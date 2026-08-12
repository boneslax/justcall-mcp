import assert from "node:assert/strict";
import test from "node:test";
import { classifyCallsAiResponse, parseCallsAiEnvelope } from "../dist/client.js";

test("maps the recorded Calls AI envelope and preserves ordered utterances", () => {
  const result = parseCallsAiEnvelope({
    status: "success",
    data: {
      call_id: 402893901,
      call_summary: "Transferred to Freddie",
      call_transcription: [
        { speaker_id: 1, speaker_name: "Caller", sentence: "Hello", timestamp: { starttime: 0, endtime: 1 } },
        { speaker_id: 2, speaker_name: "Freddie", sentence: "How can I help?", timestamp: { starttime: 1, endtime: 3 } },
      ],
    },
  });
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.utterances.map((row) => row.sentence), ["Hello", "How can I help?"]);
  assert.equal(result.transcript, "Caller: Hello\nFreddie: How can I help?");
  assert.equal(result.summary.call_id, 402893901);
  assert.equal("call_transcription" in result.summary, false);
});

test("classifies a missing transcript as not ready", () => {
  assert.deepEqual(parseCallsAiEnvelope({ status: "success", data: { call_id: 402893901 } }), {
    kind: "not_ready",
  });
  assert.deepEqual(parseCallsAiEnvelope({ status: "success", data: { call_transcription: [] } }), {
    kind: "not_ready",
  });
});

test("distinguishes provider availability outcomes", async () => {
  assert.deepEqual(await classifyCallsAiResponse(new Response("", { status: 401 })), { kind: "unauthorized" });
  assert.deepEqual(await classifyCallsAiResponse(new Response("", { status: 404 })), { kind: "not_found" });
  assert.deepEqual(
    await classifyCallsAiResponse(new Response("", { status: 429, headers: { "retry-after": "3" } })),
    { kind: "rate_limited", retry_after_ms: 3000 }
  );
  assert.deepEqual(await classifyCallsAiResponse(new Response("", { status: 503 })), {
    kind: "provider_error",
    status: 503,
    reason: "http_503",
  });
});
