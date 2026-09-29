# API reference

Every route currently defined in `infra/lib/infra-stack.ts`, grouped by the
Lambda that serves it. This tracks **what exists**, not design rationale (see
`PLAN.md` for that) or build history (see `README.md`).

**Review status legend:** ✅ reviewed together and fixed up · 👀 written, not
yet reviewed — treat as unverified until it's been gone through.

---

## `profile-service` — ✅ reviewed · AWS-verified

Source: `infra/lambda/profile-service/index.py`. Storage: `ProfilesTableV2`
(DynamoDB, partition key `user_id`, sort key `entity_key` — one `PROFILE`
item plus one `PROJECT#<id>`/`EXPERIENCE#<id>` item per entry; see
`docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md`).

### `GET /profile`

Fetch the signed-in user's profile. Identity comes from the JWT `sub` claim —
no query params needed.

- **200:** the profile — `email`, `full_name`, `skills[]`, `projects[]`,
  `experience[]`, `created_at`, `updated_at`. Embeddings on each
  project/experience entry are stripped before returning.
- **404:** no profile saved yet for the signed-in user

### `PUT /profile`

Create or fully replace the signed-in user's profile. Identity comes from the
JWT `sub` claim — `email` is now just a normal optional display field, not an
identifier, and isn't required in the body.

- **Body:** `{email?, full_name?, skills?: string[], projects?: [{id?, name, period?, description}], experience?: [{id?, title, company?, period?, description}], education?: [{institution, degree, period?, description?}]}`
  — `period` and `company`/`institution` are all optional (blank when unknown).
  `id` is assigned server-side on first save if omitted, and should be sent
  back unchanged on later edits. `education` entries get no embedding and
  aren't used for matching (like `skills`); they pass straight through to
  the generation prompt.
- **200:** `{message, ...same shape as GET}`, plus `embedding_warnings: string[]`
  **only if** embedding a new/changed entry failed (save still succeeds either
  way — see `PLAN.md`'s graceful-degradation note)
- **400:** `{"error": "Invalid JSON body"}` if the request body isn't valid JSON
- **Behavior worth knowing:** each project/experience entry's embedding is
  computed once and cached; re-saving with an entry's text unchanged reuses
  the cached vector instead of calling Bedrock again, and the entry's
  DynamoDB item isn't rewritten at all. Matched by `id` first, falling back
  to `name`/`title` for an entry that doesn't have an `id` yet.

---

## `intake-service` — ✅ reviewed · AWS-tested (see `TESTING.md`)

Source: `infra/lambda/intake-service/index.py`. No storage — one Bedrock call,
never touches DynamoDB. Exists to turn free-form profile prose into the
`profile-service` schema so the frontend can show it for review before saving.

### `POST /profile/parse`

Extract a free-form description of someone's background into the shape
`PUT /profile` expects.

- **Body:** `{raw_text}` — required, non-blank, max 20000 chars. No `email`
  (this endpoint doesn't save anything).
- **200:** `{message, profile: {full_name, skills: string[], projects: [{name, period, description}], experience: [{title, company, period, description}], education: [{institution, degree, period, description}]}}`
  — the model's output, coerced to exactly that shape (empty padding entries
  dropped, everything trimmed, `company`/`institution`/`period` left `""` when
  not stated, never guessed). The frontend adds `email` and hands this to
  `PUT /profile`.
- **400:** `raw_text` missing/blank/too long · **502:** Bedrock call failed or
  returned unparseable JSON · **405:** wrong method
- **Behavior worth knowing:** the prompt forbids inventing job titles, company
  names, skills, or dates not present in the text — same anti-hallucination
  discipline as `/tailor-generate`. The human review step in the frontend is
  the real safety net, though.

---

## `job-service` — ✅ reviewed (fixed: graceful degradation on embedding
failure, email normalization, stricter field validation) · AWS-verified

Source: `infra/lambda/job-service/index.py`. Storage: `JobDescriptionsTable`
(DynamoDB, partition key `email`, sort key `job_id`).

### `GET /job-description`

Fetch one saved job description.

- **Query params:** `email`, `job_id` (both required)
- **200:** `{email, job_id, company_name, job_title, raw_description, created_at}`
  (embedding stripped)
- **400:** missing param · **404:** not found for that email/job_id pair
- **Note:** `email` is matched exactly against what's stored — this route does
  not normalize its own `email` query param (matches `profile-service`'s `GET`,
  which has the same asymmetry; see `PLAN.md`).

### `PUT /job-description`

Create or update a job description.

- **Body:** `{email, company_name, job_title, raw_description}` — all required,
  all trimmed of whitespace before validation (a whitespace-only value is
  rejected, not silently stored). **Optional `job_id`:** when provided, the
  existing job is updated in place (same `email` + `job_id` key); when absent,
  a new job is created with a fresh UUID.
