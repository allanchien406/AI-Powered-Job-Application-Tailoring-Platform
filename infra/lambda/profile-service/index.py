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


def normalize_string_list(values):
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values:
        if isinstance(value, str) and value.strip():
            normalized_values.append(value.strip())

    return normalized_values


def normalize_entry_list(values, required_keys):
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values:
        if not isinstance(value, dict):
            continue

        normalized_entry = {}
        for key in required_keys:
            entry_value = value.get(key)
            if isinstance(entry_value, str):
                normalized_entry[key] = entry_value.strip()
            else:
                normalized_entry[key] = ""

        if not any(normalized_entry.values()):
            continue

        normalized_values.append(normalized_entry)

    return normalized_values


def normalize_profile_payload(data):
    email = data.get("email")
    full_name = data.get("full_name")

    return {
        "full_name": full_name.strip() if isinstance(full_name, str) else "",
        "email": email.strip().lower() if isinstance(email, str) else "",
        "skills": normalize_string_list(data.get("skills")),
        "projects": normalize_entry_list(data.get("projects"), ["name", "description"]),
        "experience": normalize_entry_list(data.get("experience"), ["title", "description"]),
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



def create_profiles_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS profiles (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            full_name TEXT,
            profile_data JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    conn.commit()
    cur.close()



def save_profile(conn, email, full_name, profile_data):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO profiles (email, full_name, profile_data)
        VALUES (%s, %s, %s::jsonb)
        ON CONFLICT (email)
        DO UPDATE SET
            full_name = EXCLUDED.full_name,
            profile_data = EXCLUDED.profile_data,
            updated_at = NOW()
        RETURNING id;
        """,
        (email, full_name, json.dumps(profile_data)),
    )
    profile_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    return profile_id


def get_profile_by_email(conn, email):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, email, full_name, profile_data
        FROM profiles
        WHERE email = %s;
        """,
        (email,),
    )
    row = cur.fetchone()
    cur.close()

    if not row:
        return None

    profile_data = row[3] if isinstance(row[3], dict) else {}
    normalized_profile = normalize_profile_payload(profile_data)
    normalized_profile["email"] = row[1]
    normalized_profile["full_name"] = row[2] or normalized_profile["full_name"]

    return {"profile_id": row[0], **normalized_profile}



def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")

        credentials = get_db_credentials()

        conn = get_db_connection(credentials)
        try:
            create_profiles_table(conn)

            if event.get("rawPath") == "/profile" and http_method == "GET":
                query_params = event.get("queryStringParameters") or {}
                email = query_params.get("email")

                if not email:
                    return response(400, {"error": "email query parameter is required"})

                profile = get_profile_by_email(conn, email)

                if not profile:
                    return response(404, {"error": "Profile not found"})

                return response(200, profile)

            if event.get("rawPath") == "/profile" and http_method == "PUT":
                body = event.get("body")
                data = json.loads(body) if body else {}

                normalized_profile = normalize_profile_payload(data)
                email = normalized_profile["email"]
                full_name = normalized_profile["full_name"]

                if not email:
                    return response(400, {"error": "email is required"})

                profile_id = save_profile(conn, email, full_name, normalized_profile)

                return response(
                    200,
                    {
                        "message": "Profile saved successfully",
                        "profile_id": profile_id,
                        **normalized_profile,
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