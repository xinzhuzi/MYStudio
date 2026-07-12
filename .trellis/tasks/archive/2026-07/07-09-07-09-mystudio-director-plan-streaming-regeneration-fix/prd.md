# Director plan streaming regeneration fix

## Goal

Fix director plan regeneration timing out on long non-streaming text completion by using existing streaming text channel and verifying writeback guard remains intact.

## Requirements

- Director plan regeneration must use the existing streaming text channel when available, because the current one-shot POST path is repeatedly cut off around 60 seconds by the configured provider.
- The Electron AI SDK text path must use the requested `payload.model` before any provider-level default model list, because the real provider can place an image-only model such as `gpt-image-2` before the selected text model.
- The existing six-section audit, one repair attempt, and "do not write back weak output" guard must remain unchanged.
- The fix must be limited to director plan generation and repair requests; storyboard table generation, image workflow, and Daojie project content are out of scope.
- If streaming is unavailable, the existing `aiManager.textStream` fallback may still use one-shot completion, preserving non-Electron/test compatibility.

## Acceptance Criteria

- [x] Unit tests cover director plan first generation and repair through `textCompletionStream`.
- [x] Existing weak three-block output is still blocked and not written back.
- [x] Existing six-section output is still saved to `directorPlan` and parsed to `scriptPlans`.
- [x] `npm test -- frontend/electron/main-startup.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/director-plan.test.ts` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build:mac:install` passes, installed app.asar hash matches packaged hash, and installed smoke passes.

## Notes

- Evidence from `/Users/zhengbingjin/Library/Application Support/漫影工作室/logs/diagnostics/diagnostics-2026-07-09.jsonl`: old one-shot prompt completed in 51.7s at `07:28:22`, while three later six-section attempts failed with `OpenAI 兼容: fetch failed` after about 60.6s.
- Follow-up evidence after installing the first streaming fix: `Text completion stream IPC started` fired, but AI SDK stream completed with `textLength: 0`, then director plan writeback was blocked as `导演规划失败`. Empty SDK streams must fall back to the HTTP stream path instead of returning success.
- Follow-up evidence after installing the empty-stream fallback: real Daojie regeneration logged `AI SDK text stream returned empty, falling back to HTTP`, HTTP stream status `200`, `Text completion stream IPC completed`, `directorPlan.audit.first` passed with `chars=7394`, `h2Sections=6`, `sceneSections=4`, then `directorPlan.writeback.saved`.
- The same real run also exposed a model routing defect: the AI SDK attempted chat completion with `gpt-image-2`. Text SDK calls must prefer the request model (`gpt-5.5` in this run) over provider model-list order.
