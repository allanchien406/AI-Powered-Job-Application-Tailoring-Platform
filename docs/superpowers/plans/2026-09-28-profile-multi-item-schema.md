# Profile Multi-Item Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ProfilesTable`'s single-item-per-user schema with a
multi-item schema (`PK=user_id`, `SK=entity_key`) so a profile's size is no
longer bounded by DynamoDB's 400KB single-item limit, and editing one
project/experience entry no longer rewrites every other entry's embedding.

**Architecture:** A new `ProfilesTableV2` DynamoDB table stores one
`PROFILE` item (name/skills/education) plus one `PROJECT#<id>`/
`EXPERIENCE#<id>` item per entry (each carrying its own cached embedding and
an explicit `order` attribute). `profile-service` and `tailoring-service`
both switch their reads from `get_item` to `Query(PK=user_id)` plus an
in-Lambda reassembly step; `profile-service`'s writes switch from one
`put_item` to a diffed `table.batch_writer()` batch that only touches
entries that actually changed. The live table's existing contents (3 items,
all disposable manual-testing accounts — confirmed via a real scan, not
assumed) are **not migrated**; `ProfilesTableV2` starts empty and the old
table is kept, unused, rather than deleted.

**Tech Stack:** AWS CDK (TypeScript), Python 3.12 Lambdas, boto3
(`Table.query`, `Table.batch_writer`), DynamoDB PAY_PER_REQUEST.

**Spec:** `docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md`

## Global Constraints

- No Claude attribution trailers in commit messages (per `CLAUDE.md`).
- Work happens on a feature branch off `develop` (`profile-multi-item-schema`
  — see Task 0), pushed as it's made — never commit/push directly to `main`
  or `develop`.
- Every change gets actually run/verified before being called done — a local
  invocation for pure logic, a real `cdk deploy` + curl/browser round-trip
  for anything touching AWS. A syntax check (`py_compile`) or `cdk synth`
  alone is not "tested" (per `CLAUDE.md`). This repo has no pytest/moto
  harness for its Lambdas (confirmed: no `requirements.txt`, no test files
  under `infra/lambda/`) — its established pattern (see `TESTING.md`) is a
  scratch local-invocation script for pure functions, then a real deploy +
  manual curl/browser pass for anything that touches DynamoDB/Bedrock/API
  Gateway. Follow that pattern, not a newly-invented pytest suite.
- No data migration: the live table's 3 existing items were confirmed (via a
  real scan) to be disposable manual-testing accounts, not real user data.
  `ProfilesTableV2` starts empty — see the spec's "New table, no data
  migration" section.
