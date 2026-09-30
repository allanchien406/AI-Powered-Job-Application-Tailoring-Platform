# Voice Interview Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user build their personal profile by *talking* to a live
conversational agent (Amazon Nova 2 Sonic, speech-to-speech) instead of
typing every field by hand, feeding the resulting transcript into the
existing `POST /profile/parse` → review → `PUT /profile` flow.

**Architecture:** A new `interview-service` Lambda (TypeScript, Node 22)
holds one Amazon Nova 2 Sonic bidirectional stream per session. Browser mic
audio (16kHz mono PCM) travels client → Lambda over an AppSync Events
channel; the model's reply (24kHz mono PCM) and a live transcript travel
back over the same channel. The transcript is chunked **per interview
phase** into the existing `POST /profile/parse` endpoint and merged
client-side, landing on the existing review form. Streams are renewed at
~7 minutes with TEXT history replay to get past Nova's hard 8-minute
per-connection cap. No new DynamoDB table, no new profile schema, no new
HTTP endpoint.

**Tech Stack:** Amazon Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) via
`InvokeModelWithBidirectionalStream`; `@aws-sdk/client-bedrock-runtime`;
AppSync Events (channel-based pub/sub) with `AMAZON_COGNITO_USER_POOLS`
auth; AWS CDK v2 (`EventApi` + `ChannelNamespace` L2s, `NodejsFunction` +
esbuild); React 18 + Vite + Web Audio API (`AudioWorklet`); existing
Python `intake-service` reused unchanged.

**Spec:** `docs/superpowers/specs/2026-10-01-voice-interview-design.md`
(supersedes the design in `VOICE_INTERVIEW.md`)

## Global Constraints

- No Claude attribution trailers in commit messages (per `CLAUDE.md`).
- Work happens on a feature branch off `develop` (`daniel/voice-interview` —
  see Task 0), pushed as it's made — never commit/push directly to `main`.
- **Every change gets actually run, not just type-checked** (per
  `CLAUDE.md`). `tsc` and `cdk synth` are not "tested". This repo has no
  test harness for Lambda code (no `requirements.txt`, no test files under
  `infra/lambda/`) — its established pattern (see `TESTING.md`) is a scratch
  local-execution script for logic, then a real deploy + manual
  browser pass for anything touching AWS. Follow that, don't invent a
  pytest/jest suite. The dashboard does have `vitest` (`npm test` in
  `dashboard/`) — use it for the pure helpers (phase merging, transcript
  chunking), since that's genuinely unit-testable logic.
- **Audio never leaves Bedrock** — same PII boundary as the rest of the app
  (`PLAN.md`'s Future improvement #3 is about calls leaving the account, and
  this adds no new boundary). Do not log transcript or audio content to
  CloudWatch. Note `tailoring-service`'s existing `log_prompt`
  (`index.py:120-128`) already logs PII and is flagged as temporary debug —
  don't copy that pattern here.
- **The review form is not going away.** Voice is an input method, not an
  editor. Do not add a "save directly from voice" shortcut; the human review
  step is the defense against extraction hallucination, same as it is for the
  paste flow.
- **Profile schema stays in three places, in sync** —
  `profile-service/index.py:112-123` (canonical),
  `intake-service/index.py:15-38` (LLM prompt, with a comment saying so at
  `:12-14`), `dashboard/src/api/backend.ts:30-65` (TS types). This feature
  adds no field, so it should need no change to any of them. If you find
  yourself editing one, stop and re-read the spec.
- **Model ID is `amazon.nova-2-sonic-v1:0` with no prefix.** Adding `us.` or
  `global.` throws `ValidationException` — speech model IDs take no
  cross-region-inference prefix. The legacy `amazon.nova-sonic-v1:0` has been
  EOL since 2026-09-14 and will fail.
