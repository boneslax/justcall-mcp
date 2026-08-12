# Unreleased

- Correct the call-transcript tools to use JustCall's exact-ID Calls AI endpoint with
  `platform=justcall&fetch_transcription=true`.
- Return explicit ready, not-ready, not-found, unauthorized, rate-limited, provider-error,
  and transport-error outcomes.
- This MCP is diagnostic-only. AllSafe Hub does not call this package at runtime.
