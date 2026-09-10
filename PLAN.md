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
  Still the only thing bound by the `KNOWN_SKILLS` whitelist.
- `/tailor-generate` uses `score_*_with_semantics`, which is **pure embedding
  similarity — no keyword component at all.** This was a deliberate
  simplification after the fact: the original design blended keyword score
  with cosine similarity, but a literal keyword match (e.g. "AWS" appearing in
  both texts) already scores highly on embedding similarity too, so the
  keyword bonus was mostly reinforcing what semantic scoring already caught,
  not adding independent signal. Every entry is scored and returned
  unfiltered (no hard cutoff — there's no validated cosine-similarity
  threshold yet; `build_prompt_context`'s top-3 cap does the filtering
  instead), ranked purely by cosine similarity between the entry's cached
  embedding and the JD's embedding.
- **`skills` is not an independent matching signal.** There's no
  `match_skills`/skill embedding at all, in either route. Reasoning: a skill
  worth matching on should already appear with context inside a project or
  experience description — a bare skill tag with no supporting sentence is
  weaker evidence than a description showing how it was used, and matching on
  it separately would just be re-solving what `score_*` already covers via the
  full job-description text. `skills` stays in profile storage as plain
  strings, unembedded, for CV-display purposes only (the conventional
  "Skills" tag section), not for scoring.

## Generation — ✅ implemented

- `POST /tailor-generate` accepts `{email, job_id}` (a saved job) or
  `{email, company_name, job_title, raw_description}` (ad-hoc, never persisted).
- Calls Bedrock **Claude Haiku 4.5** via the Converse API with matched
  projects/experience, explicitly instructed not to invent employers,
  dates, or achievements not present in the input.
- **The prompt includes the actual raw JD text** (`raw_job_description` in
  `prompt_context`), not a `KNOWN_SKILLS`-filtered keyword list. The original
  design only ever gave the model `extracted_requirements` — a handful of
  whitelist terms — never the real posting; the model was tailoring a CV
  against a thin proxy, with no way to pick up on anything the JD asked for
  outside that whitelist, or its actual tone/emphasis. Considered having a
  separate LLM call summarize the JD first instead — rejected as an
  unnecessary second Bedrock call solving a problem Claude Haiku doesn't have
  (it can read a raw job posting directly in the same call); worth
  reconsidering only if real JDs turn out to be long enough to strain the
  prompt budget, which there's no evidence of yet.
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
- ✅ **`job-service` reviewed** — three fixes applied to match patterns already
  established in `profile-service`: (1) graceful degradation on embedding
  failure, same shape as `profile-service`'s but *without* the caching/reuse
  machinery — `attach_embeddings` solves a problem (multiple embeddable
  sub-entries, re-saved over time) that doesn't apply here, since a job
  description has one embeddable field and is never updated in place (every
  `PUT` mints a fresh `job_id`); the only real gap was that `embed_text`'s
  failure wasn't caught at all, so a Bedrock hiccup failed the whole save. (2)
  `email` is now normalized (`.strip().lower()`) on `PUT`, matching
  `profile-service` — previously job descriptions could be saved with
  inconsistent casing/whitespace relative to how the profile they belong to
  was keyed, risking silent lookup mismatches in `tailoring-service` (which
  takes one `email` and looks it up in both tables). (3) `company_name`/
  `job_title`/`raw_description` are now trimmed and rejected if blank after
  trimming, matching `profile-service`'s validation strictness.
- ✅ **Staged, per-service AWS deployment.** Each Lambda gets deployed to real
  AWS only after it's passed code review — not the whole stack at once just
  because the code exists in the repo. Mechanically: a throwaway branch
  (e.g. `test/deploy-profile-service`) branches off `develop` and trims
  `infra-stack.ts` down to only the reviewed service(s); `develop` itself always
  keeps the full, accurate architecture. The throwaway branch is never merged
  back — restoring the full stack means returning to `develop`'s version of
  `infra-stack.ts` once every service has passed review. If a bug is found
  during real-AWS testing, the fix goes on `develop` (the real source of
  truth), then gets pulled into the test branch with `git merge develop`
  before redeploying.
- ✅ **`tailoring-service`'s four review bugs, fixed together:**
  - **Email normalized** (`.strip().lower()`) in both `handle_tailor_preview`
    and `handle_tailor_generate`, matching `profile-service`/`job-service`.
  - **Graceful degradation via a new `safe_embed_text` wrapper** — the three
    previously-unguarded `embed_text` calls (the ad-hoc JD embed, the
    saved-job fallback embed, and the per-entry safety-net embed inside
    `score_entries_with_semantics`) all route through it now. A Bedrock
    failure degrades to `None` instead of a 500; the rest of the pipeline
    (`cosine_similarity`) already tolerates a `None` vector by falling back to
    a `0.0` score.
  - **`strip_code_fence` added before `json.loads`** in
    `call_bedrock_for_tailoring`, defensively stripping a
    ` ```json ... ``` ` wrapper if Claude adds one despite being told not to.
  - **`BEDROCK_MODEL_ID` fixed to the inference-profile ID**
    `us.anthropic.claude-haiku-4-5-20251001-v1:0` (confirmed working via a
    real `converse` call), and the IAM policy rebuilt to grant both the
    profile ARN and the three regional foundation-model ARNs it can route to
    (`us-east-1`, `us-east-2`, `us-west-2` — confirmed via
    `aws bedrock get-inference-profile`). While rebuilding this policy, also
    split the previously-shared Bedrock grant into an embedding-only policy
    (all three Lambdas) and a generation-only policy (`tailoring-service`
    only) — `profile-service`/`job-service` never call Claude Haiku and
    shouldn't have had permission to.
  - **Verified via an execution-based local test** (monkeypatching the
    AWS-dependent leaf calls so the real handler code — routing,
    normalization, validation — actually runs): email normalization, the
    degradation path, and fence-stripping all confirmed correct when actually
    executed, not just read. `cdk synth` confirmed the resulting IAM policies
    are scoped correctly per-service.

