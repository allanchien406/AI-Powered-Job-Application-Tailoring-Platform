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
    """DynamoDB returns numbers as Decimal; json.dumps doesn't know how to serialize those."""

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
    """One structured line per Bedrock call so real token counts can be
    pulled from CloudWatch Logs Insights instead of guessed — see PLAN.md's
    "Measuring cost per user" section. Filter with:
    fields @message | filter @message like /BEDROCK_USAGE/"""
    print("BEDROCK_USAGE " + json.dumps({"service": "profile-service", "operation": operation, **fields}))


def get_table():
    return dynamodb.Table(os.environ["PROFILES_TABLE_NAME"])


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


def normalize_string_list(values):
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values:
        if isinstance(value, str) and value.strip():
            normalized_values.append(value.strip())

    return normalized_values


def normalize_entry_list(values, required_keys, assign_id=False):
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

        if assign_id:
            # Stable identity for the entry's own DynamoDB item
            # (PROJECT#<id> / EXPERIENCE#<id>) -- minted once, then
            # round-tripped by the frontend on every subsequent edit.
            entry_id = value.get("id")
            normalized_entry["id"] = (
                entry_id.strip() if isinstance(entry_id, str) and entry_id.strip() else str(uuid.uuid4())
            )

        normalized_values.append(normalized_entry)

    return normalized_values


def normalize_profile_payload(data):
    email = data.get("email")
    full_name = data.get("full_name")

    return {
        "full_name": full_name.strip() if isinstance(full_name, str) else "",
        "email": email.strip().lower() if isinstance(email, str) else "",
        "skills": normalize_string_list(data.get("skills")),
        "projects": normalize_entry_list(data.get("projects"), ["name", "period", "description"], assign_id=True),
        "experience": normalize_entry_list(data.get("experience"), ["title", "company", "period", "description"], assign_id=True),
        "education": normalize_entry_list(data.get("education"), ["institution", "degree", "period", "description"]),
    }


def embed_text(text, identity_value=None):
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
        "embed_entry",
        model="titan-embed-v2",
        entry=identity_value,
        input_tokens=payload.get("inputTextTokenCount"),
    )
    embedding = payload.get("embedding")
    if embedding is None:
        return None
    # DynamoDB's number type doesn't accept native floats — store as Decimal.
    return [Decimal(str(value)) for value in embedding]


def entry_text_unchanged(existing_entry, new_entry, text_keys):
    if not existing_entry:
        return False
    # (x or "") treats a missing key the same as an empty string, so adding a
    # new field to text_keys later (like "company") doesn't make every
    # pre-existing entry look "changed" just because the old stored item
    # predates that field.
    return all((existing_entry.get(key) or "") == (new_entry.get(key) or "") for key in text_keys)


def attach_embeddings(new_entries, existing_entries, text_keys):
    """Reuse a cached embedding for an entry whose text hasn't changed since the
    last save; only call Bedrock for entries that are new or edited.

    `text_keys` is the embed-relevant subset of an entry's fields, not all of
    them -- e.g. `period` (dates) is deliberately left out: it's not semantic
    content worth embedding, and editing only the dates shouldn't trigger a
    re-embed. The full entry (including `period`) is still what gets stored.

    Matched by `id` first (stable across renames/reorders), falling back to
    identity field (the first of text_keys -- "name" for projects, "title"
    for experience) for an entry that doesn't have an id yet. If two
    id-less entries share the same identity value, the later one in the
    stored list wins the lookup -- an acceptable edge case at this scale.

    A Bedrock failure while embedding a new/changed entry does NOT fail the
    whole save -- the entry is stored with embedding=None and a warning is
    returned instead. This is safe to leave for later: tailoring-service
    already falls back to embedding inline if an entry has no cached vector,
    and the "existing_entry.get('embedding')" check below means the *next*
    successful save automatically retries any entry stuck at None.
    """
    identity_key = text_keys[0]
    existing_by_id = {
        existing_entry["id"]: existing_entry
        for existing_entry in existing_entries
        if isinstance(existing_entry, dict) and existing_entry.get("id")
    }
    existing_by_identity = {
        existing_entry.get(identity_key): existing_entry
        for existing_entry in existing_entries
        if isinstance(existing_entry, dict) and existing_entry.get(identity_key)
    }

    result = []
    warnings = []
    for entry in new_entries:
        existing_entry = existing_by_id.get(entry.get("id"))
        if existing_entry is None:
            existing_entry = existing_by_identity.get(entry.get(identity_key))

        if entry_text_unchanged(existing_entry, entry, text_keys) and existing_entry.get("embedding"):
            entry = {**entry, "embedding": existing_entry["embedding"]}
        else:
            combined_text = " ".join(entry.get(key, "") for key in text_keys)
            identity_value = entry.get(identity_key) or "(unnamed entry)"
            try:
                entry = {**entry, "embedding": embed_text(combined_text, identity_value)}
            except Exception as exc:
                # Broad on purpose: whatever went wrong with Bedrock, the
                # user's actual data must still get saved.
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


