# API testing log

A procedural record of what was actually run against real AWS (account
`681583877402`, `us-east-1`) and what came back — not just the pass/fail
summary in `PLAN.md`, but the steps and evidence behind it. Ordered
newest-first (`tailoring-service`, the most recently worked on, first).

**Environment for all of this:** staged deploy branch `test/deploy-profile-service`,
API base URL `https://qmpqjnqmn8.execute-api.us-east-1.amazonaws.com`.

---

## Measuring cost per user (`BEDROCK_USAGE` logging, all four Lambdas)

**Why:** wanted to know what a brand-new user costs us, from signup to a
generated CV. Two things had to be separated: knowing *how many tokens*
each step actually uses (solvable in-app) and knowing the *current price
per token* for Claude Haiku 4.5 / Titan Embed V2 on Bedrock (not solvable
reliably by fetching it — the public Bedrock pricing page is JS-rendered and
the AWS Price List API's `model` attribute doesn't yet index these newer
models; the reliable sources are AWS Cost Explorer, filtered to Bedrock, for
what's already been spent, and the Bedrock console's own model page for
current per-token rates).

**What was built:** every Bedrock call site in all four Lambdas
(`profile-service`, `job-service`, `intake-service`, `tailoring-service`)
now prints one structured `BEDROCK_USAGE {...}` log line per call, carrying
the real token counts already present in that call's own response — Titan's
`inputTextTokenCount`, Converse's `usage.inputTokens`/`outputTokens` —
instead of an estimate. Purely additive; no behavior change. Filter in
CloudWatch Logs Insights with: `fields @message | filter @message like
/BEDROCK_USAGE/`.

**Local (mocked Bedrock, no AWS calls) — 20 checks, all pass:** correct log
shape/fields per service; real token counts from the mocked response flow
through unchanged; critically, the embedding cache still works exactly as
before — for 2 profile entries where 1 was unchanged, only 1 Bedrock call
(and 1 log line) was made, confirming the logging didn't accidentally make
`attach_embeddings` re-embed unchanged entries.

### Run 1 — simple profile

Full onboarding journey, test email `usage.log.test@example.com` (deleted
from DynamoDB after): `POST /profile/parse` → `PUT /profile` → `PUT
/job-description` → `POST /tailor-generate`.

**Test data:**
- Pasted text: *"I am Jordan Lee, a backend engineer. I worked at Nimbus
  Software from 2021 to 2024 building Python services on AWS. I also built
  a side project called Budget Tracker in 2023."*
- Resulting profile: 1 experience entry (Backend Engineer @ Nimbus
  Software), 1 project (Budget Tracker), 0 education, 2 skills.
- Job description: "Backend Software Engineer" @ "Vertex Analytics" —
  *"We need a backend engineer experienced with Python and AWS to build
  cloud services."* (short, one sentence)

All four calls succeeded; CloudWatch Logs Insights showed exactly one line
per Bedrock call, with real numbers:

| Call | Model | Input tokens | Output tokens |
|---|---|---|---|
| `PUT /profile` → embed "Backend Engineer" experience | Titan Embed V2 | 11 | — |
| `PUT /profile` → embed "Budget Tracker" project | Titan Embed V2 | 10 | — |
| `PUT /job-description` → embed the JD | Titan Embed V2 | 16 | — |
| `POST /profile/parse` → structure the pasted text | Claude Haiku 4.5 | 420 | 138 |
| `POST /tailor-generate` → generate the CV | Claude Haiku 4.5 | 407 | 122 |

Zero CloudWatch error events across all four services.

### Run 2 — richer profile, longer JD (scaling check)

Same flow, deliberately heavier input to see how cost scales: test email
`richer.test@example.com` (deleted after).

