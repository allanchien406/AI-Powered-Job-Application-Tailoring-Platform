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



def handler(event, context):
    try:
        body = event.get("body")
        data = json.loads(body) if body else {}

        email = data.get("email")
        full_name = data.get("full_name")

        if not email:
            return response(400, {"error": "email is required"})

        credentials = get_db_credentials()

        conn = get_db_connection(credentials)
        try:
            create_profiles_table(conn)
            profile_id = save_profile(conn, email, full_name, data)
        finally:
            conn.close()

        return response(
            200,
            {
                "message": "Profile saved successfully",
                "profile_id": profile_id,
                "email": email,
            },
        )

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})