# 第一章视觉连续性实施计划

## Batch 1: Toonflow fixture and baseline

1. 建只读导入器，抽取 Toonflow 第一章 43 条 storyboard、ordered asset/image IDs、prompt、model settings 和 golden paths。
2. 生成结构差异报告与可重复测试 fixture，不复制 Toonflow 生产数据库。
3. 为 MYStudio 当前 43 图建立 baseline manifest、缩略图 contact sheet 和人工问题台账。

Validation: fixture 43/43、golden missing=0、MYStudio baseline 43/43；证明两套分镜不是同一计划。

## Batch 2: Continuity contracts

1. 在 Studio 类型和项目 store 增加 asset version、ordered reference manifest、shot group、visual review 和 input fingerprint。
2. 写旧数据兼容与 round-trip 测试。
3. 扩展 parity report，禁止“有参考图”替代“视觉一致”。

Validation: focused type/store/parity tests + typecheck。

## Batch 3: Character and scene bibles

1. 把已有六层 identity anchors、negativePrompt、多视图和 variation 接入 continuity version。
2. 把 scene contact sheet/viewpoints、布局、光线和色板接入 scene version。
3. 为第一章重复角色/场景生成缺口报告；缺基准资产时阻断分镜生成。

Validation: 独孤剑尘、赵四、小杂役和三个重复场景的版本解析测试。

## Batch 4: Ordered provider request

1. 所有分镜生图入口统一从 ordered manifest 构造 reference nodes、prompt bindings 和 provider request。
2. 注入角色身份锚点、服装状态、场景视角、人物位置/朝向和动作承接。
3. 增加 provider capability probe 与真实发送参数报告。

Validation: 顺序不变、身份不串位、能力不足 hard fail、Node/Python 契约交叉测试。

## Batch 5: Shot-group continuity and stale propagation

1. 按场景/连续动作构建第一章 shot groups。
2. 支持上一镜 approved 图作为连续构图参考；canonical references 始终保留。
3. 上游 revision 变化时向后传播 stale；支持从首个失败镜头恢复。

Validation: 组内顺序、fingerprint、stale、resume 和不复用旧图测试。

## Batch 6: Visual supervision gate

1. 增加角色、场景、道具和相邻动作检查结果结构。
2. 产品 UI 显示 rejected 镜头、原因、参考图和前后镜对照。
3. `chapter-auto-video` 在存在 rejected/stale 时阻断 merge。

Validation: structural + UI + runner failure probes；不得用 prompt 合规代替 visual approved。

## Batch 7: Small-batch real generation

1. 备份当前 store、43 图和 MP4。
2. 只重生成码头连续段 6–8 镜，制作前后 contact sheet。
3. 人工核验独孤剑尘、赵四、小杂役身份、服装、体型、码头空间和动作承接。
4. 未通过则回到 Batch 3–5，不进入全章。

## Batch 8: Full chapter regeneration

1. 按 shot group 小批量重生成，逐批审查并批准。
2. 43 镜全部 approved 后，复用现有 43 条真实口播和固定音色重新合成。
3. 跑产品一键路径、真实 CLI、packaged/installed smoke 和最终媒体证据。

## Safety boundaries

- 禁止 git/worktree、删除旧图、覆盖无备份产物或修改小说正文。
- 不自动归档 Trellis task。
- 每批只改一个可复验契约；每次修改后立即回读和 focused validation。

## Batch 9: 2026-07-15 root-contract correction

1. 先写失败测试：结构完整不得自动批准；自动 reviewer 不得批准；主场景必须与 manifest 唯一匹配；道具/文字检查必须齐全。
2. 增加资产人工批准、内容指纹和 `secondary-scene` 类型；结构修复脚本只能产生 `pending`。
3. 给 Python 与前端图片发送路径增加严格 `<1,000,000 bytes` transfer gate，并为 pilot 生成 `*_thumb.png` 与传输证据。
4. 审查 UI 显示 canonical 多视图、文字锚点、服装/场景版本、关键道具和批准状态。
5. 非覆盖式建立 v4 Bible，使用空输出目录逐镜生成 6–12；未取得真实人工批准前不进入 43 镜或最终成片。

Validation: focused Vitest + Python snippets、typecheck、lint、full Vitest、timeline integration；视觉门通过后再跑 real Daojie clone、direct video、build/package/installed smoke。

## Batch 10: 2026-07-16 explicit human asset approval promotion

1. 新增独立 Python CLI；每次必须显式指定一个 `assetId/versionId`，默认 dry-run，写入时同时要求 `--apply` 与 `--human-confirmed`，禁止自动批准全部资产。
2. 写入前校验 manifest/store 内容指纹完全一致、每张 canonical reference 的磁盘 SHA-256 匹配、人工证据为真实存在且严格 `<1,000,000 bytes` 的 `*_thumb.png`。
3. 复用运行时指纹算法生成 human approval；备份并原子写 store，只更新选中资产及对应 ordered references，不批准分镜、不清除 stale。
4. 独立 Python 单元测试覆盖 dry-run、双确认门、指纹/哈希/证据失败和最小范围 apply。

