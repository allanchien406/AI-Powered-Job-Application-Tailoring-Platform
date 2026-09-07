# Current plan: DynamoDB migration + semantic tailoring + Bedrock CV generation

This tracks the architecture direction currently being implemented, separate from
`README.md`'s retrospective build log. Status markers: ✅ done · 🚧 decided, not yet
built · ❓ open decision · ⏸ deferred.

## Why this direction

- **No RAG, no S3.** A user's profile is small, structured, and fetched whole in
  one query — there's no corpus to retrieve from. A retrieval pipeline (chunking,
  vector DB, retriever) would solve a problem this app doesn't have.
- **Matching moves from exact-keyword to embedding-based semantic similarity**, so
  a JD saying "CI/CD pipelines" matches a profile bullet saying "automated
  deployment workflow." The old `tailoring-service` only caught literal substring
  overlap against a hardcoded skill list.
- **Embeddings are computed on write, not on every read.** Each project/experience
  entry's embedding is computed once when saved and cached alongside it — avoids
  ~9 redundant Bedrock calls per tailoring request.
- **RDS was the wrong store for this data's shape.** `profiles` and
  `job_descriptions` are both single-item-per-key JSON blobs with zero relational
  joins anywhere in the codebase — a DynamoDB shape, not a relational one.
- **`cv-service` is dropped, not migrated** — the dashboard is getting redesigned,
  so the current `CVData` persistence isn't worth carrying forward. This means no
  Lambda needs RDS anymore, so the VPC, security groups, and Secrets Manager
  interface endpoint come out entirely.

## Architecture

Three Lambdas behind one HTTP API, no VPC, two DynamoDB tables:

```
API Gateway (HttpApi)
 ├─ /profile              → profile-service     (ProfilesTable)
 ├─ /job-description       → job-service          (JobDescriptionsTable)
 ├─ /job-description/list  → job-service
 ├─ /tailor-preview        → tailoring-service    (reads both tables, no Bedrock)
 └─ /tailor-generate       → tailoring-service    (reads both tables + Bedrock)
```

### `ProfilesTable` — ✅ implemented

| | |
|---|---|
| Partition key | `email` (S) |
| Sort key | none — one item per user |

```json
{
  "email": "allan@example.com",
  "full_name": "Allan Chien",
  "skills": ["AWS", "Python", "Docker"],
  "projects": [
    { "name": "2048 CI/CD Project", "description": "...", "embedding": [0.02, "..."] }
  ],
  "experience": [
    { "title": "Research Engineer", "description": "...", "embedding": [0.09, "..."] }
  ],
  "created_at": "2026-01-04T10:22:31Z",
  "updated_at": "2026-09-05T03:10:02Z"
}
```

`profile_id` was dropped — nothing downstream ever used it as a key; `email` is
the real identity everywhere.

### `JobDescriptionsTable` — ✅ implemented

| | |
|---|---|
| Partition key | `email` (S) |
| Sort key | `job_id` (S, UUID generated at save time — was a SERIAL int under RDS) |

```json
{
  "email": "allan@example.com",
  "job_id": "3f1c9e2a-8b0d-4e3a-9f21-6c1a2b3d4e5f",
  "company_name": "Catalyst Cloud",
  "job_title": "Junior DevOps Engineer",
  "raw_description": "...",
  "embedding": [0.03, "..."],
  "created_at": "2026-09-05T03:10:02Z"
}
```

`email` as the partition key makes the old "JDs aren't scoped to a user" bug
structurally impossible to reintroduce — there's no code path that can fetch an
item without specifying whose partition to read from.

## Embedding cache — ✅ implemented

- Computed once in `profile-service`/`job-service` on save, stored inline on each
  entry (`embedding: [floats]`, stored as DynamoDB `Decimal`, converted to `float`
  only at the JSON-response boundary via a custom encoder).
- `profile-service` only re-embeds a project/experience entry if its text actually
  changed since the last save, matched by **identity field** (`name`/`title`), not
  array position — reordering or deleting an earlier entry doesn't cascade into
  needless re-embeds for unrelated entries.
