# CV persistence — design

Date: 2026-09-27
Status: decided, implemented (pending manual verification)

## Problem

The CV editor in the dashboard (`/builder`) works on generated CVs that exist
only in the browser. The whole tailored-CV directory is one localStorage blob:

```
localStorage["cv_tailor_dir_v2"] = { cvs: TailoredCVEntry[], viewerJobId }
```

`useCVStore` loads it **synchronously at module import** and rewrites the whole
array on **every keystroke** (`updateCV` → `persist`). Consequences:

- **Nothing survives the browser.** Clear site data, switch device, or open a
  different browser and every tailored CV is gone. "Edit/save whenever, wherever"
  isn't possible.
- **`logout()` destroys the user's work** — it calls `localStorage.removeItem`
  on the CV directory alongside the email key.
- A tailored CV is expensive to recreate: it costs a `/tailor-generate` Bedrock
  call. Losing one is losing money, not just time.

CV persistence was dropped along with `cv-service` in the DynamoDB migration
(`PLAN.md`: "⏸ **CV persistence.** Dropped along with `cv-service`. No backend
for saving/loading a generated or edited CV until the dashboard redesign
defines a new approach."). This is that new approach.

## Goal

Persist generated + edited tailored CVs server-side, scoped per user, so they
follow the user across devices and sessions. Do it without introducing a
per-keystroke request storm, and without losing any CV that only exists
locally today.

## Key decisions (and why)

### A user can have many CVs, so the sort key is a CV's own `cv_id`

The obvious key is `{user_id, job_id}` — one CV per job, which is what the
current store models (`TailoredCVEntry` is keyed by `jobId`). But tailoring is
iterative: a candidate regenerates for the same posting, tweaks wording, tries
a different template, and wants to compare attempts before exporting. Keying by
job collapses that to one row that each edit overwrites.

So: **PK `user_id` (the Cognito `sub`), SK `cv_id` (a client-minted UUID).**
`job_id` drops to a plain attribute, which is what a CV is *attributed to*
rather than *identified by*.

Trade-off accepted: "which CVs exist for job X" is no longer a direct DynamoDB
query, so it needs a GSI to answer server-side. **We deliberately skip the
GSI** — the builder already needs the full set to render "My tailored CVs", and
`GET /cv/list` returns it all. Client-side filtering over a set this size is
simpler and free. Revisit if a user ever has hundreds of CVs.

### Silent autosave with a visible status chip

`updateCV` fires per keystroke, from both the left-hand form
(`CVViewer`) and in-place editing on the preview pages (`PaginatedCV`'s
delegated `input` listener). A naive `await api.saveCV()` in that path is one
API Gateway + DynamoDB write **per character**, out of order.

Instead, localStorage stays the instant write-through buffer, and a **debounced
trailing flush** (~1.5s, with a max-wait cap so a continuously-typing user still
saves) pushes dirty entries to `PUT /cv`. Discrete, intentional actions
(`saveGeneratedCV`, `setTemplate`, delete) save immediately.

The user is never asked to press Save — a small chip in the builder header
reports `Saved` / `Saving…` / `Couldn't save`, so failure is visible without
blocking typing. Network failure never loses the edit: it stays in the local
buffer and retries with backoff.

### `DELETE /cv` is idempotent

Returns 200 whether or not the CV existed. A delete button is a double-click
target and a "already gone" error is a worse experience than a silent success.
Slight departure from the repo's `GET`-returns-404 convention, deliberate.

### Regenerate overwrites in place; new versions are explicit

`Regenerate` in the builder replaces the open CV's content **keeping the same
`cv_id`**. If every Regenerate click forked a new row, three clicks would leave
three copies and the CV list would fill with near-duplicates the user has to
clean up by hand. Forking is reachable through an explicit
"Generate another version" action on the jobs page instead.

### Local and server merge; local wins only when unsynced

On load we fetch `GET /cv/list` and merge with the local directory by `cvId`:

- a `cvId` only on the server → added (this is how another device's CVs appear)
- a `cvId` only locally → added and marked dirty, so it flushes upward
- a `cvId` in both → **the local copy wins only if it is still dirty**;
  otherwise the server copy wins

This is what makes migration free: a CV that only ever existed in localStorage
has no `cvId` yet, gets one minted at load, and is pushed up on first hydrate.
No migration step, no user action. The dirty-only-wins rule is what stops a
crash between an edit and its debounced flush from being silently reverted by
the server copy.

### The `cv_id` rekey is handled by minting, not discarding

`cv_tailor_dir_v2` entries have no `cvId` (the key was the job id). `loadDir`
reads v2 when v3 is absent and mints a `cvId` per entry, so **existing local
CVs are kept**. This differs deliberately from the v1→v2 bump, where `skills`
changed shape incompatibly and the decision was to regenerate — here the
migration is cheap and lossless, so there's no reason to throw work away.

### `raw_description` is capped, and the job ref is kept

Each entry stores a `job_ref` snapshot of the job it was tailored from
(`{company_name, job_title, raw_description}`) so `isJobRefMatching` can
still tell whether the job has been edited since — that's what decides
regenerate-vs-reuse on the jobs page. It duplicates `JobDescriptionsTable`,
but it keeps the CV item self-contained (the builder renders without fetching
the job) and keeps the staleness logic untouched.

Nothing caps `raw_description` length today, and a DynamoDB item is capped at
400KB — so a large pasted posting duplicated into the CV item could fail the
write. `normalize_cv_payload` truncates it and reports a warning rather than
failing the save. Fingerprinting instead of storing the text was considered
and rejected as more moving parts for a marginal saving.

### `cv-service` makes no Bedrock calls

It's pure CRUD over one table, so its IAM role grants `ReadWrite` on `CvsTable`
and nothing else. No embedding policy, no generation policy — unlike every
other Lambda in the stack, which is worth calling out in `infra-stack.ts` so
nobody "fixes" the missing policy later.

## Architecture

### `CvsTable` (new, in `infra/lib/infra-stack.ts`)

| | |
|---|---|
| Partition key | `user_id` (S, the Cognito `sub`) |
| Sort key | `cv_id` (S, client-minted UUID) |

```json
{
  "user_id": "<cognito-sub-uuid>",
  "cv_id": "8f2c...uuid",
  "job_id": "3f1c9e2a-8b0d-4e3a-9f21-6c1a2b3d4e5f",
  "meta": { "companyName": "Catalyst Cloud", "jobTitle": "Junior DevOps Engineer" },
  "job_ref": { "company_name": "...", "job_title": "...", "raw_description": "..." },
  "template_id": "modern",
  "generated_at": "2026-09-27T10:22:31Z",
  "updated_at": "2026-09-27T10:41:08Z",
  "created_at": "2026-09-27T10:22:31Z",
  "cv": { "...": "CVData — see dashboard/src/types.ts" }
}
```

`cv` is the full `CVData` document. Entry-level `id`s inside it are preserved
rather than re-minted server-side, so React keys stay stable across a reload.

`updated_at` is displayed ("last edited") but is **not** the list sort key —
sorting by it would reshuffle "My tailored CVs" on every autosave. Ordering is
`generated_at` descending, so a CV's position reflects when it was created.

`user_id` as the partition key means cross-user access is structurally
impossible: every read and write names a partition, and that partition is
always the verified JWT `sub`, never a client-supplied value.

### Backend (`infra/lambda/cv-service/index.py`)

Same conventions as the other three Lambdas — hand-parsed `rawPath` +
`requestContext.http.method` dispatch, `get_user_id(event)` reading the JWT
authorizer claims, the shared `response()` / `DecimalEncoder` / `now_iso()`
helpers copy-pasted per-service, and the same
`JSONDecodeError → 400` / `MissingIdentityError → 500` / `KeyError → 500` /
`Exception → 500` exception ladder.

`normalize_cv_payload` mirrors `profile-service`'s `normalize_profile_payload`:
coerce every field to its declared type, trim strings, drop array entries that
aren't objects, clamp `skills[].level` to 1–10, and truncate
`job_ref.raw_description`.

| Route | Method | Behaviour |
|---|---|---|
| `/cv` | `PUT` | Upsert. No `cv_id` in the body → create; `cv_id` present → replace in place, preserving `created_at`. |
| `/cv` | `GET` | One CV by `?cv_id=`. 404 if absent. |
| `/cv/list` | `GET` | All the caller's CVs, `generated_at` descending. |
| `/cv` | `DELETE` | Delete by `?cv_id=`. Idempotent 200. |

All four behind the same `HttpJwtAuthorizer` as every other route — there is no
unauthenticated route, and adding one would require deliberately omitting the
`authorizer` property (which is easy to do by accident).

### Frontend (`dashboard/`)

- `api/backend.ts` — `StoredCV` interfaces and four typed functions over the
  existing `request<T>()` helper. The Cognito access token attaches
  automatically; nothing to plumb.
- `utils/cvSync.ts` (new) — the dirty-set / debounce / retry machinery,
  extracted from the store so it's testable in isolation. Flushes on
  `visibilitychange → hidden`. It does **not** flush on `beforeunload`:
  `navigator.sendBeacon` cannot set an `Authorization` header, so a beacon
  flush would 401. `visibilitychange` is the reliable async-capable hook.
- `store/useCVStore.ts` — the rekey (`jobId` identity → `cvId` identity,
  `viewerJobId` → `viewerCvId`), async `hydrate()` replacing the
  module-import-time `loadDir()`, per-entry `syncState`, and immediate PUTs for
  the discrete actions.
- `App.tsx` — calls `hydrate()` once auth is established.
- `pages/CVBuilderPage.tsx` — the save-status chip, CV list grouped by job
  (with delete per entry), regenerate-in-place.
- `pages/JobDescriptionPage.tsx` — "Open" jumps to the most recent CV for a
  job; "Generate another version" forks a new `cv_id`.

### Migration

No user action, no script. On first load after deploy, `loadDir()` reads
`cv_tailor_dir_v2`, mints a `cvId` for each entry, marks them dirty, and
`hydrate()`'s merge pushes them to `PUT /cv`. Subsequent loads find
`cv_tailor_dir_v3` and read it directly.

`logout()` no longer wipes the CV directory. With server-side persistence that
would destroy synced work over what is now a purely local optimisation. It
clears the email key and the in-memory state only; the cached directory is
reconciled against the server on the next hydrate, and being signed out can
never delete a server-side CV anyway (the delete path requires a JWT).

## Testing / verification plan

Backend:
- `python3 -m py_compile infra/lambda/cv-service/index.py`
- `npx cdk synth` — 3 DynamoDB tables, 5 Lambdas, 12 routes (one CloudFormation
  route per method), and confirm `cv-service`'s role has no `bedrock:InvokeModel`
- Deploy, then exercise each route with a live Cognito token: create, read
  back, list, update in place (assert `created_at` is preserved and
  `updated_at` moved), delete, and delete-again (assert 200, not 404)
- Two users: assert user A's `GET /cv/list` never contains user B's CVs
- Assert the stored item is a valid `CVData` round trip — including entry
  `id`s and a `skills[].level` of 7 surviving intact

Frontend:
- `npm run build` (`tsc` — the store, pages, and new sync module all typecheck)
- `npm test` for the sync module's debounce/retry logic
- In the browser: type into a CV, wait for the chip to read Saved, hard-reload,
  and confirm the edit is still there
- Open a second browser profile, sign in as the same user, and confirm the CV
  is there
- Confirm editing on device A appears on device B after a reload
- Delete a CV and confirm it stays deleted after a reload
- Delete a CV that was never synced and confirm it doesn't reappear on reload

## Explicitly out of scope for this pass

- **A GSI for "CVs for job X"** — client-side filtering is enough at this
  scale.
- **Version history / undo.** Multiple CVs per job makes side-by-side
  comparison possible; keeping old revisions of *one* CV is not built.
- **Soft delete / trash.** `DELETE /cv` is a hard delete.
- **`phone` / `location` / `website` / `linkedin` on the profile.**
  `generatedCvToCVData` still hardcodes these to `''` because `ProfilesTable`
  doesn't carry them (`PLAN.md`, "Profile schema gap"). Closing that is a
  profile-schema change that also intersects the un-designed
  "profile merge vs overwrite" item.
- **`DELETE /job-description`** — still an open item on its own
  (`PLAN.md`, Future improvements #2). Deleting a job does **not** cascade to
  its CVs; an orphaned CV is still readable and exportable.
- **Multi-tab conflict resolution.** Two tabs editing the same CV is
  last-write-wins at the item level. A `BroadcastChannel` would fix it; not
  built.
- **Metadata-only list endpoint.** `GET /cv/list` returns full entries so the
  builder hydrates in one round trip, matching the current whole-blob
  localStorage behaviour.
