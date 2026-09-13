# Postman collection

Ready-to-import requests for every live API endpoint (see `../API.md`) with
pre-filled dummy/test data. Targets the currently staged backend at
`https://qmpqjnqmn8.execute-api.us-east-1.amazonaws.com` (us-east-1).

## Files

- `AI-Powered-Job-Application-Tailoring-Platform.postman_collection.json` — the
  collection (9 requests across 3 folders).
- `job-tailoring-platform.postman_environment.json` — environment with
  `base_url`, `email`, and `job_id` variables.

## Import

1. Postman → **Import** → drop in the collection JSON.
2. **Import** the environment JSON too, then select
   `Job-Tailoring Platform (staged us-east-1)` from the environment dropdown
   (top-right).
3. Optional: edit the `email` variable if you want a different test user. Every
   profile/job in the collection is keyed off `email`, and `job_id` is filled
   in automatically by `PUT /job-description`'s test script.

## Suggested run order

Requests are ordered top-to-bottom in the folders for a full happy path:

1. **Profile** — `POST /profile/parse` (free text → schema), then
   `PUT /profile` (upsert by email), then `GET /profile` to read it back.
2. **Job descriptions** — `PUT /job-description` (saves + stores `job_id`),
   then `GET /job-description`, then `GET /job-description/list`.
3. **Tailoring** — `POST /tailor-preview` (keyword-only, no Bedrock → fast),
   `POST /tailor-generate` (saved-job path), and
   `POST /tailor-generate` (ad-hoc path, uses a transient job that's never
   persisted).

Each request has a small test script asserting the expected status and key
response fields, so failures show up in the Test Results tab.

## Notes / gotchas

- `PUT /profile` and `PUT /job-description` hit Bedrock (Titan embeddings) and
  the `/tailor-generate` and `/profile/parse` requests hit Claude Haiku 4.5 —
  all calls are real and billed; `GET /profile`, job reads, list, and
  `/tailor-preview` do no embedding/generation.
- `PUT /job-description` always creates a **new** item (fresh UUID per call) —
  re-running the collection multiplies saved jobs, it doesn't overwrite.
- The old `/cv/*` endpoints (removed `cv-service`) are **not** included.
- Re-saving a profile with unchanged project/experience text reuses the cached
  embedding (no re-embed); changing `period` alone does not trigger a re-embed.