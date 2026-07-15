# Logging Guidelines

> How logging is done in this project.

---

## Overview

<!--
Document your project's logging conventions here.

Questions to answer:
- What logging library do you use?
- What are the log levels and when to use each?
- What should be logged?
- What should NOT be logged (PII, secrets)?
-->

The Python sidecar currently writes concise process logs to stdout/stderr. Each
message must identify the subsystem and support Electron runtime diagnostics
without exposing secrets or large media payloads.

---

## Log Levels

<!-- When to use each level: debug, info, warn, error -->

- Informational lifecycle events use stdout, for example server listening and
  model task progress.
- Recoverable degradation uses a warning message or persisted `warning` field.
- Failed operations must update durable task state and surface an error to the
  Electron caller; printing alone is insufficient.

---

## Structured Logging

<!-- Log format, required fields -->

Prefix sidecar output with `[tts-sidecar]`. For durable cross-process evidence,
return structured JSON fields such as `status`, `backend`, `mocked`, `warning`,
and `error` instead of requiring consumers to parse prose logs.

---

## What to Log

<!-- Important events to log -->

- Service start/stop and listening address.
- Model download, cache, load, and unload lifecycle.
- Generation identifiers, terminal status, backend kind, and timing metadata.
- Enough context to identify a failing route without dumping its full body.

---

## What NOT to Log

<!-- Sensitive data, PII, secrets -->

- `MANYING_TTS_CONTROL_TOKEN`, API keys, authorization headers, or passwords.
- Full prompt/reference text when a short identifier or length is sufficient.
- Base64 media, raw audio bytes, or unbounded exception payloads.
