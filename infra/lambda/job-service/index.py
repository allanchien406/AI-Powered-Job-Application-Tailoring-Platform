import json
import os

import boto3
import pg8000


def response(status_code, body):
	return {
		"statusCode": status_code,
		"headers": {"content-type": "application/json"},
		"body": json.dumps(body),
	}


def get_db_credentials():
	secret_arn = os.environ["DB_SECRET_ARN"]
	secrets_client = boto3.client("secretsmanager")
	secret_value = secrets_client.get_secret_value(SecretId=secret_arn)
	secret_string = secret_value.get("SecretString")

	if not secret_string:
		raise ValueError("Database secret is missing SecretString")

	return json.loads(secret_string)


def get_db_connection(credentials):
	return pg8000.connect(
		host=os.environ["DB_HOST"],
		port=int(os.environ["DB_PORT"]),
		database=os.environ["DB_NAME"],
		user=credentials["username"],
		password=credentials["password"],
		timeout=5,
	)


def create_job_descriptions_table(conn):
	cur = conn.cursor()
	cur.execute(
		"""
		CREATE TABLE IF NOT EXISTS job_descriptions (
			id SERIAL PRIMARY KEY,
			company_name TEXT NOT NULL,
			job_title TEXT NOT NULL,
			raw_description TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		"""
	)
	conn.commit()
	cur.close()


def save_job_description(conn, company_name, job_title, raw_description):
	cur = conn.cursor()
	cur.execute(
		"""
		INSERT INTO job_descriptions (company_name, job_title, raw_description)
		VALUES (%s, %s, %s)
		RETURNING id;
		""",
		(company_name, job_title, raw_description),
	)
	job_id = cur.fetchone()[0]
	conn.commit()
	cur.close()
	return job_id


def get_job_description_by_id(conn, job_id):
	cur = conn.cursor()
	cur.execute(
		"""
		SELECT id, company_name, job_title, raw_description
		FROM job_descriptions
		WHERE id = %s;
		""",
		(job_id,),
	)
	row = cur.fetchone()
	cur.close()

	if not row:
		return None

	return {
		"job_id": row[0],
		"company_name": row[1],
		"job_title": row[2],
		"raw_description": row[3],
	}


def handler(event, context):
	try:
		http_method = event.get("requestContext", {}).get("http", {}).get("method")

		credentials = get_db_credentials()
		conn = get_db_connection(credentials)
		try:
			create_job_descriptions_table(conn)

			raw_path = event.get("rawPath")

			if raw_path == "/job-description" and http_method == "GET":
				query_params = event.get("queryStringParameters") or {}
				job_id = query_params.get("job_id")

				if not job_id:
					return response(400, {"error": "job_id query parameter is required"})

				try:
					job_id_int = int(job_id)
				except ValueError:
					return response(400, {"error": "job_id must be an integer"})

				job_description = get_job_description_by_id(conn, job_id_int)

				if not job_description:
					return response(404, {"error": "Job description not found"})

				return response(200, job_description)

			if raw_path == "/job-description" and http_method == "PUT":
				body = event.get("body")
				data = json.loads(body) if body else {}

				company_name = data.get("company_name")
				job_title = data.get("job_title")
				raw_description = data.get("raw_description")

				if not company_name:
					return response(400, {"error": "company_name is required"})
				if not job_title:
					return response(400, {"error": "job_title is required"})
				if not raw_description:
					return response(400, {"error": "raw_description is required"})

				job_id = save_job_description(conn, company_name, job_title, raw_description)

				return response(
					200,
					{
						"message": "Job description saved successfully",
						"job_id": job_id,
						"company_name": company_name,
						"job_title": job_title,
					},
				)

			return response(405, {"error": f"Method {http_method} not allowed"})
		finally:
			conn.close()

	except json.JSONDecodeError:
		return response(400, {"error": "Invalid JSON body"})
	except KeyError as exc:
		return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
	except Exception as exc:
		return response(500, {"error": str(exc)})