**Test data — pasted text for `POST /profile/parse`:**
```
I'm Sarah Mitchell, a backend and infrastructure engineer with about 8 years
of experience. Most recently I've been a Senior Backend Engineer at Cascade
Systems from 2022 to now, where I lead a team building payment processing
APIs in Python and Go, handling around 2 million transactions a day, and I
migrated our monolith to a microservices architecture on Kubernetes. Before
that, I was a DevOps Engineer at Meridian Health from 2019 to 2022, where I
built CI/CD pipelines with Jenkins and GitHub Actions, managed Terraform
infrastructure across AWS and GCP, and set up Prometheus/Grafana monitoring
for a HIPAA-compliant environment. From 2017 to 2019 I worked as a Software
Engineer at Quill Data, a small startup, building their initial REST API in
Node.js and setting up their first PostgreSQL database schema. My very first
job out of school was a one-year contract as a Junior Developer at Fenwick
Consulting in 2016, mostly writing internal tooling scripts in Python.

On the side, I've built a few things: a self-hosted budget tracking app
called Ledgerline using React and a Django backend, which I've maintained
since 2021; an open-source Terraform module for provisioning multi-region
DynamoDB tables that's gotten a few hundred GitHub stars, built in 2023; and
back in 2018 I built a Discord bot for a gaming community that did automated
tournament bracket scheduling.

I have a Bachelor's in Computer Science from Riverside State University,
2013 to 2017. I also did an AWS Solutions Architect certification course
through a community college in 2020, no formal degree, just a certificate.

Skills: Python, Go, Node.js, Kubernetes, Docker, Terraform, AWS, GCP,
Jenkins, GitHub Actions, PostgreSQL, DynamoDB, Prometheus, Grafana, React,
Django.

Outside of work I coach a youth soccer team on weekends, and I'm into
woodworking as a hobby.
```

Parsed into **4 experience entries, 3 projects, 2 education entries, 16
skills** — the two hobbies (soccer coaching, woodworking) were correctly
excluded from the extraction.

**Test data — job description for `PUT /job-description`:**
```json
{
  "company_name": "Northbeam Cloud",
  "job_title": "Senior Site Reliability Engineer",
  "raw_description": "Northbeam Cloud is looking for a Senior Site Reliability Engineer to join our Platform team. We run a multi-region, multi-cloud infrastructure serving millions of API requests per day, and reliability is core to our business.\n\nWhat you'll do:\n- Design, build, and operate highly available distributed systems across AWS and GCP\n- Own our Kubernetes platform: cluster upgrades, autoscaling, cost optimization, and security hardening\n- Build and maintain CI/CD pipelines that let product teams ship safely and frequently\n- Define and track SLOs/SLIs for critical services, and lead incident response and postmortems\n- Write infrastructure as code (Terraform) and drive infrastructure toward full automation\n- Build observability tooling (metrics, logging, tracing) so engineers can debug production issues quickly\n- Partner with backend teams on capacity planning, performance tuning, and architecture reviews\n- Mentor other engineers on operational best practices\n\nWhat we're looking for:\n- 5+ years of experience in an SRE, DevOps, or backend infrastructure role\n- Deep hands-on experience with Kubernetes in production\n- Strong scripting/programming ability in Python and/or Go\n- Experience with infrastructure as code, ideally Terraform\n- Experience with CI/CD tooling (GitHub Actions, Jenkins, or similar)\n- Solid understanding of networking, Linux systems, and distributed systems fundamentals\n- Experience with monitoring/observability stacks like Prometheus and Grafana\n- Comfortable being on an on-call rotation and leading incident response\n\nNice to have:\n- Experience operating databases at scale (PostgreSQL, DynamoDB, or similar)\n- Experience in a regulated or compliance-heavy environment (HIPAA, SOC 2, PCI)\n- Contributions to open-source infrastructure tooling\n- Multi-cloud experience (AWS + GCP or Azure)\n\nWhat we offer: competitive salary, equity, fully remote work, unlimited PTO, and a home office stipend."
}
```
1928 characters — multi-section (responsibilities / requirements / nice-to-have / benefits).

**Match quality:** 3 of 4 experience entries scored above
`MIN_SEMANTIC_SCORE` (DevOps Engineer 0.466, Senior Backend Engineer 0.395,
Software Engineer 0.27) — correctly dropping the least-relevant "Junior
Developer / internal tooling scripts" entry. 1 of 3 projects matched (the
Terraform/DynamoDB module, 0.22) — correctly dropping the budget-tracker app
and the Discord bot. `generated_cv` used the real companies (Cascade
Systems, Meridian Health, Quill Data) and real periods throughout — no
hallucinated employer, same as every prior generation test. Zero CloudWatch
errors across all four services.

**Real token counts:**

| Call | Model | Input | Output |
|---|---|---|---|
| 7× profile entry embeds (15, 27, 18, 36, 42, 24, 16) | Titan Embed V2 | 178 total | — |
| JD embed (1928-char description) | Titan Embed V2 | 391 | — |
| `POST /profile/parse` | Claude Haiku 4.5 | 824 | 675 |
| `POST /tailor-generate` | Claude Haiku 4.5 | 1142 | 480 |

### Cost comparison

