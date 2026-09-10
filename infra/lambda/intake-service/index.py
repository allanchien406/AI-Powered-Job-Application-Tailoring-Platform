import json
import os
import re

import boto3
from botocore.exceptions import ClientError


bedrock_runtime = boto3.client("bedrock-runtime")


# Keep this in sync with what PUT /profile expects (profile-service's
# normalize_profile_payload) — the whole point is that the output here can be
# reviewed by the user, then handed straight to PUT /profile.
SYSTEM_PROMPT = (
    "You are a CV intake assistant. The user gives you a free-form description of "
    "their background. Extract it into JSON with exactly this schema:\n"
    '{"full_name": string, "skills": [string], '
    '"projects": [{"name": string, "description": string}], '
    '"experience": [{"title": string, "company": string, "description": string}]}\n'
    "Rules:\n"
    "- Only include information the user actually stated. Do not invent job titles, "
    "company names, skills, dates, or achievements that are not in the text.\n"
    "- If the user names an employer for a role, put it in \"company\". If they "
    "don't, use an empty string \"\" — never guess a company name.\n"
    "- \"experience\" is paid or formal roles; \"projects\" is personal/side "
    "projects or portfolio work. If it's genuinely unclear, prefer \"experience\".\n"
    "- \"skills\" is short technology/tool/competency terms the user explicitly "
    "mentioned — not full sentences.\n"
    "- If the user gave no name, use an empty string for \"full_name\".\n"
    "Respond with ONLY the JSON object, no preamble or explanation."
)

MAX_RAW_TEXT_CHARS = 20000


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def strip_code_fence(text):
    """LLMs commonly wrap JSON output in a ```json ... ``` markdown fence even
    when told to respond with ONLY JSON. Strip one if present before parsing."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def parse_profile_text(raw_text):
    resp = bedrock_runtime.converse(
        modelId=os.environ["BEDROCK_MODEL_ID"],
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": raw_text}]}],
        inferenceConfig={"maxTokens": 2048, "temperature": 0.2},
    )
    raw_output = resp["output"]["message"]["content"][0]["text"]
    return json.loads(strip_code_fence(raw_output))


def normalize_string_list(values):
    if not isinstance(values, list):
        return []
    return [value.strip() for value in values if isinstance(value, str) and value.strip()]


def normalize_entry_list(values, keys):
    if not isinstance(values, list):
        return []
    result = []
    for value in values:
        if not isinstance(value, dict):
            continue
        entry = {key: (value.get(key).strip() if isinstance(value.get(key), str) else "") for key in keys}
        if any(entry.values()):
            result.append(entry)
    return result


def normalize_parsed(parsed):
    """The model's output is only loosely trusted — coerce it to exactly the
    profile-service schema shape (and drop any empty padding entries) before
    handing it back to the frontend."""
    if not isinstance(parsed, dict):
        parsed = {}
    full_name = parsed.get("full_name")
    return {
        "full_name": full_name.strip() if isinstance(full_name, str) else "",
        "skills": normalize_string_list(parsed.get("skills")),
        "projects": normalize_entry_list(parsed.get("projects"), ["name", "description"]),
        "experience": normalize_entry_list(parsed.get("experience"), ["title", "company", "description"]),
    }


def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")

        if raw_path == "/profile/parse" and http_method == "POST":
            data = json.loads(event.get("body") or "{}")
            raw_text = (data.get("raw_text") or "").strip()

            if not raw_text:
                return response(400, {"error": "raw_text is required"})
            if len(raw_text) > MAX_RAW_TEXT_CHARS:
                return response(400, {"error": f"raw_text is too long (max {MAX_RAW_TEXT_CHARS} characters)"})

            try:
                parsed = parse_profile_text(raw_text)
            except json.JSONDecodeError:
                return response(502, {"error": "Model returned invalid JSON"})
            except ClientError as exc:
                return response(502, {"error": f"Bedrock call failed: {exc.response['Error']['Code']}"})

            return response(200, {"message": "Parsed profile text", "profile": normalize_parsed(parsed)})

        return response(405, {"error": f"Method {http_method} not allowed"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