- **`body` must be an `AsyncIterable`, not `{chunk:{bytes}}`.** The official
  JS SDK doc example is wrong (aws-sdk-js-v3#7125); the object form throws
  `TypeError: this.options.inputStream is not async iterable`. This is the
  single most likely thing to burn a day on.
- **`contentName` must be fresh per audio turn.** Reusing one across turns
  errors, including after a stream continuation.
- **Mark nothing ✅ in `PLAN.md` or `VOICE_INTERVIEW.md` off the back of your
  own test run.** `CLAUDE.md` requires the user's independent manual
  confirmation first. Task 10 is that hand-off.

---

## Phase 0: Branch setup

### Task 0: Create the feature branch

- [ ] Branch `daniel/voice-interview` off `develop` (done: created as part
      of writing this plan). Confirm:

```bash
git rev-parse --abbrev-ref HEAD   # daniel/voice-interview
git log --oneline -1              # 82a7d11 (tip of develop)
```

- [ ] Confirm the working tree was clean before branching:

```bash
git status --short   # empty
```

---

## Phase 1: Local Bedrock spike (no CDK, no product code)

Purpose: prove the SDK call shape and model access before writing anything
that gets kept. Everything here is throwaway.

### Task 1: Verify a Nova 2 Sonic bidirectional stream works locally

- [ ] Install the SDK somewhere disposable (NOT in `infra/` — this is a
      spike):

```bash
mkdir -p /tmp/nova-spike && cd /tmp/nova-spike
npm init -y
npm install @aws-sdk/client-bedrock-runtime @smithy/node-http-handler
```

- [ ] Confirm the command exists in the installed version:

```bash
node -e "const m=require('@aws-sdk/client-bedrock-runtime');
console.log('version', require('@aws-sdk/client-bedrock-runtime/package.json').version);
console.log('has command', typeof m.InvokeModelWithBidirectionalStreamCommand);"
```

Record the version in the task notes — it's what the real
`interview-service` will pin.

- [ ] Check model access in your account before writing code:

```bash
aws bedrock list-inference-profiles --region us-east-1 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId,'sonic')]" \
  --output table
aws bedrock list-foundation-models --region us-east-1 \
  --query "modelSummaries[?contains(modelId,'sonic')].[modelId,modelLifecycle.status]" \
  --output table
```

Expect `amazon.nova-2-sonic-v1:0` with status `ACTIVE`. **If the model isn't
listed, stop** — request access in the console before continuing, since
everything downstream depends on it.

- [ ] Write `/tmp/nova-spike/spike.mjs`:

```js
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand }
  from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const REGION = "us-east-1";
const MODEL = "amazon.nova-2-sonic-v1:0";
const promptName = randomUUID();

// Queue-backed async iterator: yields a chunk when signalled, parks on a
// promise when empty. This shape is the fix for the "inputStream is not
// async iterable" failure -- NOT the {chunk:{bytes}} form from the SDK docs.
const queue = [];
let signal = null;
const wake = () => { if (signal) { const s = signal; signal = null; s(); } };
function push(event, delayMs = 0) {
  return new Promise((resolve) => setTimeout(() => {
    queue.push({ chunk: { bytes: new TextEncoder().encode(JSON.stringify(event)) } });
    wake();
    resolve();
  }, delayMs));
}
const body = {
  [Symbol.asyncIterator]: () => ({
    next: async () => {
      while (queue.length === 0) await new Promise((r) => { signal = r; });
      return { value: queue.shift(), done: false };
    },
  }),
};

const client = new BedrockRuntimeClient({
  region: REGION,
  requestHandler: new NodeHttp2Handler({
    requestTimeout: 300000,
    sessionTimeout: 300000,
    disableConcurrentStreams: false,
    maxConcurrentStreams: 20,
  }),
});

// Read the WAV's data chunk only. A .wav file is a RIFF container with a
// 44-byte header (or more) in front of the samples -- sending the file as-is
// plays the header as audio noise and, worse, makes the sample count wrong.
// Walk the chunk list rather than assuming 44, since some encoders pad.
function readPcmBase64(file) {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file} is not a RIFF/WAVE file`);
  }
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return buf.subarray(off + 8, off + 8 + size).toString("base64");
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new Error(`no data chunk in ${file}`);
}

const pcm = readPcmBase64(process.argv[2]);
console.log(`pcm bytes: ${Buffer.from(pcm, "base64").length}`);

