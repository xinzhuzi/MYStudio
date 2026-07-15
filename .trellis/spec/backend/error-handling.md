# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

Route handlers validate input at the boundary, return JSON errors with an
appropriate HTTP status, and persist asynchronous generation failures. The
Electron runtime treats sidecar startup and health failures as product errors.

---

## Error Types

<!-- Custom error classes/types -->

- Use `ValueError` or `RuntimeError` inside engine/storage code when an
  operation cannot continue.
- HTTP handlers translate failures to `send_error_json(...)`.
- Generation jobs store `status="failed"` and the error message before removing
  the task from active state.

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

- Validate required fields before starting work and return immediately.
- Catch `json.JSONDecodeError` separately as HTTP 400.
- Do not silently replace real-mode inference failures with mock output.
- Background worker boundaries may catch broad exceptions only after the
  durable task state has been updated.

---

## API Error Responses

<!-- Standard error response format -->

Errors use the existing compatible shape:

```python
self.send_json(
    {"detail": message, "error": message},
    status=HTTPStatus.BAD_REQUEST,
)
```

Use 400 for invalid input, 403 for an invalid control token, 404 for missing
profiles/files/routes, and 500 for unexpected internal failures.

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

- Do not expose control tokens, provider keys, or full sensitive payloads.
- Do not report success until the output file and persisted generation record
  both confirm completion.
- Do not catch an exception and leave a generation permanently `generating`.