- `PLAN.md`'s `ProfilesTable` section status marker moves from ✅ to a new
  entry documenting the schema change, ending at ✅ only once Phase 5's
  manual verification task is confirmed by the user — not off the back of
  self-verification alone (per `CLAUDE.md`'s testing workflow).
- The old `profilesTable` CDK resource and its grants are left in place at
  the end of this plan — do not delete it. Deletion is an explicit, separate
  follow-up.

---

# Phase 0: Branch setup

### Task 0: Create the feature branch

**Files:** none

- [ ] **Step 1: Create and push the branch**

```bash
git checkout develop
git pull
git checkout -b profile-multi-item-schema
git push -u origin profile-multi-item-schema
```

---

# Phase 1: New table (infra only, no behavior change)

### Task 1: Add `ProfilesTableV2` to the CDK stack

**Files:**
- Modify: `infra/lib/infra-stack.ts:36-40` (add new table right after the
  existing `profilesTable` declaration)

**Interfaces:**
- Produces: `profilesTableV2` (`dynamodb.Table`) — consumed by Task 4 (Lambda
  env var cutover + grants).

- [ ] **Step 1: Add the new table resource**

In `infra/lib/infra-stack.ts`, immediately after the existing `profilesTable`
declaration (after line 40, before the `jobDescriptionsTable` declaration),
add:

```ts
    // Multi-item replacement for `profilesTable` -- PK user_id, SK
    // entity_key ("PROFILE" | "PROJECT#<id>" | "EXPERIENCE#<id>"). See
    // docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md.
    // `profilesTable` above is kept, unused once cutover lands, as a
    // rollback safety net -- do not delete it here.
    const profilesTableV2 = new dynamodb.Table(this, "ProfilesTableV2", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "entity_key", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });
```

- [ ] **Step 2: Verify it synthesizes**

Run: `cd infra && npx cdk synth > /dev/null`
Expected: exits 0, no errors. This only proves the CDK app compiles and
synthesizes a template — it does not prove the table works; that's Task 7's
job once this is actually deployed.

- [ ] **Step 3: Run the existing CDK unit tests**

Run: `cd infra && npx jest`
Expected: `infra/test/infra.test.ts` still passes (it doesn't yet assert
anything about `ProfilesTableV2`, so this just confirms the new resource
didn't break existing assertions).

- [ ] **Step 4: Commit**

```bash
git add infra/lib/infra-stack.ts
git commit -m "infra: add ProfilesTableV2 (multi-item profile schema)"
git push
```

---

# Phase 2: `profile-service` rewrite

### Task 2: Rewrite `profile-service/index.py` for the multi-item schema

**Files:**
- Modify: `infra/lambda/profile-service/index.py`

**Interfaces:**
- Consumes: none from earlier tasks (this is the Lambda code, independent of
  the CDK tasks until Phase 5's deploy).
- Produces: `query_profile_items(table, user_id) -> list[dict]`,
  `assemble_profile(items) -> dict | None`, `save_profile(table, user_id,
  normalized_profile) -> tuple[dict | None, list[str]]` — same return shape
  as the current `save_profile`, consumed by `handler`.

- [ ] **Step 1: Add the `Key` import**

At the top of `infra/lambda/profile-service/index.py`, alongside the
existing imports:

```python
from boto3.dynamodb.conditions import Key
```

- [ ] **Step 2: Mint a stable `id` for project/experience entries**

Replace `normalize_entry_list` (`index.py:76-98`) with:

```python
def normalize_entry_list(values, required_keys, assign_id=False):
    if not isinstance(values, list):
        return []

    normalized_values = []
    for value in values:
        if not isinstance(value, dict):
            continue

        normalized_entry = {}
        for key in required_keys:
            entry_value = value.get(key)
            if isinstance(entry_value, str):
                normalized_entry[key] = entry_value.strip()
            else:
                normalized_entry[key] = ""

        if not any(normalized_entry.values()):
            continue

        if assign_id:
            # Stable identity for the entry's own DynamoDB item
            # (PROJECT#<id> / EXPERIENCE#<id>) -- minted once, then
            # round-tripped by the frontend on every subsequent edit.
            entry_id = value.get("id")
            normalized_entry["id"] = (
                entry_id.strip() if isinstance(entry_id, str) and entry_id.strip() else str(uuid.uuid4())
            )

        normalized_values.append(normalized_entry)

    return normalized_values
```

Then update `normalize_profile_payload` (`index.py:101-112`) to pass
`assign_id=True` for projects and experience only:

```python
def normalize_profile_payload(data):
    email = data.get("email")
    full_name = data.get("full_name")

    return {
        "full_name": full_name.strip() if isinstance(full_name, str) else "",
        "email": email.strip().lower() if isinstance(email, str) else "",
        "skills": normalize_string_list(data.get("skills")),
        "projects": normalize_entry_list(data.get("projects"), ["name", "period", "description"], assign_id=True),
        "experience": normalize_entry_list(data.get("experience"), ["title", "company", "period", "description"], assign_id=True),
        "education": normalize_entry_list(data.get("education"), ["institution", "degree", "period", "description"]),
    }
```

Add `import uuid` to the top of the file if it isn't already there (check —
`save_profile`'s current `cv_id or str(uuid.uuid4())`-style pattern doesn't
exist in this file yet, so this import is new here).

- [ ] **Step 3: Switch `attach_embeddings` matching to `id`-first**

Replace `attach_embeddings` (`index.py:150-198`) with:

```python
def attach_embeddings(new_entries, existing_entries, text_keys):
    """Reuse a cached embedding for an entry whose text hasn't changed since the
    last save; only call Bedrock for entries that are new or edited.

    `text_keys` is the embed-relevant subset of an entry's fields, not all of
    them -- e.g. `period` (dates) is deliberately left out: it's not semantic
    content worth embedding, and editing only the dates shouldn't trigger a
    re-embed. The full entry (including `period`) is still what gets stored.

    Matched by `id` first (stable across renames/reorders), falling back to
    identity field (the first of text_keys -- "name" for projects, "title"
    for experience) for an entry that doesn't have an id yet. If two
    id-less entries share the same identity value, the later one in the
    stored list wins the lookup -- an acceptable edge case at this scale.

    A Bedrock failure while embedding a new/changed entry does NOT fail the
    whole save -- the entry is stored with embedding=None and a warning is
    returned instead. This is safe to leave for later: tailoring-service
    already falls back to embedding inline if an entry has no cached vector,
    and the "existing_entry.get('embedding')" check below means the *next*
    successful save automatically retries any entry stuck at None.
    """
    identity_key = text_keys[0]
    existing_by_id = {
        existing_entry["id"]: existing_entry
        for existing_entry in existing_entries
        if isinstance(existing_entry, dict) and existing_entry.get("id")
    }
    existing_by_identity = {
        existing_entry.get(identity_key): existing_entry
        for existing_entry in existing_entries
        if isinstance(existing_entry, dict) and existing_entry.get(identity_key)
    }

    result = []
    warnings = []
    for entry in new_entries:
        existing_entry = existing_by_id.get(entry.get("id"))
        if existing_entry is None:
            existing_entry = existing_by_identity.get(entry.get(identity_key))

        if entry_text_unchanged(existing_entry, entry, text_keys) and existing_entry.get("embedding"):
            entry = {**entry, "embedding": existing_entry["embedding"]}
        else:
            combined_text = " ".join(entry.get(key, "") for key in text_keys)
            identity_value = entry.get(identity_key) or "(unnamed entry)"
            try:
                entry = {**entry, "embedding": embed_text(combined_text, identity_value)}
            except Exception as exc:
                # Broad on purpose: whatever went wrong with Bedrock, the
                # user's actual data must still get saved.
                print(f"embed_text failed for {identity_value!r}: {exc}")
                entry = {**entry, "embedding": None}
                warnings.append(f"{identity_value}: embedding failed, will retry on next save")
        result.append(entry)
    return result, warnings
```

(Only the matching logic in the first half changed; `entry_text_unchanged`
itself is untouched.)

- [ ] **Step 4: Replace the single-item read/write functions**

Replace `get_profile_by_user_id` and `save_profile`
(`index.py:215-241`) with:

```python
def query_profile_items(table, user_id):
    return table.query(KeyConditionExpression=Key("user_id").eq(user_id)).get("Items", [])


def assemble_profile(items):
    """Group the flat multi-item Query result back into the profile shape
    the rest of this service (and its API response) expects. Returns None
    if there's no PROFILE base item -- i.e. the user has no saved profile."""
    base = None
    projects = []
    experience = []
    for item in items:
        key = item.get("entity_key", "")
        if key == "PROFILE":
            base = item
        elif key.startswith("PROJECT#"):
            projects.append(item)
        elif key.startswith("EXPERIENCE#"):
            experience.append(item)

    if base is None:
        return None

    def strip_storage_keys(entry):
        return {k: v for k, v in entry.items() if k not in ("user_id", "entity_key", "order")}

    projects.sort(key=lambda e: e.get("order", 0))
    experience.sort(key=lambda e: e.get("order", 0))

    return {
        "user_id": base["user_id"],
        "email": base.get("email", ""),
        "full_name": base.get("full_name", ""),
        "skills": base.get("skills", []),
        "education": base.get("education", []),
        "projects": [strip_storage_keys(p) for p in projects],
        "experience": [strip_storage_keys(e) for e in experience],
        "created_at": base.get("created_at"),
        "updated_at": base.get("updated_at"),
    }


def save_profile(table, user_id, normalized_profile):
    existing_items = query_profile_items(table, user_id)
    existing_profile = assemble_profile(existing_items) or {}
    existing_by_key = {item["entity_key"]: item for item in existing_items}

    projects, project_warnings = attach_embeddings(
        normalized_profile["projects"], existing_profile.get("projects", []), ["name", "description"]
    )
    experience, experience_warnings = attach_embeddings(
        normalized_profile["experience"], existing_profile.get("experience", []), ["title", "company", "description"]
    )

    now = now_iso()
    base_item = {
        "user_id": user_id,
        "entity_key": "PROFILE",
        "email": normalized_profile["email"],
        "full_name": normalized_profile["full_name"],
        "skills": normalized_profile["skills"],
        "education": normalized_profile["education"],
        "created_at": existing_by_key.get("PROFILE", {}).get("created_at", now),
        "updated_at": now,
    }

    final_items = [base_item]
    for prefix, entries in (("PROJECT#", projects), ("EXPERIENCE#", experience)):
        for order, entry in enumerate(entries):
            final_items.append({**entry, "user_id": user_id, "entity_key": f"{prefix}{entry['id']}", "order": order})

    final_keys = {item["entity_key"] for item in final_items}
    keys_to_delete = [key for key in existing_by_key if key not in final_keys]

    with table.batch_writer() as batch:
        for item in final_items:
            # Skip rewriting an entry that hasn't changed at all (content or
            # order) -- the whole point of splitting entries into their own
            # items is that an untouched project shouldn't cost a write just
            # because a sibling entry changed.
            if existing_by_key.get(item["entity_key"]) == item:
                continue
            batch.put_item(Item=item)
        for key in keys_to_delete:
            batch.delete_item(Key={"user_id": user_id, "entity_key": key})

    return assemble_profile(final_items), project_warnings + experience_warnings
```

- [ ] **Step 5: Update `handler` to use the new functions**

In `handler` (`index.py:244-273`):

```python
        if event.get("rawPath") == "/profile" and http_method == "GET":
            user_id = get_user_id(event)
            profile = assemble_profile(query_profile_items(table, user_id))

            if not profile:
                return response(404, {"error": "Profile not found"})

            return response(200, strip_embeddings(profile))

        if event.get("rawPath") == "/profile" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            normalized_profile = normalize_profile_payload(data)

            item, embedding_warnings = save_profile(table, user_id, normalized_profile)

            result = {"message": "Profile saved successfully", **strip_embeddings(item)}
            if embedding_warnings:
                result["embedding_warnings"] = embedding_warnings

            return response(200, result)
```

(Only the two lookups changed — `get_profile_by_user_id(...)` →
`assemble_profile(query_profile_items(table, ...))` in the `GET` branch;
the `PUT` branch's call to `save_profile` is unchanged since its signature
didn't change.)

- [ ] **Step 6: Verify it compiles**

Run: `python3 -m py_compile infra/lambda/profile-service/index.py`
Expected: exits 0, no output.

- [ ] **Step 7: Local check of the pure logic (fake table, no AWS)**

Write this to a scratch path and run it — a minimal in-memory fake
satisfying the small subset of the boto3 `Table` API this code calls
(`query`, `batch_writer`), matching this repo's existing convention of
disposable local check scripts over a moto/pytest harness this repo doesn't
have:

```python
import sys, uuid
sys.path.insert(0, "infra/lambda/profile-service")
import index as profile_service


class FakeBatch:
    def __init__(self, store):
        self.store = store
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def put_item(self, Item):
        self.store[(Item["user_id"], Item["entity_key"])] = Item
    def delete_item(self, Key):
        self.store.pop((Key["user_id"], Key["entity_key"]), None)


class FakeTable:
    def __init__(self):
        self.store = {}
    def query(self, KeyConditionExpression):
        user_id = KeyConditionExpression.get_expression()["values"][0]
        return {"Items": [v for (uid, _), v in self.store.items() if uid == user_id]}
    def batch_writer(self):
        return FakeBatch(self.store)


table = FakeTable()
user_id = "user-1"

# Save 1: one project, one experience entry
normalized = profile_service.normalize_profile_payload({
    "email": "a@example.com",
    "full_name": "Ada Lovelace",
    "skills": ["Python"],
    "projects": [{"name": "Engine", "period": "2020", "description": "Built it"}],
    "experience": [{"title": "Engineer", "company": "Acme", "period": "2015-2020", "description": "Did stuff"}],
    "education": [],
})
result1, warnings1 = profile_service.save_profile(table, user_id, normalized)
assert result1["projects"][0]["name"] == "Engine"
project_id = result1["projects"][0]["id"]
project_embedding_1 = result1["projects"][0]["embedding"]
assert len(table.store) == 3, f"expected 3 items (PROFILE + 1 project + 1 experience), got {len(table.store)}"

# Save 2: same project text (unchanged), full_name changed
normalized2 = profile_service.normalize_profile_payload({
    "email": "a@example.com",
    "full_name": "Ada Lovelace (updated)",
    "skills": ["Python"],
    "projects": [{"id": project_id, "name": "Engine", "period": "2020", "description": "Built it"}],
    "experience": [{"title": "Engineer", "company": "Acme", "period": "2015-2020", "description": "Did stuff"}],
    "education": [],
})
project_before = dict(table.store[(user_id, f"PROJECT#{project_id}")])
result2, warnings2 = profile_service.save_profile(table, user_id, normalized2)
project_after = table.store[(user_id, f"PROJECT#{project_id}")]
assert project_before == project_after, "unchanged project item should not have been rewritten"
assert result2["full_name"] == "Ada Lovelace (updated)"
assert result2["projects"][0]["embedding"] == project_embedding_1, "embedding should be byte-identical (cache reused)"

# Save 3: delete the experience entry
normalized3 = profile_service.normalize_profile_payload({
    "email": "a@example.com",
    "full_name": "Ada Lovelace (updated)",
    "skills": ["Python"],
    "projects": [{"id": project_id, "name": "Engine", "period": "2020", "description": "Built it"}],
    "experience": [],
    "education": [],
})
result3, warnings3 = profile_service.save_profile(table, user_id, normalized3)
assert result3["experience"] == []
assert len(table.store) == 2, f"expected 2 items left (PROFILE + 1 project) after deleting the experience entry, got {len(table.store)}"

print("All profile-service multi-item checks passed")
```

Run: `python3 <scratch_path>.py`
Expected: `All profile-service multi-item checks passed`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/profile-service/index.py
git commit -m "profile-service: multi-item schema, skip writes for unchanged entries"
git push
```

---

# Phase 3: `tailoring-service` read-path update

### Task 3: Rewrite `get_profile_by_user_id` in `tailoring-service`

**Files:**
- Modify: `infra/lambda/tailoring-service/index.py:130-152`

**Interfaces:**
- Consumes: none new.
- Produces: `get_profile_by_user_id(user_id) -> dict | None` — same return
  shape as before (embeddings included, unlike `profile-service`'s public
  API), consumed unchanged by the existing call sites at `index.py:556` and
  `index.py:592`.

- [ ] **Step 1: Add the `Key` import**

Confirm `from boto3.dynamodb.conditions import Key` is present near the top
of `infra/lambda/tailoring-service/index.py` (it's already used elsewhere in
this file for `job_descriptions_table` lookups — if a grep shows it's not
imported, add it).

- [ ] **Step 2: Replace `get_profile_by_user_id`**

Replace `index.py:150-152`:

```python
def get_profile_by_user_id(user_id):
    """Read-only lookup -- this service never writes to ProfilesTable."""
    items = profiles_table().query(KeyConditionExpression=Key("user_id").eq(user_id)).get("Items", [])
    return assemble_profile(items)


def assemble_profile(items):
    """Mirrors profile-service's assemble_profile -- groups the flat
    multi-item Query result back into the shape this service's matching
    code expects (profile.get("projects"), .get("experience"), etc.).
    Embeddings are NOT stripped here (unlike profile-service's public API)
    since this service needs them for cosine similarity. Leftover storage
    keys (entity_key/order) on each entry are harmless -- callers only
    read specific fields via .get()."""
    base = None
    projects = []
    experience = []
    for item in items:
        key = item.get("entity_key", "")
        if key == "PROFILE":
            base = item
        elif key.startswith("PROJECT#"):
            projects.append(item)
        elif key.startswith("EXPERIENCE#"):
            experience.append(item)

    if base is None:
        return None

    projects.sort(key=lambda e: e.get("order", 0))
    experience.sort(key=lambda e: e.get("order", 0))

    return {
        "user_id": base["user_id"],
        "email": base.get("email", ""),
        "full_name": base.get("full_name", ""),
        "skills": base.get("skills", []),
        "education": base.get("education", []),
        "projects": projects,
        "experience": experience,
    }
```

- [ ] **Step 3: Verify it compiles**

Run: `python3 -m py_compile infra/lambda/tailoring-service/index.py`
Expected: exits 0, no output.

- [ ] **Step 4: Local check (fake table, no AWS)**

Write this to a scratch path and run it:

```python
import sys
sys.path.insert(0, "infra/lambda/tailoring-service")
import index as tailoring_service


class FakeQueryTable:
    def __init__(self, items):
        self.items = items
    def query(self, KeyConditionExpression):
        return {"Items": self.items}


items = [
    {"user_id": "user-1", "entity_key": "PROFILE", "email": "a@example.com", "full_name": "Ada", "skills": ["Python"], "education": []},
    {"user_id": "user-1", "entity_key": "PROJECT#p1", "id": "p1", "name": "Engine", "description": "...", "embedding": [0.1], "order": 0},
    {"user_id": "user-1", "entity_key": "EXPERIENCE#e1", "id": "e1", "title": "Engineer", "company": "Acme", "description": "...", "embedding": [0.2], "order": 0},
]

tailoring_service.profiles_table = lambda: FakeQueryTable(items)
profile = tailoring_service.get_profile_by_user_id("user-1")

assert profile is not None
assert profile["full_name"] == "Ada"
assert profile["projects"][0]["name"] == "Engine"
assert profile["projects"][0]["embedding"] == [0.1]
assert profile["experience"][0]["company"] == "Acme"

tailoring_service.profiles_table = lambda: FakeQueryTable([])
assert tailoring_service.get_profile_by_user_id("nobody") is None

print("All tailoring-service assemble_profile checks passed")
```

Run: `python3 <scratch_path>.py`
Expected: `All tailoring-service assemble_profile checks passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/tailoring-service/index.py
git commit -m "tailoring-service: read profiles via the multi-item schema"
git push
```

---

# Phase 4: Cutover wiring, frontend types, docs

### Task 4: Point both Lambdas at `ProfilesTableV2`

**Files:**
- Modify: `infra/lib/infra-stack.ts` (the `profileServiceHandler` and
  `tailoringServiceHandler` blocks — around lines 141-146 and 178-186 per
  the earlier grep of this file)

- [ ] **Step 1: Update `profileServiceHandler`'s env var and grant**

Change:
```ts
        PROFILES_TABLE_NAME: profilesTable.tableName,
```
to:
```ts
        PROFILES_TABLE_NAME: profilesTableV2.tableName,
```
in the `profileServiceHandler` environment block, and change:
```ts
    profilesTable.grantReadWriteData(profileServiceHandler);
```
to:
```ts
    profilesTableV2.grantReadWriteData(profileServiceHandler);
```

- [ ] **Step 2: Update `tailoringServiceHandler`'s env var and grant**

Change:
```ts
          PROFILES_TABLE_NAME: profilesTable.tableName,
```
to:
```ts
          PROFILES_TABLE_NAME: profilesTableV2.tableName,
```
in the `tailoringServiceHandler` environment block, and change:
```ts
    profilesTable.grantReadData(tailoringServiceHandler);
```
to:
```ts
    profilesTableV2.grantReadData(tailoringServiceHandler);
```

Leave `profilesTable`'s own declaration untouched — it still exists in the
stack, just with no Lambda pointing at it anymore after this change deploys.

- [ ] **Step 3: Verify it synthesizes**

Run: `cd infra && npx cdk synth > /dev/null`
Expected: exits 0.

- [ ] **Step 4: Commit**

Do **not** push/deploy this yet — Task 4's commit lands in git now, but per
the Global Constraints it's deployed together with Tasks 2, 3, 5, and 6 in
Phase 5's single deploy (Task 7).

```bash
git add infra/lib/infra-stack.ts
git commit -m "infra: cut profile-service and tailoring-service over to ProfilesTableV2"
git push
```

### Task 5: Add `id` to the frontend's entry types

**Files:**
- Modify: `dashboard/src/api/backend.ts:30-41`

- [ ] **Step 1: Add the optional field**

```ts
export interface ExperienceEntry {
  id?: string;
  title: string;
  company: string;
  period: string;
  description: string;
}

export interface ProjectEntry {
  id?: string;
  name: string;
  period: string;
  description: string;
}
```

This is a type-accuracy change only — `ProfileIntakePage.tsx`'s
`updateExperience`/`updateProject` (`{...e, ...patch}`) already pass an
unknown `id` field through edits untouched, so no runtime behavior changes.

- [ ] **Step 2: Verify the typecheck/build passes**

Run: `cd dashboard && npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/backend.ts
git commit -m "dashboard: type profile entries' server-assigned id field"
git push
```

### Task 6: Update `API.md` and `PLAN.md`

**Files:**
- Modify: `API.md` (the `profile-service` section, `API.md:12-42`)
- Modify: `PLAN.md` (the `ProfilesTable` section, `PLAN.md:43-70`)

- [ ] **Step 1: Update `API.md`**

In the `profile-service` section, change the storage line
(`API.md:14-15`):

```markdown
Source: `infra/lambda/profile-service/index.py`. Storage: `ProfilesTableV2`
(DynamoDB, partition key `user_id`, sort key `entity_key` — one `PROFILE`
item plus one `PROJECT#<id>`/`EXPERIENCE#<id>` item per entry; see
`docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md`).
```

And update the `PUT /profile` body description
(`API.md:31`) to note the new `id` field:

```markdown
- **Body:** `{email, full_name?, skills?: string[], projects?: [{id?, name, period?, description}], experience?: [{id?, title, company?, period?, description}], education?: [{institution, degree, period?, description?}]}`
  — `period` and `company`/`institution` are all optional (blank when unknown).
  `id` is assigned server-side on first save if omitted, and should be sent
  back unchanged on later edits. `education` entries get no embedding and
  aren't used for matching (like `skills`); they pass straight through to
  the generation prompt.
```

And update the "Behavior worth knowing" line (`API.md:39-42`):

```markdown
- **Behavior worth knowing:** each project/experience entry's embedding is
  computed once and cached; re-saving with an entry's text unchanged reuses
  the cached vector instead of calling Bedrock again, and the entry's
  DynamoDB item isn't rewritten at all. Matched by `id` first, falling back
  to `name`/`title` for an entry that doesn't have an `id` yet.
```

- [ ] **Step 2: Update `PLAN.md`**

Change the `ProfilesTable` heading and body (`PLAN.md:43-70`) to:

```markdown
### `ProfilesTable` — ⏸ superseded by `ProfilesTableV2`, kept as rollback safety net

Single item per user (`PK=user_id`, no sort key). Replaced due to
embedding-driven item size — see `ProfilesTableV2` below and
`docs/superpowers/specs/2026-09-28-profile-multi-item-schema-design.md` for
the full reasoning. Not deleted yet; deletion is a deliberate later
follow-up once confidence has built up.

### `ProfilesTableV2` — 🚧 implemented, pending deployment verification

| | |
|---|---|
| Partition key | `user_id` (S, the Cognito `sub`) |
| Sort key | `entity_key` (S — `"PROFILE"` \| `"PROJECT#<id>"` \| `"EXPERIENCE#<id>"`) |

```json
{"user_id": "<cognito-sub-uuid>", "entity_key": "PROFILE", "email": "allan@example.com", "full_name": "Allan Chien", "skills": ["AWS", "Python", "Docker"], "education": [], "created_at": "2026-01-04T10:22:31Z", "updated_at": "2026-09-28T03:10:02Z"}
{"user_id": "<cognito-sub-uuid>", "entity_key": "PROJECT#3f1c9e2a-...", "id": "3f1c9e2a-...", "name": "2048 CI/CD Project", "period": "2020", "description": "...", "embedding": [0.02, "..."], "order": 0}
{"user_id": "<cognito-sub-uuid>", "entity_key": "EXPERIENCE#8b0d4e3a-...", "id": "8b0d4e3a-...", "title": "Research Engineer", "company": "Bittide Labs", "period": "2021-2024", "description": "...", "embedding": [0.09, "..."], "order": 0}
```

One `PROFILE` item plus one `PROJECT#<id>`/`EXPERIENCE#<id>` item per entry,
each independently bounded (~12KB, dominated by its embedding) instead of
one item whose size scales with the whole profile. A save only rewrites
entries that actually changed — `attach_embeddings`' existing cache already
avoided re-*computing* an unchanged entry's embedding, this additionally
avoids re-*writing* it.
```

(Keep `JobDescriptionsTable`/`CvsTable` sections below this unchanged.)

- [ ] **Step 3: Commit**

```bash
git add API.md PLAN.md
git commit -m "docs: document the ProfilesTableV2 multi-item schema"
git push
```

---

# Phase 5: Deploy and verify (real AWS)

This phase deploys to the real AWS account per `TESTING.md`'s established
practice (real curl/browser checks, CloudWatch review). No data migration
is involved (see the spec's "New table, no data migration" section), so
this is a single deploy, not a staged sequence.

### Task 7: Deploy

- [ ] **Step 1: Deploy everything**

```bash
cd infra && npx cdk deploy
```

Expected: CloudFormation reports `CREATE_COMPLETE` for `ProfilesTableV2` and
successful updates to `ProfileServiceHandler`/`TailoringServiceHandler`
(new code + `PROFILES_TABLE_NAME` env var pointed at the new table). CDK
resolves the create-before-update dependency automatically since the
Lambda environments reference `profilesTableV2.tableName`.

- [ ] **Step 2: Confirm the new table exists**

```bash
aws dynamodb describe-table --table-name <ProfilesTableV2 physical name from the deploy output>
aws dynamodb scan --table-name <ProfilesTableV2 physical name> --select COUNT
```

Expected: `describe-table` succeeds with the expected key schema
(`user_id` HASH, `entity_key` RANGE); `scan --select COUNT` returns `Count: 0`.

### Task 8: Manual verification (hand-off)

Run this yourself first (per `CLAUDE.md`: verify it yourself, then hand back
the same steps for independent confirmation — don't mark anything done
before that confirmation comes back).

- [ ] **Step 1: `GET`/`PUT` round-trip on a fresh profile**

1. Sign in (the old profile is gone — `ProfilesTableV2` starts empty, by
   design), go to `/profile`.
2. Confirm `GET /profile` correctly 404s (no profile yet) rather than
   erroring.
3. Paste a background paragraph through the existing intake flow, review,
   and Save. Confirm it saves and reloads correctly.
4. Edit one field on one project and Save again.

- [ ] **Step 2: Confirm unchanged entries are skipped, not just cached**

1. Raw DynamoDB read of a project's item before a save where only a
   *different* entry is edited:
   ```bash
   aws dynamodb get-item --table-name <ProfilesTableV2> --key '{"user_id": {"S": "<sub>"}, "entity_key": {"S": "PROJECT#<id>"}}'
   ```
2. Edit and save a *different* project.
3. Re-run the same `get-item` — confirm the untouched project's item
   (including its `embedding`) is byte-for-byte identical (same values, and
   ideally check CloudWatch to confirm no `PutItem`/`BatchWriteItem` touched
   that key — the app-level check is the embedding being unchanged).

- [ ] **Step 3: Confirm deletion works**

1. Remove a project from the profile in the UI and Save.
2. Confirm it's gone on reload.
3. `aws dynamodb query --table-name <ProfilesTableV2> --key-condition-expression "user_id = :u" --expression-attribute-values '{":u": {"S": "<sub>"}}'` — confirm that project's item no longer appears.

- [ ] **Step 4: Confirm `tailoring-service` still works end-to-end**

Run `/tailor-generate` (or `/tailor-preview`) against the freshly re-entered
profile and a saved job description. Confirm matched experiences/projects and the
generated CV still reference the real company/period data, same as
`TESTING.md`'s existing tailoring-service verification rounds.

- [ ] **Step 5: Check CloudWatch**

Check `profile-service` and `tailoring-service` log groups for the test
window. Expected: zero error events.

- [ ] **Step 6: Hand back the manual test plan**

Give the user Steps 1-5 above (with their own account/sub/table name filled
in) as a reproducible manual test plan, per `CLAUDE.md`. Wait for their
confirmation that it passed before proceeding to Task 9.

### Task 9: Close out

- [ ] **Step 1: Update `PLAN.md`'s status marker**

Only after Task 8's manual confirmation comes back: change
`ProfilesTableV2`'s status line in `PLAN.md` from `🚧 implemented, pending
deployment verification` to `✅ implemented, AWS-verified`.

- [ ] **Step 2: Append a `TESTING.md` entry**

Add a dated section to `TESTING.md` (matching its existing per-service
format) documenting what was actually run in Task 8 and its results —
same style as the existing `profile-service`/`tailoring-service` sections.

- [ ] **Step 3: Commit and push**

```bash
git add PLAN.md TESTING.md
git commit -m "profile multi-item schema: mark AWS-verified"
git push
```

- [ ] **Step 4: Open the PR**

Per `CLAUDE.md`, merge `develop` back into `main` via a PR when ready — but
first merge this feature branch into `develop` (also via PR, since this
plan branched off `develop` rather than working directly on it), then
follow the repo's normal `develop` → `main` PR flow separately.
