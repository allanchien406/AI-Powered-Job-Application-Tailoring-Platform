# Voice interview agent — design

Date: 2026-10-01
Status: decided, not yet built

Supersedes the design in `VOICE_INTERVIEW.md` (commit `86c6b1c`), which
specified a WebSocket transport, a Python/boto3 relay, and a pre-Cognito
identity model. All three of those turned out to be wrong or obsolete — see
"What changed and why" at the end.

## Problem

Building a personal profile today means hand-writing it.
`ProfileIntakePage` (`dashboard/src/pages/ProfileIntakePage.tsx`) offers two
paths, and both are typing:

1. **Paste free text** → `POST /profile/parse` → editable review form
   (`handleParse`, `:77-89`).
2. **Fill in the form by hand** — every field editable: name (`:164-170`),
   skills as tags (`:172-193`), experience `title`/`company`/`period`/
   `description` (`:195-245`), projects `name`/`period`/`description`
   (`:247-290`), education `institution`/`period`/`degree`/`description`
   (`:292-343`).

That second path is the friction point. A job application needs structured
entries — each role with a title, a company, a period, and a prose
description — and asking someone to produce that prose *before* they have
anyone to bounce it off of is a stall. The information exists; the
motivation to format it doesn't.

`intake-service` already proves the shape of the fix: `POST /profile/parse`
(`infra/lambda/intake-service/index.py:125-141`) takes free-form text and
coerces it to exactly the `PUT /profile` schema, with a system prompt
(`:15-38`) that explicitly forbids inventing anything the user didn't state.
What it takes is *text*, and today the only source of that text is a keyboard.

## Goal

Let the user **talk** their profile into existence — a live, conversational
voice interview that asks about their experience, follows up on what they
say, and produces the same review form the paste flow already produces. No
new profile schema, no new storage, no new HTTP endpoint on the handoff.

## Non-goals

- **Replacing the manual form.** The review step stays. Voice is a better
  *input* method, not a better editor — and the review step is the real
  defense against extraction hallucination, exactly as it is for the paste
  flow (`API.md:73-76`).
- **Any CV/matching logic in the voice prompt.** The interviewer's job is to
  elicit prose, not to score, match, or tailor. Keeping domain logic out of
  the voice layer is what lets the existing `intake-service` prompt stay the
  single place that defines the profile schema.
- **Reading the user's saved profile mid-interview** (to drill into gaps).
  v1 starts blind. The tool-call path back into `profile-service` is a
  post-v1 add.
- **Phone / PSTN channel.** Browser only.

## Key decisions (and why)

### Speech-to-speech on Amazon Nova 2 Sonic, not a cascaded STT→LLM→TTS pipeline

`amazon.nova-2-sonic-v1:0`, one model handling listen → reason → speak over
a single `InvokeModelWithBidirectionalStream` call. STT, LLM, and TTS as
three separate services is the obvious alternative and is strictly worse
here: three network hops of latency per turn instead of one, and cascaded
pipelines lose prosody — the model never hears its own voice, so it can't
respond to how the user actually said something.

Also relevant: the whole point of the feature is that the agent *follows up
on what was said*. That's a reasoning behaviour, and having the reasoning in
the same model as the speech is what makes the follow-up coherent with the
audio the user just produced.

Region works out: the stack is already deployed to `us-east-1`
(`TESTING.md:4,10,16`; API base `*.execute-api.us-east-1.amazonaws.com`),
which is one of Nova 2 Sonic's available regions (`us-east-1`, `us-west-2`,
`eu-north-1`, `ap-northeast-1`). No cross-region inference, no region-move
project. **Use the bare model ID** — speech model IDs take no `us.`/`global.`
prefix, and adding one throws `ValidationException`.

The legacy `amazon.nova-sonic-v1:0` reached EOL on 2026-09-14, i.e. it's
already dead as of this writing. Nova 2 is not an upgrade decision, it's
the only option.

