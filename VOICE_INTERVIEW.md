# Voice interview agent — 🚧 decided, not yet built

A live, conversational voice interview that gathers the raw-material prose a
CV is built from. The agent asks the user, in voice, to talk about their
experience and themselves, listens to the answers, and asks follow-ups —
then the resulting conversation is fed through the **existing**
`intake-service` parse flow, so the output lands on the familiar
editable-profile review instead of needing any new schema or storage work.

**The design now lives in
`docs/superpowers/specs/2026-10-01-voice-interview-design.md`**, and the
task-by-task build in
`docs/superpowers/plans/2026-10-01-voice-interview.md`. This file is a
summary and a status pointer, not a source of truth.

> The original design in this file (API Gateway WebSocket transport, a
> Python/boto3 Lambda relay, and a pre-Cognito "email on connect, no real
> auth" identity model) turned out to be wrong on all three counts and was
> superseded on 2026-10-01. The spec's "What changed and why" table has the
> full comparison and reasoning.

## Current design in brief

- **Model:** Amazon Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) on Bedrock —
  one `InvokeModelWithBidirectionalStream` call handles listen → reason →
  speak, so STT/LLM/TTS aren't three separate services. Already in `us-east-1`
  where the stack lives. The legacy `amazon.nova-sonic-v1:0` is EOL.
- **Relay:** a new `interview-service` Lambda in **TypeScript** (Node 22).
  Not Python — `boto3` does declare
  `invoke_model_with_bidirectional_stream`, but its **sync** client can't
  drive a full-duplex session (bytes must go *into* the request while the
  response is being read out, and botocore's event-stream layer is
  receive-oriented). The Python SDK that does support it
  (`aws_sdk_bedrock_runtime`) is Pre-Alpha 0.7.0, needs Python ≥3.12, and
  isn't in the Lambda runtime.
- **Transport:** **AppSync Events**, not API Gateway WebSocket. WebSocket
  invokes the integration per message, so it can't hold a stream whose
  client→server audio has to flow continuously; its 32KB frame cap also
  forces ~0.5s chunks. AppSync keeps one Lambda alive per session and
  supports Cognito auth natively, with the JWT in the WebSocket subprotocol
  rather than in a URL.
- **Auth:** Cognito via AppSync's `AMAZON_COGNITO_USER_POOLS` auth mode,
  reusing the existing user pool. Channels are namespaced per user
  (`/interview/user/{sub}/{sessionId}`), so isolation is enforced from JWT
  claims rather than a hand-rolled connection registry.
- **Session length:** Nova holds a stream open for 8 minutes. The relay
  renews at ~7 minutes on a turn boundary, replaying prior turns as TEXT
  history and buffering the user's audio across the gap.
- **Output handling:** the transcript is tagged **per interview phase**
  (intro → experience → projects → skills → education → wrap-up) and each
  phase is posted to `POST /profile/parse` separately, then merged
  client-side, landing on the existing review form → `PUT /profile`.
  Chunking is not incidental: `intake-service` rejects anything over
  `MAX_RAW_TEXT_CHARS` (20,000 — `index.py:40`, enforced at `:131-132`), and
  a normal spoken interview is roughly 40,000 characters.
- **Hosting for v1:** Lambda relay, matching the current stack. AgentCore
  Runtime is the documented scale-up path.
- **Cost:** roughly **$2.25/hr** all-in (input + output speech), per AWS's
  own per-session cost table for its serverless Nova Sonic reference
  implementation. Still negligible next to the existing Haiku generation
  calls. (The previously documented "$0.27/hr" counted input audio only and
  was about 8x low.)

## Things that don't change

Browser mic via the Web Audio API; live conversational interaction with
barge-in; the transcript feeding the existing
`/profile/parse` → editable review → `PUT /profile` flow; and **no CV or
matching logic in the voice prompt** — the interviewer's job is to elicit
prose, and `intake-service` stays the single place that defines the profile
schema.

## Deferred / open (post-v1)

- ⏸ **Reading the existing saved profile mid-interview** (drill into gaps) via
  a tool call back into `profile-service`.
- ⏸ **Persisting transcripts** for session resume across Lambda invocations
  (v1 keeps the transcript in memory for the session only).
- ⏸ **PSTN / Amazon Connect** channel for phone-based interviews.
- ⏸ **Beyond-Chrome audio worklets** — v1 targets Chrome, as the AWS Nova
  samples do.
- ❓ Voice selection (Tiffany/Matthew/Amy), response timing / VAD sensitivity,
  and `endpointingSensitivity` tuning — product tuning, not hard
  requirements.

## Verification approach

Follows the repo's staged pattern (per `CLAUDE.md`): execution-based local
tests first (a fake `AsyncIterable` driving the real relay/protocol code, and
a scratch local Bedrock call to prove the SDK call shape), then a staged
deploy, then a manual plan — sign in → start interview → speak → watch both
directions of the live transcript → run past a renewal and confirm
continuity → end → "Build my profile from this" lands coherent structured
entries on the review form. `PLAN.md` and this file are marked ✅ only after
the user's independent manual pass confirms it.
