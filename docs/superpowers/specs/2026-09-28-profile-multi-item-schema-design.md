# Profile multi-item schema — design

Date: 2026-09-28
Status: decided, implemented, AWS-verified

## Problem

`ProfilesTable` currently stores one user's entire profile as a single
DynamoDB item (`infra/lib/infra-stack.ts:36-40` — partition key `user_id`,
no sort key). `profile-service`'s `PUT /profile` (`index.py:219-240`)
always does one `table.put_item(Item=item)` with the *whole* profile —
every skill, every project, every experience entry, and every entry's
cached embedding — regardless of which single field the user actually
changed.

This is expensive specifically because of embeddings: each project/experience
entry carries a 1024-float Titan Embed V2 vector (`attach_embeddings`,
`index.py:150-198`), which serializes to **~12.3KB per entry**. A realistic
profile (3 projects + 3 experience entries) measures **~76KB total, ~74KB of
which is embeddings** — verified by constructing a representative profile and
serializing it. That scales linearly with entry count (~12.3KB × number of
projects+experience entries), and unlike `cv-service`
(`infra/lambda/cv-service/index.py:55-79`), `profile-service` has **no caps**
on list length or field size. A user with a long history (say 15 projects +
15 experience entries) would be pushing **~370KB** — within reach of
DynamoDB's 400KB single-item limit, with no truncate-and-warn fallback: the
save would fail outright.

Separately, every save re-transmits and rewrites every *unchanged* entry's
12KB embedding too, even though `attach_embeddings` already avoids
*recomputing* it — the cache saves a Bedrock call but not the DynamoDB write.

## Goal

Eliminate the single-item size ceiling entirely, and stop rewriting entries
that didn't change, without changing the `/profile` API's request/response
shape (the frontend should need zero behavior changes).

## Key decisions (and why)

### Split into multiple items per user: `PK=user_id`, `SK=entity_key`

New `ProfilesTableV2`:

| `entity_key` | Contents |
|---|---|
| `PROFILE` | `email`, `full_name`, `skills`, `education`, `created_at`, `updated_at` |
| `PROJECT#<id>` | `name`, `period`, `description`, `embedding`, `order` |
| `EXPERIENCE#<id>` | `title`, `company`, `period`, `description`, `embedding`, `order` |

