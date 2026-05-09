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


def create_cvs_table(conn):
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cvs (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            cv_data JSONB NOT NULL,
            is_archived BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_cvs_email ON cvs(email);"
    )
    conn.commit()
    cur.close()


def save_cv(conn, email, name, cv_data, cv_id=None):
    cur = conn.cursor()
    if cv_id:
        cur.execute(
            """
            UPDATE cvs
            SET name = %s, cv_data = %s::jsonb, updated_at = NOW()
            WHERE id = %s AND email = %s AND is_archived = FALSE
            RETURNING id;
            """,
            (name, json.dumps(cv_data), cv_id, email),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            cur.close()
            raise ValueError("CV not found or access denied")
    else:
        cur.execute(
            """
            INSERT INTO cvs (email, name, cv_data)
            VALUES (%s, %s, %s::jsonb)
            RETURNING id;
            """,
            (email, name, json.dumps(cv_data)),
        )
        row = cur.fetchone()
    conn.commit()
    cur.close()
    return row[0]


def get_cv_by_id(conn, cv_id, email):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, email, name, cv_data, created_at, updated_at
        FROM cvs
        WHERE id = %s AND email = %s AND is_archived = FALSE;
        """,
        (cv_id, email),
    )
    row = cur.fetchone()
    cur.close()
    if not row:
        return None
    return {
        "cv_id": row[0],
        "email": row[1],
        "name": row[2],
        "cv_data": row[3] if isinstance(row[3], dict) else {},
        "created_at": row[4].isoformat() if row[4] else None,
        "updated_at": row[5].isoformat() if row[5] else None,
    }


def list_cvs(conn, email):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, email, name, created_at, updated_at
        FROM cvs
        WHERE email = %s AND is_archived = FALSE
        ORDER BY updated_at DESC;
        """,
        (email,),
    )
    rows = cur.fetchall()
    cur.close()
    return [
        {
            "cv_id": row[0],
            "email": row[1],
            "name": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "updated_at": row[4].isoformat() if row[4] else None,
        }
        for row in rows
    ]


def delete_cv(conn, cv_id, email):
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE cvs
        SET is_archived = TRUE, updated_at = NOW()
        WHERE id = %s AND email = %s AND is_archived = FALSE
        RETURNING id;
        """,
        (cv_id, email),
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    return row is not None


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")

        credentials = get_db_credentials()
        conn = get_db_connection(credentials)
        try:
            create_cvs_table(conn)

            if raw_path == "/cv/list" and http_method == "GET":
                params = event.get("queryStringParameters") or {}
                email = params.get("email")
                if not email:
                    return response(400, {"error": "email query parameter is required"})
                cvs = list_cvs(conn, email)
                return response(200, {"cvs": cvs})

            if raw_path == "/cv" and http_method == "GET":
                params = event.get("queryStringParameters") or {}
                email = params.get("email")
                cv_id = params.get("cv_id")
                if not email or not cv_id:
                    return response(400, {"error": "email and cv_id query parameters are required"})
                result = get_cv_by_id(conn, int(cv_id), email)
                if not result:
                    return response(404, {"error": "CV not found"})
                return response(200, result)

            if raw_path == "/cv" and http_method == "PUT":
                body = event.get("body")
                data = json.loads(body) if body else {}
                email = data.get("email")
                name = data.get("name", "")
                cv_data = data.get("cv_data")
                cv_id = data.get("cv_id")

                if not email:
                    return response(400, {"error": "email is required"})
                if not cv_data:
                    return response(400, {"error": "cv_data is required"})

                new_id = save_cv(conn, email, name, cv_data, cv_id)
                return response(200, {"cv_id": new_id, "message": "CV saved successfully"})

            if raw_path == "/cv" and http_method == "DELETE":
                params = event.get("queryStringParameters") or {}
                email = params.get("email")
                cv_id = params.get("cv_id")
                if not email or not cv_id:
                    return response(400, {"error": "email and cv_id query parameters are required"})
                deleted = delete_cv(conn, int(cv_id), email)
                if not deleted:
                    return response(404, {"error": "CV not found or already deleted"})
                return response(200, {"message": "CV deleted successfully"})

            return response(405, {"error": f"Method {http_method} not allowed for {raw_path}"})

        finally:
            conn.close()

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except ValueError as exc:
        return response(400, {"error": str(exc)})
    except Exception as exc:
        return response(500, {"error": str(exc)})
