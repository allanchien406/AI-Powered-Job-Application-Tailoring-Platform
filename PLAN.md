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
    { "title": "Research Engineer", "company": "Bittide Labs", "description": "...", "embedding": [0.09, "..."] }
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
  not adding independent signal. Every entry is ranked by cosine similarity
  between its cached embedding and the JD's embedding; entries below
  `MIN_SEMANTIC_SCORE` (`0.10`) are then dropped as noise, and
  `build_prompt_context` caps the prompt at the top 3 of what's left. The
  0.10 number comes from a real test (see "Threshold calibration" below), not
  a guess — it started life as "no threshold at all" until there was data to
  set one from.
- **`skills` is not an independent matching signal.** There's no
  `match_skills`/skill embedding at all, in either route. Reasoning: a skill
  worth matching on should already appear with context inside a project or
  experience description — a bare skill tag with no supporting sentence is
  weaker evidence than a description showing how it was used, and matching on
  it separately would just be re-solving what `score_*` already covers via the
  full job-description text. `skills` stays in profile storage as plain
  strings, unembedded, for CV-display purposes only (the conventional
  "Skills" tag section), not for scoring.

### Threshold calibration

`MIN_SEMANTIC_SCORE = 0.10`. Data behind it (see `TESTING.md` for the full
runs):