- **200:** `{message, job_id, email, company_name, job_title}` — `email` is
  lowercased+trimmed before storage; `job_id` is the new UUID (on create) or
  the provided ID (on update) — plus `embedding_warnings: string[]` **only if**
  embedding `raw_description` failed (save/update still succeeds either way,
  mirroring `profile-service`'s graceful-degradation pattern)
- **400:** any required field missing/blank · **404 (update only):** `job_id`
  not found for that `email`
- **Behavior worth knowing:** `raw_description`'s embedding is computed once
  here, at save/update time, and cached on the item for `tailoring-service` to
  reuse. On update, if `raw_description` hasn't changed, the existing embedding
  is preserved (no Bedrock call); if the description text has changed, a fresh
  embedding is computed. If that embedding call fails, `tailoring-service`
  falls back to embedding it inline at match time instead.

### `GET /job-description/list`

List every job description saved by a user.

- **Query params:** `email` (required)
- **200:** `{job_descriptions: [...]}`, most recent first (embeddings stripped)
- **400:** `email` missing

---

## `cv-service` — 🚧 implemented · deployment verification pending

Source: `infra/lambda/cv-service/index.py`. Storage: `CvsTable` (DynamoDB,
partition key `user_id`, sort key `cv_id`). Every route derives `user_id` from
the verified Cognito JWT `sub`; no client-supplied identity is accepted.

### `PUT /cv`

Create a CV when `cv_id` is omitted, or replace one in place when it is
provided. The server stamps `created_at` and `updated_at`, preserves nested
entry IDs, and normalizes/caps CV fields so a DynamoDB item stays below 400KB.

- **Body:** `{cv_id?, job_id?, meta, job_ref, template_id, generated_at, cv}`
- **200:** `{message, cv_id, job_id?, generated_at, updated_at, warnings?}`
- **Behavior:** missing `job_id` is omitted from the DynamoDB item rather than
  written as a DynamoDB `NULL` value. `job_ref.raw_description` is capped at
  20,000 characters and reports a warning when clipped.

### `GET /cv?cv_id=`

Fetch one CV owned by the signed-in user. Missing `cv_id` is **400** and an
unknown CV is **404**.

### `GET /cv/list`

Returns `{cvs: [...]}` for the signed-in user, ordered by `generated_at`
descending. Filtering by `job_id` is client-side because no GSI is used.

### `DELETE /cv?cv_id=`

Deletes one CV owned by the signed-in user. The operation is idempotent and
returns **200** even when the item is already absent.

---

## `tailoring-service` — ✅ reviewed and deployed (fixed: email normalization,
graceful degradation on embedding failure, defensive markdown-fence parsing,
correct Claude Haiku 4.5 model ID + IAM ARNs, generation fabricating an
employer name) — AWS-verified pending final manual confirmation (see `PLAN.md`)

Source: `infra/lambda/tailoring-service/index.py`. Reads `ProfilesTableV2` and
`JobDescriptionsTable` directly (read-only — never writes either).

### `POST /tailor-preview`

Keyword-only match between a saved profile and a saved job description. No
Bedrock calls — fast and free, meant for a live/frequent preview.

- **Body:** `{email, job_id}` — both required, job must already be saved
- **200:** `{message, email, job_id, extracted_requirements[], matched_projects[], matched_experiences[], prompt_context}`
- **400:** missing field · **404:** profile or job not found

### `POST /tailor-generate`

Full pipeline: pure-embedding matching (no keyword component — see
`PLAN.md`), then a Bedrock call that generates a tailored CV section.

- **Body:** either `{email, job_id}` (a previously saved job) **or**
  `{email, company_name, job_title, raw_description}` (ad-hoc — never
  persisted, embedded fresh on the spot)
- **200:** `{message, email, prompt_context, generated_cv: {title, summary, experience: [{company, role, period, description}], education: [{institution, degree, period}]}}`
  — `prompt_context` includes `raw_job_description` (the actual JD text, not a
  keyword-extracted proxy), `matched_projects` (`{name, period, description, score}`),
  `matched_experiences` (`{title, company, period, description, score}` —
  `company`/`period` are the profile's real values if saved, `""` otherwise),
  and `education` (all of it, un-scored), ranked by
  cosine similarity, top 3 only
- **400:** missing required field · **404:** profile or job not found (saved-job
  path only) · **502:** Bedrock call failed or returned unparseable JSON
- **Behavior worth knowing:** unlike `/tailor-preview`, matching here has no
  keyword component at all — every project/experience entry is ranked by cosine
  similarity against the JD's embedding, then entries below `MIN_SEMANTIC_SCORE`
  (`0.10`) are dropped as noise (calibrated from a real test — see `PLAN.md`;
  entries that couldn't be embedded at all are exempt). What survives is ranked
  best-first, then `prompt_context` caps at the top 3.