def query_profile_items(table, user_id):
    items = []
    kwargs = {"KeyConditionExpression": Key("user_id").eq(user_id)}
    while True:
        page = table.query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def assemble_profile(items):
    """Group the flat multi-item Query result back into the profile shape
    the rest of this service (and its API response) expects. Returns None
    if there's no PROFILE base item -- i.e. the user has no saved profile."""
    base = None
    projects = []
    experience = []
    for item in items:
        key = item.get("entity_key", "")
        if key == "PROFILE":
            base = item
        elif key.startswith("PROJECT#"):
            projects.append(item)
        elif key.startswith("EXPERIENCE#"):
            experience.append(item)

    if base is None:
        return None

    def strip_storage_keys(entry):
        return {k: v for k, v in entry.items() if k not in ("user_id", "entity_key", "order")}

    projects.sort(key=lambda e: e.get("order", 0))
    experience.sort(key=lambda e: e.get("order", 0))

    return {
        "user_id": base["user_id"],
        "email": base.get("email", ""),
        "full_name": base.get("full_name", ""),
        "skills": base.get("skills", []),
        "education": base.get("education", []),
        "projects": [strip_storage_keys(p) for p in projects],
        "experience": [strip_storage_keys(e) for e in experience],
        "created_at": base.get("created_at"),
        "updated_at": base.get("updated_at"),
    }


def save_profile(table, user_id, normalized_profile):
    existing_items = query_profile_items(table, user_id)
    existing_profile = assemble_profile(existing_items) or {}
    existing_by_key = {item["entity_key"]: item for item in existing_items}

    projects, project_warnings = attach_embeddings(
        normalized_profile["projects"], existing_profile.get("projects", []), ["name", "description"]
    )
    experience, experience_warnings = attach_embeddings(
        normalized_profile["experience"], existing_profile.get("experience", []), ["title", "company", "description"]
    )

    now = now_iso()
    base_item = {
        "user_id": user_id,
        "entity_key": "PROFILE",
        "email": normalized_profile["email"],
        "full_name": normalized_profile["full_name"],
        "skills": normalized_profile["skills"],
        "education": normalized_profile["education"],
        "created_at": existing_by_key.get("PROFILE", {}).get("created_at", now),
        "updated_at": now,
    }

    final_items = [base_item]
    for prefix, entries in (("PROJECT#", projects), ("EXPERIENCE#", experience)):
        for order, entry in enumerate(entries):
            final_items.append({**entry, "user_id": user_id, "entity_key": f"{prefix}{entry['id']}", "order": order})

    final_keys = {item["entity_key"] for item in final_items}
    # Anything in existing_by_key not in final_keys gets deleted below -- this
    # function owns the full set of recognized entity_key types (PROFILE,
    # PROJECT#, EXPERIENCE#), so a future entity type added elsewhere without
    # updating this function would have its items silently deleted here.
    keys_to_delete = [key for key in existing_by_key if key not in final_keys]

    with table.batch_writer(overwrite_by_pkeys=["user_id", "entity_key"]) as batch:
        for item in final_items:
            # Skip rewriting an entry that hasn't changed at all (content or
            # order) -- the whole point of splitting entries into their own
            # items is that an untouched project shouldn't cost a write just
            # because a sibling entry changed.
            if existing_by_key.get(item["entity_key"]) == item:
                continue
            batch.put_item(Item=item)
        for key in keys_to_delete:
            batch.delete_item(Key={"user_id": user_id, "entity_key": key})

    return assemble_profile(final_items), project_warnings + experience_warnings


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        table = get_table()

        if event.get("rawPath") == "/profile" and http_method == "GET":
            user_id = get_user_id(event)
            profile = assemble_profile(query_profile_items(table, user_id))

            if not profile:
                return response(404, {"error": "Profile not found"})

            return response(200, strip_embeddings(profile))

        if event.get("rawPath") == "/profile" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            normalized_profile = normalize_profile_payload(data)

            item, embedding_warnings = save_profile(table, user_id, normalized_profile)

            result = {"message": "Profile saved successfully", **strip_embeddings(item)}
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