- Never echoed back through the public API (`strip_embeddings` in
  `profile-service`, `strip_embedding` in `job-service`) — internal plumbing for
  `tailoring-service`, not something the frontend needs.
- Steady-state Bedrock calls per `/tailor-generate` request: 0–1 (only an
  ad-hoc/uncached JD needs a fresh embedding) + 1 generation call — down from ~9
  in the naive "embed everything on every request" design.

## Matching — ✅ implemented

- `/tailor-preview` keeps the original keyword-only scoring (`score_projects`,
  `score_experience`) — free, fast, zero Bedrock calls, unchanged behavior.
- `/tailor-generate` uses `score_*_with_semantics`: keyword score **and** cosine
  similarity against the cached embedding are computed for *every* entry before
  any filtering — filtering by keyword score first (like the old functions do)
  would discard a paraphrase-only match before semantic scoring ever ran.

## Generation — ✅ implemented

- `POST /tailor-generate` accepts `{email, job_id}` (a saved job) or
  `{email, company_name, job_title, raw_description}` (ad-hoc, never persisted).
- Calls Bedrock **Claude Haiku 4.5** via the Converse API with matched
  skills/projects/experience, explicitly instructed not to invent employers,
  dates, or achievements not present in the input.
- Returns `{title, summary, experience[]}` shaped to map onto the frontend's
  `CVData` — not yet wired into the dashboard (see Deferred).

## Resolved decisions

- ✅ **Graceful degradation on embedding failure** — `profile-service`'s
  `attach_embeddings` now catches any failure from `embed_text` per-entry
  rather than letting it propagate and fail the whole save. A failed entry is
  stored with `embedding: None` and the save still succeeds; the response
  includes a non-fatal `embedding_warnings` list naming which entries didn't
  get embedded. This is self-healing, not just swallowed: `tailoring-service`
  already falls back to embedding inline for an entry with no cached vector,
  and `attach_embeddings`'s own reuse check treats `embedding: None` as "not
  cached," so the next successful save automatically retries it.
- ✅ **Entry matching for the embedding cache is name/title-based**, not
  array-position-based (see the Embedding cache section above).

## Deferred / explicitly out of scope

- ⏸ **ATS-safe export.** `exportPDF.ts` rasterizes the CV via `html2canvas` into a
  PNG-in-a-PDF (no extractable text), and `ModernTemplate.tsx` is two-column —
  both defeat "ATS-friendly" regardless of AI content. Separate follow-up.
- ⏸ **CV persistence.** Dropped along with `cv-service`. No backend for
  saving/loading a generated or edited CV until the dashboard redesign defines a
  new approach.
- ⏸ **Frontend wiring.** `dashboard/src/api/cvApi.ts` calls to `/cv` and
  `/cv/list` will break once those routes are gone — expected, not a regression,
  since the dashboard is being redesigned regardless.
- ⏸ **Profile schema gap.** `CVData` needs `title`/`phone`/`location`/`website`/
  `linkedin`/`education`; `profile_data` doesn't carry those. `generated_cv`
  leaves them blank rather than inventing them.

## Verification checklist (once deployed)

1. `cdk diff` / `cdk synth` — confirm no VPC/RDS resources, 2 DynamoDB tables, 3
   Lambdas, 7 routes. *(Done via `cdk synth` against the current code.)*
2. `cdk deploy` — requires Bedrock model access enabled in the console for both
   Claude Haiku 4.5 and Titan Embeddings in the target region first.
3. Save the same profile twice with one entry's text unchanged — confirm that
   entry's `embedding` is identical across both saves (not redundantly
   re-embedded), while a genuinely edited entry gets a new one.
4. `PUT /job-description` → confirm the response returns a UUID `job_id`.
5. `GET /job-description/list?email=...` → confirm it lists only that user's
   saved jobs.
6. `POST /tailor-generate` ad-hoc (no `job_id`) and saved-job (`{email, job_id}`)
   paths both return a non-empty `generated_cv`.
7. A profile entry worded as a paraphrase (not a literal keyword match) still
   surfaces in `matched_projects`/`matched_experiences` under `/tailor-generate`.
8. `/cv` and `/cv/list` routes return route-not-found (404), not 405 — confirms
   they're actually gone, not just erroring.