`education` deliberately stays inline in the `PROFILE` item rather than
getting its own item type: it has no embedding (never scored/matched, per
`TESTING.md`'s "education + period" round) and is small — splitting it out
would add complexity for no size benefit. Only `projects` and `experience`
are split, because embeddings are what actually drive item size.

Each item is independently bounded at ~12KB regardless of how many
projects/experience entries a user has — the 400KB ceiling stops being
reachable in practice.

### Entries need a stable `id` — minted server-side, matches `cv-service`'s precedent

DynamoDB's sort key is immutable, so `PROJECT#<id>`/`EXPERIENCE#<id>` need a
stable identifier that survives edits and reordering. `profile-service`
currently has no `id` field on these entries at all — `attach_embeddings`
matches by *identity field value* instead (`name` for projects, `title` for
experience; `index.py:159-164`), which the code's own docstring flags as an
"acceptable edge case, not worth a more elaborate identity scheme yet."

Fix: mint a UUID server-side on first save when one isn't supplied, mirroring
`cv-service`'s `normalize_object_list` `id`-handling (`cv-service/index.py:104-114`).
Verified this is safe with **zero frontend changes**: `ExperienceEntry`/
`ProjectEntry` (`dashboard/src/api/backend.ts:30-41`) have no `id` field
today, but `updateExperience`/`updateProject`
(`dashboard/src/pages/ProfileIntakePage.tsx:103-113`) update entries via
`{...e, ...patch}` — an unknown extra field like a server-returned `id`
round-trips through edits untouched. `attach_embeddings`'s matching switches
to `id`-first (falling back to identity-field matching for brand-new entries
that don't have one yet), which also fixes the "two entries share the same
identity value" edge case the old docstring called out.

### Writes: `BatchWriteItem` (via `table.batch_writer()`), not `TransactWriteItems`

Considered `TransactWriteItems` for all-or-nothing atomicity across the
multi-item write. Rejected: it costs 2x the WCU of individual writes, and
this codebase has an established graceful-degradation philosophy instead of
transactional atomicity — `cv-service` truncates and warns rather than
failing a save outright, and `attach_embeddings` already tolerates a failed
embedding with a warning rather than failing the whole save
(`index.py:189-196`). A partial `BatchWriteItem` failure (one entry's `Put`
fails while others succeed) is recoverable on the next save the same way.

This is a slightly different risk shape from the old single-item `put_item`,
though, which was atomic: two concurrent tabs saving at once always left the
profile equal to exactly one full submission, never a mix of both. The new
multi-item write can leave the profile as a genuine mix of two concurrent
saves (e.g. tab A's edited project alongside tab B's edited experience),
which the old atomic write could not produce. Still acceptable at this
project's scale, but worth naming accurately rather than implying the risk
is unchanged.

`table.batch_writer()` is boto3's built-in helper: it auto-chunks into
groups of 25 and retries unprocessed items internally (a tight retry loop on
`__exit__` with no sleep/backoff of its own — only botocore's normal
per-API-call retry applies), so no hand-rolled retry loop is needed.

### Skip writing entries that didn't change — the actual efficiency win

Splitting into multiple items only removes the size ceiling by itself; it
doesn't reduce write cost unless unchanged entries are actually skipped.
`save_profile` now compares each entry's full computed item (id, fields,
`order`) against what's already stored for that `entity_key`, and only
`Put`s entries that differ. Reordering counts as a change (the `order`
attribute differs) even if content doesn't — correctness over a marginal
reorder-only optimization. The `PROFILE` base item is small (no embeddings)
and always rewritten (its `updated_at` always changes), which is cheap and
not worth optimizing away.

### Ordering needs an explicit attribute, not SK order

`Query` results sort lexicographically by SK; `PROJECT#<uuid>` order is
meaningless for display order. Each item carries an explicit `order: <int>`
set from the array index at save time; the read path sorts by it after
fetching. Alternative considered: zero-pad a sequence into the SK itself so
`Query` returns pre-sorted results — rejected because SK is immutable, so
reordering or deleting an entry would require delete+recreate instead of a
plain attribute update.

### New table, no data migration

DynamoDB key schemas are immutable. `ProfilesTableV2` is a **new** CDK table
resource, not a modified `profilesTable` — changing the existing table's
`sortKey` in CDK would force CloudFormation to replace the physical
resource (delete-then-create), losing all existing profile data.

Checked the live table before deciding: it holds exactly 3 items, all
disposable manual-testing accounts from prior verification rounds (per
`TESTING.md`'s "deleted after" convention — one wasn't actually cleaned up,
plus the two accounts used to build/test this app during development). None
of it is real end-user data worth the cost of migration tooling. Decision:
**no migration script, no data carried over.** `ProfilesTableV2` starts
empty; whoever had a profile re-enters it (the app's existing paste-text
`/profile/parse` intake flow makes this a few minutes of work, not a
from-scratch retype).

This removes the migration-ordering concern entirely — there's no "run the
migration between deploys without anyone editing a profile" window to
protect, because there's nothing being carried over. Deploying the new table
and the code cutover can happen in a single `cdk deploy` (CDK/CloudFormation
resolves the dependency automatically since the Lambda environment
references `profilesTableV2.tableName`).

The old `profilesTable` is **kept, not deleted**, as a matter of caution
(deleting a stateful resource is a separate, deliberate action) even though
its contents aren't being preserved — removing it is an easy follow-up
whenever it's actually in the way.

## Non-goals

- Moving to a relational database. Ordering and multi-item consistency are
  standard DynamoDB patterns (`order` attribute, `batch_writer`), not
  problems that require a different database. A relational store would trade
  this for real operational cost (VPC networking for Lambda, connection
  pooling, always-on billing) for access patterns that are still just
  get/list/update by `user_id`.
- A GSI or any new query pattern. The only access pattern is "all of a
  user's profile," which `Query(PK=user_id)` already answers in one round
  trip, same as today's `get_item`.
