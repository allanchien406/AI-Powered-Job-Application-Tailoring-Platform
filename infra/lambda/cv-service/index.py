import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key


dynamodb = boto3.resource("dynamodb")


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


def get_table():
    return dynamodb.Table(os.environ["CVS_TABLE_NAME"])


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


# A DynamoDB item is capped at 400KB, and this service is fed straight from a
# live editor -- a user can paste an arbitrarily long job description, a very
# long summary, or dozens of experience entries, and a single oversized item
# fails the whole save. Every field below is therefore capped, sized so the
# worst case of a maximal payload is ~290KB (comfortably inside the limit).
# Truncation warns rather than rejecting, matching profile-service's
# graceful-degradation discipline: a slightly clipped CV is recoverable, a
# failed save loses the user's work.
MAX_SHORT_CHARS = 200
MAX_PERIOD_CHARS = 80
MAX_DESCRIPTION_CHARS = 2000
MAX_COURSEWORK_CHARS = 2000
MAX_BULLET_CHARS = 250
MAX_BULLETS = 8
MAX_SUMMARY_CHARS = 20000
MAX_REFERENCES_CHARS = 2000
MAX_ADDITIONAL = 30
MAX_ADDITIONAL_CHARS = 500
MAX_EXPERIENCE = 40
MAX_EDUCATION = 15
MAX_ENTRY_SECTIONS = 15
MAX_SKILLS = 60
# The job_ref snapshot only feeds the dashboard's "has this job been edited
# since?" comparison, so clipping its tail is far cheaper than failing a save.
MAX_JOB_REF_CHARS = 20000


def normalize_text(value, max_chars=MAX_SHORT_CHARS):
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_chars]


def normalize_object_list(values, string_keys, max_items, char_caps):
    """Coerce a list of objects to a known shape: every declared string key is
    present (defaulting to ""), non-dict entries are dropped, and the list is
    capped. Mirrors profile-service's `normalize_entry_list`.

    `char_caps` maps each key to its cap, because a role/company/period is
    short while a description or coursework is not."""
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values[:max_items]:
        if not isinstance(value, dict):
            continue

        normalized_entry = {}
        for key in string_keys:
            # `id` is passed through rather than trimmed-to-empty: the dashboard
            # uses it as the React key for the entry, and re-minting it on save
            # would remount that row in the editor.
            if key == "id":
                entry_id = value.get("id")
                if isinstance(entry_id, str) and entry_id.strip():
                    normalized_entry["id"] = entry_id.strip()
                else:
                    normalized_entry["id"] = str(uuid.uuid4())
                continue
            normalized_entry[key] = normalize_text(value.get(key), char_caps.get(key, MAX_SHORT_CHARS))

        if not any(v for k, v in normalized_entry.items() if k != "id"):
            continue

        normalized_values.append(normalized_entry)

    return normalized_values


def normalize_bullet_list(values):
    if not isinstance(values, list):
        return []
    return [
        b
        for b in (normalize_text(v, MAX_BULLET_CHARS) for v in values[:MAX_BULLETS])
        if b
    ]


def normalize_skills(values):
    """`SkillEntry` is {name, level?} with level an optional 1-10 integer that
    the Modern template draws its bar from. Drop an out-of-range level rather
    than the whole skill -- a levelless skill still renders, just without a bar,
    so a bad level shouldn't cost the user the entry."""
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values[:MAX_SKILLS]:
        if isinstance(value, str):
            name = normalize_text(value)
            if name:
                normalized_values.append({"name": name})
            continue
        if not isinstance(value, dict):
            continue

        name = normalize_text(value.get("name"))
        if not name:
            continue

        level = value.get("level")
        try:
            level = int(level)
        except (TypeError, ValueError):
            level = None

        if level is not None and 1 <= level <= 10:
            normalized_values.append({"name": name, "level": level})
        else:
            normalized_values.append({"name": name})

    return normalized_values


def normalize_string_list(values):
    if not isinstance(values, list):
        return []
    return [
        s
        for s in (normalize_text(v, MAX_ADDITIONAL_CHARS) for v in values[:MAX_ADDITIONAL])
        if s
    ]


