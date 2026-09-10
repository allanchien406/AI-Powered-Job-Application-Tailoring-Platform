# API testing log

A procedural record of what was actually run against real AWS (account
`681583877402`, `us-east-1`) and what came back — not just the pass/fail
summary in `PLAN.md`, but the steps and evidence behind it. Ordered
newest-first (`tailoring-service`, the most recently worked on, first).

**Environment for all of this:** staged deploy branch `test/deploy-profile-service`,
API base URL `https://qmpqjnqmn8.execute-api.us-east-1.amazonaws.com`.

---

## `tailoring-service`

### Round 1 — initial deploy, connectivity

1. Deployed alongside the already-verified `profile-service`/`job-service` (`cdk deploy`, 13 new resources, all `CREATE_COMPLETE`).
2. `POST /tailor-preview` with a saved profile + saved job (`job_id eb3d2223-...`, "Catalyst Cloud" JD asking for AWS/Linux/CI-CD):
   **Result: PASS.** `extracted_requirements: ["aws", "linux", "ci/cd"]`, the CI/CD project matched with `matched_terms`, `prompt_context` included `raw_job_description`. Zero Bedrock calls, as designed.
3. `POST /tailor-generate` (saved-job path):
   **Result: FAIL.** `{"error": "Bedrock call failed: AccessDeniedException"}`.

### Round 1 — diagnosing the failure

Ruled out code/IAM before concluding it was external:
- Direct `aws bedrock-runtime converse` call with the exact inference-profile ID → same `AccessDeniedException`.
- Retested Titan Embeddings directly → still worked (real 1024-dim vector).
- `aws bedrock list-foundation-models` → Claude Haiku 4.5 shows `ACTIVE`.
- Pulled the actual deployed IAM policy via `aws iam get-role-policy` → matched `cdk diff`'s prediction exactly.
- Retried the direct Bedrock call with the account's own `iamadmin` (full admin) credentials → **identical error**, ruling out any IAM policy fix.

**Conclusion:** AWS Marketplace subscription issue, not a code/infra bug. Full error:
```
AccessDeniedException: Model access is denied due to IAM user or service role
is not authorized to perform the required AWS Marketplace actions
(aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe)...
Your AWS Marketplace subscription for this model cannot be completed at this time.
```
User checked the account and found an expired card. After fixing it in AWS Billing:
- Immediate retest → more specific error: `INVALID_PAYMENT_INSTRUMENT: A valid payment instrument must be provided` (progress — confirms the diagnosis, but not propagated yet).
- Retest after a 60s wait → **PASS**, real `"OK"` response from Claude Haiku 4.5.

### Round 2 — full generation pipeline, post-billing-fix

1. `POST /tailor-generate` (saved-job path): **PASS.** Real `generated_cv` returned (`title`, `summary`, two `experience` entries), ~3.9s response time.
   - Notable: `matched_experiences` included the "Research Engineer / Bittide protocol" entry with **zero keyword overlap** with the JD — it had been *absent* from `/tailor-preview`'s keyword-only match — caught purely by cosine similarity (`score: 0.112`) and used correctly in the generated summary.
2. `POST /tailor-generate` (ad-hoc path, JD for "Acme Corp" re: "containerization and infrastructure automation"): **Mixed result.** Generation succeeded and picked up the semantically-related ECS project (`score: 0.292`, zero literal keyword overlap with "containerization"), but `generated_cv.experience[0].company` was `"Acme Corp"` — **a bug**: the target company, fabricated as if it were a past employer.
3. User independently re-ran the saved-job case themselves and got the same class of failure: `"company": "Catalyst Cloud"` — confirming this wasn't a one-off, it's the model inconsistently doing the wrong thing on repeat calls of the same input (`temperature: 0.4`).

### Round 3 — employer-name hallucination, prompt-level fix

Fix: explicit system-prompt instructions to write `"Not specified"` for `company`/`period` when not genuinely provided, and to never use `target_role.company_name` as an experience entry's company. Redeployed, then re-ran the exact cases that had hallucinated:

| Run | Path | `company` in output |
|---|---|---|
| 1 | saved-job | `"Not specified"` (both entries) |
| 2 | saved-job | `"Not specified"` (both entries) |
| 3 | saved-job | `"Not specified"` |
| 4 | ad-hoc ("Acme Corp") | `"Not specified"` (both entries) |
| 5 | ad-hoc ("Acme Corp") | `"Not specified"` (both entries) |