Validation: `python3 -m unittest Library.ai.test_promote_chapter001_continuity_approvals`；随后使用最终 9 个候选重跑 v5 Bible dry-run。未取得用户逐项明确批准前不得 apply、pilot 或全章生成。

## Batch 11: 2026-07-16 full-chapter asset-version coverage correction

1. 以当前 43 镜 `orderedReferenceManifest` 的 `(assetId, versionId)` 严格键为准复算覆盖：旧口径的 19 个资产实际展开为 23 个缺失版本；悦来客栈、悦来客栈斗室和金水塾馆各有多个受控视角版本。
2. 修复结构 repair 在未再次传入 `--asset-manifest` 时从旧 image-workflow 重建引用、使已导入 Bible 对齐回退的问题；已有 `continuityAssetVersions` 必须按精确 ID 或项目实体名重新投影到 ordered references。
3. 将分镜中的旧独孤 ID `char_1780298212338_ld9bmar` 对齐到当前角色库/Bible ID `char_1780296482373_nh4qana`，同时更新 continuity character state；不得修改口播 speaker/voice binding。
4. 为 19 个全章资产准备 23 个非覆盖 pending 版本：4 个错误角色、4 个场景和错误铜钱使用新候选或已验证 Toonflow 铜钱；其余身份/结构参考仍保持 pending，等待逐项人工批准。
5. 固定 23–24 镜：悦来客栈斗室 `inn-room-window-axis` 为唯一主场景，金水塾馆同视角只允许 `secondary-scene`。

Validation: repair 回归测试证明无 manifest 重跑不丢 Bible ID/版本；全章 dry-run 报告 43/43 ordered references 均能解析到 pending/approved version，主场景唯一匹配；任何自动 reviewer 仍不能批准资产或分镜。

## Batch 12: 2026-07-17 authorized non-overwriting character reruns

1. Preserve the ambiguous `girl-turnaround` and `old-laborer-turnaround-r2` evidence; advance only their new output/report revisions to `girl-turnaround-r2` and `old-laborer-turnaround-r3`.
2. Keep `young-laborer-turnaround-r2` as the first-submission revision and write new `chapter001-v5-*-r3.json` plan artifacts.
3. Re-run the zero-generation provider probe, then submit old laborer r3, girl r2, and young laborer r2 strictly serially through the single-provider/single-key generation probe.
4. Stop before the next paid call on any ambiguous failure. On success, review only each validated `<1,000,000` byte `*_thumb.png`; no asset is approved automatically.

Validation: focused builder unit tests, `--plan` reports exactly the three missing authorized revisions, provider probe reports `mikoto / gpt-image-2 / keyCount=1 / HTTP 200`, and each paid report records exactly one generated image or a terminal non-retryable failure.

Result: the focused builder tests passed and the r3 plan had exactly the three expected gaps. The provider probe passed with one provider/key and no generation call. The first paid job, `old-laborer-turnaround-r3`, ended in a new ambiguous socket failure after its only POST, so the remaining two jobs were not submitted and Batch 12 remains open.

## Batch 16: 2026-07-17 renewed asynchronous paid authorization

1. Use the verified `/v1/images/generations/async` plus task polling contract through `probe-generation`, with unique non-overwriting output, thumbnail, and report paths.
2. Submit exactly three serialized jobs: `old-laborer-turnaround-r4` (one authorized resend), `girl-turnaround-r2` (one authorized resend), and `young-laborer-turnaround-r2` (first submission).
3. Stop before the next paid call on any socket, timeout, abort, reset, pipe, or HTTP 5xx ambiguity; preserve the failure report and do not fall back to another provider/key.
4. On success, validate and send only the corresponding strict `<1,000,000` byte `_thumb.png`; do not write any automatic human approval.

Validation: each submitted job has one generation attempt, an asynchronous task/result or terminal non-retryable failure, unique durable report paths, and no collision with old r2/r3/base outputs.

Result: all three authorized asynchronous jobs completed through `mikoto / gpt-image-2` with one provider/key and no fallback. `old-laborer-turnaround-r4` output SHA-256 `727d4c4a97210e0f0466758ff6d4686543acc2b2be1dc3c0cf488aeba4f50413`, thumb `768x512 / 304828 bytes / e3e5fea79cf21d55ae6296f38f2bbbea482d9d7fa20fd63da34de260628001fe`; `girl-turnaround-r2` output SHA-256 `2aeb62a08784a196abdb89ac25ef0de42db0b191f0073bf452c4369402362b3f`, thumb `768x512 / 284411 bytes / fae48feab6516d7dbd5c70a5129695a3d73b8be56f5e195af30f97cc37429af4`; `young-laborer-turnaround-r2` output SHA-256 `161714a8937a17a303b466ee791bf47fb86975cf7203b52d50c49dd7c3adbcea`, thumb `768x512 / 302731 bytes / ac403a16a8912d60d771bc94efbc34441fc111a815a1f52945a018f21482ecdf`. All remain pending human approval.

## Batch 13: 2026-07-17 pre-mutation visual and paid-fallback gates

