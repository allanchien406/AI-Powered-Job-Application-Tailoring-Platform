import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key


dynamodb = boto3.resource("dynamodb")
bedrock_runtime = boto3.client("bedrock-runtime")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def get_table():
    return dynamodb.Table(os.environ["JOB_DESCRIPTIONS_TABLE_NAME"])


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def embed_text(text):
    if not text or not text.strip():
        return None

    body = json.dumps({"inputText": text[:8000]})
    resp = bedrock_runtime.invoke_model(
        modelId=os.environ["BEDROCK_EMBEDDING_MODEL_ID"],
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(resp["body"].read())
    embedding = payload.get("embedding")
    if embedding is None:
        return None
    return [Decimal(str(value)) for value in embedding]


def strip_embedding(job_description):
    return {k: v for k, v in job_description.items() if k != "embedding"}


def save_job_description(table, email, company_name, job_title, raw_description):
    job_id = str(uuid.uuid4())
    item = {
        "email": email,
        "job_id": job_id,
        "company_name": company_name,
        "job_title": job_title,
        "raw_description": raw_description,
        "embedding": embed_text(raw_description),
        "created_at": now_iso(),
    }
    table.put_item(Item=item)
    return item


def get_job_description_by_id(table, email, job_id):
    return table.get_item(Key={"email": email, "job_id": job_id}).get("Item")


def list_job_descriptions(table, email):
    result = table.query(KeyConditionExpression=Key("email").eq(email))
    items = result.get("Items", [])
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return [strip_embedding(item) for item in items]


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")
        table = get_table()

        if raw_path == "/job-description/list" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            email = query_params.get("email")

            if not email:
                return response(400, {"error": "email query parameter is required"})

            return response(200, {"job_descriptions": list_job_descriptions(table, email)})

        if raw_path == "/job-description" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            email = query_params.get("email")
            job_id = query_params.get("job_id")

            if not email or not job_id:
                return response(400, {"error": "email and job_id query parameters are required"})

            job_description = get_job_description_by_id(table, email, job_id)

            if not job_description:
                return response(404, {"error": "Job description not found"})

            return response(200, strip_embedding(job_description))

        if raw_path == "/job-description" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            email = data.get("email")
            company_name = data.get("company_name")
            job_title = data.get("job_title")
            raw_description = data.get("raw_description")

            if not email:
                return response(400, {"error": "email is required"})
            if not company_name:
                return response(400, {"error": "company_name is required"})
            if not job_title:
                return response(400, {"error": "job_title is required"})
            if not raw_description:
                return response(400, {"error": "raw_description is required"})

            item = save_job_description(table, email, company_name, job_title, raw_description)

            return response(
                200,
                {
                    "message": "Job description saved successfully",
                    "job_id": item["job_id"],
                    "email": email,
                    "company_name": company_name,
                    "job_title": job_title,
                },
            )

        return response(405, {"error": f"Method {http_method} not allowed"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
