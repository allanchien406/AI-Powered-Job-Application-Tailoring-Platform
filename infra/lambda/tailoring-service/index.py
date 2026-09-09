import json
import math
import os
import re
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
bedrock_runtime = boto3.client("bedrock-runtime")


# Whitelist of skill/technology terms this service knows how to spot in a raw
# job description. Only terms in this list can ever end up in
# `extracted_requirements` — anything a JD asks for that isn't here (or an
# alias of something here) is invisible to the keyword-matching path. This is
# the known limitation semantic scoring in /tailor-generate works around (it
# compares against the full JD text directly, not just this whitelist), but
# /tailor-preview has no alternative to it since it never calls Bedrock.
KNOWN_SKILLS = [
    "aws",
    "azure",
    "gcp",
    "python",
    "java",
    "javascript",
    "typescript",
    "docker",
    "kubernetes",
    "terraform",
    "linux",
    "postgresql",
    "mysql",
    "dynamodb",
    "git",
    "ci/cd",
    "jenkins",
    "github actions",
    "api gateway",
    "lambda",
    "ecs",
    "ecr",
    "cloudformation",
    "cdk",
    "s3",
    "glue",
    "athena",
    "kinesis",
]


# Spelling/phrasing variants that should count as the same requirement as
# their canonical KNOWN_SKILLS entry (e.g. "postgres" and "ci cd" both mean
# the KNOWN_SKILLS terms "postgresql" and "ci/cd").
SKILL_ALIASES = {
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "cicd": "ci/cd",
    "ci cd": "ci/cd",
    "ci/cd": "ci/cd",
    "github actions": "github actions",
}

# Semantic score is a cosine similarity in [-1, 1]; this weight puts a strong
# semantic match (~0.7+) roughly on par with matching two keyword terms.
SEMANTIC_WEIGHT = 6
# Low bar — a pure semantic match (0 keyword overlap) only needs a modest
# cosine similarity to surface; this just filters out near-zero noise.
MIN_TOTAL_SCORE = 0.5


class DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal; json.dumps doesn't know how to
    serialize those, so convert to float only at the response boundary."""

    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def response(status_code, body):
    """Build the API Gateway HTTP API Lambda-proxy response shape."""
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def profiles_table():
    return dynamodb.Table(os.environ["PROFILES_TABLE_NAME"])


def job_descriptions_table():
    return dynamodb.Table(os.environ["JOB_DESCRIPTIONS_TABLE_NAME"])


def get_profile_by_email(email):
    """Read-only lookup — this service never writes to ProfilesTable."""
    return profiles_table().get_item(Key={"email": email}).get("Item")


def get_job_description_by_id(email, job_id):
    """Read-only lookup — this service never writes to JobDescriptionsTable."""
    return job_descriptions_table().get_item(Key={"email": email, "job_id": job_id}).get("Item")


def normalize_text(text):
    """Lowercase and collapse whitespace, so substring matching below isn't
    thrown off by casing or line breaks."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def extract_requirements_from_raw_description(raw_description):
    """Scan a job description's raw text for any KNOWN_SKILLS term (or one of
    its aliases) and return the canonical terms found. This is the entire
    keyword-matching universe: /tailor-preview's scoring, and half of
    /tailor-generate's blended scoring, both only ever "see" JD requirements
    that show up in this list."""
    text = normalize_text(raw_description)
    extracted = []

    for skill in KNOWN_SKILLS:
        variants = {skill}
        for alias, canonical in SKILL_ALIASES.items():
            if canonical == skill:
                variants.add(alias)

        if any(variant in text for variant in variants):
            extracted.append(skill)

    return extracted


def dedupe_preserve_order(items):
    """Remove duplicates while keeping first-seen order (plain set() would
    lose the ordering that ranking/display relies on)."""
    seen = set()
    result = []

    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)

    return result