## Open decisions

- ❓ **No dedup on `job-service` save.** Every `PUT /job-description` creates a
  brand-new item with a fresh UUID `job_id`, even if it's an identical
  resubmission — a double-click, a client retry after a timeout, or the same
  JD pasted again while iterating on a profile. Once `/job-description/list`
  is actually used by a frontend, this could mean duplicate entries piling up
  in someone's saved-jobs list. Raised during `job-service`'s review; left as
  a product/scope call, not fixed.
- ❓ **No delete/archive for job descriptions.** `cv-service` had soft-delete
  (`is_archived`) before it was dropped; `job-service` has no equivalent —
  once saved, a job description sits there permanently with no way to remove
  it. Same status: raised, not fixed, pending a decision on whether/how this
  app should support it.

## Known bugs, pending fix

- 🐛 **Generation sometimes fabricates an employer name — found during
  real-Bedrock testing, once the Marketplace blocker below was resolved.**
  Given an ad-hoc JD for "Acme Corp," the model's `generated_cv.experience`
  included `"company": "Acme Corp"` — the *target* company, not a real past
  employer — attached to a description drawn from the candidate's actual
  project work. A second call (saved-job path, same underlying profile)
  correctly wrote `"company": "Not specified"` for the same missing-data
  situation, so this is inconsistent, not a hard rule the model always
  breaks. Root cause: `profile_data.experience` entries only ever store
  `title`/`description` — there's no company/employer field anywhere in the
  schema — yet the generation schema in the system prompt still asks for
  `"company"` on every entry, so the model has nothing real to put there and
  sometimes reaches for the one company name sitting in the prompt
  (`target_role.company_name`) instead of abstaining. Violates the system
  prompt's own "don't invent employers... not present in the input"
  instruction. Not yet fixed — options include instructing the model
  explicitly to use a fixed placeholder (never the target company's name)
  when no employer is given, and/or adding a company field to the profile
  schema so real data exists to draw from.

## External blocker (RESOLVED)

- ✅ Was: Claude Haiku 4.5 generation blocked by
  `AccessDeniedException: ... INVALID_PAYMENT_INSTRUMENT: A valid payment
  instrument must be provided` on this AWS account's Marketplace
  subscription. Root cause was an expired card on the account — fixed by the
  user directly in AWS Billing; confirmed working ~60s after the fix via a
  direct `converse` call, then confirmed again through the actual deployed
  `/tailor-generate` endpoint (see AWS verification status below). Kept here
  as a record of the diagnosis process (ruled out IAM/ARN/code first) in case
  something similar recurs.

## AWS verification status

- ✅ **`profile-service`** — deployed to real AWS (account `681583877402`,
  `us-east-1`) via the staged process above and manually verified: `PUT`/`GET
  /profile` round-trip correctly, embeddings are real (1024-dim, confirmed by
  reading the raw DynamoDB item) and hidden from API responses, the cache
  reuses an unchanged entry's embedding byte-for-byte while correctly
  re-embedding an edited one, and all error paths (404/400) behave as
  expected. CloudWatch logs clean across every test call.
- ✅ **`job-service`** — added to the same staged stack (`test/deploy-profile-service`,
  now covering both services) and manually verified: `PUT`/`GET`/`GET .../list`
  all round-trip correctly, email is normalized (`"  Allan@Example.com  "` →
  `"allan@example.com"`, confirmed in the stored item), a real embedding is
  stored (1024-dim, confirmed via raw DynamoDB read), blank-after-trim fields
  are rejected (400) instead of silently stored, a nonexistent `job_id` 404s,
  and a different email against the same `job_id` also 404s — confirming the
  partition-key scoping is structural, not just an unchecked assumption.
  CloudWatch logs clean across every test call. Confirmed independently via
  the manual test plan, per the testing workflow.
- 🚧 **`tailoring-service`** — deployed to the same staged stack.
  `POST /tailor-preview` fully verified (keyword matching, `prompt_context`
  with `raw_job_description`, zero Bedrock calls). `POST /tailor-generate`'s
  full pipeline confirmed working end to end once the Marketplace blocker was
  resolved: both the saved-job and ad-hoc paths return real `generated_cv`
  output, semantic matching demonstrably caught a paraphrase-only match with
  zero keyword overlap (an experience entry about "Bittide protocol" scored
  0.112 against a JD asking for AWS/Linux/CI-CD and was correctly used in the
  generated summary), and CloudWatch logs are clean across every test call.
  Not marked fully ✅ yet — not because the deploy failed, but because the
  fabricated-employer-name bug above was found during this same testing and
  should be resolved (or explicitly accepted) before calling generation
  quality verified, not just generation connectivity. Automated verification
  done by me; manual confirmation from the user still pending, per the
  testing workflow.

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
