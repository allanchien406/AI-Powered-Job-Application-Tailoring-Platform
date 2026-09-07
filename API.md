# API reference

Every route currently defined in `infra/lib/infra-stack.ts`, grouped by the
Lambda that serves it. This tracks **what exists**, not design rationale (see
`PLAN.md` for that) or build history (see `README.md`).

**Review status legend:** ✅ reviewed together and fixed up · 👀 written, not
yet reviewed — treat as unverified until it's been gone through.

---

## `profile-service` — ✅ reviewed · AWS-verified

Source: `infra/lambda/profile-service/index.py`. Storage: `ProfilesTable`
(DynamoDB, partition key `email`).

### `GET /profile`

Fetch a profile by email.

- **Query params:** `email` (required)
- **200:** the profile — `email`, `full_name`, `skills[]`, `projects[]`,
  `experience[]`, `created_at`, `updated_at`. Embeddings on each
  project/experience entry are stripped before returning.
- **400:** `email` missing · **404:** no profile for that email

### `PUT /profile`

Create or fully replace a profile (upsert by `email`).

- **Body:** `{email, full_name?, skills?: string[], projects?: [{name, description}], experience?: [{title, description}]}`
- **200:** `{message, ...same shape as GET}`, plus `embedding_warnings: string[]`
  **only if** embedding a new/changed entry failed (save still succeeds either
  way — see `PLAN.md`'s graceful-degradation note)
- **400:** `email` missing
- **Behavior worth knowing:** each project/experience entry's embedding is
  computed once and cached; re-saving with an entry's text unchanged reuses
  the cached vector instead of calling Bedrock again. Matched by `name`/`title`
  as identity, not array position.

---

## `job-service` — 👀 not yet reviewed

Source: `infra/lambda/job-service/index.py`. Storage: `JobDescriptionsTable`
(DynamoDB, partition key `email`, sort key `job_id`).

### `GET /job-description`

Fetch one saved job description.

- **Query params:** `email`, `job_id` (both required)
- **200:** `{email, job_id, company_name, job_title, raw_description, created_at}`
  (embedding stripped)
- **400:** missing param · **404:** not found for that email/job_id pair

### `PUT /job-description`

Save a new job description. Always creates a new item (no update-in-place —
`job_id` is generated fresh every call).

- **Body:** `{email, company_name, job_title, raw_description}` — all required
- **200:** `{message, job_id, email, company_name, job_title}` — `job_id` is a
  generated UUID string
- **400:** any required field missing
- **Behavior worth knowing:** `raw_description`'s embedding is computed once
  here, at save time, and cached on the item for `tailoring-service` to reuse.

### `GET /job-description/list`

List every job description saved by a user.

- **Query params:** `email` (required)
- **200:** `{job_descriptions: [...]}`, most recent first (embeddings stripped)
- **400:** `email` missing

---

## `tailoring-service` — 👀 not yet reviewed

Source: `infra/lambda/tailoring-service/index.py`. Reads `ProfilesTable` and
`JobDescriptionsTable` directly (read-only — never writes either).

### `POST /tailor-preview`

Keyword-only match between a saved profile and a saved job description. No
Bedrock calls — fast and free, meant for a live/frequent preview.

- **Body:** `{email, job_id}` — both required, job must already be saved
- **200:** `{message, email, job_id, extracted_requirements[], matched_skills[], matched_projects[], matched_experiences[], prompt_context}`
- **400:** missing field · **404:** profile or job not found

### `POST /tailor-generate`

Full pipeline: semantic + keyword matching, then a Bedrock call that generates
a tailored CV section.

- **Body:** either `{email, job_id}` (a previously saved job) **or**
  `{email, company_name, job_title, raw_description}` (ad-hoc — never
  persisted, embedded fresh on the spot)
- **200:** `{message, email, prompt_context, generated_cv: {title, summary, experience: [{company, role, period, description}]}}`
- **400:** missing required field · **404:** profile or job not found (saved-job
  path only) · **502:** Bedrock call failed or returned unparseable JSON
- **⚠️ Known bug (see `PLAN.md`):** the generation call's model ID is currently
  wrong for Claude Haiku 4.5 (needs an inference-profile ARN, not the bare
  model ID) — this route will fail at the Bedrock call until that's fixed.
- **Behavior worth knowing:** scoring blends keyword matches with cosine
  similarity against each entry's cached embedding, computed over *every*
  project/experience entry before any filtering — not just the ones that
  already passed a keyword filter — so a paraphrase-only match still surfaces.
