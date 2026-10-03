# Voice interview agent — 🚧 decided, not yet built

A live, conversational voice interview that gathers the raw-material prose a CV is
built from. The agent asks the user, in voice, to talk about their experience and
themselves, listens to the answers, and asks follow-ups — then the resulting
conversation is fed through the **existing** `intake-service` parse flow, so the
output lands on the familiar editable-profile review instead of needing any new
schema or storage work.

## Product decisions (confirmed)

| Decision | Choice | Why |
|---|---|---|
| Interview channel | **In the browser** — mic in the React dashboard, Web Audio API | Stays inside the existing web app; no telephony infra |
| Interaction model | **Live conversational** (barge-in, natural turn-taking) | Best answers; agent follows up on what's said, doesn't read a fixed script |
| Output handling | **Full transcript → `POST /profile/parse` → editable review → `PUT /profile`** | Reuses the intake flow already built and verified |
| Interview context | **Start blind** — agent does not see the saved profile in v1 | Simplicity; the tool-call path to read `profile-service` mid-interview is a later add |
| Hosting for v1 | **Lambda relay** (matches current stack), not AgentCore | No container/ECR toolchain; AgentCore is the documented scale-up path |

## Technology

- **Amazon Nova Sonic 2** (`amazon.nova-2-sonic-v1:0`) — Amazon's speech-to-speech
  model on Bedrock. One bidirectional stream (`InvokeModelWithBidirectionalStream`)
  handles listen → reason → speak in a single model call: STT, LLM reasoning, and
  TTS are not three separate services. Preserves tone/emphasis, gives ~1.3–1.5s
  first-audio and natural barge-in, supports async tool calling, and works in
  `us-east-1`.
- Everything runs **inside the existing AWS account** — audio and transcripts never
  leave Bedrock in this account (same PII boundary as the rest of the app; the
  "send profile text to the LLM" concern from PLAN.md's Future improvement #3 is
  about *calls leaving the account boundary*, and this adds no new boundary).
- Cost is negligible for this feature: roughly $0.27/hr of *input* audio — a ~10
  minute interview is a rounding error next to the existing Haiku generation calls.

## Architecture

```
Browser (InterviewPage, Web Audio API → 16 kHz mono PCM)
   │                                          ▲
   │ WebSocket (email on connect)             │ audio (24 kHz PCM) + transcripts
   ▼                                          │
API Gateway WebSocket ($connect / $default / $disconnect)
   ▼
interview-service Lambda  ──(timeout ~900 s to hold the live session)──
   │ opens InvokeModelWithBidirectionalStream → amazon.nova-2-sonic-v1:0
   ▼
Phased interview script (each phase a focused system prompt)
   │ transcript
   ▼
existing POST /profile/parse → editable review form → PUT /profile
```

New footprint vs. current stack, all CDK in `infra-stack.ts`:

1. **`WebSocketApi`** with three routes (`$connect`, `$default`, `$disconnect`);
   the client sends its `email` as a connect query param (same identity model as
   the REST API — localStorage email, no real auth yet).
2. **`interview-service` Lambda** — relays mic frames into the BidirectionalStream,
   streams `audioOutput` (24 kHz PCM) and transcripts back to the browser, and
   accumulates the transcript in memory for the duration of the session. Lambda's
   15-minute ceiling is the reason v1 interviews stay short (see Notes).
3. **IAM**: a new `bedrockGenerationPolicy`-style grant for
   `amazon.nova-2-sonic-v1:0` (in-region `bedrock-runtime`) on this Lambda only.
4. **Frontend**: new `InterviewPage.tsx` + `backend.ts` additions — mic capture
   (16 kHz mono PCM), WebSocket streaming, a live two-way transcript pane,
   start/end controls, and a **"Build my profile from this"** button that posts the
   transcript to `/profile/parse` and drops the user onto the existing review form.

## Interview flow (session segmentation)

The conversation is split into phases, each its own focused system prompt with the
prior phases' chat history carried forward — the AWS-recommended pattern for
keeping per-turn reasoning light and latency low:

intro (warm-up, name/headline) → experience (roles, companies, what they did) →
projects (notable work) → skills + education → wrap-up (anything missed) → hand off
transcript to `/profile/parse`.

## Notes / constraints

- **Nova Sonic sessions cap at ~8 minutes.** v1 keeps interviews under that and
  relies on the phased prompts; the documented escape hatch is session
  continuation (re-establish the stream and replay chat history), deferred.
- **Model access is a manual prerequisite** in the Bedrock console for
  `us-east-1` (`amazon.nova-2-sonic-v1:0`) — same step as Haiku model access was.
  Verify the exact model ID in the console before wiring the constant.
- **Domain logic stays out of the voice prompt** — the interviewer's job is to
  elicit prose, not to score or match anything. No skills/CV logic in the
  interview prompt.

## Deferred / open (post-v1)

- ⏸ **AgentCore Runtime** hosting instead of the Lambda relay, if a long-lived
  socket outgrows Lambda (adds container/ECR toolchain + SigV4 WebSocket proxy).
- ⏸ **Session continuation** to permit interviews longer than ~8 minutes.
- ⏸ **Reading the existing saved profile mid-interview** (drill into gaps) via a
  tool call back into `profile-service`.
- ⏸ **PSTN / Amazon Connect** channel for phone-based interviews.
- ❓ Voice selection (Tiffany/Matthew/Amy), response timing/VAD sensitivity, and
  output sample-rate knobs — product tuning, not hard requirements.

## Verification approach (when built)

Follows the repo's staged pattern: execution-based local tests (monkeypatch the
Bedrock stream + WebSocket leaves so the real relay/phase/validation code runs),
then staged deployment on a throwaway branch, then a manual plan: sign in → start
interview → speak → watch both directions of the live transcript → end → "Build my
profile from this" lands coherent structured entries on the review form. Mark ✅
in `PLAN.md` only after the user's independent manual pass confirms it.