def score_text_against_requirements(text, extracted_requirements, weight):
    """Count how many extracted requirement terms appear as a literal
    substring of `text`, each worth `weight` points. Returns the total score
    plus which specific terms matched (for the matched_terms field shown to
    the caller)."""
    if not isinstance(text, str):
        return 0, []

    normalized_text = normalize_text(text)
    matched_terms = []
    score = 0

    for requirement in extracted_requirements:
        if requirement in normalized_text:
            matched_terms.append(requirement)
            score += weight

    return score, matched_terms


# --- Keyword-only scoring: used by /tailor-preview. No Bedrock calls, cheap
# enough to run on every keystroke of a live preview. ---


def score_projects(profile, extracted_requirements):
    """Score every project by literal keyword overlap with the JD (title
    weighted higher than description), keep only the ones that matched
    something, and return them sorted best-first. No embeddings involved —
    a project with zero literal keyword overlap never shows up here, even if
    it's a strong paraphrased match (that's what the *_with_semantics
    versions below exist to catch, for /tailor-generate only)."""
    projects = profile.get("projects", [])
    scored_projects = []

    for project in projects:
        if not isinstance(project, dict):
            continue

        project_name = project.get("name", "")
        project_description = project.get("description", "")

        title_score, title_matches = score_text_against_requirements(project_name, extracted_requirements, 4)
        description_score, description_matches = score_text_against_requirements(
            project_description, extracted_requirements, 3
        )

        total_score = title_score + description_score
        matched_terms = dedupe_preserve_order(title_matches + description_matches)

        if total_score > 0:
            scored_projects.append(
                {
                    "name": project_name,
                    "description": project_description,
                    "score": total_score,
                    "matched_terms": matched_terms,
                }
            )

    scored_projects.sort(key=lambda item: item["score"], reverse=True)
    return scored_projects


def score_experience(profile, extracted_requirements):
    """Same as score_projects, but for the profile's experience entries (and
    a lower description weight — see the 2 vs 3 in the weight arguments)."""
    experiences = profile.get("experience", [])
    scored_experiences = []

    for experience in experiences:
        if not isinstance(experience, dict):
            continue

        experience_title = experience.get("title", "")
        experience_description = experience.get("description", "")

        title_score, title_matches = score_text_against_requirements(experience_title, extracted_requirements, 4)
        description_score, description_matches = score_text_against_requirements(
            experience_description, extracted_requirements, 2
        )

        total_score = title_score + description_score
        matched_terms = dedupe_preserve_order(title_matches + description_matches)

        if total_score > 0:
            scored_experiences.append(
                {
                    "title": experience_title,
                    "description": experience_description,
                    "score": total_score,
                    "matched_terms": matched_terms,
                }
            )

    scored_experiences.sort(key=lambda item: item["score"], reverse=True)
    return scored_experiences


# --- Semantic-augmented scoring: used by /tailor-generate only. ---


def embed_text(text):
    """Call Bedrock Titan Embeddings and return the raw embedding as a plain
    list of floats. Used here for two things: embedding an ad-hoc (never
    persisted) job description, and as a fallback for any profile entry that
    somehow has no cached embedding of its own. Unlike profile-service's/
    job-service's embed_text, this one never writes to DynamoDB, so there's
    no need to convert the result to Decimal."""
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
    return payload.get("embedding")


def to_float_vector(vector):
    """DynamoDB gives back embeddings as a list of Decimal; cosine_similarity
    needs plain floats to do math with. Returns None for an empty/missing
    vector so callers can treat "no embedding" and "embedding failed" the
    same way."""
    if not vector:
        return None
    return [float(value) for value in vector]


def cosine_similarity(vec_a, vec_b):
    """Standard cosine similarity: how closely two vectors point in the same
    direction, from -1 (opposite) to 1 (identical direction). Returns 0.0 for
    any missing/zero-length input rather than raising, so a missing embedding
    anywhere just falls back to "no semantic signal" instead of crashing."""
    if not vec_a or not vec_b:
        return 0.0

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))

    if not norm_a or not norm_b:
        return 0.0

    return dot / (norm_a * norm_b)


