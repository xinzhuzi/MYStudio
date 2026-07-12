# Implement

1. Replace the two director plan `aiManager.text` calls with `aiManager.textStream`.
2. Use a no-op chunk callback for now; the saved result still comes from the returned full text.
3. Update workflow action tests so the installed mock exposes `textCompletionStream`, and assert director plan calls use it.
4. Run targeted tests and typecheck.
5. Re-check diagnostics expectation: if a real regeneration is attempted later, success should log `Text completion stream IPC completed`; failure should still block writeback.
6. If real diagnostics show `Text completion stream completed through AI SDK` with `textLength: 0`, patch the Electron stream IPC so empty SDK streams log a warning and continue to `runTextCompletionStreamRequest`.
7. If real diagnostics or terminal output show the AI SDK text path using an image-only provider model such as `gpt-image-2`, change Electron text handlers to prefer `payload.model` before `provider.model?.[0]`, and add a source-level regression test.
8. Re-run focused tests, typecheck, lint, package/install, and installed smoke after the model routing patch.