- **Test 1** — a profile with 4 experience + 4 project entries, only one of
  each genuinely IT-related, the rest hobbies (choir, astronomy, gardening,
  sourdough…), against a software-engineer JD. Cosine scores: hobbies landed
  **0.03–0.09**; the one relevant experience (had a literal "python" hit too)
  scored **0.38**; the one relevant project (pure paraphrase, *zero* keyword
  overlap — "backend server / relational database" vs the JD's "databases /
  full-stack web applications") scored **0.14**. `0.10` sits just above the
  hobby ceiling with margin below that weakest real match. Re-run with the
  threshold: only the two real entries survived, all six hobbies dropped.
- **Test 2 (adversarial)** — a data-analyst JD, with a genuinely relevant but
  weakly-phrased experience ("tracked sales numbers", "dug into the figures" —
  no JD keywords) and a *hobby deliberately written to sound technical*
  ("Fantasy Football League Manager… tracked player statistics in
  spreadsheets, calculated weekly scores"). Result: the weak real match scored
  **0.206** and survived; the technical-sounding hobby scored **below 0.10**
  and was dropped. The embedding distinguished shared vocabulary from actual
  relevance — the failure mode most at risk from a threshold, and it held.

Known limits: still only two synthetic profiles. The gap between "weak real
paraphrase" (~0.14) and "hobby noise" (~0.09) is thin, so a borderline case
could still go either way. Erring toward recall (keep weak matches) because
catching paraphrases keyword matching misses is the entire reason semantic
scoring exists. Revisit as real usage data accumulates.

## Schema: education + period — ✅ implemented

- **`education`** is a new top-level profile array: `[{institution, degree,
  period, description}]` (`description` optional — honors/coursework/thesis).
  It gets **no embedding and no matching** — same call as `skills`: everyone
  lists all their education regardless of the job, and the matching value is
  low. It passes through to the generation prompt in full (capped at 5,
  un-scored, un-thresholded) and the generated CV gets an `education` array.
- **`period`** was added to `experience`, `projects`, and `education`
  (`"2020–2023"`, `"summer 2021"`, `"3 years"` — freeform, blank when
  unknown). It is **deliberately not part of the embedded text**: dates aren't
  semantic content, and editing only a date shouldn't force a re-embed.
  `attach_embeddings` in `profile-service` takes the embed-relevant field
  subset (`title`/`company`/`description`), and the full entry — `period`
  included — is what gets stored. `entry_text_unchanged` compares only that
  subset, so a period-only edit reuses the cached vector.
- Touched every layer: `profile-service` (schema + storage), `intake-service`
  (extraction prompt + normalization — now also pulls dates into `period`
  when stated), `tailoring-service` (both scoring paths carry `period`
  through, `build_prompt_context` adds `education`, the generation prompt's
  output schema gains `education` and stops hard-coding `"Not specified"` for
  `period`), and the frontend (`backend.ts` types + `ProfileIntakePage`
  gained period inputs and a whole Education section).
- **AWS-verified** (see `TESTING.md` → "Schema: `education` + `period`"):
  save/read round-trip; raw DynamoDB scan confirmed `education` items carry no
  `embedding` key while `experience`/`projects` do; editing only `period`
  left the stored embedding vector byte-identical (cache correctly reused);
  `/tailor-generate` surfaced real `company`/`period` (no hallucinated
  employer) and a correct `education` array in both `prompt_context` and
  `generated_cv`; `/profile/parse` correctly extracted `period` and
  `education` from free text; CloudWatch clean across all three services.
  Verified by me against the real deployed stack, and confirmed by the user's
  own manual pass — **done**.

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
- ✅ **Fixed generation fabricating an employer name (prompt-level fix, before
  the schema fix below existed).** The system prompt in
  `call_bedrock_for_tailoring` was updated to say `"Not specified"` should be
  used rather than guessing, and to never write `target_role.company_name` as
  an experience entry's `"company"` — that's the job being applied to, not
  somewhere the candidate worked. Verified against real Bedrock, not just
  read: redeployed and re-ran the exact case that had hallucinated
  (`"Catalyst Cloud"` and `"Acme Corp"` both previously appeared as fabricated
  employers) five times across both the saved-job and ad-hoc paths — zero
  hallucinations, `"Not specified"` written consistently every time.
- ✅ **Added `company` to the experience schema**, closing the gap the fix
  above was working around. `profile-service`'s `experience` entries now
  accept an optional `company` field (`normalize_entry_list(..., ["title",
  "company", "description"])`); `tailoring-service` surfaces it through both
  matching paths (`score_experience`'s keyword output, and
  `score_experience_with_semantics` via a new `extra_fields` passthrough) so
  the generation prompt has a real employer name to use when one exists,
  rather than needing to fall back to "Not specified" for data that's
  actually available. The system prompt was updated accordingly: use the real
  `"company"` if given and non-empty, fall back to `"Not specified"`
  otherwise (still never `target_role.company_name`). This also closes a
  frontend-alignment gap noted separately: `dashboard/src/types.ts`'s
  `ExperienceEntry` already had a `company` field — it was `profile-service`'s
  schema that was missing it, not the frontend.

  One backward-compatibility wrinkle caught and fixed while making this
  change: `attach_embeddings`' entry-comparison (`entry_text_unchanged`) did
  `existing_entry.get(key) == new_entry.get(key)`, which would have treated
  every pre-existing experience entry (saved before `company` existed, so the
  key is absent from the stored item) as "changed" the next time it's saved,
  since a missing key (`None`) doesn't equal the new payload's `company: ""`
  — needlessly re-embedding data that hadn't actually changed. Fixed by
  normalizing both sides with `(x or "")` before comparing, so a missing key
  and an empty string are treated the same; this also protects any future
  field addition the same way.

  Verified via execution-based local tests (not yet against real AWS): both
  `profile-service`'s and `tailoring-service`'s handling of the new field,
  and specifically the backward-compatibility fix, confirmed via direct
  function calls with representative inputs.

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

None currently outstanding. (See Resolved decisions for the
fabricated-employer-name fix.)

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

✅ **The `company` field addition is now AWS-verified too**, redeployed and
retested on top of the statuses below: resaving the existing test profile
*without* `company` (simulating an old client) left the stored embedding
byte-for-byte unchanged (the backward-compat fix works), resaving *with* a
real company name correctly triggered a fresh embed, and the real value
(`"Bittide Labs"`) flowed all the way through to a live `/tailor-generate`
call — showing up correctly on the matching experience entry while the
project-based entry (which genuinely has no employer) still correctly said
`"Not specified"`, and the target company was never used as a fake employer.
CloudWatch logs clean on both `profile-service` and `tailoring-service`.

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
- ✅ **`tailoring-service`** — deployed to the same staged stack and verified.
  `POST /tailor-preview` (keyword matching, `prompt_context` with
  `raw_job_description`, zero Bedrock calls) and `POST /tailor-generate`
  (both saved-job and ad-hoc paths) both work end to end. Along the way, three
  things were found via real testing and fixed + reverified: the external
  Marketplace/billing blocker (resolved), the fabricated-employer-name
  hallucination (prompt fix + `company` schema field, 5/5 clean), and the
  `MIN_SEMANTIC_SCORE = 0.10` threshold (calibrated and validated against two
  test profiles — see "Threshold calibration" and `TESTING.md`). CloudWatch
  logs clean throughout. Automated verification by me across all rounds; the
  user reviewed the manual test plans and elected to move on to frontend
  integration rather than re-run each round by hand.

**Next up: frontend ↔ backend integration** — see the section below.

## Frontend ↔ backend integration — 🚧 in progress

All backend services are deployed and verified. The old `dashboard/`
pages (`CVBuilderPage`, `MyCVsPage`) still reference the removed `cv-service`
(`cvApi.ts` → `/cv`, `/cv/list`) — stale, but not yet ripped out.

**Profile intake flow — ✅ wired end to end.** New `dashboard/src/api/backend.ts`
(real client for `profile-service`/`intake-service`; default URL points at the
staged deployment, override with `VITE_API_URL`) + new `ProfileIntakePage.tsx`
at `/profile`: sign in → paste your background as prose → `POST /profile/parse`
→ the result renders as editable fields (name, skill tags, experience,
projects, all add/remove-able) → correct anything → **Save** calls
`PUT /profile`. `LoginPage` now routes here after sign-in instead of the old
builder. Verified by driving the whole flow in a headless browser against the
real deployed backend: a pasted paragraph parsed correctly (companies where
named, blank where not, jazz-band hobby excluded), an edit to the name
persisted, and a direct `GET /profile` confirmed the round-trip. Zero console
errors. See `TESTING.md`.

**Job description + tailoring flow — ✅ wired end to end.** `backend.ts`
extended with `saveJobDescription`/`listJobDescriptions`/`generateTailoredCV`
(and the `JobDescriptionInput`/`StoredJobDescription`/`GeneratedCV`/
`PromptContext` types). New `JobDescriptionPage.tsx` at `/jobs`: paste
company/title/description → `PUT /job-description` → appears in a saved-jobs
list (`GET /job-description/list`) → **Tailor CV** on any saved job calls
`POST /tailor-generate` and renders the generated title/summary/experience/
education inline on that job's card. `ProfileIntakePage`'s "saved" screen now
links forward to `/jobs`, completing the loop from the login page. Verified
end to end in a headless browser against the real deployed backend: signed
in → parsed+saved a profile (Nimbus Software experience, Budget Tracker
project, State University education) → saved a Vertex Analytics job posting
→ generated a CV that used the *real* profile data (Nimbus Software, correct
period, State University) rather than fabricating an employer from the target
company name → reloaded the page and confirmed the saved job list persists
via `GET /job-description/list`. Zero console errors, zero CloudWatch errors
across all four Lambdas. See `TESTING.md`.

Still to do: deciding what happens to the stale
`CVBuilderPage`/`MyCVsPage`/`cvApi.ts`, and (smaller) `/tailor-preview`
(the free keyword-only route) isn't wired into the frontend anywhere yet —
only the paid `/tailor-generate` path is.

**Free-text experience → the profile-service JSON schema — ✅ backend built and
tested against real AWS.** Two runs (a rambling casual paragraph, and a sparse
self-taught description): companies extracted correctly when named, left empty
when not (no guessed employers), a stated hobby correctly excluded, and a
description with no formal role correctly produced an empty `experience` list
rather than fabricating one. One minor note: the model will lightly *infer* a
job title from described work ("Frontend Developer" from "doing frontend React
work") — a synthesis, not a fabrication of facts, and the frontend review step
is there to catch it. See `TESTING.md`. The product direction (and the
`FreeformDemoPage`
prototype) is that a user pastes/types their background as prose, not fills in
a structured form — but `PUT /profile` needs `{skills[], projects[{name,
description}], experience[{title, company?, description}]}`. A new
`intake-service` Lambda (`POST /profile/parse`) does the transformation with
one Claude call. Chosen shape:
- **Parse, don't save.** Returns the structured extraction unsaved; the
  frontend renders it as editable fields, the user corrects anything wrong,
  *then* the frontend calls the existing `PUT /profile`. The human review step
  is the real defense against extraction hallucination — same concern we
  fought in the generation direction.
- **Its own Lambda, not a route on `profile-service` or `tailoring-service`.**
  Keeps each service's job legible, and its IAM is minimal — Bedrock
  generation model only, zero DynamoDB (it never saves).
- Output is coerced to exactly the `PUT /profile` schema (empty entries
  dropped, trimmed, `company` left blank when no employer named).

## Future improvements — 📝 noted, not started

User-proposed, captured here for later. Not designed or scoped yet.

1. **Profile updates should merge, not overwrite.** `PUT /profile` today is a
   full replace — `normalize_profile_payload` takes exactly what's in the
   request body and that becomes the whole item (see `save_profile` in
   `profile-service`). `ProfileIntakePage` compounds this on the frontend
   side too: it always starts from a blank form (`stage: 'paste'`), so
   there's no way to see what's already saved before adding to it — a user
   has to re-paste their entire background to add one new job. Fix likely
   needs both ends: the frontend should load the existing saved profile into
   the review form (pre-filled, editable) instead of starting blank, and/or
   `profile-service` should support adding a single entry without requiring
   the full profile in the request. Worth deciding whether "merge" means
   append-only (never lose data unless explicitly removed) or still
   full-replace-but-easier-to-edit (pre-filled form, same overwrite
   semantics underneath) — those are different amounts of backend work.
2. **Saved job list needs edit/delete.** Right now `job-service` only
   supports create (`PUT` always makes a new UUID `job_id`, never updates)
   and read — there's no `DELETE`, no update-in-place. This is the same gap
   already flagged in "Open decisions" above (no dedup, no
   delete/archive) — now with a concrete frontend (`JobDescriptionPage`)
   that would use it. Needs a `DELETE /job-description` route at minimum;
   an update route depends on whether editing a saved JD should re-embed it.
3. **Reduce what's sent to the LLM — cost and security.** Two angles worth
   separating: (a) *cost* — trimming prompt size (e.g. capping
   `raw_job_description` length before it hits `/tailor-generate`, not just
   `MAX_RAW_TEXT_CHARS` on the intake side) and avoiding redundant context
   across calls; (b) *security* — right now full profile text (real name,
   real employers, potentially other PII) goes into every Bedrock prompt.
   Worth considering what's actually necessary to send vs. what's
   convenient, and whether anything should be redacted/minimized before it
   leaves the account boundary into the model call.
4. **PDF export needs to be ATS-friendly.** Already tracked below under
   "Deferred / explicitly out of scope" — `exportPDF.ts` currently rasterizes
   via `html2canvas` into an image-in-a-PDF with no extractable text, which
   defeats ATS parsing regardless of how good the generated content is.
   Restating here because it's now specifically tied to the *generated* CV
   from `/tailor-generate`, not just the manual builder.
5. **Cover letter generation.** A new capability, not just a fix — likely a
   new Bedrock-backed route (e.g. `POST /cover-letter-generate`) that takes
   the same `{email, job_id}` shape as `/tailor-generate` and reuses the same
   matched-profile-data + anti-hallucination prompt discipline established
   there, producing a tailored cover letter instead of (or alongside) the CV
   sections.

## Deferred / explicitly out of scope

- ⏸ **ATS-safe export.** `exportPDF.ts` rasterizes the CV via `html2canvas` into a
  PNG-in-a-PDF (no extractable text), and `ModernTemplate.tsx` is two-column —
  both defeat "ATS-friendly" regardless of AI content. Separate follow-up.
- ⏸ **CV persistence.** Dropped along with `cv-service`. No backend for
  saving/loading a generated or edited CV until the dashboard redesign defines a
  new approach.
- 🚧 **Frontend wiring** — now the active piece of work (moved out of deferred).
  See "Frontend ↔ backend integration" above.
- ⏸ **Profile schema gap (partially closed).** `education` and per-entry
  `period` were added (see "Schema: education + period" below). Still missing
  vs a full `CVData`: `phone`/`location`/`website`/`linkedin` and a top-level
  `title` — `generated_cv` still leaves those to be filled in manually.

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