Pricing applied: the user-supplied Anthropic first-party table for Claude
Haiku 4.5 ($1.00 / $5.00 per 1M input/output tokens). Titan Embed V2 isn't
in that table (it's an Amazon model, not Anthropic) and wasn't priced here —
but its token volume is a rounding error next to Claude's in both runs
(37 vs. 569 tokens, against ~1,100–2,000 Claude tokens), so leaving it out
doesn't materially change either total.

| Run | Profile size | JD size | Claude tokens (in/out) | Cost |
|---|---|---|---|---|
| 1 — simple | 1 experience, 1 project | ~90 chars | 827 / 260 | **≈ $0.00213** |
| 2 — richer | 4 experience, 3 projects, 2 education, 16 skills | 1928 chars | 1966 / 1155 | **≈ $0.00774** |

Run 2 cost **≈3.6×** Run 1 — driven almost entirely by output tokens: a
richer profile makes for a longer structured extraction, and more matched
entries plus a longer JD make for a longer generated CV. Cost per user isn't
a single number — it's bounded below by a sparse profile (~$0.002) and
grows with how much career history and JD detail a real user provides. At
the 1000-user scale `PRODUCTION.md` targets, that's roughly **$2–8** in
Claude spend for 1000 users to each complete onboarding once, depending on
how much they write — confirming Bedrock cost isn't the bottleneck at that
scale; the real constraints are the ones already tracked in `PRODUCTION.md`
(auth, throttling, storage).

**Caveat:** the pricing table used is Anthropic's *first-party API*
pricing. This app calls Claude Haiku 4.5 through *Amazon Bedrock*, which AWS
describes as separately/partner-priced — Bedrock's on-demand rate has
historically tracked the first-party price for Claude models, but that
wasn't independently confirmed for Haiku 4.5 on Bedrock specifically. Cost
Explorer / the Bedrock console pricing tab remain the way to get an
exact-not-probable number.

**Status: usage logging verified end-to-end against real AWS across two
runs of different scale (simple and richer). Purely additive (no behavior
change). Cost-scaling behavior confirmed: dominated by Claude Haiku output
tokens, not Titan embedding calls. No explicit "I confirm" from the user
yet, but the output has been reviewed and built on directly (the cost
calculations above).**

---

## Job description frontend (`JobDescriptionPage.tsx` → `job-service` + `tailoring-service`)

Full headless-browser run against `npm run dev` (localhost:5173) talking to
the real deployed backend. Test email `jd.frontend.test@example.com`, all
data deleted from DynamoDB after.

**Flow driven:**
1. Sign in (fresh email) → landed on `/profile`.
2. Pasted a background paragraph (Nimbus Software 2021–2024, Budget Tracker
   project 2023, State University CS degree 2017–2021) → **Build my profile**
   → parsed correctly → **Save profile** → "Profile saved ✓".
3. Clicked the new **Add a job to tailor for →** link on the saved screen →
   landed on `/jobs`.
4. Filled in company "Vertex Analytics", title "Backend Software Engineer",
   and a Python/AWS job description → **Save job** → appeared immediately in
   the saved-jobs list (optimistic add from the `PUT` response, no extra
   fetch needed).
5. Clicked **Tailor CV** on that job → `POST /tailor-generate` → generated
   result rendered inline on the job's card:
   > "Backend Software Engineer" — "Software engineer with experience
   > building Python services on AWS..." — Experience: "Software Engineer ·
   > Nimbus Software · 2021-2024" — Education: "Computer Science · State
   > University · 2017-2021"
   - **Real profile data used, not the target company** — "Nimbus Software"
     appears as the employer, not "Vertex Analytics." Confirms the
     anti-hallucination fix still holds through the new frontend path.
6. Reloaded the page → saved job list still showed "Backend Software
   Engineer" (`GET /job-description/list` round-trip confirmed).

**Console errors: none.** **CloudWatch (profile-service, tailoring-service,
intake-service, job-service, 10-minute window): zero error events.**

**Status: job description + tailoring frontend flow verified end-to-end
against real AWS.**

---

## Schema: `education` + `period` (all three services)

Deployed via `test/deploy-profile-service` (merged from `develop` @ `e2f98d8`).
Test email `edu.period.test@example.com`, deleted from DynamoDB after.

**Test 1 — `PUT /profile` with education + period, then `GET /profile`
round-trip:** saved a profile with one experience entry (`period: "2021-2024"`),
one project (`period: "2023"`), one education entry (`institution`, `degree`,
`period: "2017-2021"`, `description`). Both the `PUT` response and a follow-up
`GET` returned all fields intact, correctly nested. ✓

**Test 2 — raw DynamoDB scan** to confirm the embedding design decision landed
exactly as intended:
- `experience` item keys: `company, title, period, description, embedding` — has embedding (1024 floats) ✓
- `projects` item keys: `embedding, period, name, description` — has embedding ✓
- `education` item keys: `description, institution, degree, period` — **no embedding key at all** ✓ (education is pure pass-through, like skills — never scored/matched)

**Test 3 — editing only `period` reuses the cached embedding:** re-saved the
same profile with the experience `period` changed (`"2021-2024"` →
`"2021-2025"`, description/title/company unchanged). Compared the stored
embedding vector before and after — **byte-identical** (`-0.0818987637758255,
0.02513905242085457, -0.03089732490479946...` both times), while `period`
correctly updated to the new value. Confirms `period` is excluded from the
embed-relevant `text_keys` as designed — editing dates alone doesn't burn a
Bedrock call or invalidate the cache. ✓

**Test 4 — full `/tailor-generate` flow** against that profile (job: "Backend
Software Engineer" @ "Vertex Analytics", Python/AWS/API description):
- `prompt_context.matched_experiences` included the real `company` ("Nimbus
  Software") and `period` ("2021-2025") pass-through fields alongside the score.
- `prompt_context.education` surfaced the full entry (institution, degree,
  period, description) — unscored, as designed.
- `generated_cv.experience` used the **real** company/period, not the target
  company — no hallucination (this was the exact bug class fixed earlier in
  the session; confirms the fix still holds with the new fields in play).
- `generated_cv.education` correctly included the real institution/degree/
  period, and the summary naturally referenced the CS background without
  inventing anything not in the input.
- `matched_projects` was empty for this JD — the one saved project ("Budget
  Tracker") reasonably didn't score above threshold for a backend-engineer
  posting; expected behavior, not a bug.

**Test 5 — `POST /profile/parse` extraction of period + education from free
text** (text mentioning a CS degree 2016–2020 with honors, a Data Analyst
role 2020–2023, and a 2023 side project): all three sections extracted with
correct `period` values (`"2016-2020"`, `"2020-2023"`, `"2023"`) and the
education entry correctly split into `institution`/`degree`/`period`/
`description` ("Graduated with honors"). No fabricated fields.

**CloudWatch logs**: checked `profile-service`, `tailoring-service`, and
`intake-service` log groups for the 15-minute test window — zero error events
across all three.

**Status: education + period schema verified end-to-end against real AWS
(save/read round-trip, embedding-cache correctness, generation, and free-text
extraction). Awaiting user's own manual pass before marking done in `PLAN.md`.**

---

## `intake-service` (`POST /profile/parse`)

Deployed as part of the frontend-integration work — turns free-form prose into
the `profile-service` schema.

**Test 1 — casual, rambling text** (a paragraph mentioning: software engineer
at Delta Systems ~4 yrs Python/Go/APIs/Postgres; a year at a startup "Loopware"
doing frontend React; a side app "TripSplit" in React Native; woodworking as an
explicitly-stated hobby; "know Docker and AWS pretty well too"):

- `full_name` → `"Morgan Reyes"` ✓
- `skills` → `Python, Go, backend, APIs, Postgres, React, React Native, Docker, AWS` — reasonable, though "backend"/"APIs" are more concepts than tools
- `projects` → `[TripSplit]` only ✓ — correctly a project, not experience
- `experience` → `[Software Engineer @ Delta Systems, Frontend Developer @ Loopware]` — companies correct (both were named). "Frontend Developer" title was *inferred* from "doing frontend React work" — a mild synthesis, not stated verbatim; the human-review step is meant to catch this.
- **Woodworking hobby correctly excluded** from both lists.

**Test 2 — sparse, self-taught, no employer named** ("I taught myself web
development… built a portfolio site and a weather dashboard… comfortable with
JavaScript, HTML, CSS, starting to learn TypeScript"):

- `full_name` → `""` ✓ (no name given, not guessed)
- `skills` → `JavaScript, HTML, CSS, TypeScript` ✓
- `projects` → `[Personal Portfolio Site, Weather Dashboard]` ✓
- `experience` → `[]` ✓ — correctly empty; did **not** fabricate an employer or
  misclassify the projects as jobs, even though there was no formal role to
  extract.

CloudWatch logs clean on both. **Status: works; `company` discipline held (no
guessed employers); minor note on title inference.**

**Test 3 — full frontend flow** (dev server + headless browser vs the real
deployed backend): sign in with a fresh email → land on `/profile` → paste a
paragraph ("data engineer at Streamline Corp… interned at a fintech company…
built HabitDots in Svelte… play in a jazz band on weekends but that's just for
fun") → click "Build my profile".

- Parsed into the editable form: `full_name` "Riley Chen"; skills `[Python, ETL
  pipelines, Postgres, SQL, Svelte]`; experience `[Data Engineer @ Streamline
  Corp, Intern @ ""]` (internship company correctly blank — none was named);
  project `[HabitDots]`. Jazz band hobby excluded.
- Edited the name to "Riley Chen (edited)" → clicked **Save profile** → "Profile
  saved ✓".
- Direct `GET /profile` for that email confirmed the round-trip: `full_name`
  = "Riley Chen (edited)" (the edit persisted), 2 experience, 1 project, skills
  intact.
- Zero browser console errors.

**Status: profile intake flow wired end to end and verified against real AWS.**

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

### Round 5 — matching accuracy + threshold calibration

Purpose: measure how well pure-embedding matching actually separates relevant
entries from noise, on a realistic profile.

**Setup:** profile `casey.multitest@example.com` — 4 experience + 4 project
entries, only *one of each* IT-related, the rest hobbies (weekend trail guide,
community choir, amateur astronomer, vegetable garden, sourdough bread,
birdwatching journal). Job: a Software Engineer role mentioning Python, AWS,
databases, full-stack web apps, agile.

**Before adding a threshold** — cosine scores (all entries returned, ranked):

| Entry | Semantic score | Keyword score |
|---|---|---|
| Backend Developer *(relevant, has a literal "python" hit)* | **0.379** | 2 |
| Community Choir Member *(hobby)* | 0.086 | 0 |
| Amateur Astronomer *(hobby)* | 0.035 | 0 |
| Budget Tracker Web App *(relevant project, **zero** keyword overlap)* | **0.143** | 0 |
| Backyard Vegetable Garden *(hobby)* | 0.079 | 0 |
| Birdwatching Journal *(hobby)* | 0.044 | 0 |

- `/tailor-preview` (keyword-only) found the Backend Developer experience but
  **zero projects** — the relevant project shares no whitelist term with the
  JD. Exactly the blind spot semantic matching exists to close.
- Directionally correct: the one relevant entry outranked every hobby in both
  categories. But the margin for the *pure-paraphrase* project (0.143 vs the
  top hobby's 0.086) is much thinner than for the keyword-reinforced
  experience (0.379 vs 0.086).
- Filtering of hobby content out of the *final CV* came from the generation
  model's own judgment, not the pipeline — all entries were still in the
  prompt.

**Added `MIN_SEMANTIC_SCORE = 0.10`.** Re-ran the same profile:
- `matched_experiences`: `[Backend Developer 0.379]` only.
- `matched_projects`: `[Budget Tracker Web App 0.143]` only.
- All six hobby entries dropped. Generated CV used only the two real sources,
  no hobby leakage. **PASS.**

**Test 2 — adversarial** (`dana.analyst@example.com`, ad-hoc Data Analyst JD
about metrics / dashboards / SQL / spreadsheets / stakeholders):

| Entry | Score | Kept? |
|---|---|---|
| Operations Coordinator *(relevant, weak paraphrase — "tracked sales numbers", "dug into the figures", **zero** JD keywords)* | 0.206 | ✅ kept |
| Household Budget Spreadsheet *(relevant project, casual phrasing)* | 0.141 | ✅ kept |
| Fantasy Football League Manager *(hobby, deliberately loaded with "tracked player statistics in spreadsheets, calculated weekly scores")* | below 0.10 | ✅ **dropped** |
| Pottery Class Attendee *(hobby)* | below 0.10 | dropped |
| Appalachian Trail Section Hike *(hobby project)* | below 0.10 | dropped |

- Both weak-but-real paraphrase matches survived — no over-filtering.
- The technical-adjacent hobby (fantasy football with statistics/spreadsheets
  vocabulary) was correctly dropped — the embedding distinguished *shared
  words* from *actual relevance*. This was the failure mode most at risk from
  a threshold, and it held.
- Generated CV clean: only the two real sources, correct company attribution,
  no hobby content.

CloudWatch logs clean across all of Round 5.

**Current status:** all five rounds pass; `tailoring-service` deployed and
AWS-verified per `PLAN.md`. The 0.10 threshold is validated against two
profiles — still thin data, `MIN_SEMANTIC_SCORE` is a one-line change to tune.

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
