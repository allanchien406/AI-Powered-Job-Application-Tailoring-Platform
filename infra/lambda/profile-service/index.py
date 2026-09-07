import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3


dynamodb = boto3.resource("dynamodb")
bedrock_runtime = boto3.client("bedrock-runtime")


class DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal; json.dumps doesn't know how to serialize those."""

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
    return dynamodb.Table(os.environ["PROFILES_TABLE_NAME"])


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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
    # DynamoDB's number type doesn't accept native floats — store as Decimal.
    return [Decimal(str(value)) for value in embedding]


def entry_text_unchanged(existing_entry, new_entry, text_keys):
    if not existing_entry:
        return False
    return all(existing_entry.get(key) == new_entry.get(key) for key in text_keys)


def attach_embeddings(new_entries, existing_entries, text_keys):
    """Reuse a cached embedding for an entry whose text hasn't changed since the
    last save; only call Bedrock for entries that are new or edited.

    Matched by identity field (the first of text_keys — "name" for projects,
    "title" for experience) rather than array position, so reordering entries or
    deleting an earlier one doesn't cascade into needless re-embeds for entries
    whose content didn't actually change. If two entries share the same identity
    value, the later one in the stored list wins the lookup — an acceptable edge
    case at this scale, not worth a more elaborate identity scheme yet.

    A Bedrock failure while embedding a new/changed entry does NOT fail the
    whole save — the entry is stored with embedding=None and a warning is
    returned instead. This is safe to leave for later: tailoring-service
    already falls back to embedding inline if an entry has no cached vector,
    and the "existing_entry.get('embedding')" check below means the *next*
    successful save automatically retries any entry stuck at None.
    """
    identity_key = text_keys[0]
    existing_by_identity = {
        existing_entry.get(identity_key): existing_entry
        for existing_entry in existing_entries
        if isinstance(existing_entry, dict) and existing_entry.get(identity_key)
    }

    result = []
    warnings = []
    for entry in new_entries:
        existing_entry = existing_by_identity.get(entry.get(identity_key))
        if entry_text_unchanged(existing_entry, entry, text_keys) and existing_entry.get("embedding"):
            entry = {**entry, "embedding": existing_entry["embedding"]}
        else:
            combined_text = " ".join(entry.get(key, "") for key in text_keys)
            try:
                entry = {**entry, "embedding": embed_text(combined_text)}
            except Exception as exc:
                # Broad on purpose: whatever went wrong with Bedrock, the
                # user's actual data must still get saved.
                identity_value = entry.get(identity_key) or "(unnamed entry)"
                print(f"embed_text failed for {identity_value!r}: {exc}")
                entry = {**entry, "embedding": None}
                warnings.append(f"{identity_value}: embedding failed, will retry on next save")
        result.append(entry)
    return result, warnings


def strip_embeddings(profile):
    """Embeddings are internal plumbing for tailoring-service — don't echo
    ~1500-float vectors back through the public API."""

    def without_embedding(entries):
        return [{k: v for k, v in entry.items() if k != "embedding"} for entry in entries]

    return {
        **profile,
        "projects": without_embedding(profile.get("projects", [])),
        "experience": without_embedding(profile.get("experience", [])),
    }


def get_profile_by_email(table, email):
    return table.get_item(Key={"email": email}).get("Item")


def save_profile(table, normalized_profile):
    email = normalized_profile["email"]
    existing = get_profile_by_email(table, email) or {}

    projects, project_warnings = attach_embeddings(
        normalized_profile["projects"], existing.get("projects", []), ["name", "description"]
    )
    experience, experience_warnings = attach_embeddings(
        normalized_profile["experience"], existing.get("experience", []), ["title", "description"]
    )

    item = {
        "email": email,
        "full_name": normalized_profile["full_name"],
        "skills": normalized_profile["skills"],
        "projects": projects,
        "experience": experience,
        "created_at": existing.get("created_at", now_iso()),
        "updated_at": now_iso(),
    }
    table.put_item(Item=item)
    return item, project_warnings + experience_warnings


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        table = get_table()

        if event.get("rawPath") == "/profile" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            email = query_params.get("email")

            if not email:
                return response(400, {"error": "email query parameter is required"})

            profile = get_profile_by_email(table, email)

            if not profile:
                return response(404, {"error": "Profile not found"})

            return response(200, strip_embeddings(profile))

        if event.get("rawPath") == "/profile" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            normalized_profile = normalize_profile_payload(data)
            email = normalized_profile["email"]

            if not email:
                return response(400, {"error": "email is required"})

            item, embedding_warnings = save_profile(table, normalized_profile)

            result = {"message": "Profile saved successfully", **strip_embeddings(item)}
            if embedding_warnings:
                result["embedding_warnings"] = embedding_warnings

            return response(200, result)

        return response(405, {"error": f"Method {http_method} not allowed"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