def score_entries_with_semantics(entries, extracted_requirements, jd_vector, title_field, description_field, title_weight, description_weight):
    """The /tailor-generate counterpart to score_projects/score_experience:
    computes BOTH a keyword score (same logic as the preview path) AND a
    semantic score (cosine similarity between this entry's cached embedding
    and the JD's embedding), and blends them into one total_score.

    Score every entry on keyword AND semantic similarity, unfiltered, before
    any cutoff — filtering by keyword score first (as score_projects/score_experience
    do) would throw away a paraphrase-only match before semantic scoring ever runs.
    """
    scored = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        title_text = entry.get(title_field, "")
        description_text = entry.get(description_field, "")

        title_score, title_matches = score_text_against_requirements(title_text, extracted_requirements, title_weight)
        description_score, description_matches = score_text_against_requirements(
            description_text, extracted_requirements, description_weight
        )
        keyword_score = title_score + description_score

        entry_vector = to_float_vector(entry.get("embedding"))
        if entry_vector is None:
            # Safety net for entries saved before embeddings existed.
            entry_vector = embed_text(f"{title_text} {description_text}")
        semantic_score = cosine_similarity(jd_vector, entry_vector) if entry_vector else 0.0

        total_score = keyword_score + semantic_score * SEMANTIC_WEIGHT
        if total_score <= MIN_TOTAL_SCORE:
            continue

        scored.append(
            {
                title_field: title_text,
                description_field: description_text,
                "score": round(total_score, 2),
                "matched_terms": dedupe_preserve_order(title_matches + description_matches),
                "semantic_score": round(semantic_score, 3),
            }
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored


def score_projects_with_semantics(profile, extracted_requirements, jd_vector):
    """score_entries_with_semantics, specialized for the projects list."""
    return score_entries_with_semantics(
        profile.get("projects", []), extracted_requirements, jd_vector, "name", "description", 4, 3
    )


def score_experience_with_semantics(profile, extracted_requirements, jd_vector):
    """score_entries_with_semantics, specialized for the experience list."""
    return score_entries_with_semantics(
        profile.get("experience", []), extracted_requirements, jd_vector, "title", "description", 4, 2
    )


def build_prompt_context(profile, job_description, extracted_requirements, matched_projects, matched_experiences):
    """Assemble the compact payload sent to Bedrock for generation: who the
    candidate is, what role they're targeting, and only the top few
    highest-scored projects/experience entries (capped at 3 each) rather than
    the candidate's whole profile."""
    return {
        "candidate": {
            "full_name": profile.get("full_name", ""),
            "email": profile.get("email", ""),
        },
        "target_role": {
            "company_name": job_description.get("company_name", ""),
            "job_title": job_description.get("job_title", ""),
        },
        "job_requirements": extracted_requirements,
        "matched_projects": matched_projects[:3],
        "matched_experiences": matched_experiences[:3],
    }


def call_bedrock_for_tailoring(prompt_context):
    """The actual generation step: send prompt_context to Claude (via the
    Converse API) and ask for a tailored CV section back as JSON. The system
    prompt explicitly forbids inventing facts not present in the input —
    a fabricated CV is actively harmful, not just a quality miss."""
    system_prompt = (
        "You are a CV tailoring assistant. Given a candidate's matched projects and "
        "experience and a target job, produce a tailored CV section. "
        "Respond with ONLY valid JSON matching this schema: "
        '{"title": string, "summary": string, "experience": '
        '[{"company": string, "role": string, "period": string, "description": string}]}. '
        "Only use facts present in the candidate's matched projects and experience "
        "below — do not invent employers, dates, or achievements that are not present in the input."
    )

    resp = bedrock_runtime.converse(
        modelId=os.environ["BEDROCK_MODEL_ID"],
        system=[{"text": system_prompt}],
        messages=[{"role": "user", "content": [{"text": json.dumps(prompt_context)}]}],
        inferenceConfig={"maxTokens": 1024, "temperature": 0.4},
    )
    raw_text = resp["output"]["message"]["content"][0]["text"]
    return json.loads(raw_text)


def handle_tailor_preview(event):
    """POST /tailor-preview: fast, free, keyword-only match between an
    already-saved profile and an already-saved job description. Zero Bedrock
    calls — meant to be cheap enough to call frequently (e.g. as the user
    edits their profile)."""
    body = event.get("body")
    data = json.loads(body) if body else {}

    email = data.get("email")
    job_id = data.get("job_id")

    if not email:
        return response(400, {"error": "email is required"})
    if not job_id:
        return response(400, {"error": "job_id is required"})

    profile = get_profile_by_email(email)
    if not profile:
        return response(404, {"error": "Profile not found"})

    job_description = get_job_description_by_id(email, job_id)
    if not job_description:
        return response(404, {"error": "Job description not found"})

    extracted_requirements = extract_requirements_from_raw_description(job_description["raw_description"])
    matched_projects = score_projects(profile, extracted_requirements)
    matched_experiences = score_experience(profile, extracted_requirements)
    prompt_context = build_prompt_context(
        profile, job_description, extracted_requirements, matched_projects, matched_experiences
    )

    return response(
        200,
        {
            "message": "Tailor preview data loaded successfully",
            "email": email,
            "job_id": job_id,
            "extracted_requirements": extracted_requirements,
            "matched_projects": matched_projects,
            "matched_experiences": matched_experiences,
            "prompt_context": prompt_context,
        },
    )


def handle_tailor_generate(event):
    """POST /tailor-generate: the full pipeline. Accepts either a saved
    {email, job_id} or an ad-hoc {email, company_name, job_title,
    raw_description} that's never persisted. Does semantic+keyword matching,
    then calls Bedrock to produce an actual tailored CV section."""
    data = json.loads(event.get("body") or "{}")
    email = data.get("email")

    if not email:
        return response(400, {"error": "email is required"})

    profile = get_profile_by_email(email)
    if not profile:
        return response(404, {"error": "Profile not found"})

    if data.get("job_id"):
        # Saved-job path: reuse the JD's cached embedding if it has one,
        # otherwise embed it now (covers JDs saved before embeddings existed).
        job_description = get_job_description_by_id(email, data["job_id"])
        if not job_description:
            return response(404, {"error": "Job description not found"})
        jd_vector = to_float_vector(job_description.get("embedding")) or embed_text(job_description["raw_description"])
    else:
        # Ad-hoc path: nothing saved, nothing cached — embed it fresh.
        missing = [field for field in ("company_name", "job_title", "raw_description") if not data.get(field)]
        if missing:
            return response(400, {"error": f"{missing[0]} is required when job_id is omitted"})
        job_description = {key: data[key] for key in ("company_name", "job_title", "raw_description")}
        jd_vector = embed_text(job_description["raw_description"])

    extracted_requirements = extract_requirements_from_raw_description(job_description["raw_description"])
    matched_projects = score_projects_with_semantics(profile, extracted_requirements, jd_vector)
    matched_experiences = score_experience_with_semantics(profile, extracted_requirements, jd_vector)
    prompt_context = build_prompt_context(
        profile, job_description, extracted_requirements, matched_projects, matched_experiences
    )

    try:
        generated_cv = call_bedrock_for_tailoring(prompt_context)
    except json.JSONDecodeError:
        return response(502, {"error": "Model returned invalid JSON"})
    except ClientError as exc:
        return response(502, {"error": f"Bedrock call failed: {exc.response['Error']['Code']}"})

    return response(
        200,
        {
            "message": "Tailored CV generated",
            "email": email,
            "prompt_context": prompt_context,
            "generated_cv": generated_cv,
        },
    )


def handler(event, context):
    """Lambda entrypoint: route by (rawPath, method) to one of the two
    handlers above, same dispatch style as profile-service/job-service."""
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")

        if raw_path == "/tailor-preview" and http_method == "POST":
            return handle_tailor_preview(event)

        if raw_path == "/tailor-generate" and http_method == "POST":
            return handle_tailor_generate(event)

        return response(404, {"error": "Route not found"})

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
