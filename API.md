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

- **Body:** `{email, full_name?, skills?: string[], projects?: [{name, period?, description}], experience?: [{title, company?, period?, description}], education?: [{institution, degree, period?, description?}]}`
  — `period` and `company`/`institution` are all optional (blank when unknown).
  `education` entries get no embedding and aren't used for matching (like
  `skills`); they pass straight through to the generation prompt.
- **200:** `{message, ...same shape as GET}`, plus `embedding_warnings: string[]`
  **only if** embedding a new/changed entry failed (save still succeeds either
  way — see `PLAN.md`'s graceful-degradation note)
- **400:** `email` missing
- **Behavior worth knowing:** each project/experience entry's embedding is
  computed once and cached; re-saving with an entry's text unchanged reuses
  the cached vector instead of calling Bedrock again. Matched by `name`/`title`
  as identity, not array position.

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

Save a new job description. Always creates a new item (no update-in-place —
`job_id` is generated fresh every call, so there's no dedup against an
existing entry for the same job).

- **Body:** `{email, company_name, job_title, raw_description}` — all required,
  all trimmed of whitespace before validation (a whitespace-only value is
  rejected, not silently stored)
- **200:** `{message, job_id, email, company_name, job_title}` — `job_id` is a
  generated UUID string, `email` is lowercased+trimmed before storage — plus
  `embedding_warnings: string[]` **only if** embedding `raw_description` failed
  (save still succeeds either way, mirroring `profile-service`'s
  graceful-degradation pattern)
- **400:** any required field missing/blank
- **Behavior worth knowing:** `raw_description`'s embedding is computed once
  here, at save time, and cached on the item for `tailoring-service` to reuse.
  If that embedding call fails, there's no "next save" to retry it on (unlike
  `profile-service`'s entries) — `tailoring-service` falls back to embedding it
  inline at match time instead.

### `GET /job-description/list`

List every job description saved by a user.

- **Query params:** `email` (required)
- **200:** `{job_descriptions: [...]}`, most recent first (embeddings stripped)
- **400:** `email` missing

---

## `tailoring-service` — ✅ reviewed and deployed (fixed: email normalization,
graceful degradation on embedding failure, defensive markdown-fence parsing,
correct Claude Haiku 4.5 model ID + IAM ARNs, generation fabricating an
employer name) — AWS-verified pending final manual confirmation (see `PLAN.md`)

Source: `infra/lambda/tailoring-service/index.py`. Reads `ProfilesTable` and
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