(async () => {
  const stream = client.send(new InvokeModelWithBidirectionalStreamCommand({
    modelId: MODEL,
    body,
  }));

  // Start consuming the response IMMEDIATELY, before pushing any input.
  // Reading only after the input is exhausted can stall on HTTP/2 flow
  // control: the model starts replying while we're still streaming audio,
  // and an unread response window eventually blocks the request.
  const reader = (async () => {
    const { body: out } = await stream;
    for await (const ev of out) {
      const d = JSON.parse(new TextDecoder().decode(ev.chunk.bytes));
      if (d.event?.textOutput) console.log("TEXT:", d.event.textOutput.content);
      if (d.event?.audioOutput) console.log("AUDIO bytes:",
        Buffer.from(d.event.audioOutput.content, "base64").length);
      if (d.event?.contentStart?.additionalModelFields) console.log("STAGE:",
        JSON.stringify(d.event.contentStart.additionalModelFields));
    }
    console.log("stream closed");
  })();

  // Lifecycle events, in order. See the spec's protocol section.
  await push({ event: { sessionStart: { inferenceConfiguration: {
    maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } });
  await push({ event: { promptStart: { promptName,
    textOutputConfiguration: { mediaType: "text/plain" },
    audioOutputConfiguration: { mediaType: "audio/lpcm",
      sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1,
      voiceId: "matthew", encoding: "base64", audioType: "SPEECH" } } } });

  const sysContent = randomUUID();
  await push({ event: { contentStart: { promptName, contentName: sysContent,
    type: "TEXT", role: "SYSTEM",
    textInputConfiguration: { mediaType: "text/plain" } } } });
  await push({ event: { textInput: { promptName, contentName: sysContent,
    content: "You are a friendly assistant. Keep responses to two or three sentences." } } });
  await push({ event: { contentEnd: { promptName, contentName: sysContent } } });

  const audioContent = randomUUID();
  await push({ event: { contentStart: { promptName, contentName: audioContent,
    type: "AUDIO", role: "USER",
    audioInputConfiguration: { mediaType: "audio/lpcm",
      sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1,
      audioType: "SPEECH", encoding: "base64" } } } });

  const CHUNK = 8192;
  for (let i = 0; i < pcm.length; i += CHUNK) {
    await push({ event: { audioInput: { promptName, contentName: audioContent,
      content: pcm.slice(i, i + CHUNK) } } }, 40);
  }
  await push({ event: { contentEnd: { promptName, contentName: audioContent } } });

  await reader;
})().catch((e) => { console.error("SPIKE FAILED:", e); process.exit(1); });
```

- [ ] Get a test WAV. Any 16kHz mono 16-bit recording of a spoken question
      works. If `ffmpeg` is available:
      `ffmpeg -i input.m4a -ar 16000 -ac 1 -f s16le out.raw && base64 -w 0 out.raw > out.b64`
      (if you have a raw `.raw`/`.pcm` file, base64 it directly — the script
      reads base64 text).

- [ ] Run it and confirm a real reply comes back:

```bash
cd /tmp/nova-spike && node spike.mjs out.b64
```

**Pass criteria:** printed `TEXT:` lines containing an assistant reply, and
`AUDIO bytes:` lines with non-zero lengths. Also confirm `stream closed`
arrives rather than a hang.

- [ ] If it fails, the likely causes, in order: wrong region; model not
      enabled; `AccessDeniedException` (IAM lacks `bedrock:InvokeModel` —
      for a local run, your own credentials need it); sample rate wrong;
      `body` shape wrong (re-read the `body` constraint at the top of this
      plan). Record the real error before changing anything.

- [ ] **Decide the SDK version to pin** from the step above and note it —
      Task 2's `package.json` uses it.

---

## Phase 2: Walking skeleton — AppSync Events + a bare Lambda

Purpose: get browser → AppSync → Lambda → AppSync → browser working, with a
handler that echoes, before any Nova Sonic logic. Verifies the runtime
semantics the spec flags as the main unknown.

### Task 2: Add the AppSync Events API and channel namespace to the stack

- [ ] Add to `infra/lib/infra-stack.ts`. Note the existing stack uses
      `Code.fromAsset("lambda/<name>")` (a path relative to the CWD where
      `cdk` runs, i.e. `infra/`) — `NodejsFunction` wants an explicit
      `entry` path, so use `path.join(__dirname, "..", "lambda", ...)` and
      add `import * as path from "path";`:

```ts
import { EventApi, ChannelNamespace, AppSyncAuthorizationType,
         LambdaInvokeType } from "aws-cdk-lib/aws-appsync";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
```

- [ ] Create the API. `AppSyncAuthProvider` is a **plain interface, not a
      class** — pass an object literal. The enum is
      `AppSyncAuthorizationType` (not `AuthorizationType`), and
      `cognitoConfig` takes the pool object directly:

```ts
const interviewEventApi = new EventApi(this, "InterviewEventApi", {
  apiName: "cv-tailor-interview",
  authorizationConfig: {
    authProviders: [
      {
        authorizationType: AppSyncAuthorizationType.USER_POOL,
        cognitoConfig: { userPool },   // the existing pool, not a new one
      },
    ],
    connectionAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
    defaultPublishAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
    defaultSubscribeAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
  },
});
```

- [ ] Add `interview-service` as a `NodejsFunction`. `aws-cdk-lib/aws-lambda-nodejs`
      ships with `aws-cdk-lib`; add `esbuild` to `infra/package.json`
      devDependencies. Omit `runtime` — it infers from the local Node
      version (23.10.0 here), so pin `target` instead so the deployed
      runtime doesn't drift with whatever Node is on your machine:

```ts
const interviewServiceHandler = new NodejsFunction(this, "InterviewService", {
  entry: path.join(__dirname, "..", "lambda", "interview-service", "index.ts"),
  handler: "index.handler",
  bundling: { minify: false, sourceMap: true, target: "node22" },
  timeout: cdk.Duration.seconds(900),   // Lambda ceiling == hard session limit
  memorySize: 1024,
  environment: {
    NOVA_SONIC_MODEL_ID: NOVA_SONIC_MODEL_ID,
    // Task 2 only needs a placeholder so the stack is deployable; Task 4
    // replaces this with the real phase prompts. Don't reference a constant
    // that doesn't exist yet — Task 2 has to synth on its own.
    PHASE_PROMPTS: "{}",
  },
});
```

- [ ] Wire the channel namespace with an `onSubscribe` handler config — this
      is the piece that keeps one Lambda alive per session. `HandlerConfig`
      (`aws-cdk-lib/aws-appsync/lib/channel-namespace.d.ts:53-68`) has
      `direct`, `dataSource`, and `lambdaInvokeType`; with `code` set on the
      namespace, `direct: true` points the handler at that code:

```ts
const interviewChannelNamespace = new ChannelNamespace(this, "InterviewChannels", {
  api: interviewEventApi,
  channelNamespaceName: "interview",
  code: interviewServiceHandler,
  publishHandlerConfig: { direct: true, lambdaInvokeType: LambdaInvokeType.REQUEST_RESPONSE },
  subscribeHandlerConfig: { direct: true, lambdaInvokeType: LambdaInvokeType.REQUEST_RESPONSE },
});
```

The fallback, if `direct: true` doesn't wire to `code` the way you expect, is
an explicit `AppSyncLambdaDataSource` passed as `dataSource` instead. The
underlying `CfnChannelNamespace.HandlerConfigProperty` takes `behavior`
(`HandlerBehavior.CODE` | `DIRECT`) + `integration.dataSourceName` +
`lambdaConfig.invokeType` — drop to `CfnChannelNamespace` L1 only if the L2
genuinely doesn't fit.

- [ ] IAM for Bedrock — a new policy statement scoped to this Lambda only,
      mirroring `bedrockGenerationPolicy`
      (`infra-stack.ts:133-141`):

```ts
const novaSonicPolicy = new iam.PolicyStatement({
  actions: ["bedrock:InvokeModel"],
  resources: [
    `arn:aws:bedrock:${this.region}::foundation-model/${NOVA_SONIC_MODEL_ID}`,
  ],
});
interviewServiceHandler.addToRolePolicy(novaSonicPolicy);
```

No DynamoDB grants. The transcript is in-memory for the session (spec,
"Session transcript lives in memory") — this Lambda needs no table access at
all, same minimal-IAM reasoning as `intake-service`
(`infra-stack.ts:201-212`).

- [ ] Output the Events endpoints as stack outputs so the dashboard's
      `amplify-config.ts` can be pointed at them without hand-copying from
      the console:

```ts
new cdk.CfnOutput(this, "InterviewEventsRealtimeDns", {
  value: interviewEventApi.realtimeDns,
});
new cdk.CfnOutput(this, "InterviewEventsHttpDns", {
  value: interviewEventApi.httpDns,
});
```

- [ ] IAM for Bedrock — a new policy statement scoped to this Lambda only,
      mirroring the existing `bedrockGenerationPolicy` style
      (`infra-stack.ts:133-141`):

```ts
const novaSonicPolicy = new iam.PolicyStatement({
  actions: ["bedrock:InvokeModel"],
  resources: [
    `arn:aws:bedrock:${this.region}::foundation-model/${NOVA_SONIC_MODEL_ID}`,
  ],
});
interviewServiceHandler.addToRolePolicy(new iam.PolicyPolicy({
  statements: [novaSonicPolicy],
}));
```

No DynamoDB grants. The transcript is in-memory for the session (spec,
"Session transcript lives in memory") — this Lambda needs no table access at
all, same minimal-IAM reasoning as `intake-service`
(`infra-stack.ts:201-212`).

- [ ] Add the constant near the existing Bedrock model IDs
      (`infra-stack.ts:21-24`):

```ts
const NOVA_SONIC_MODEL_ID = "amazon.nova-2-sonic-v1:0";
```

- [ ] Synthesise and confirm the resources appear:

```bash
cd infra && npx tsc --noEmit && npx cdk synth --quiet && \
  grep -c "AWS::AppSync::Api" cdk.out/InfraStack.template.json && \
  grep -c "AWS::AppSync::ChannelNamespace" cdk.out/InfraStack.template.json
```

Both counts ≥ 1. `tsc --noEmit` and `cdk synth` are *not* the test — they
only prove the template builds. The test is Task 3.

- [ ] `cdk deploy`, note the new resources in the output.

### Task 3: Verify the skeleton end-to-end in a browser (THE critical check)

This is where the spec's main unknown gets resolved or the plan changes.

- [ ] Put a bare echo handler in `infra/lambda/interview-service/index.ts`
      first — log the event it receives and echo it back. Don't write the
      Nova Sonic logic until the plumbing is proven:

```ts
// Deliberately bare: no imports beyond what the handler needs. The point of
// this first version is to observe the event envelope.
export const handler = async (event: unknown) => {
  console.log("interview-service invoked:", JSON.stringify(event, null, 2));
  // then publish it back to the same channel
};
```

Log the **whole** event. You need to see: the channel path, whether `sub` is
present and from where, what identifies the session, and how the handler is
expected to publish. This is the documentation you can't guess.

- [ ] Add the Events endpoint to `dashboard/src/amplify-config.ts` from the
      stack output (`interviewEventApi.httpDns` / `realtimeDns`). Confirm
      the exact `Amplify.configure` shape for Events in `aws-amplify` ^6.22
      — check the installed package rather than guessing:

```bash
cd dashboard && grep -rn "Events" node_modules/@aws-amplify/api/lib/*.d.ts \
  node_modules/@aws-amplify/core/lib/*.d.ts 2>/dev/null | head -20
node -e "console.log(Object.keys(require('./node_modules/@aws-amplify/api/package.json').dependencies))"
```

- [ ] Write a throwaway test page (`dashboard/src/pages/InterviewSpikePage.tsx`,
      routed at `/interview-spike` — **delete it in Task 10**) that
      connects, subscribes to `/interview/user/<sub>/test`, publishes an
      `audio`-shaped message, and renders whatever comes back.

- [ ] Run `npm run dev` in `dashboard/`, sign in, open the page, and confirm
      in the Lambda's CloudWatch log that: the handler fired once per
      session (not once per publish), and it can publish back to the channel
      and the browser received it.

- [ ] **Decision point.** Record the answers to:
      1. Does the `onSubscribe` handler stay alive for the session?
      2. What is the event envelope, exactly?
      3. How does the handler publish to the channel (SDK, HTTP, or the
         `publish` event the client sends)?
      4. Does `sub` arrive, and is the wildcard channel path enforced?

      If (1) is no — the handler does not stay alive — **stop and revisit the
      transport** (ECS Fargate / AgentCore Runtime, per the spec's Risks
      section) rather than working around it. That is the single outcome that
      invalidates the rest of this plan.

- [ ] Push: `infra` + `dashboard` skeleton, working end-to-end.

---

## Phase 3: The real relay

### Task 4: Interview phases and the system prompt

- [ ] Create `infra/lambda/interview-service/phases.ts`. Six phases, in
      order: `intro`, `experience`, `projects`, `skills`, `education`,
      `wrapUp`. Each is a short system prompt telling the agent what to
      elicit in that phase.

**Content constraints** (these matter more than the wording):
- The agent elicits **prose**. It does not score, match, or tailor
  anything — no CV logic in the voice prompt (spec, "Non-goals").
- Ask open questions and **follow up** on what the user actually said. That's
  the whole value of speech-to-speech over a form.
- Encourage the user to include concrete detail: employer, title, dates,
  what they did, what it resulted in. This is what `intake-service`'s prompt
  (`index.py:15-38`) needs to extract `title`/`company`/`period`/`description`
  without guessing.
- **Do not** ask the agent to produce JSON, structure, or a profile. That's
  `intake-service`'s job. One concern, one place.
- Keep each phase's prompt short — that's what keeps per-turn reasoning
  light and latency low.

- [ ] Export a `PHASES` array and an `advance(currentPhase) -> nextPhase`
      helper. Phase transitions should be driven by the agent finishing a
      topic, and the client may also skip ahead via the `phase` event.
- [ ] Replace Task 2's `PHASE_PROMPTS: "{}"` placeholder with
      `JSON.stringify(PHASES)` now that the prompts exist.

- [ ] Unit-test the phase transition logic as
      `infra/test/phases.test.ts` and run `cd infra && npm test`. **`infra`
      already has jest 30 + ts-jest wired** (`infra/jest.config.js`,
      `roots: ['<rootDir>/test']`, `testMatch: ['**/*.test.ts']`) — this is
      the natural home, and it also means the currently-empty
      `infra/test/infra.test.ts` finally has a neighbour. Assert: phase
      order, `wrapUp` is terminal, an unknown phase doesn't throw, and each
      prompt is non-empty.

### Task 5: The Nova Sonic stream client

- [ ] Create `infra/lambda/interview-service/novaSonicStream.ts` — port the
      working spike (Task 1) into a reusable class. It owns:
  - the `BedrockRuntimeClient` with `NodeHttp2Handler` (300s timeouts,
    `disableConcurrentStreams: false`, `maxConcurrentStreams: 20`)
  - the queue-backed `AsyncIterable` body
  - `start(systemPrompt, history)`, `sendAudio(base64Pcm)`,
    `endAudioInput()`, `close()`
  - an event dispatch surface: `onTextOutput`, `onAudioOutput`,
    `onTranscript(role, text)`, `onTurnEnd`, `onError`

- [ ] **Event ordering** (spec's protocol section) — implement exactly:
  `sessionStart` → `promptStart` → `contentStart(SYSTEM,TEXT)` →
  `textInput` → `contentEnd` → [`contentStart(role,TEXT)` → `textInput` →
  `contentEnd`] × history → `contentStart(USER,AUDIO)` → `audioInput` × N →
  `contentEnd`.

- [ ] Mint a fresh `contentName` per audio turn and per history block. This
      is a hard protocol rule, not a style preference.

- [ ] Filter speculative text. `contentStart` carries
      `additionalModelFields.generationStage`; only surface `textOutput` as a
      final transcript line when the stage isn't `SPECULATIVE`, or the live
      transcript will visibly rewrite itself mid-sentence. (Keep streaming
      partial text for the UI if you want — just don't mark it final.)

- [ ] Base64 decode `audioOutput` before publishing to the channel, or the
      browser gets double-encoded garbage.

- [ ] **Test with the Task 1 spike harness**: run the class against real
      Bedrock with a recorded WAV and assert you get transcript + audio back.
      Refactor the spike into a test that runs, don't eyeball it.

### Task 6: Session continuation

- [ ] Track wall-clock per stream in the session. At **7 minutes** (not 8 —
      margin matters, and a renewal is invisible to the user), and **only on
      a turn boundary** (`contentEnd` for the assistant turn), renew:
  1. Set a "renewing" flag; queue incoming audio into a buffer instead of
     sending it.
  2. Tear down the old stream (`promptEnd` → `sessionEnd`).
  3. Open a new stream, replay every prior turn as TEXT history blocks.
  4. Reopen the audio block with a **fresh** `contentName`, flush the
     buffered audio.
- [ ] Buffering across the gap is the point — the user keeps talking during a
      rollover and must not lose the sentence. (This is the AWS reference
      sample's approach.)
- [ ] Bound history: replaying an entire 7-minute interview as TEXT is fine
      for v1 (a few thousand tokens); don't truncate unless a real test shows
      a problem, and if you do truncate, say so in a comment.
- [ ] Add a total session ceiling tied to the Lambda's 900s timeout. Past
      it, close the stream and send the client an `error` event saying the
      interview hit its time limit — the user should still be able to take
      the transcript they've accumulated.
- [ ] Test the renewal path with a forced short interval (e.g. an env var
      `RENEW_AFTER_SECONDS` defaulting to 420) so you don't have to run a
      7-minute test to exercise it. Run it. Assert the conversation stays
      coherent across the boundary and no audio is lost.

### Task 7: The session handler

- [ ] `infra/lambda/interview-service/index.ts` — the handler Task 3's echo
      stub becomes. Responsibilities:
  - one session per invocation; per-session state in memory (transcript
    turns, current phase, stream instance, start time)
  - `audio` in → `sendAudio`
  - `transcript` out, tagged with the current phase (**this is what makes
    chunked parsing possible — it must be attached at emit time, not
    reconstructed later**)
  - `phase` in → advance, update the system prompt for the next turn
  - `end` in → `endAudioInput()`, wait for the final turn, then publish the
    full phase-tagged transcript
  - keep the spec's "Non-goals" discipline: no domain logic in this layer
- [ ] Match the event payload contract in the spec exactly. It's small and
      the frontend is written against it; changing it later means changing
      both sides.
- [ ] **Test locally with a fake stream.** Feed the handler a scripted
      `AsyncIterable` of canned Bedrock events (a turn, a phase change, a
      renewal) by making the stream client injectable, and assert the
      events the handler publishes match the spec's contract. This runs
      without AWS and without a browser, so it goes in
      `infra/test/` (`npm test` in `infra/`, per Task 4). `TESTING.md` is a
      *verification log* of things that were run against real AWS, not a
      unit-testing playbook — don't cite it as precedent for this.

### Task 8: Frontend audio and the interview page

- [ ] Audio capture module. `getUserMedia` → `AudioContext` →
      `AudioWorkletNode` → resample to **16 kHz mono 16-bit** → base64 →
      publish. The resample must happen in the worklet; doing it on the main
      thread will glitch.
- [ ] Playback module. 24 kHz mono 16-bit base64 in → decode → ring buffer
      in an `AudioWorklet` → destination at 24 kHz. **Sample-rate mismatch
      is the top cause of "transcript fine, no sound"** (spec, Risks) — if
      audio doesn't play, check this before suspecting the stream.
- [ ] `useVoiceInterview` hook: connect, subscribe, manage phase state,
      expose `{transcript, currentPhase, status, start, stop, endAndCollect}`.
      Handle token caching — a per-publish token fetch adds a Cognito round
      trip to every audio chunk, so read the token once per session window.- [ ] `InterviewPage.tsx`: live two-way transcript, start/stop controls,
      phase progress, and a **"Build my profile from this"** button.
- [ ] Route at `/interview` in `dashboard/src/App.tsx`; add a nav entry in
      `dashboard/src/components/Shell.tsx` (`NAV_ITEMS`, `:6-10`).
- [ ] Chrome-first. Note the limitation in the UI or a code comment; don't
      pre-emptively abstract the worklet for browsers you can't test.

---

## Phase 4: The profile handoff

### Task 9: Chunked parse and merge

- [ ] `chunkTranscriptByPhase(turns)` — group transcript turns by their phase
      tag into one text blob per phase. **Test this with `vitest`**; it's
      pure logic and the one piece of this feature that deserves unit tests
      proper. Assert: every turn lands in exactly one chunk, empty phases
      produce no chunk, order is preserved, and each chunk is under
      `MAX_RAW_TEXT_CHARS` (20,000) — that last assertion is the whole
      reason this function exists, so make it a real check that fails if a
      phase is too long.
- [ ] `mergeParsedProfiles(profiles)` — concatenate `skills`, `projects`,
      `experience`, `education`; take `full_name` from the first chunk that
      has one. **Merge, don't replace** — `ProfileIntakePage` hydrates from a
      saved profile on mount (`:43-64`), so replacing would silently destroy
      saved work. Test with `vitest` too.
- [ ] Wire the button: for each chunk, `parseProfileText(chunk)`
      (`dashboard/src/api/backend.ts:68-74`), merge, then hand to the
      existing review form. **Reuse `ProfileIntakePage`'s review stage** if
      you can — don't build a second review UI. Show per-chunk progress and
      surface a partial failure as a partial result with a warning, not a
      total loss: a failure should cost one section, not the interview
      (that's the reason for chunking).
- [ ] Confirm no change was needed to `intake-service` — the whole point of
      chunking was to fit its existing cap. If you find yourself editing
      `MAX_RAW_TEXT_CHARS`, that's a signal the chunking isn't doing its job;
      stop and reconsider.

---

## Phase 5: Deploy, verify, hand off

### Task 10: Deploy and manual verification (hand-off)

- [ ] Delete `InterviewPage`'s spike sibling `InterviewSpikePage.tsx` and
      its `/interview-spike` route.
- [ ] `cd infra && npx cdk deploy`; `cd dashboard && npm run build` (which
      runs `tsc && vite build`).
- [ ] Run `npm test` in `dashboard/` — the new vitest specs plus the
      existing `cvEdits`/`cvSync` tests must all pass.
- [ ] **Run it yourself first, thoroughly**, before handing over: a full
      interview, start to finish, including a forced renewal to confirm
      continuity. Read the Lambda's CloudWatch logs for errors. Half a
      passing interview is not a working feature.
- [ ] Then hand back a step-by-step manual plan for the user, covering:
  sign in → start interview → speak → watch both directions of the live
      transcript → let it run past a renewal and confirm continuity → end →
      "Build my profile from this" → confirm the review form has coherent
      entries per section → edit → save → confirm the profile persists.
- [ ] **Wait for the user to confirm the manual pass.** Do not proceed to
      Task 11 until they do. Do not mark anything ✅ on the strength of your
      own test run.

### Task 11: Close out

- [ ] Rewrite `VOICE_INTERVIEW.md`. **Already done** as part of writing the
      spec (2026-10-01) — it now carries the corrected transport, language,
      auth and cost, and points at the spec rather than duplicating it. This
      step is a **re-read and confirm it's still accurate** after the build,
      not a rewrite.
- [ ] Update `PLAN.md`'s "Voice interview agent" section (`:753-772`) —
      status markers to ✅, referencing the spec and the verification result.
- [ ] Add an `API.md` note if warranted. No new HTTP endpoint is added, but
      the chunked `/profile/parse` usage is worth a line, since the existing
      entry documents the 20k cap (`:64`) and a caller hitting it would
      otherwise be surprised.
- [ ] Append the verification record to `TESTING.md`, following its
      established format (account, region, what was run, what came back) —
      including the renewal-continuity result and the real cost of one
      interview, which will finally put a number on the corrected estimate.
- [ ] `cd infra && npm test` — by now this runs the phase tests from Task 4
      and the handler tests from Task 7; `infra/test/infra.test.ts` itself is
      still entirely commented out. Worth adding assertions while you're in
      here: a real `Template.resourceCountIs` check on the AppSync resources
      is cheap and would catch a silent synth regression.
- [ ] PR from `daniel/voice-interview` into `develop`.

---

## Appendix: protocol quick reference

```
sessionStart                        inferenceConfig {maxTokens, topP, temperature}
promptStart                         voiceId, 24kHz audioOutputConfiguration
  contentStart(SYSTEM, TEXT) → textInput(systemPrompt) → contentEnd
  [contentStart(role, TEXT) → textInput(turn) → contentEnd]  ← history replay
  contentStart(USER, AUDIO)          16kHz audioInputConfiguration
    audioInput × N                   base64 PCM chunks
  contentEnd
  ← model: contentStart → textOutput + audioOutput → contentEnd
promptEnd
sessionEnd
```

| Thing | Value |
|---|---|
| Model ID | `amazon.nova-2-sonic-v1:0` (no `us.` prefix) |
| Region | `us-east-1` |
| Audio in | 16,000 Hz, mono, 16-bit LPCM, base64 |
| Audio out | 24,000 Hz, mono, 16-bit LPCM, base64 |
| Stream limit | 8 min hard; renew at ~7 min |
| Lambda timeout | 900 s (hard session ceiling) |
| `body` type | `AsyncIterable` (not an object) |
| `contentName` | fresh UUID per content block |