**Result: 5/5 PASS**, zero hallucinated employer names. CloudWatch logs clean across all five calls.

### Round 4 — `company` field added to the schema

Rather than *only* instructing the model to say "Not specified," added a real `company` field to the profile schema so real data exists when available (see `PLAN.md` for the full reasoning, including a backward-compatibility bug caught and fixed in `profile-service` along the way).

1. Captured the existing stored embedding for the "Research Engineer" experience entry (raw DynamoDB read).
2. Re-saved the profile with the *same* title/description and no `company` field (simulating a pre-migration client):
   **Result: PASS** — embedding byte-for-byte identical after (`diff` on the raw vectors showed no change). Confirms the `entry_text_unchanged` backward-compat fix works — a missing key isn't mistaken for a real change.
3. Re-saved with a real `company: "Bittide Labs"` added:
   **Result: PASS** — embedding changed (a real content change correctly triggered a fresh embed).
4. `POST /tailor-generate` (saved-job path) again:
   **Result: PASS.**
   - `prompt_context.matched_experiences[0].company` → `"Bittide Labs"` (the real value, now flowing through matching).
   - `generated_cv.experience`: the Research Engineer entry correctly shows `"company": "Bittide Labs"`; the CI/CD *project*-based entry (which has no employer at all) correctly still shows `"Not specified"`; the target company (`"Catalyst Cloud"`) does not appear as a fabricated employer anywhere.

CloudWatch logs clean on both `profile-service` and `tailoring-service` across this whole round.

**Current status:** all four rounds pass; `tailoring-service` is deployed and AWS-verified per `PLAN.md`.

---

## `job-service`

Deployed to the same staged stack after code review (email normalization, graceful degradation on embedding failure, stricter field validation — see `PLAN.md`).

1. `PUT /job-description` with deliberately messy input — `"  Allan@Example.com  "`:
   **Result: PASS.** Response's `email` came back `"allan@example.com"` (trimmed + lowercased), `job_id` was a generated UUID.
2. `GET /job-description?email=allan@example.com&job_id=<id>`:
   **Result: PASS.** Same data returned, embedding stripped from the response.
3. `GET /job-description/list?email=allan@example.com`:
   **Result: PASS.** Listed the saved job.
4. Raw DynamoDB read on the stored item: **PASS** — real 1024-dim embedding present, confirming Bedrock actually ran even though the API response never shows it.
5. `PUT /job-description` with `company_name: "   "` (whitespace-only): **PASS** — `400 {"error": "company_name is required"}`, not silently stored.
6. `GET /job-description` with missing `job_id` query param: **PASS** — `400`.
7. `GET /job-description` for a real `job_id` but a *different* `email`: **PASS** — `404`, confirming the partition-key scoping is structural (can't cross into another user's data), not just an app-level check that could be forgotten.
8. CloudWatch logs across all calls: clean, no errors.

User independently confirmed this manual test plan passed. **Status: AWS-verified.**

---

## `profile-service`

Deployed first, as its own scoped-down stack (`test/deploy-profile-service` branch created specifically for this staged-per-service deployment approach — see `PLAN.md`).

1. `PUT /profile` with a full profile (skills, one project, one experience entry): **PASS.** `200`, no `profile_id` in the response (intentionally dropped — `email` is the real identity), `embedding_warnings` absent (nothing failed).
2. `GET /profile?email=...`: **PASS.** Same data returned.
3. Raw DynamoDB read on the project entry's `embedding`: **PASS** — real 1024-dim vector, confirmed hidden from the API response (`strip_embeddings` works).
4. Re-saved with the project's text unchanged, experience's text edited:
   **Result: PASS** — project's embedding was byte-for-byte identical before/after (cache correctly reused it); experience's embedding differed (correctly re-embedded since the text actually changed).
5. `GET /profile?email=nobody@example.com`: **PASS** — `404`.
6. `GET /profile` with no `email` param: **PASS** — `400`.
7. `PUT /profile` with no `email`: **PASS** — `400`.
8. `DELETE /profile`: **PASS** (as expected) — `404` from API Gateway itself, since the route only registers `GET`/`PUT`; confirmed this is API Gateway rejecting it before the Lambda ever runs, not a Lambda bug.
9. CloudWatch logs: clean across every call.

User confirmed this round (the first one under the now-formal testing workflow, though profile-service's own initial marking predates that policy being written — see `AGENTS.md`/`PLAN.md` for that history). **Status: AWS-verified.**