**Cost is negligible but not as negligible as previously documented.** The
prior `VOICE_INTERVIEW.md` (commit `86c6b1c`, lines 32-33) claimed
"~$0.27/hr of *input* audio". AWS's own
own per-session cost table for its serverless Nova Sonic reference
implementation puts input speech at $0.0102/min and output speech at
$0.0272/min — **~$0.037/min combined, ~$2.25/hr all-in**. Still a rounding
error next to the existing Claude Haiku generation calls, but the old number
was off by roughly 8x and is corrected here.

### The relay Lambda is Node.js/TypeScript, not Python

This is the decision the previous design missed, and it forced the other
two.

Every Bedrock call in this repo is `boto3.client("bedrock-runtime")` —
`intake-service/index.py:9`, `job-service/index.py:12`,
`profile-service/index.py:12`, `tailoring-service/index.py:13`. Staying
Python was therefore the default assumption, and it does not work.

`boto3` exposes `invoke_model_with_bidirectional_stream` in its service
model, but its **sync** client cannot drive a full-duplex session: the
operation needs bytes written into the request stream *while* the response
stream is being read, and botocore's event-stream layer is receive-oriented.
AWS's own guidance for Python is unambiguous — "Python developers can use
this new experimental SDK" — pointing at **`aws_sdk_bedrock_runtime`**,
which is:

- version **0.7.0**, classified **Pre-Alpha** in its own `pyproject.toml`
- `requires-python = ">=3.12"`
- **not present in the Lambda Python runtime** — it would need a
  hand-built Lambda layer

The JS SDK has no such problem: `@aws-sdk/client-bedrock-runtime` ships
`InvokeModelWithBidirectionalStreamCommand` as a stable, GA API. AWS's own
serverless Nova Sonic reference implementation is a TypeScript Lambda,
which is a strong signal that this is the supported serverless path.

Cost of the choice: `interview-service` becomes the only non-Python Lambda
in the stack, and TypeScript needs a bundling step (this repo currently has
none for Lambda code — every Lambda is pure stdlib + boto3 and deploys as a
raw directory). That's a real, accepted cost; a Pre-Alpha SDK pinned into a
production path is the worse risk.

