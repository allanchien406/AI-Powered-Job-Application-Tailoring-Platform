import json
import os
import re

import boto3
import pg8000


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


SKILL_ALIASES = {
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "cicd": "ci/cd",
    "ci cd": "ci/cd",
    "ci/cd": "ci/cd",
    "github actions": "github actions",
}



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

    return {
        "profile_id": row[0],
        "email": row[1],
        "full_name": row[2],
        "profile_data": row[3],
    }



def get_job_description_by_id(conn, job_id):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, company_name, job_title, raw_description
        FROM job_descriptions
        WHERE id = %s;
        """,
        (job_id,),
    )
    row = cur.fetchone()
    cur.close()

    if not row:
        return None

    return {
        "job_id": row[0],
        "company_name": row[1],
        "job_title": row[2],
        "raw_description": row[3],
    }



def normalize_text(text):
    return re.sub(r"\s+", " ", text.lower()).strip()



def extract_requirements_from_raw_description(raw_description):
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


# --- New functions ---

def canonicalize_skill(skill):
    normalized = normalize_text(skill)
    return SKILL_ALIASES.get(normalized, normalized)


def dedupe_preserve_order(items):
    seen = set()
    result = []

    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)

    return result


def match_skills(profile_data, extracted_requirements):
    raw_skills = profile_data.get("skills", [])
    normalized_profile_skills = [canonicalize_skill(skill) for skill in raw_skills if isinstance(skill, str)]
    normalized_profile_skills = dedupe_preserve_order(normalized_profile_skills)

    matched_skills = [
        requirement for requirement in extracted_requirements if requirement in normalized_profile_skills
    ]

    return matched_skills


def score_text_against_requirements(text, extracted_requirements, weight):
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


def score_projects(profile_data, extracted_requirements):
    projects = profile_data.get("projects", [])
    scored_projects = []

    for project in projects:
        if not isinstance(project, dict):
            continue

        project_name = project.get("name", "")
        project_description = project.get("description", "")

        title_score, title_matches = score_text_against_requirements(
            project_name, extracted_requirements, 4
        )
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


def score_experience(profile_data, extracted_requirements):
    experiences = profile_data.get("experience", [])
    scored_experiences = []

    for experience in experiences:
        if not isinstance(experience, dict):
            continue

        experience_title = experience.get("title", "")
        experience_description = experience.get("description", "")

        title_score, title_matches = score_text_against_requirements(
            experience_title, extracted_requirements, 4
        )
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


def build_prompt_context(profile, job_description, extracted_requirements, matched_skills, matched_projects, matched_experiences):
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
        "matched_skills": matched_skills[:5],
        "matched_projects": matched_projects[:3],
        "matched_experiences": matched_experiences[:3],
    }



def handler(event, context):
    try:
        http_method = event.get("requestContext", {}).get("http", {}).get("method")
        raw_path = event.get("rawPath")

        if raw_path != "/tailor-preview":
            return response(404, {"error": "Route not found"})

        if http_method != "POST":
            return response(405, {"error": f"Method {http_method} not allowed"})

        body = event.get("body")
        data = json.loads(body) if body else {}

        email = data.get("email")
        job_id = data.get("job_id")

        if not email:
            return response(400, {"error": "email is required"})
        if job_id is None:
            return response(400, {"error": "job_id is required"})

        try:
            job_id_int = int(job_id)
        except ValueError:
            return response(400, {"error": "job_id must be an integer"})

        credentials = get_db_credentials()
        conn = get_db_connection(credentials)
        try:
            profile = get_profile_by_email(conn, email)
            if not profile:
                return response(404, {"error": "Profile not found"})

            job_description = get_job_description_by_id(conn, job_id_int)
            if not job_description:
                return response(404, {"error": "Job description not found"})

            extracted_requirements = extract_requirements_from_raw_description(
                job_description["raw_description"]
            )

            profile_data = profile.get("profile_data", {})
            matched_skills = match_skills(profile_data, extracted_requirements)
            matched_projects = score_projects(profile_data, extracted_requirements)
            matched_experiences = score_experience(profile_data, extracted_requirements)
            prompt_context = build_prompt_context(
                profile,
                job_description,
                extracted_requirements,
                matched_skills,
                matched_projects,
                matched_experiences,
            )

            return response(
                200,
                {
                    "message": "Tailor preview data loaded successfully",
                    "email": email,
                    "job_id": job_id_int,
                    "profile": profile,
                    "job_description": job_description,
                    "extracted_requirements": extracted_requirements,
                    "matched_skills": matched_skills,
                    "matched_projects": matched_projects,
                    "matched_experiences": matched_experiences,
                    "prompt_context": prompt_context,
                },
            )
        finally:
            conn.close()
    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except KeyError as exc:
        return response(500, {"error": f"Missing required environment variable: {str(exc)}"})
    except Exception as exc:
        return response(500, {"error": str(exc)})
