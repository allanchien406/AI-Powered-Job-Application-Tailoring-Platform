# Production readiness plan (1000+ users)

A living plan (like `PLAN.md`) for scaling the current single-user-tailoring
setup to 1000+ real users. Status markers follow the same convention as
`PLAN.md`: ✅ done · 🚧 decided, not yet built · ❓ open decision · ⏸ deferred.

**Scope confirmed: per-user tailoring only.** Each user matches their own
profile against their own saved jobs. Cross-user features (e.g. employers
searching/ranking all candidates) are out of scope and would require a
separate plan (vector index, data-model redesign) — see "Explicitly out of
scope" at the bottom.

---

## Premise: the data model does not need to change

The current schema scales to 1000 users by construction, so this plan does
**not** alter `ProfilesTable` or `JobDescriptionsTable`'s key design:

- Every read/write is keyed by `email` → one DynamoDB partition per user.
  PAY_PER_REQUEST absorbs the load; no throttling expected at this size.
- No cross-user queries, no hot keys (traffic spreads across user emails),
  no scans, no joins.
- Matching is in-memory cosine over **one user's** entries — bounded by that
  user's career length, not the user count.
- Bedrock usage is already minimized: embeddings cached on save, one
  generation call per `/tailor-generate` request.

What breaks at 1000 users is at the edges, not the core. The four changes
below are ranked roughly by how quickly each becomes a real problem.

---

## 1. Authentication — 🚧 the only structural change

Currently the API trusts a client-supplied `email` with no session; anyone
who guesses an email can read/write that user's profile and jobs. Fine at one
user, a data leak at 1000 strangers.

- **Add a Cognito user pool** in `infra/lib/infra-stack.ts`.
- **Protect all routes** behind an API Gateway authorizer (JWT authorizer or
  a validating Lambda authorizer).
- **Derive identity from the verified token** in `profile-service`,
  `job-service`, and `tailoring-service`. Stop accepting `email` from the
  client — either drop the field from the contract, or 403 when the request
  `email` doesn't match the token's verified identity.
- **Frontend change:** `dashboard/src/api/backend.ts` attaches the token via
  the `Authorization` header instead of passing `email`. Endpoint shapes stay
  otherwise identical.
- **Contract change:** update `API.md` — the `email` query/body param docs
  change with this.

**Open question (❓):** password-only Cognito for now, or federated (e.g.
Google) sign-in? Default for the dashboard flow is Cognito-native.

## 2. Batched Bedrock embeddings — 🚧 kills the save-storm throttle

`profile-service`'s `attach_embeddings` currently calls `embed_text` once per
changed entry (`infra/lambda/profile-service/index.py`), so a 10-entry
profile = 10 sequential Bedrock calls on first save. A burst of 1000 users
saving profiles at once blows the default Titan TPS quota.

- **Batch the embedding call:** collect the embed-relevant text of all
  new/changed entries and send one batched Titan request (`inputTexts`, ≤25
  texts per call), mapping results back onto entries by index. Preserves the
  cached-embedding semantics — unchanged entries still skip Bedrock entirely.
- **Add retry + exponential backoff** on `ThrottlingException` / 429s in both
  `profile-service` and `job-service`.
- `job-service` already embeds once per save; only the retry/backoff applies.
- Optional follow-up: request a Bedrock quota increase in the AWS console.

## 3. Compact embedding storage — 🚧 4x smaller items

Embeddings are stored as DynamoDB `Decimal` arrays (~12–16KB per entry as
JSON). Packed as bytes they shrink ~4x, which cuts read cost and pushes the
400KB item-size ceiling far away.

- Store each 1024-dim vector as a packed base64 `Binary` value on write;
  decode on read in all services that consume vectors.
- The JSON response boundary (`strip_embeddings` / `strip_embedding`) and
  the `DecimalEncoder` in `profile-service`/`job-service` are the only other
  touching points — embeddings never leave the API, so no contract change.

## 4. Ops hardening — ⏸ optional at this size

- **CloudWatch dashboard:** per-endpoint p50/p99 latency, Bedrock throttle
  count, error rate — so the next bottleneck surfaces before users feel it.
- **Provisioned concurrency** on the read-heavy Lambdas if cold starts add
  tail latency during bursts. Not expected to be needed at 1000 users.
- Lambda/API Gateway default quotas are not a constraint at this size.

---

## Implementation order & verification

1. **Auth** first — it changes the API contract, so everything else is
   layered on top of verified identity.
2. **Batch embeddings** and **compact storage** are independent of each other
   and of auth ordering (deferred / after auth).

Per `AGENTS.md`, each change is executed against the deployed stage and hand-
verified (both self-run and user-confirmed) before its status is marked:
- Auth: sign-in → every endpoint called with the token → wrong/absent token
  rejected; token-email mismatch rejected.
- Batching: profile save with many new entries observed to make exactly one
  Bedrock call; throttling retry confirmed via injected failure or `dt`.
- Compact storage: raw DynamoDB read shows Binary embedding; save/read
  round-trip identical to current behavior; tailoring vector decode correct.

`PLAN.md` and `API.md` are updated within the same change as their
corresponding item lands. Nothing here yet: all items 🚧/"not started".

---

## Explicitly out of scope

- **Cross-user matching/search** (employer-side candidate ranking): the
  in-memory per-user cosine matching cannot do this at 1000 users — requires
  a vector-indexed store (Aurora pgvector, OpenSearch k-NN) and a data-model
  redesign. Separate plan, separate decision.
- **Multi-AZ / DR / backup-and-restore** for the DynamoDB tables.
- **Rate limiting / abuse protection** per endpoint beyond Bedrock retries
  (worth revisiting once real traffic patterns exist).
- **User self-service** (profile deletion, email change, password reset UI).