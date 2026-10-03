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


class MissingIdentityError(Exception):
    """Raised when the JWT authorizer's claims are missing or malformed --
    distinct from a missing environment variable, so handler can report it
    with an accurate message instead of a misleading one."""


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def log_bedrock_usage(operation, **fields):
    """See profile-service's log_bedrock_usage — same convention, filter with:
    fields @message | filter @message like /BEDROCK_USAGE/"""
    print("BEDROCK_USAGE " + json.dumps({"service": "job-service", "operation": operation, **fields}))


def get_table():
    return dynamodb.Table(os.environ["JOB_DESCRIPTIONS_TABLE_NAME"])


def get_user_id(event):
    """The verified Cognito sub for the caller -- the only trustworthy source
    of identity. Never derive this from the request body/query string; a
    client-supplied value there is exactly the vulnerability this replaces."""
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        raise MissingIdentityError(
            "JWT authorizer context missing or malformed -- is the authorizer attached to this route?"
        )


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def embed_text(text, job_id=None):
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
    log_bedrock_usage(
        "embed_job_description",
        model="titan-embed-v2",
        job_id=job_id,
        input_tokens=payload.get("inputTextTokenCount"),
    )
    embedding = payload.get("embedding")
    if embedding is None:
        return None
    return [Decimal(str(value)) for value in embedding]


def strip_embedding(job_description):
    return {k: v for k, v in job_description.items() if k != "embedding"}


def write_job_description(table, user_id, job_id, company_name, job_title, raw_description, created_at):
    warnings = []

    try:
        embedding = embed_text(raw_description, job_id)
    except Exception as exc:
        print(f"embed_text failed for job_id {job_id!r}: {exc}")
        embedding = None
        warnings.append("raw_description: embedding failed, will be computed on the fly when this job is used for tailoring")

    item = {
        "user_id": user_id,
        "job_id": job_id,
        "company_name": company_name,
        "job_title": job_title,
        "raw_description": raw_description,
        "embedding": embedding,
        "created_at": created_at,
    }
    table.put_item(Item=item)
    return item, warnings


def save_job_description(table, user_id, company_name, job_title, raw_description):
    job_id = str(uuid.uuid4())
    return write_job_description(
        table, user_id, job_id, company_name, job_title, raw_description, now_iso()
    )


def update_job_description(table, user_id, job_id, company_name, job_title, raw_description):
    existing = get_job_description_by_id(table, user_id, job_id)
    if not existing:
        return None

    if raw_description == existing.get("raw_description"):
        item = dict(existing)
        item["company_name"] = company_name
        item["job_title"] = job_title
        item["raw_description"] = raw_description
        table.put_item(Item=item)
        return item, []

    return write_job_description(
        table,
        user_id,
        job_id,
        company_name,
        job_title,
        raw_description,
        existing.get("created_at") or now_iso(),
    )


def get_job_description_by_id(table, user_id, job_id):
    return table.get_item(Key={"user_id": user_id, "job_id": job_id}).get("Item")


def list_job_descriptions(table, user_id):
    result = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = result.get("Items", [])
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return [strip_embedding(item) for item in items]


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")
        table = get_table()

        if raw_path == "/job-description/list" and http_method == "GET":
            user_id = get_user_id(event)
            return response(200, {"job_descriptions": list_job_descriptions(table, user_id)})

        if raw_path == "/job-description" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            job_id = query_params.get("job_id")
            user_id = get_user_id(event)

            if not job_id:
                return response(400, {"error": "job_id query parameter is required"})

            job_description = get_job_description_by_id(table, user_id, job_id)

            if not job_description:
                return response(404, {"error": "Job description not found"})

            return response(200, strip_embedding(job_description))

        if raw_path == "/job-description" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            company_name = (data.get("company_name") or "").strip()
            job_title = (data.get("job_title") or "").strip()
            raw_description = (data.get("raw_description") or "").strip()
            job_id = (data.get("job_id") or "").strip() or None

            if not company_name:
                return response(400, {"error": "company_name is required"})
            if not job_title:
                return response(400, {"error": "job_title is required"})
            if not raw_description:
                return response(400, {"error": "raw_description is required"})

            if job_id is not None:
                updated = update_job_description(
                    table, user_id, job_id, company_name, job_title, raw_description
                )
                if updated is None:
                    return response(404, {"error": "Job description not found"})
                item, embedding_warnings = updated
                message = "Job description updated successfully"
            else:
                item, embedding_warnings = save_job_description(
                    table, user_id, company_name, job_title, raw_description
                )
                message = "Job description saved successfully"

            result = {
                "message": message,
                "job_id": item["job_id"],
                "company_name": company_name,
                "job_title": job_title,
            }
            if embedding_warnings:
                result["embedding_warnings"] = embedding_warnings

            return response(200, result)

        return response(405, {"error": f"Method {http_method} not allowed"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except MissingIdentityError as exc:
        return response(500, {"error": str(exc)})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