**The trap to design around:** the `body` parameter must be an
`AsyncIterable`, not `{chunk: {bytes}}`. The official JS SDK doc example
shows the object form, which fails with
`TypeError: this.options.inputStream is not async iterable` (confirmed
upstream, aws-sdk-js-v3#7125). The relay needs a queue-backed async
iterator that parks on a promise when the queue is empty.

### Transport: AppSync Events, not API Gateway WebSocket

AppSync Events is channel-based pub/sub. A session channel carries both
directions: the client publishes `audio` in, the session Lambda publishes
`audio` and `transcript` out.

**API Gateway WebSocket was evaluated and rejected** — it cannot hold this
stream. WebSocket APIs invoke the integration **per message**, and the
`$connect` invocation is not guaranteed the same execution environment as
subsequent `$default` ones, so the Lambda holding the Bedrock stream can't
reliably be fed by the client's audio frames. Working around that needs
either an external relay (DynamoDB polled at ~2Hz, adding 250-500ms to every
turn — unacceptable when barge-in depends on latency) or an in-process
connection registry that fails intermittently under concurrent invocations.

The hard limits compound it:

| Limit | Value | Consequence |
|---|---|---|
| Frame size | 32 KB | 16kHz/16-bit mono is 32KB/s raw, ~42KB/s base64 → ~0.5s chunks |
| Message payload | 128 KB | must split larger messages across frames |
| Integration timeout | 29 s | can't hold a session |
| Connection duration | 2 h | not the binding constraint |
| Idle timeout | 10 min | kills paused sessions |

Splitting to fit 32KB frames also means **one Lambda invocation per
half-second per user**, which is both a latency source and a cost source
for no benefit.

AppSync Events removes all of that: the session Lambda is invoked once per
session and stays alive holding the stream, connections run up to 24 hours,
and it's the topology AWS built its own serverless Nova Sonic sample around
specifically because it "hides the complexity of stateful WebSocket
infrastructure."

**Cost of the choice:** a new service in a stack that's currently five
Lambdas + one HTTP API + Cognito + four DynamoDB tables.

The CDK support is better than first assumed, and was checked rather than
assumed (`infra/node_modules/aws-cdk-lib` 2.251.0): `EventApi` is a full L2
(`aws-appsync/lib/eventapi.d.ts:346`) taking `authorizationConfig`, and
`ChannelNamespace` is an L2 (`channel-namespace.d.ts:155`) with exactly the
props this design needs — `code`, `subscribeHandlerConfig` (the
`onSubscribe` handler config), `publishHandlerConfig`, and
`authorizationConfig` (`channel-namespace.d.ts:120-151`). That handler
config resolves to `CfnChannelNamespace.HandlerConfigProperty` with
`behavior` + `integration.dataSourceName` + `lambdaConfig.invokeType`. So the
Lambda-on-subscribe wiring does **not** need hand-rolled L1 constructs, and
the residual uncertainty is runtime behaviour — the event envelope the
handler receives and how it publishes back — which is a read-the-docs
question rather than a build-fight.

### Auth: Cognito via AppSync's `AMAZON_COGNITO_USER_POOLS` auth mode

The previous design used "email as a connect query param, no real auth yet" —
predating the Cognito work (`PLAN.md:114`) and contradicting the `sub`-only
identity every other service enforces (`get_user_id`, e.g.
`profile-service/index.py:50-59`).

AppSync Events supports `AMAZON_COGNITO_USER_POOLS` as a first-class auth
mode, and the WebSocket handshake carries the Cognito JWT in the
**`Sec-WebSocket-Protocol` subprotocol**, not in the URL. This is strictly
better than the alternatives considered:

- **Not a query string** — no token in API Gateway access logs, nothing to
  redact. (This was the fallback choice before the transport changed; a
  browser also cannot set an `Authorization` header on a WebSocket, which is
  what forced the query-string workaround in the first place.)
- **Not `Sec-WebSocket-Protocol` hand-rolling** — Amplify's Events client
  already does it.
- **Not unauthenticated** — the transcript is user PII.

Channel paths are namespaced per user —
`/interview/user/{sub}/{sessionId}` — so a client is only authorized for its
own channels, enforced by AppSync from the JWT claims rather than by a
hand-rolled connection registry in DynamoDB. This is a genuine improvement
over API Gateway WebSocket, not a compromise.

`{sub}` comes from the same Cognito user pool already in the stack
(`infra/lib/infra-stack.ts:81-87`) — the new construct references it rather
than creating a second pool. The client needs no new plumbing: it already
holds the Cognito access token via `aws-amplify` (^6.22 in
`dashboard/package.json`), and the Events client reads it from the Amplify
session. Token caching matters — a per-publish token fetch would add a
Cognito round trip to every audio chunk.

### Build session continuation in from the start, don't defer past the 8-minute cap

Nova Sonic holds a bidirectional stream open for **8 minutes**, then it's
gone. A CV interview is longer than that — the prior design's mitigation was
to "keep v1 interviews under 8 minutes," which isn't a real product
position.

The supported pattern is connection renewal: at a turn boundary, tear the
stream down, open a new one, and replay the prior conversation as TEXT
history blocks (`contentStart(role, TEXT)` → `textInput` → `contentEnd`).
AWS's reference sample does exactly this and additionally **buffers the
user's audio into a queue across the gap**, flushing it on the new stream —
so someone who kept talking during the rollover doesn't lose their sentence.

Timing: renew at **~7 minutes**, not 8. Cutting at the documented limit means
racing it; the margin costs nothing since a renewal is invisible to the user.

The Lambda's own 900s ceiling then becomes the hard session limit. That's
acceptable for v1 (a 15-minute interview is a complete CV) and is a clean
stopping point if it's ever hit.

### Transcript → profile: chunk by interview phase, merge client-side

The tempting design — "full transcript → `POST /profile/parse`" — breaks on a
size limit. `intake-service` sets `MAX_RAW_TEXT_CHARS = 20000`
(`index.py:40`) and hard-rejects over it with a 400 (`:131-132`). A 10-minute
spoken interview is roughly 40,000 characters. The handoff that the whole
"reuse the existing flow" plan rests on would fail on a normal interview.

Raising the cap was considered and rejected: one 40k-char call against a 30s
Lambda timeout is tight, and a single failure loses the entire interview.

Instead, the interview is already **phased** — intro → experience →
projects → skills → education → wrap-up — because phased prompts are the
recommended way to keep per-turn reasoning light and latency low. That's a
free seam: tag each turn with its phase, then on "Build my profile from
this", call `/profile/parse` **once per phase**. Each chunk is well under
20k chars, each call is fast, and a failure costs one section rather than the
whole session.

The merge is additive — concatenate `skills`, `projects`, `experience`,
`education`; take `full_name` from the intro phase. **Merge, don't replace**:
`ProfileIntakePage` now hydrates from a saved profile on mount (`:43-64`),
so the replace-then-rebuild behaviour of `handleParse` would silently destroy
saved work. (Incidentally, additive merge is the behaviour
`PLAN.md:778-790` lists as future improvement #1 — the voice path gets that
for free, but the paste path still doesn't; worth keeping those two
straight.)

### Session transcript lives in memory, not DynamoDB

The transcript is accumulated in the session Lambda and returned to the
client on request. No new table, no persistence across sessions, no new
cleanup job. Rationale: it's a transcript of a conversation the user just
had and is about to convert into a profile; the durable artifact is the
profile, which goes to `ProfilesTableV2` through the existing `PUT /profile`.

This is the decision that keeps the feature's storage footprint at zero and
is the main thing to revisit if a future phase wants session resume.

## Audio format (fixed by the model, not a choice)

| Direction | Sample rate | Channels | Bit depth | Encoding |
|---|---|---|---|---|
| Browser → model | 16,000 Hz | 1 | 16 | LPCM, base64 in the `audioInput` event |
| Model → browser | 24,000 Hz | 1 | 16 | LPCM, base64 in the `audioOutput` event |

Both are set in the event payloads (`audioInputConfiguration` /
`audioOutputConfiguration`) and both are hard requirements — a sample-rate
mismatch is the single most common failure, and its symptom is confusing:
transcript looks perfect, user hears nothing. Capture and resample to 16kHz
in an `AudioWorklet`; play 24kHz output at 24kHz.

## Event protocol (order-sensitive)

```
sessionStart                              (inferenceConfig; turnDetection optional)
promptStart                               (voiceId, 24kHz audio output config)
  contentStart(SYSTEM, TEXT) → textInput(system prompt) → contentEnd
  [contentStart(role, TEXT) → textInput(prior turn) → contentEnd]   ← history replay
  contentStart(USER, AUDIO)                (16kHz config)
    audioInput, audioInput, ...            (base64 PCM chunks)
  contentEnd                               ("done speaking")
  ← model streams: contentStart → textOutput + audioOutput → contentEnd
promptEnd
sessionEnd
```

Two failure modes to guard explicitly:

- **Reusing a `contentName` across turns errors.** Mint a fresh UUID per
  audio turn, including after a continuation.
- **`contentStart` must precede any `audioInput`,** and each block needs its
  matching `contentEnd`.

One subtlety worth knowing: `contentStart` carries
`additionalModelFields.generationStage`. The model emits speculative text
that may be revised; only display `textOutput` when the generation stage is
not `SPECULATIVE`, or the live transcript will visibly rewrite itself.

## Event payload contract (interview channel)

Small, explicit, and versioned by field — the channel is internal to this
feature, so there's no need for a formal schema, but the shapes should be
fixed before the frontend is written against them.

| Direction | Event | Payload |
|---|---|---|
| client → Lambda | `audio` | `{b64}` base64 16kHz mono PCM |
| client → Lambda | `phase` | `{phase}` — client-initiated phase skip (optional) |
| client → Lambda | `end` | `{}` — finish the audio block, collect the transcript |
| Lambda → client | `audio` | `{b64}` base64 24kHz mono PCM |
| Lambda → client | `transcript` | `{role, text, phase, final}` — `role` is `USER`\|`ASSISTANT` |
| Lambda → client | `phases` | `{current, total}` — progress indicator |
| Lambda → client | `error` | `{message}` |

The `phase` field on each `transcript` event is what makes chunked parsing
possible; it's the whole mechanism and must be attached at emit time, not
reconstructed later from the text.

## Risks, named honestly

- **AppSync Events runtime semantics are the biggest unknown.** CDK support
  is confirmed (see the transport section) — what's *not* confirmed is what
  the `onSubscribe` handler actually receives, whether it stays alive for the
  session and how, and how it publishes back to the channel. That shapes the
  relay's structure, so it's the walking-skeleton task (Task 3) of the plan,
  and it has an explicit decision point: if the handler does *not* stay alive
  per session, stop and revisit the transport (ECS Fargate / AgentCore
  Runtime) rather than working around it. That's the single outcome that
  invalidates the rest of the plan, which is exactly why it comes before any
  product code.
- **Amplify v6's exact Events config shape is unverified.** `aws-amplify`
  ^6.22 is already a dependency, and the Events client ships in
  `@aws-amplify/api`, but the precise `Amplify.configure({Events: …})` key
  and auth-mode wiring need confirming in the spike rather than being assumed.
- **TypeScript bundling is new to this repo.** `NodejsFunction` + esbuild is
  the intended route; it adds a dev dependency and a build step to a
  directory-asset deployment that currently has none.
- **The profile schema is defined in three places that must stay in sync** —
  `profile-service/index.py:112-123` (canonical), `intake-service/index.py:15-38`
  (the LLM prompt, which says so in a comment at `:12-14`), and
  `dashboard/src/api/backend.ts:30-65` (TS types). This feature does not add a
  field, so no change is needed — but it means the review form is the only
  place profile shape is enforced, which is another reason it's not going
  away.
- **Chrome-first.** `getUserMedia` + `AudioWorklet` are well supported
  elsewhere but the AWS Nova samples are Chrome-optimised and the
  getUserMedia constraints differ. Ship Chrome, note the limitation, don't
  pre-emptively abstract the worklet.

## What changed and why (from the previous `VOICE_INTERVIEW.md`)

| Previous | Now | Reason |
|---|---|---|
| Python/boto3 Lambda relay | Node.js/TypeScript | boto3's sync client can't drive a full-duplex session; the Python SDK that can is Pre-Alpha 0.7.0 and absent from the Lambda runtime |
| API Gateway WebSocket | AppSync Events | WebSocket can't hold a bidirectional audio stream; per-message invocation breaks session state |
| "email on connect, no real auth yet" | Cognito `AMAZON_COGNITO_USER_POOLS` auth mode | Predated the Cognito work; contradicts the `sub`-only identity model |
| Full transcript → one `/profile/parse` call | Chunked per phase, merged client-side | A normal interview transcript exceeds `MAX_RAW_TEXT_CHARS` (20,000) |
| "Keep v1 under 8 minutes" | Session continuation, renew at ~7 min | An interview is legitimately longer than 8 minutes |
| "~$0.27/hr" | ~$2.25/hr all-in | Prior figure counted input speech only and was ~8x low |
| Lambda timeout ~900s "because of the 8-min cap" | 900s is the hard session ceiling; 7-min renewal | Reframed: the cap is per-stream, not per-session |
| Model access is "a manual console prerequisite" | Verified at the start of the build | Amazon models need no opt-in in principle, but availability is account-specific — the plan checks `list-foundation-models` before writing any code |

The product decisions that survive unchanged: in-browser channel, live
conversational interaction with barge-in, transcript feeding the existing
`/profile/parse` → review → `PUT /profile` flow, and no CV/matching logic in
the voice prompt.