def normalize_cv_payload(data):
    """Coerce a request body into the stored item's shape. Returns
    (item_fields, warnings) -- a truncation is reported but never fails the
    save, the same graceful-degradation discipline profile-service uses for a
    failed embedding."""
    warnings = []

    job_ref_raw_description = normalize_text(
        (data.get("job_ref") or {}).get("raw_description"), MAX_JOB_REF_CHARS
    )
    if len(job_ref_raw_description) == MAX_JOB_REF_CHARS:
        warnings.append(
            f"job_ref.raw_description truncated to {MAX_JOB_REF_CHARS} characters; "
            "it is only used to detect edits to the job, not for generation"
        )

    job_ref = {
        "company_name": normalize_text((data.get("job_ref") or {}).get("company_name")),
        "job_title": normalize_text((data.get("job_ref") or {}).get("job_title")),
        "raw_description": job_ref_raw_description,
    }

    meta = {
        "companyName": normalize_text((data.get("meta") or {}).get("companyName")),
        "jobTitle": normalize_text((data.get("meta") or {}).get("jobTitle")),
    }

    # The `cv` document is the full CVData the dashboard renders. Every field is
    # coerced rather than passed through, because it comes straight from an
    # editor and a malformed value here would break the templates' render
    # (e.g. `.map` on a non-array) with a 500 in the middle of a user's typing.
    source_cv = data.get("cv") if isinstance(data.get("cv"), dict) else {}

    # EntrySection lists (projects/research) get their own pass rather than
    # normalize_object_list, because each entry carries its own `bullets` array
    # and optional org/period that must stay paired with their own entry.
    def normalize_entry_sections(key):
        raw = source_cv.get(key)
        if not isinstance(raw, list):
            return []
        result = []
        for value in raw[:MAX_ENTRY_SECTIONS]:
            if not isinstance(value, dict):
                continue
            title = normalize_text(value.get("title"))
            org = normalize_text(value.get("org"))
            period = normalize_text(value.get("period"), MAX_PERIOD_CHARS)
            bullets = normalize_bullet_list(value.get("bullets"))
            entry_id = value.get("id")
            if not (title or org or bullets):
                continue
            result.append(
                {
                    "id": entry_id.strip()
                    if isinstance(entry_id, str) and entry_id.strip()
                    else str(uuid.uuid4()),
                    "title": title,
                    **({"org": org} if org else {}),
                    **({"period": period} if period else {}),
                    "bullets": bullets,
                }
            )
        return result

    cv = {
        "name": normalize_text(source_cv.get("name")),
        "title": normalize_text(source_cv.get("title")),
        "email": normalize_text(source_cv.get("email")),
        "phone": normalize_text(source_cv.get("phone")),
        "location": normalize_text(source_cv.get("location")),
        "website": normalize_text(source_cv.get("website")),
        "linkedin": normalize_text(source_cv.get("linkedin")),
        "summary": normalize_text(source_cv.get("summary"), MAX_SUMMARY_CHARS),
        "experience": normalize_object_list(
            source_cv.get("experience"),
            ["id", "company", "role", "period", "description"],
            MAX_EXPERIENCE,
            {
                "company": MAX_SHORT_CHARS,
                "role": MAX_SHORT_CHARS,
                "period": MAX_PERIOD_CHARS,
                "description": MAX_DESCRIPTION_CHARS,
            },
        ),
        "education": normalize_object_list(
            source_cv.get("education"),
            ["id", "institution", "degree", "period", "coursework"],
            MAX_EDUCATION,
            {
                "institution": MAX_SHORT_CHARS,
                "degree": MAX_SHORT_CHARS,
                "period": MAX_PERIOD_CHARS,
                "coursework": MAX_COURSEWORK_CHARS,
            },
        ),
        "skills": normalize_skills(source_cv.get("skills")),
        "accentColor": normalize_text(source_cv.get("accentColor")) or "#2c4a3e",
        "projects": normalize_entry_sections("projects"),
        "research": normalize_entry_sections("research"),
    }

    additional = normalize_string_list(source_cv.get("additional"))
    if additional:
        cv["additional"] = additional
    references_note = normalize_text(source_cv.get("referencesNote"), MAX_REFERENCES_CHARS)
    if references_note:
        cv["referencesNote"] = references_note

    return (
        {
            **(
                {"job_id": normalize_text(data.get("job_id"))}
                if normalize_text(data.get("job_id"))
                else {}
            ),
            "meta": meta,
            "job_ref": job_ref,
            "template_id": normalize_text(data.get("template_id")) or "modern",
            "generated_at": normalize_text(data.get("generated_at")) or now_iso(),
            "cv": cv,
        },
        warnings,
    )


def get_cv_by_id(table, user_id, cv_id):
    return table.get_item(Key={"user_id": user_id, "cv_id": cv_id}).get("Item")


def list_cvs(table, user_id):
    result = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = result.get("Items", [])
    # Ordered by generated_at, not updated_at: the dashboard autosaves on a
    # debounce, so sorting by updated_at would reshuffle the user's list on
    # every keystroke-burst.
    items.sort(key=lambda item: item.get("generated_at", ""), reverse=True)
    return items


def save_cv(table, user_id, cv_id, normalized):
    existing = get_cv_by_id(table, user_id, cv_id) if cv_id else None

    item = {
        "user_id": user_id,
        "cv_id": cv_id or str(uuid.uuid4()),
        **normalized,
        "created_at": (existing or {}).get("created_at", now_iso()),
        "updated_at": now_iso(),
    }
    table.put_item(Item=item)
    return item


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")
        table = get_table()

        if raw_path == "/cv/list" and http_method == "GET":
            user_id = get_user_id(event)
            return response(200, {"cvs": list_cvs(table, user_id)})

        if raw_path == "/cv" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            cv_id = (query_params.get("cv_id") or "").strip()
            user_id = get_user_id(event)

            if not cv_id:
                return response(400, {"error": "cv_id query parameter is required"})

            cv = get_cv_by_id(table, user_id, cv_id)

            if not cv:
                return response(404, {"error": "CV not found"})

            return response(200, cv)

        if raw_path == "/cv" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            cv_id = (data.get("cv_id") or "").strip() or None
            normalized, warnings = normalize_cv_payload(data)

            item = save_cv(table, user_id, cv_id, normalized)

            result = {
                "message": "CV saved successfully",
                "cv_id": item["cv_id"],
                "job_id": item.get("job_id"),
                "generated_at": item["generated_at"],
                "updated_at": item["updated_at"],
            }
            if warnings:
                result["warnings"] = warnings

            return response(200, result)

        if raw_path == "/cv" and http_method == "DELETE":
            query_params = event.get("queryStringParameters") or {}
            cv_id = (query_params.get("cv_id") or "").strip()
            user_id = get_user_id(event)

            if not cv_id:
                return response(400, {"error": "cv_id query parameter is required"})

            # Idempotent: a delete button is a double-click target, and
            # "already gone" is a worse experience than a silent success. The
            # user_id partition still scopes the delete, so this can never
            # remove another user's CV.
            table.delete_item(Key={"user_id": user_id, "cv_id": cv_id})
            return response(200, {"message": "CV deleted successfully", "cv_id": cv_id})

        return response(405, {"error": f"Method {http_method} not allowed"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except MissingIdentityError as exc:
        return response(500, {"error": str(exc)})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
