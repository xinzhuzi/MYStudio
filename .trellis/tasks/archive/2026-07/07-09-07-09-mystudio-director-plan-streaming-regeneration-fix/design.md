# Design

## Current Behavior

`useProductionPlanningActions.handleDirectorPlan` calls `aiManager.text` for both first generation and repair generation. `aiManager.text` delegates to `window.electronAPI.textCompletion`, which sends one non-streaming POST to `/v1/chat/completions`.

Diagnostics show the configured provider can return the old short/weak director plan in about 51.7s, but repeatedly drops the newer six-section request at about 60.6s. Local timeout is 300s, so raising it will not address the observed cutoff.

## Target Behavior

Use `aiManager.textStream` for director plan generation and repair. This keeps the existing provider resolution, model binding, max token handling, and fallback semantics, while allowing providers that support streaming to send early chunks instead of leaving the connection idle.

If the AI SDK stream returns no text, treat it as a failed stream transport and continue into the existing hand-written HTTP stream fallback. Returning `{ success: true, text: "" }` is not valid for director planning and hides the useful fallback path.

When using the Electron main-process AI SDK text helpers, resolve the model from the request payload first. Provider model arrays can contain image-only models and are not safe as a higher-priority text default.

No data model or node UI changes are required.

## Boundaries

- Keep audit and writeback logic in `useProductionPlanningActions` unchanged.
- Do not modify provider config, app settings persistence, image workflow, storyboard table generation, or Daojie disk content.
- Tests should prove the hook now enters the streaming path without weakening validation.