1. Treat socket, timeout, abort, reset, pipe, and HTTP 5xx generation-POST failures as ambiguous paid outcomes and stop provider/key fallback immediately; retain 4xx fallback diagnostics.
2. Move the product auto-video visual-continuity assertion before fixed-voice resolution and TTS generation.
3. Add a direct-video `vite-node` preflight that reuses `auditVisualContinuity` against the current project store and exits before the Python generator unless every current chapter storyboard and referenced asset has a valid human approval and no stale state.

Validation: `build-scripts.test.ts` 66/66, `chapter-auto-video.test.ts` 5/5, direct visual preflight 2/2, combined focused Vitest 73/73, frontend typecheck, lint, and builder Python 4/4. The live store preflight correctly reports `approved=0, pending=43, rejected=0, stale=43` and exits before direct generation.

## Batch 14: approved storyboard promotion and no-regeneration final path

1. Add a standalone Python promotion CLI with dry-run default and a dual `--apply --human-confirmed` write gate.
2. Require a completed 43-shot full report, 43 valid human generation approvals, exact output hashes, and valid standalone transfer thumbnails.
3. Copy each approved image into a project-scoped content-addressed revision path, preserve old images, back up the store, and update only the matching chapter storyboards to the new media/manifest/state with `visualReview.status=pending` and no stale flag.
4. Make authoritative direct-video reuse those final product-approved revisions without a new image POST, preserving the exact approved review fingerprint inputs.

Validation: Python promotion unit tests, dry-run against synthetic fixtures, direct reuse regression proving zero image POSTs, focused Vitest/Python tests, typecheck and lint.

Result: promotion and direct reuse contracts are implemented. The promotion suite validates 43 generated images, 43 current human generation approvals, exact hashes, PNG thumbnails, non-overwriting content-addressed project paths, store backup, and product-review `pending` state. The direct reuse suite proves an approved project image performs zero provider requests. Six new Python tests pass; the broader selected continuity suite passes 22/22.

## Batch 15: durable canonical report history

1. Keep canonical latest report paths for existing readers.
2. Before replacing a provider-probe or direct-video canonical report, archive the prior exact bytes under a timestamp-and-SHA content-addressed history path.
3. Preserve the paid generation probe's stronger unique-path/no-overwrite behavior unchanged.

Validation: the report-retention regression proves the second canonical write archives the first exact JSON and leaves the second as latest; focused build-script tests pass 67/67.

## Batch 16: async paid recovery and integrity hardening

1. Before any new paid request, close the promotion transaction gaps found by deep review: bind approvals to the exact report output and transfer thumbnail, preflight all source bytes, write through staged atomic files, roll back partial artifacts, and make a repeated identical promotion a no-op.
2. Reject approved storyboard or previous-frame reuse when the current image bytes, project-scoped approved-revision path, or approval fingerprint no longer match; any fresh storyboard media/workflow replacement must reset product visual review to `pending` while clearing only the regenerated stale flag.
3. Route direct-video preflight, post-generation validation, probe, timeline, and final media failures through durable canonical failure reports without weakening unique paid-probe reports.
4. Submit `old-laborer-turnaround-r4`, `girl-turnaround-r2`, and `young-laborer-turnaround-r2` asynchronously and strictly serially. Each request uses a unique output/report path and the single-provider/single-key contract; any ambiguous result stops the remaining paid calls.

Validation: focused Python/Vitest regressions for rollback, idempotence, evidence linkage, byte tamper, path forgery, review reset, and durable failure reporting; then provider preflight and the three explicitly authorized asynchronous requests under the stop-on-ambiguity rule.

## Batch 17: 2026-07-17 release-gate evidence and current visual blocker

1. Fresh read-only review confirmed all 31 v5 asset evidence paths exist as registered `*_thumb.png` files, each strictly below 1,000,000 bytes with matching packet SHA-256; no approval write was performed.
2. `MYSTUDIO_DAOJIE_VISUAL_PREFLIGHT=1 ./node_modules/.bin/vite-node --config build/vite-node.config.ts build/audit-daojie-visual-continuity.ts` correctly failed closed with `approved=0,pending=43,rejected=0,stale=43`.
3. `npm run video:daojie:chapter001:probe-providers` passed in `provider-models-only` mode with `generationEndpointCalled=false`, one `mikoto / gpt-image-2` provider/key, and HTTP 200 for `/v1/models`; no paid image request was made.
4. Release gate passed after the current source snapshot: typecheck, lint, full Vitest (330 files; 1364 passed, 3 skipped), `build:mac`, packaged smoke, overwrite install, and installed smoke. Packaged and installed `app.asar` SHA-256 both equal `b71d0951a3f813214e509a29c87f175aa44f51f40cb646561fb6278f2e0972de`. Smoke screenshot capture timed out but the script's DOM visual fallback reported `whiteRatio=0.000` and exit 0.

Result: packaging/install is complete, but visual approval and real v5 generation remain open. Do not run the paid pilot, full generation, or final direct-video command until the 31 asset approvals and subsequent 43-shot storyboard approvals are explicitly confirmed.
