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

## Batch 18: 2026-07-17 fresh preflight and regression evidence

1. Current-store recheck finds exactly 31 v5 asset versions at `reviewStatus=pending` and exactly 43 current `chapter-001` storyboards at `visualReview.status=pending`, `stale=true`; no approval write occurred.
2. Python continuity approval/Bible suites pass 17/17. Focused Vitest continuity, auto-video, readiness, build-script, visual-audit, and timeline-contract suites pass 108/108. Real FFmpeg timeline integration passes 3/3 with `MYSTUDIO_TIMELINE_RENDER_INTEGRATION=1`.
3. Current source overlap remains limited to the previously audited continuity files and task evidence; no large-file-refactor or OpenCut integration source file was edited by this task.

Result: structural and transfer gates remain green, but the required human visual approval and paid pilot/full generation are still not complete; the next safe action is explicit operator approval of the 31-asset packet.

## Batch 19: 2026-07-17 approved-version projection and pilot stop gate

1. Fixed the production/pilot continuity payload builder so an existing approved `(assetId, versionId)` from the live store projects its exact canonical paths, hashes, content fingerprint, approval fingerprint, and approval state into newly built manifests. This prevents the legacy project asset catalog from invalidating an already approved v5 Bible.
2. Added a regression in `apps/frontend/config/build-scripts.test.ts` proving stale project catalog paths are replaced by the approved store references.
3. Fresh 6–12 dry-run now reports `approved=9,pending=0,rejected=0,structurallyIncomplete=0`; fresh full-chapter dry-run reports `approved=31,pending=0,rejected=0,structurallyIncomplete=0` with `generatedImages=0` and `reusedImages=0`.
4. Started the authorized 6–12 real pilot in a new `/tmp` directory. The first unique `mikoto / gpt-image-2` POST ended with `fetch failed` and no task/output; the paid-request ambiguity hard gate stopped before shots 7–12 and before provider/key fallback. The durable canonical video report records `failureStage=continuity-pilot`; no pilot image or report was written.
5. Re-ran the non-generating provider probe: one `mikoto / gpt-image-2` provider/key, `/v1/models` HTTP 200, `generatedImages=0`, `generationEndpointCalled=false`.

Current blocker: the pilot needs a newly authorized retry or provider task-ID recovery before any further paid image request. No automatic retry is permitted after the ambiguous POST. Asset approvals remain 31/31 in the live store; all 43 storyboard visual reviews remain pending/stale.

## Batch 20: 2026-07-17 release/install revalidation

1. Fresh release gate passed: `npm run build:mac`, packaged `npm run smoke:desktop`, overwrite install via `ditto`, and packaged/installed `app.asar` SHA-256 match `c281b3faee8cc6d29297ede887f4e038e014738aaecec17bd5c5f43ac99e6b2a`.
2. Fresh installed smoke passed with `MYSTUDIO_SMOKE_DEBUG_PORT=9374`, `MYSTUDIO_SMOKE_CDP_TIMEOUT_MS=30000`, an isolated user-data directory, and report `/tmp/installed-smoke-report-20260717.json`; all four routes, workflow E2E, asset/voice flow, script/asset-generation/voice flow, Python settings, and `whiteRatio=0.000` passed. Screenshot capture timed out and the runner correctly used DOM visual fallback.
3. Fresh real Daojie background `--auto-video` smoke intentionally failed closed at the visual gate: report `/tmp/background-daojie-blocked-20260717.json` has `source=real-daojie-chapter001-clone`, `foregroundViolation=false`, `terminalStage=failed`, `timedOut=false`, and empty `finalPath`; 43 storyboard reviews remain pending/stale.

Release/install is complete for the current source snapshot. AC6/AC7 remain blocked by the paid pilot ambiguity and the required 43-shot human visual review; no final MP4 was promoted.

## Batch 21: 2026-07-17 operator approval and fresh release recheck

1. The operator explicitly confirmed that all 31 v5 continuity assets pass. A fresh read-only store audit now finds `31/31` with `reviewStatus=approved`, `approved=true`, `approval.status=approved`, and `approval.reviewer=human`; all 55 registered evidence thumbnails decode as PNG, have longest edge `<=768px`, and are strictly `<1,000,000` bytes.
2. Fresh non-generating dry-runs prove the approved-version projection is consumed by the pilot and full-chapter manifests: pilot shots 6–12 report `assetApprovalSummary={approved:9,pending:0,rejected:0,structurallyIncomplete:0}` and full chapter reports `31/31` with the same zero-pending result; both keep `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`.
3. Fresh provider probe remains configuration-only: one `mikoto / gpt-image-2` provider/key, `/v1/models` HTTP 200, `generationEndpointCalled=false`, `generatedImages=0`.
4. Fresh focused continuity tests pass `88/88`; Python continuity suites pass `23/23`; typecheck, lint, and full Vitest pass (`331` files passed, `1` skipped; `1370` passed, `3` skipped); timeline contract tests pass `2/2`.
5. Fresh packaged smoke and overwrite install remain green. Packaged and installed `app.asar` SHA-256 both equal `c281b3faee8cc6d29297ede887f4e038e014738aaecec17bd5c5f43ac99e6b2a`. Installed smoke passes with DOM fallback (`whiteRatio=0`) at `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/desktop-smoke-report.json`; screenshot capture timed out but did not produce a white-screen failure.
6. Fresh background auto-video still fails closed before generation with `terminalStage=failed`, `finalPath=""`, `foregroundViolation=false`; the current store remains `43/43` storyboard `visualReview.status=pending` and `stale=true`.
7. Fixed the Bible planner's research snapshot write path to allocate a non-overwriting revision when an existing snapshot's content changes. The fresh plan now succeeds with `chapter001-v5-31-version-source-matrix-r5.json`, while the prior r4 artifact remains intact; the planner regression suite passes `4/4`.

Result: the 31-asset gate is closed successfully, but the paid 6–12 pilot still cannot be retried from the previous ambiguous `fetch failed` POST without a new explicit retry authorization or a provider task-ID recovery. AC6/AC7 remain open; no paid retry, storyboard approval, promotion, or final MP4 was performed in this batch.

## Batch 22: 2026-07-17 storyboard metadata preservation hardening

1. Preserve the previous human visual review when a storyboard replacement payload omits review metadata; reset it to `pending` whenever source or visual output changes.
2. Match replacement rows by `(episodeId, index)` when an upstream parser changes storyboard IDs, so continuity metadata is not silently discarded by an exact-ID miss.
3. Add a store regression covering ID drift, stale marking, and review reset.

Validation: `npm test -- --run frontend/stores/studio-store.test.ts` passes 16/16. The live production store was not rewritten because its missing storyboard review/continuity fields have no approved backup to restore safely.

Correction: the current production store has 43/43 `visualReview`, `continuityState`, `orderedReferenceManifest`, and `sourceFingerprint` fields absent; the live audit therefore reports `approved=0,pending=43,rejected=0,stale=0`. Earlier `stale=true` counts came from the cloned smoke/report state and are retained as historical evidence, not as a claim about the current file.

## Batch 23: 2026-07-17 approved-asset structural recovery and release recheck

1. Corrected `Library/repair_chapter001_visual_continuity.py` so repaired references project an approved Bible version's exact `approvalFingerprint` and `approved=true`; pending versions remain unapproved. Added a regression covering the approved projection.
2. Applied backup-first structural repair to the live project store. All 43 storyboards now have ordered manifests, continuity state, source fingerprints, and pending visual-review records; no storyboard was auto-approved. The repair created timestamped store/script backups and fixed the 23–24 primary scene contract.
3. Fresh live audit: 31/31 continuity assets approved by human; 139/139 storyboard references resolve with matching content/approval fingerprints; 43/43 primary scenes unique; 23–24 use `悦来客栈斗室/inn-room-window-axis` as primary and `金水塾馆` as secondary; 43/43 storyboards remain pending/stale pending regenerated-image review.
4. Fresh transfer audit: 55 unique evidence thumbnails decode as PNG, longest edge `<=768px`, strict bytes `<1,000,000`, with packet byte/SHA parity 55/55.
5. Validation: Python continuity discovery 21/21; focused Vitest 113/113; full Vitest 331 files passed, 1 skipped, 1371 passed, 3 skipped; typecheck and lint passed. `npm run smoke:workflow:background:daojie -- --auto-video` correctly failed closed with 88 visual issues, no MP4, and `foregroundViolation=false`.
6. Release: `build:mac`, packaged smoke, overwrite install, and installed smoke all passed. Packaged/installed `app.asar` SHA-256: `57c7504961fdfa77a8ef393de3385efc085e10b365ad10c8530dd20d45648b2c`; screenshot capture timed out but DOM fallback reported `whiteRatio=0.000`.

Open gate: the paid 6–12 pilot and 43-shot regeneration still require a separately explicit paid retry authorization and then human approval of generated storyboards; no paid request was made in Batch 23.

## Batch 24: 2026-07-17 operator approval revalidation and release handoff

1. The operator confirmed that all 31 continuity assets pass. A fresh live-store audit finds `31/31` human-approved versions, `55/55` registered `*_thumb.png` evidence files valid as PNG, longest edge `<=768px`, strict bytes `<1,000,000`, and exact SHA-256 parity; all `31/31` canonical references also hash-match.
2. All `139/139` ordered storyboard references resolve with matching content/approval fingerprints, and all `43/43` storyboards have exactly one matching `scene-viewpoint` primary. Shots 23–24 keep `悦来客栈斗室/inn-room-window-axis` primary with `金水塾馆` as `secondary-scene`.
3. Non-generating pilot/full dry-runs pass with `assetApprovalSummary` approved `9/9` and `31/31`, `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`. The live visual preflight correctly fails closed at `approved=0,pending=43,rejected=0,stale=43`; no paid provider request was made.
4. Fresh quality gates pass: typecheck, lint, full Vitest (`331` files passed, `1` skipped; `1371` passed, `3` skipped), Python continuity suite (`21/21`), FFmpeg/timeline and continuity focused tests (`80/80`), plus OpenCut editing boundary tests (`24/24`).
5. Fresh release handoff passes: `build:mac`, packaged smoke, overwrite install, and installed smoke. Packaged/installed `app.asar` SHA-256 is `57c7504961fdfa77a8ef393de3385efc085e10b365ad10c8530dd20d45648b2c`; screenshot capture timed out but DOM fallback reported `whiteRatio=0.000`.

Remaining gate: the current 43 storyboard images are still `visualReview.status=pending` and `stale=true`. There is no safe non-paid path to satisfy AC6/AC7; a separately explicit paid 6–12 pilot/43-shot regeneration authorization is required, followed by serial generation and human approval of all 43 storyboards before final MP4 promotion.

## Batch 25: 2026-07-17 continuation deep audit and smoke retry

1. Fresh live-store verification confirms `31/31` human-approved continuity assets, `55/55` valid strict transfer thumbnails, `139/139` ordered references with matching fingerprints, and `43/43` unique primary scenes; the live storyboard rows contain all continuity metadata and remain `visualReview.status=pending` with top-level `stale=true`.
2. Fresh pilot/full dry-runs remain non-mutating: pilot `6–12` reports `approved=9,pending=0`, full chapter reports `approved=31,pending=0`, both `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`. Provider probe reports HTTP 200 with `generationEndpointCalled=false`; no paid request was sent.
3. Direct visual preflight and background `--auto-video` smoke both fail closed as designed: `approved=0,pending=43,rejected=0,stale=43`, `terminalStage=failed`, `finalPath=""`, `foregroundViolation=false`, with 88 continuity issues and no final MP4.
4. Fresh quality verification passes typecheck, lint, full Vitest (`331` files passed, `1` skipped; `1371` passed, `3` skipped), Python continuity (`21/21`), FFmpeg/timeline integration (`10/10`), and Daojie editing timeline tests (`2/2`). Scope review found no edits to large-file-refactor production targets or OpenCut editing-core files; only shared regression-test surfaces overlap.
5. The first packaged-smoke retry timed out in `Runtime.evaluate`; a second retry on debug port `9343` passed with DOM fallback (`whiteRatio=0.000`, four routes, workflow/asset/TTS/Python checks). The packaged app was overwritten into `/Applications/漫影工作室.app`; packaged/installed `app.asar` SHA-256 remains `57c7504961fdfa77a8ef393de3385efc085e10b365ad10c8530dd20d45648b2c`.

The remaining media gates are paid storyboard regeneration followed by 43-shot human visual approval and final MP4 promotion; AC1's portable Toonflow golden-image pixel comparison is also explicitly deferred because its source paths are not stable. No automatic retry or cross-task source edit was performed.

## Batch 26: 2026-07-17 task-ID recovery audit

1. Inspected every durable continuity/pilot/provider report and the generation helper's async contract. The prior ambiguous pilot POST persisted no `taskId`, `task_id`, request ID, output URL, or result artifact; the failure was a transport-level `fetch failed`, so no provider task can be polled or recovered without a new request.
2. Current live audit remains `31/31` human-approved assets, `43/43` pending/stale storyboards, `139` ordered references, and `43/43` unique primary scenes. The full-video report remains `failureStage=visual-continuity-preflight` with no final path; background auto-video remains `terminalStage=failed` with empty `finalPath` and no generation call.
3. Packaged and installed `app.asar` hashes were re-read directly and remain identical at `57c7504961fdfa77a8ef393de3385efc085e10b365ad10c8530dd20d45648b2c`.

Conclusion: task-ID recovery is unavailable. The next paid call is still blocked behind explicit operator authorization, and the portable Toonflow golden-image comparison remains deferred; no hidden recovery path or cross-task edit was used.

## Batch 27: 2026-07-17 continuation deep audit and conflict-safe verification

1. Re-read the live project store after the operator's confirmation: `31/31` continuity assets are `approved=true`, `reviewStatus=approved`, and reviewer `human`; all `43/43` storyboards have continuity state, `139/139` ordered references, and one aligned `scene-viewpoint` primary, while `43/43` remain `visualReview.status=pending` and `stale=true`.
2. Re-ran the non-generating provider probe from `apps/`: one `mikoto / gpt-image-2` provider/key, `/v1/models` HTTP 200, `generationEndpointCalled=false`, `generatedImages=0`. The canonical `npm run video:daojie:chapter001` invocation now reaches the intended visual preflight and fails closed with `approved=0,pending=43,rejected=0,stale=43`; no generator, TTS, timeline, or paid image request ran.
3. Fresh quality verification passes: full Vitest `331` files / `1371` tests with `3` timeline-runtime skips by default; typecheck; lint; Python continuity suite `28 passed`; real FFmpeg timeline integration `3/3`. The current source snapshot still has no real pilot images or final v5 MP4.
4. Scope audit found direct/shared overlap with the active large-file, background-smoke, and workflow-validation tasks (`image-generator.ts`, `visual-continuity.ts`, `build-scripts.test.ts`, `automate-daojie-chapter001-video.mjs`, and `electron/main.ts`). No edits were made to those shared files, no git/worktree operation was run, and no destructive or paid action was taken.

Open gate: the remaining 6–12 pilot requires a new explicit paid-generation authorization; after serial generation and human shot approvals, rerun the real video, then perform the final deep audit and build/install handoff.

## Batch 28: 2026-07-17 authorized pilot recovery without duplicate requests

1. Reconciled the paid evidence before any new request: the three renewed Bible calls are the distinct `old-laborer-turnaround-r4`, `girl-turnaround-r2`, and `young-laborer-turnaround-r2` reports; none is a 6–12 storyboard pilot call.
2. Found the existing non-overwriting pilot directory `apps/output/automation/daojie-chapter001-continuity-pilot-20260717073846`. Its durable report is `awaiting-human-approval` with `awaitingApprovalShot=6`, `processedImages=1`, `generatedImages=1`, `reusedImages=0`, and `mutatedProductionProject=false`; provider is the single `mikoto / gpt-image-2` binding.
3. `shot-006_thumb.png` is the only generated pilot transfer artifact: `768x432`, `267155` bytes, SHA-256 `4fdd91251ab925046e854064d272b713e8faa045a9521e389b7920959ae2255a`. No new provider request was made while recovering this evidence.

Current gate: do not create another pilot directory or resend shot 006. After explicit human approval of the existing shot-006 thumbnail, resume the same report with `--approve-shot 6 --human-confirmed`, then continue serially to shot 007.

## Batch 29: 2026-07-17 shot-007 provenance quarantine

1. Read-only inspection found the formal pilot directory now contains `shot-006` and `shot-007`, with `report.json` at `status=awaiting-human-approval`, `awaitingApprovalShot=7`, `processedImages=2`, `generatedImages=2`, and `reusedImages=0`.
2. The diagnostic copy `/tmp/mystudio-pilot-debug.I9nzA9/` contains byte-identical `shot-006` and `shot-007` files, but its report entries incorrectly point back to the formal pilot absolute paths. The formal and diagnostic `shot-007.png` SHA-256 are both `ee3e0ecd473a2695915fb4dd37caaa7b41a93d1c4f61dcefc67381d6262562c7`; both `shot-007_thumb.png` SHA-256 are `235c1937ec2ad098477c786779337973a04c6e60f699b1fb9569e0d97a5c5992`.
3. Because the report has no provider task ID, request ID, or immutable paid-call evidence, and the diagnostic report is path-contaminated, `shot-007` is quarantined as unverified evidence. It must not be human-approved, used as the previous-frame reference, or counted toward the 7-shot paid pilot.
4. Preserve all formal and diagnostic files. Do not resend shot 006 or create a new pilot directory. Before any paid request, add a provenance-safe continuation/recovery step that either recovers a provider task ID or requires explicit authorization for exactly one new shot-007 request; any ambiguity stops the remaining pilot calls.

Validation: formal/diagnostic SHA comparison, report-path ancestry check, and image thumbnail hard gate were run read-only. No provider generation endpoint was called in this audit.

## Batch 30: 2026-07-17 formal shot-007 evidence accepted without resend

1. Rechecked the formal report independently: every output and transfer thumbnail is inside the formal pilot directory; output SHA-256 and thumbnail SHA/byte metadata match; both thumbnails are valid PNG and strictly below 1,000,000 bytes.
2. The formal `shot-007` file and report were written at the same timestamp, while the `/tmp` diagnostic copy was created later and reused the formal absolute paths. The diagnostic copy is not used as evidence and does not trigger another provider request.
3. Human review may therefore proceed against the formal `shot-007_thumb.png`; no regeneration or duplicate paid call is needed for shots 006–007.

## Batch 31: 2026-07-17 shot-008 visual rejection and paid stop

1. After the existing 006–007 approvals, exactly one serialized provider request generated formal `shot-008`; the pilot report records `generatedImages=3`, `reusedImages=0`, and a valid `768x432 / 264106 bytes` transfer thumbnail.
2. Visual review against the approved Bible rejects shot 008: the dock axis, cold mist, adult/child blocking, and bare-foot ragged child are readable, but 赵四's canonical `dock-overseer` reference is a grey-white worn overseer outfit while the generated adult is rendered in a near-black robe. This is a wardrobe-version continuity failure.
3. Shot 008 remains unapproved and cannot be used as a previous-frame reference for shot 009. No automatic reject write or paid retry was issued; the run stopped before any further provider request.

Next gate: obtain explicit authorization for one non-overwriting shot-008 retry only; if authorized, restart from 008 and re-review before continuing serially.

## Batch 32: 2026-07-17 authorized shot-008 retry exhausted

1. The user authorized exactly one non-overwriting retry of shot 008. Before the request, the formal report and human-approval ledger were backed up.
2. The retry produced `shot-008-r02.png` and `shot-008-r02_thumb.png`; the pilot remains `status=awaiting-human-approval`, `processedImages=3`, `generatedImages=3`, `reusedImages=0`, and `mutatedProductionProject=false`. The new thumbnail is `768x432`, `274710` bytes, SHA-256 `a4b79b9323a432d26349da19eafd7deed859be8b7ff71c175649779cb07a347a`.
3. Visual review still rejects shot 008: scene/action/child blocking are readable, but 赵四 remains in a near-black robe instead of the approved grey-white `dock-overseer` wardrobe. Neither the superseded shot 008 nor `shot-008-r02` is approved; no third request is allowed under the current authorization.

Current gate: pilot is safely paused at shot 008. Continuing to 009–012 requires a new approved shot-008 visual result and therefore a new explicit retry/model decision; no automatic paid retry or fallback is permitted.

## Batch 33: 2026-07-17 wardrobe prompt hardening without new paid calls

1. Root-cause review of both failed 008 outputs found the approved `dock-overseer` asset had no explicit color lock in its runtime prompt: the canonical asset showed grey-white clothing, but the prompt only carried the opaque wardrobe version and generic negative constraints.
2. Added a runtime-only `dock-overseer` wardrobe hard lock in `Library/build_daojie_chapter001_workflow.py`: require grey-white worn overseer robe/grey sash/coarse-cloth layers and prohibit near-black/full-black martial robes. This does not rewrite the approved Bible store or invalidate the 31 asset approvals.
3. Added a focused regression in `apps/frontend/config/build-scripts.test.ts`; the selected prompt/manifest suite passes `4/4`.

No image provider request was made for this hardening change. The paid pilot remains paused at the rejected `shot-008-r02`.

## Batch 34: 2026-07-17 installed release revalidation without paid generation

1. Ran `npm run smoke:installed` from `apps/`; the packaged app was overwritten into `/Applications/漫影工作室.app` with no backup app created.
2. Packaged and installed `app.asar` SHA-256 both equal `0b95eb51b508bc5fe9677f5445f625e5107b55714d22907af8adf1b2ddb38884`.
3. Installed smoke passed: four routes, workflow E2E, asset/voice flow, script/asset-generation/voice flow, Python settings, and `whiteRatio=0.000`. Screenshot capture timed out and the runner correctly used DOM visual fallback; exit code was 0.
4. The pilot report remains `awaiting-human-approval` with `processedImages=3`, `generatedImages=3`, `reusedImages=0`, `approvedShots=[6,7]`, `awaitingApprovalShot=8`, and `mutatedProductionProject=false`. No image provider request was made in this batch, and shot 008 was not retried again.

Release/install is closed for the current source snapshot. The visual task remains in progress because `shot-008-r02` is rejected; 009–012, full 43-shot generation, auto-video, and final MP4 promotion remain blocked until a separately authorized/model-changed 008 result is human-approved.

## Batch 35: 2026-07-17 single shot-008 rerun closure

1. Re-read the formal pilot report after the authorized retry. It remains `status=awaiting-human-approval`, `processedImages=3`, `generatedImages=3`, `reusedImages=0`, `approvedShots=[6,7]`, `awaitingApprovalShot=8`, and `mutatedProductionProject=false`.
2. The one authorized shot-008 retry is already consumed by `shot-008-r02`; its transfer thumbnail is `768x432`, `274710` bytes, SHA-256 `a4b79b9323a432d26349da19eafd7deed859be8b7ff71c175649779cb07a347a`. Visual review still rejects the near-black 赵四 wardrobe against the approved grey-white `dock-overseer` Bible. No third request, automatic approval, or fallback image was performed.
3. The read-only hard-lock dry-run confirms the new grey-white wardrobe constraints are present in the generated prompt while keeping `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`; the hardening change therefore did not incur another provider charge.

Current gate: remain paused at shot 008. Do not continue to shots 009–012, full 43-shot generation, auto-video, or final MP4 promotion without a separately authorized/model-changed shot-008 result that passes human visual review.

## Batch 36: 2026-07-17 real background auto-video gate recheck

1. Re-ran the canonical `MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS=120000 npm run smoke:workflow:background:daojie -- --auto-video` from `apps/`. The packaged UI workflow reached all six stages, the click was observed, and the run terminated without foreground violation or timeout.
2. The runner correctly failed closed at the visual gate with `88` continuity issues; `chapterAutoVideo.terminalStage=failed`, `finalPath=""`, `finalVideoEvidence=null`, and `runtimeProblems=[]`. No image generation, TTS, timeline render, or paid provider request ran.
3. The direct durable report records `failureStage=visual-continuity-preflight` with `approved=0,pending=43,rejected=0,stale=43`. This confirms the remaining blocker is the intended storyboard approval gate, not the previously suspected repository-path startup failure.

Validation: packaged background workflow smoke completed and wrote `apps/output/automation/background-workflow-daojie-report.json`; the task remains `in_progress` until the 43 storyboard images are genuinely generated and human-approved.

## Batch 37: 2026-07-17 current-source package/install revalidation

1. `npm run build:mac` completed successfully and rebuilt the arm64 packaged app from the current source snapshot.
2. Packaged desktop smoke passed all four routes, workflow E2E, asset/voice flow, script/asset-generation/voice flow, Python settings, and DOM visual fallback `whiteRatio=0.000` (screenshot capture timed out without a white-screen failure).
3. `npm run smoke:installed` overwrote `/Applications/漫影工作室.app`, verified packaged/installed `app.asar` SHA-256 parity as `e331a33b23955081250765be72dd0e3db2ce4ba1a0fec287c13ccd9fbceb7066`, and installed smoke passed with the same DOM fallback.

Release/install is current and healthy; it does not close the visual-media gate. The pilot remains paused at the already-consumed single 008 retry.

## Batch 38: 2026-07-17 provider configuration probe without generation

1. `npm run video:daojie:chapter001:probe-providers` passed in `provider-models-only` mode with exactly one configured `mikoto / gpt-image-2` provider/key and `/v1/models` HTTP `200` (`18` models).
2. The durable probe records `generatedImages=0` and `generationEndpointCalled=false`; this was configuration-only and incurred no image-generation request.

The provider is reachable, but the paid generation gate remains intentionally closed until a separately authorized replacement for the rejected shot-008-r02 is available.

## Batch 39: 2026-07-17 portable Toonflow golden fixture closure without paid generation

1. Corrected the Toonflow path audit: the database stores image paths relative to the read-only `data/oss/` root, not directly under `data/`. All 43 storyboard images and all 132 ordered reference links resolve from that source.
2. Added `Library/ai/build_toonflow_portable_fixture.py`, which copies only content-addressed evidence into the task research directory, records fixed `assetId/imageId/sourcePath` order, and verifies both file SHA-256 and decoded RGBA pixel SHA-256. The durable fixture reports `storyboardCount=43`, `goldenImageCount=43`, `referenceCount=132`, `missingImageCount=0`, and `goldenPixelSha256Verified=true`.
3. Added an idempotence/integrity unit test and a frontend parity regression for verified golden metadata. Focused Vitest (`4/4`), Python fixture test (`1/1`), typecheck, and lint pass. No production project file, old image, MP4, or provider endpoint was modified or called.

Evidence: `.trellis/tasks/07-12-mystudio-chapter001-visual-continuity/research/toonflow-chapter001-portable-fixture.json`. AC1 is now closed; AC5–AC7 remain gated by the already-consumed, rejected shot-008 retry.

## Batch 40: 2026-07-17 portable fixture path contract

1. Hardened `Library/ai/build_toonflow_portable_fixture.py` so `fixtureRoot` is serialized relative to the manifest and `verify_fixture()` resolves it from the manifest parent instead of the caller's current working directory.
2. Added a regression assertion in `Library/ai/test_toonflow_portable_fixture.py`; regenerated the task-local manifest with `fixtureRoot=toonflow-chapter001-portable-fixture`.
3. Fresh verification reports `storyboardCount=43`, `goldenImageCount=43`, `referenceCount=132`, `missingImageCount=0`, `goldenPixelSha256Verified=true`, and `contentAddressed=true`; verification also passes from `/tmp` using the absolute manifest path.

No image provider request was made. The visual pilot remains paused at the already-consumed rejected `shot-008-r02`.

## Batch 41: 2026-07-17 fresh quality and release closure

1. Trellis `task.py validate` passes for both `07-12-mystudio-chapter001-visual-continuity` and dependent `07-14-workflow-integration-validation`.
2. Fresh quality gates pass: focused Vitest `6 files / 129 tests`, full Vitest `333 passed / 1 skipped` with `1382 passed / 3 skipped`, Python continuity suite `29 passed`, typecheck, lint, and real FFmpeg timeline integration `3/3`.
3. Fresh provider probe remains configuration-only: one `mikoto / gpt-image-2`, `/v1/models` HTTP `200`, `generatedImages=0`, `generationEndpointCalled=false`. Pilot and full-chapter dry-runs both report `generatedImages=0`, `reusedImages=0` without mutating production.
4. Fresh canonical `npm run video:daojie:chapter001` exits `1` at `visual-continuity-preflight` with `approved=0,pending=43,rejected=0,stale=43`; no generator, TTS, timeline, MP4, or paid request ran.
5. Current-source release chain passes: `build:mac`, packaged `smoke:desktop`, overwrite install, and `smoke:installed`; packaged and installed `app.asar` SHA-256 both equal `2a699441df89a1522db0b169ab2dd71a6d2f28472a9acd7638b55d5b24f4dc47`. Background real Daojie auto-video also fails closed at the intended visual gate with 88 issues, `terminalStage=failed`, `finalPath=""`, `foregroundViolation=false`.

The task remains `in_progress`: AC5–AC7 still require a valid replacement for rejected `shot-008-r02`, serial human approval of all 43 storyboard images, then real auto-video and final timeline MP4 evidence.

## Batch 42: 2026-07-17 rerun-cause and transfer-path audit

1. Reconciled the formal pilot and its pre-retry backup: the paid storyboard POSTs were exactly four—shots 006, 007, 008, and the one explicitly authorized 008 retry (`shot-008-r02`). The report's `generatedImages=3` is the count of active unique shot entries after the retry replaced 008; it is not a paid-request counter. No third 008 request exists.
2. The repeated non-paid commands were dry-runs, provider-model probes, visual preflight, background auto-video, and package/install smoke. Fresh reports show `generatedImages=0`, `generationEndpointCalled=false` for probes/dry-runs, and direct/background video stop at `approved=0,pending=43,rejected=0,stale=43` before generator/TTS/timeline.
3. Both paid 008 outputs fail the same visual contract: 赵四 is rendered in a near-black robe while approved `dock-overseer` requires grey-white worn overseer clothing. Runtime prompt hardening now adds an explicit grey-white/grey-sash lock and black-robe negatives; the hard-lock dry-run passes with `generatedImages=0` and no provider call, but the already-authorized retry remains rejected.
4. Current pilot thumbnails are transfer-safe: 006 `768x432/267155 bytes`, 007 `768x432/262703 bytes`, and 008-r02 `768x432/274710 bytes`; all are strict `<1,000,000` bytes. Focused image-transfer/worker/generation-path regressions pass `36/36`. The current real continuity manifest uses absolute Bible paths, so no `local-image://` path entered the Python pilot.

Current gate: no automatic or further paid retry is permitted. A new 008 image requires a new explicit authorization/model decision, after which it must pass human review before shots 009–012 or the 43-shot chapter can continue.

## Batch 43: 2026-07-18 paid-retry confirmation hard gate

1. Root-cause follow-up found that `--restart-from-shot` was a paid operation but had no separate command-line confirmation, so a mistaken recovery command could issue another provider request.
2. `Library/generate_chapter001_continuity_sample.py` now requires `--confirm-paid-retry` whenever `--restart-from-shot` is used, and rejects the confirmation flag by itself before loading provider state.
3. `apps/build/automate-daojie-chapter001-video.mjs` forwards the confirmation only when `MYSTUDIO_CONTINUITY_CONFIRM_PAID_RETRY=1`; setting a restart environment variable alone now fails closed before the provider call.

Validation: `python3 -m unittest Library.ai.test_continuity_pilot_attempt_ledger` (`3/3`) and `npm test -- frontend/config/build-scripts.test.ts` (`69/69`) pass. No provider request was made; the formal pilot remains paused at rejected `shot-008-r02`.

## Batch 44: 2026-07-18 independent shot-008 evidence recheck

1. Reopened the standalone `shot-008-r02_thumb.png` transfer artifact, which is `768x432` and `274710` bytes.
2. The image independently confirms the prior rejection: 赵四's robe is rendered near-black across the torso and sleeves, while the approved `dock-overseer` contract requires visible grey-white clothing; the child/boat/dock blocking does not override this wardrobe failure.
3. No approval write, image mutation, or provider request was made.

Current gate is unchanged: a newly authorized/model-changed 008 result must pass human review before the serial pilot can advance.

## Batch 45: 2026-07-17 Mikoto async transport wiring closure without paid generation

1. Root cause was isolated to transport wiring, not an absent Mikoto API: the Node helper already supported `POST /v1/images/generations/async` plus `GET /v1/images/tasks/{task_id}`, but the formal continuity-pilot child process did not force `MYSTUDIO_IMAGE_ASYNC_MODE=1`; Python's non-GPT path also ignored `asyncMode` when building its endpoints.
2. Fixed `Library/build_daojie_chapter001_workflow.py` so non-GPT providers select `/v1/images/generations/async` and `/v1/images/tasks/{task_id}` when `asyncMode=true`, while preserving the synchronous endpoints when false. The formal pilot wrapper now passes `MYSTUDIO_IMAGE_ASYNC_MODE=1` for both pilot and full-chapter runs.
3. Pilot reports now record top-level/provider `asyncMode` and `generationEndpointCalled`; a fresh 6–12 dry-run with an intentionally false provider flag plus the forced environment reports `asyncMode=true`, `generationEndpointCalled=false`, `generatedImages=0`, `reusedImages=0`, `generationAttemptCount=0`, and no provider request.
4. Fresh provider-model probe remains non-generating: one `mikoto / gpt-image-2` provider/key, `/v1/models` HTTP `200`, `18` models, `generatedImages=0`, `generationEndpointCalled=false`.
5. Regression coverage passes: Python approved-reuse/transport/attempt-ledger tests `7/7`; `npm test -- frontend/config/build-scripts.test.ts` `69/69`; Python compile and Node syntax checks pass.

The paid pilot is still intentionally paused at the already-consumed rejected `shot-008-r02`; this batch did not issue any image-generation request or authorize a new retry.

## Batch 46: 2026-07-17 zero-cost continuity-pilot dry-run gate and release refresh

1. Added `MYSTUDIO_CONTINUITY_PILOT_DRY_RUN=1` handling to the Node pilot wrapper. In this mode it passes `--dry-run` and hard-fails unless the report proves `dryRun=true`, `asyncMode=true`, `generationEndpointCalled=false`, `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`.
2. Ran the wrapper dry-run against the real configured `mikoto / gpt-image-2` provider. It completed with zero generated/reused images and the required async/no-network assertions; no image-generation POST was issued.
3. Refreshed release validation after the wrapper change: typecheck, lint, full Vitest (`333` files passed, `1` skipped; `1383` tests passed, `3` skipped), `build:mac`, packaged smoke, overwrite install, and installed smoke all passed. Packaged and installed `app.asar` SHA-256 both equal `105786d2a734c9229250f762a3e7edcb7bfd513d74a8a4c403022d07a6f5b628`.

The authoritative production store remains `43/43` storyboard reviews pending/stale, and the formal pilot remains paused at rejected `shot-008-r02`; no new paid generation or approval write occurred in this batch.

## Batch 47: 2026-07-17 real auto-video gate recheck after async/dry-run release

1. Fresh `MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS=120000 npm run smoke:workflow:background:daojie -- --auto-video` loaded the real `chapter-001` clone and completed all six workflow stages with `foregroundViolation=false`, `timedOut=false`, and no runtime problems.
2. The one-click action correctly failed closed at the visual gate: `terminalStage=failed`, `finalPath=""`, `finalVideoEvidence=null`, with `43/43` storyboard reviews still pending/stale. No image-generation POST, TTS generation, timeline render, or MP4 promotion occurred.
3. The installed app used for this check is the refreshed build with packaged/installed `app.asar` SHA-256 `105786d2a734c9229250f762a3e7edcb7bfd513d74a8a4c403022d07a6f5b628`.

The remaining transition is external and paid: one newly authorized/model-changed shot-008 generation, human approval of its safe thumbnail, then serial 009–012 and the six-group 43-shot run. No authorization is inferred from this recheck.

## Batch 48: 2026-07-17 cross-output paid-request ledger and break-loop closure

1. Added `apps/build/paid-image-request-ledger.mjs`, an append-only ledger with canonical request hashing. It records logical job/shot, provider host, model, async endpoint, prompt/reference/payload SHA-256 values, task ID, status, and redacted error type.
2. Updated `apps/build/generate-storyboard-image.mjs` to prepare transfer thumbnails before hashing, write `POST_SENT` before network I/O, stop duplicate fingerprints before a second POST, and stop provider/key fallback for ambiguous outcomes. Ledger-backed calls require explicit authorization, exact single-provider/single-key configuration, and `singleAttempt=true`.
3. Updated `Library/generate_chapter001_continuity_sample.py` to require `--confirm-paid-request` for every non-dry-run paid call, pass logical attempt metadata, and project ledger request evidence into per-output attempts and reports. Existing images and old reports were not rewritten.
4. Updated `apps/build/automate-daojie-chapter001-video.mjs` to forward paid authorization only when explicitly set in the environment; the default path remains non-generating.
5. Added mock regressions proving one completed fingerprint produces exactly one POST across a second attempt and that missing authorization produces zero provider requests. Focused build-script tests pass `71/71`; Python compile and Node syntax checks pass. No generation endpoint was called.
6. Added the root-cause report `research/paid-retry-root-cause-20260717.md` and the paid-image boundary section to `.trellis/spec/guides/cross-layer-thinking-guide.md`.

Current gate: the rejected `shot-008-r02` remains immutable; no new paid request is permitted without a fresh user authorization and a changed visual/model decision. All subsequent dry-run, probe, preflight, package, and install checks remain the only safe next actions.

## Batch 49: 2026-07-17 async response-shape regression closure

1. A zero-network mock of the Python non-GPT adapter exposed a second transport-layer gap: Mikoto's documented poll response stores the final image under `result.data`, while the adapter only inspected top-level `data`; a successful task could therefore be misreported as a timeout and prompt an unnecessary retry.
2. Updated `Library/build_daojie_chapter001_workflow.py` to accept the documented nested `result.data` response without changing the synchronous contract or any provider configuration.
3. Added a regression proving the non-GPT async path uses exactly `POST /v1/images/generations/async` followed by `GET /v1/images/tasks/{task_id}` and resolves the nested result without network I/O.

Validation: `python3 -m unittest Library.ai.test_continuity_pilot_attempt_ledger Library.ai.test_chapter001_approved_storyboard_reuse` passes `9/9`. No paid endpoint was called; the formal pilot remains paused at the already-consumed, visually rejected `shot-008-r02`.

## Batch 50: 2026-07-17 no-cost quality and installed-release revalidation

1. Focused Python continuity regressions pass `14/14`; focused build-script Vitest passes `71/71`; full Vitest passes `334` files with `1392` passed and `3` skipped; typecheck, lint, Python compile, and Node syntax checks pass.
2. The wrapper dry-run reports `asyncMode=true`, `generationEndpointCalled=false`, `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`. The provider-model probe reports one `mikoto / gpt-image-2` provider/key and `/v1/models` HTTP `200`, with no generation endpoint call.
3. The canonical video command still stops before generator/TTS/timeline at `approved=0,pending=43,rejected=0,stale=43`; this is the intended visual gate, not a paid transport retry.
4. Rebuilt and installed the current source. Packaged and installed `app.asar` SHA-256 both equal `090dfdbacf351585c6258430acddb00ab9ef490edf62e1e9b6c1ad7288b5e79b`; packaged and installed smoke both exit `0`.

No continuity pilot, probe-generation, or image-generation endpoint was run in this batch. AC5–AC7 remain open because the formal pilot is still paused at the rejected `shot-008-r02`.

## Batch 51: planned MA ImageGen prompt-contract alignment (not started)

1. Snapshot the current 43 prompts and the 006–009 pilot report without changing images, approvals, or paid ledgers. Replace the global storyboard/derived style locks with one `daojie-gongbi-v2` contract: line-first gongbi structure, mineral-wash color budget, flat paper illumination, clean finish, concise scene-specific modules, and full-clothing hard lock. Remove the Node helper's positive `dirty texture` suffix.
2. Revise the chapter Bible source facts that currently specify ragged child clothing and gray-only scene palettes. Produce new versioned source plans only; do not rewrite the 31 approved asset records or their reference images. New Bible versions require their own human review before use.
3. Add a role-aware style-reference contract. Capability data must declare reference order and maximum image count. With no declared capacity, the request fails closed rather than adding a ninth image or dropping a canonical reference. Any live reference-capability probe remains a separately authorized paid action.
4. Extend the 43-shot prompt audit and request tests to reject SD weight syntax, global indoor props in exterior shots, `dirty texture`, ragged-clothing language, monochrome/gray-blue-only palettes, missing v2 clauses, and missing style-reference provenance when enabled. Test that contract changes invalidate old pilot reuse without altering old evidence.
5. Add a post-output adapter for `$ma-imagegen/scripts/daojie_gongbi_restyle.py audit-color`; fail on a chromatic ratio outside 0.30–0.70 and retain its JSON report for human review. Add an explicit linework/clothing/cleanliness/watermark checklist to the per-shot review record.
6. Run Python/Vitest/typecheck/lint plus a no-network 43-shot dry-run. Present the generated v2 prompts and capability report for review. Only after explicit approval may a new, serialized, non-overwriting pilot restart at the first v2-affected shot; 006–009 remain historical evidence and must not bridge to 010.

## Batch 52: 2026-07-19 Daojie Gongbi V2 prompt-contract alignment

1. Implemented the local `daojie-gongbi-v2` contract, source provenance, style fingerprint, fail-closed provider/reference-capability manifest, per-output 30%-70% color audit, and seven-field human-review checklist. The `2d_gongbi` preset keeps its stable ID while using GPT-safe line-first gongbi wording and negative-only dirty-texture constraints.
2. Kept all existing Bible records, images, approvals, ledgers, and pilot reports immutable. V2 Bible source plans use `artDirectionVersion=daojie-gongbi-v2` and intact humble workwear; the request render boundary also converts legacy hardship wording in visual facts, continuity state, wardrobe keys, negative constraints, and character-anchor text without mutating its source record.
3. Fixed the final full-chapter audit gap: a legacy `identityAnchors.uniqueMarks` value containing `褴褛短褐与破旧裤装` now renders as `朴素完整短褐与完整旧式裤装`. Added a regression covering the complete request prompt and V2 audit. Also aligned TypeScript and Python continuity fingerprints by retaining `styleReferenceSha256: null` when no style reference is present.
4. Fresh no-network full-chapter dry-run evidence: `research/daojie-gongbi-v2-43-shot-dry-run-20260719-r05/report.json`. It records `43` entries, `0` V2 prompt-audit failures, `0` legacy ragged/dirty prompt terms, `generationEndpointCalled=false`, `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false`. The capability report is correctly `blocked`: provider `no-network-unconfigured/unconfigured` has no exact verified reference-capacity record, so all `43` requests are refused before image transfer.
5. Fresh validation passes: Python V2/continuity suites `32/32`; standalone Node V2 helper suite `3/3`; full Vitest `357` files / `1505` tests passed (`1` file skipped; `3` tests skipped; `1` todo); `npm run typecheck`; `npm run lint`; and Python compilation of the V2 workflow modules.

Human review is now required for the V2 prompt manifest, Bible source plans, and capability report. No provider capability is approved and no paid generation authorization is implied by this implementation. The V2 pilot remains blocked before shot 001; historical 006–009 evidence cannot be promoted or reused as V2 evidence.

## Batch 53: 2026-07-20 V2 fresh no-network recheck

1. Fresh direct visual preflight against the live store remains fail-closed: `approved=0`, `pending=43`, `rejected=0`, `stale=43`; it reads the store only and did not enter image, TTS, or video stages.
2. Generated a new non-overwriting V2 full-chapter dry-run report at `research/daojie-gongbi-v2-43-shot-dry-run-20260720-r06/report.json`. It has 43 entries, one V2 contract fingerprint, zero V2 prompt-audit failures, zero unsafe terms in final prompts, `generationEndpointCalled=false`, `generatedImages=0`, `generationAttemptCount=0`, and `mutatedProductionProject=false`.
3. The capability report blocks all 43 shots before image transfer because `no-network-unconfigured/unconfigured` has no exact verified provider/model multi-reference capacity record. Python V2 plus paid-attempt-gate regressions pass `18/18`; V2 modules compile; focused Node V2/preflight regressions pass `7/7`.

Open gate: human review of the V2 manifest/Bible/capability contract remains required. After that review, a live provider capability record and separately explicit paid authorization for a new serialized pilot starting at V2 shot 001 are still required; no historic pilot approval can satisfy either gate.

## Batch 54: 2026-07-20 operator V2 approval and shot-001 authorization

1. The operator approved the V2 manifest, Bible projection, and capability contract, explicitly accepting the current fail-closed capability state. This approves the local contract only; it does not manufacture provider capacity evidence or promote historical pilot output.
2. The operator authorizes exactly one non-overwriting, serialized paid generation request for V2 shot 001 after an exact provider/model multi-reference capability record is verified. No retry, fallback, later shot, previous-frame reuse, or production-store promotion is authorized by this decision.

## Batch 55: 2026-07-20 V2 shot-001 authorized-pilot terminal evidence

1. The first local submission attempt stopped at the Node authorization boundary before any provider POST because the V2 request-config snapshot was created before `singleAttempt`, `attemptId`, `logicalJob`, and `logicalShot` were attached. Its nonempty output directory and `failed-or-ambiguous` local attempt record are preserved; the append-only paid ledger has no event for that directory.
2. Fixed `Library/generate_chapter001_continuity_sample.py` to derive the final V2 request configuration after those immutable attempt fields are attached. Added a no-network regression that exercises the selected-shot path with a mocked output and verifies that the GPT request receives explicit authorization plus all four attempt fields. Focused Python suites pass `19/19`; Python compile, Node syntax, focused V2 Node tests, typecheck, and lint pass.
3. The second, new-directory invocation consumed the single authorized request for V2 shot 001. The paid ledger records one `POST_SENT -> TASK_ACCEPTED -> COMPLETED` chain for `mikoto / gpt-image-2` at `/v1/images/generations/async`, task `img_ccecfc6575ec5c2bbf34b85348946c2d`, with the approved V2 contract fingerprint and ordered roles `scene-viewpoint, prop-state, prop-state`.
4. The returned PNG is preserved at `apps/output/automation/daojie-chapter001-v2-pilot-shot001-20260720-a02/shot-001.png` (`1672x941`, SHA-256 `2dd674df9e362c4069b8463e99a8f03286613f73547f8afe3dd2768a892e27a0`). It is terminally unapproved: `shot-001.color-audit.json` reports `chromatic_pixel_ratio_high` at `0.7266`, outside the accepted `0.30-0.70` band. The runner therefore stopped before creating a review thumbnail or report, and no approval, production-store update, retry, or later-shot request occurred.

Current gate: the V2 001 request is consumed and fails the mandatory color gate. Any prompt/contract correction may be investigated without network, but a new image request requires a new explicit user authorization. It cannot advance to shot 002 or satisfy the 43-shot visual continuity gate.

## Batch 56: 2026-07-20 V2 scene-specific prompt alignment and no-network recheck

1. Expanded the local V2 story-fact renderer and positive-render audit to remove dark-corner, heavy-fog, glowing-text, wet-mirror, and ragged-clothing shortcuts while preserving the underlying scene action. The replacement table and audit pattern are now part of the V2 contract fingerprint, so prior r05-r08 prompt evidence cannot be reused as current V2 input.
2. Added a six-viewpoint light contract for the chapter's dock, inn hall, inn room, school, night-return room, and river axes. Prompt assembly now prefers `continuityState.sceneViewpointId` over legacy `sceneNo`, then falls back to the chapter's controlled group. This fixes the 41-42 inn-room-return prompts that previously inherited the stale school light line.
3. The non-overwriting Bible plan confirms 31 existing source records and 8 generation jobs at `research/chapter001-daojie-gongbi-v2-31-version-source-matrix-r1.json` and `research/chapter001-daojie-gongbi-v2-generation-prompts-r1.json`; no candidate image, approved asset, production store, ledger, or provider endpoint was touched.
4. Fresh full-chapter r09 evidence at `research/daojie-gongbi-v2-43-shot-dry-run-20260720-r09/report.json` records fingerprint `35cf0c6b11c4b008b911316e742117140fcbe828a6f73f2ccfad69c77a7c33e4`, 43/43 V2 prompt-audit passes, no old night/ragged terms, `generationEndpointCalled=false`, `generatedImages=0`, `generationAttemptCount=0`, and `mutatedProductionProject=false`. The capability report remains correctly blocked for all 43 shots because no exact provider/model reference-capacity record is available in the no-network configuration.
5. Focused Python regressions pass 20/20; Python compile, `npm run typecheck`, and `npm run lint` pass. Focused build-script Vitest remains 71/71 from this source snapshot.

Current gate: the V2 001 request remains consumed by the rejected color-gate output. The new V2 fingerprint and r09 manifest need human review before any new paid request. No authorization is implied for a 001 retry or shot 002.

## Batch 57: 2026-07-20 operator approval of r09 V2 manifest

1. The operator approved the r09 V2 prompt manifest, its non-overwriting Bible prompt plan/source matrix, and the current fail-closed reference-capability contract. The immutable review record is `research/daojie-gongbi-v2-r09-human-review.json`; it binds the three reviewed files by SHA-256 and records V2 fingerprint `35cf0c6b11c4b008b911316e742117140fcbe828a6f73f2ccfad69c77a7c33e4`.
2. This approval confirms the local art-direction contract only. The review evidence confirms 43/43 prompt-audit passes and an offline, non-mutating run. It does not approve a storyboard image, promote any Bible candidate, add provider capacity, add a style reference, or authorize a paid request.

Current gate: V2 shot 001 remains terminally unapproved because its only authorized request failed the color ratio gate. A new 001 generation requires a separate, explicit paid authorization after a current provider/model reference-capacity check; shot 002 remains unauthorized.

## Batch 58: 2026-07-20 renewed V2 shot-001 authorization boundary

1. The operator explicitly authorizes one new, serialized, non-overwriting paid V2 request for shot 001 only. The immutable scope record is `research/daojie-gongbi-v2-shot001-r02-paid-authorization.json`; it binds the current r09 fingerprint, three ordered references, `mikoto / gpt-image-2`, one key, and the async endpoint.
2. A current zero-cost provider-model probe returned HTTP `200` for exactly one `mikoto / gpt-image-2` provider/key with `generationEndpointCalled=false`. The authorization still requires a same-entry dry-run, exact reference-capability verification, and cross-output paid-ledger duplicate protection before the single POST.
3. This renewal does not authorize retry flags, another key/provider, style references, shot 002 or later, production-store writeback, or storyboard approval. Any transport ambiguity, missing task ID, output failure, or color-gate failure stops the run without another request.

## Batch 59: 2026-07-20 V2 shot-001 r02 single-request result awaiting human review

1. The authorized r02 V2 shot-001 request used the reviewed fingerprint `35cf0c6b11c4b008b911316e742117140fcbe828a6f73f2ccfad69c77a7c33e4`, one `mikoto / gpt-image-2` provider/key, the ordered roles `scene-viewpoint, prop-state, prop-state`, and `https://api.mikoto.vip/v1/images/generations/async`. The append-only ledger records exactly `POST_SENT -> TASK_ACCEPTED -> COMPLETED` for task `img_95128d217377437949f1dd8a817feda6`; no fallback, retry, later shot, or production-store write occurred.
2. The non-overwriting evidence directory is `research/daojie-gongbi-v2-shot001-pilot-20260720-r02/`. Its PNG is `1672x941`, SHA-256 `30d9e53e583fa37da425e52549164e01e09e8a55dac37fb10e2c418f5f0c45de`; the transfer thumbnail is `768x432 / 245744 bytes`, and the report records `generatedImages=1`, `reusedImages=0`, and `mutatedProductionProject=false`.
3. The mandatory V2 color report passes with `chromaticPixelRatio=0.3676` in the `0.30-0.70` band. The pilot is intentionally `awaiting-human-approval` for shot 001. No approval was written and shot 002 remains unauthorized until a human reviews linework, color balance, clothing integrity, cleanliness, continuity, text, and watermark.

## Batch 60: 2026-07-20 shot-001 visible-character correction and no-network recheck

1. Root cause of the human-rejected r02 output was confirmed in the live storyboard source: shot 001 lists only the dock, whip, and basket. Its former runtime continuity state therefore locked the image to zero people, even though the director plan requires Zhao Si's raised whip and the young laborer shielding their head. The existing `SAMPLE_SHOT_CONTINUITY` omitted shot 001.
2. Added an explicit shot-001 state for `监工赵四` (left-middle, raised whip) and `小杂役` (right-lower, shielding head), with `独孤剑尘不入画`. `ordered_continuity_asset_names` and `resolve_continuity_image_assets` now provide one ordered source of truth for both the full workflow and the paid pilot: dock, Zhao Si, young laborer, whip, basket. The three-view character expansion produces nine physical references, exactly matching the verified `mikoto / gpt-image-2` capacity.
3. Focused Python tests pass `16/16`; the focused build-script Vitest suite passes `71/71`; Python compilation passes. The fresh non-overwriting r03 dry-run at `research/daojie-gongbi-v2-shot001-person-correction-dry-run-20260720-r03/report.json` records two named visible characters, five logical ordered assets, nine physical reference roles, `requestAllowed=true`, `generationEndpointCalled=false`, `generatedImages=0`, `reusedImages=0`, and `mutatedProductionProject=false` for that dry-run.
4. Operational incident: an attempted `--help` against `build_daojie_chapter001_workflow.py` entered its no-argument main path and rewrote the live project store/script/entity JSON files at `05:55 +0800` through the local asset-composite path. The paid ledger was not modified after `05:39 +0800`, and no provider request was made. No verified pre-05:55 current snapshot exists locally; older backups are not safe restoration inputs. No rollback was applied.

Current gate: r02 remains rejected and immutable. The r03 contract corrects the semantic failure, but its five logical/nine physical references differ from the already-consumed r02 authorization. A new single, serialized, non-overwriting paid authorization for V2 shot 001 is required before any provider request; shot 002 remains unauthorized.

## Batch 61: 2026-07-20 storyboard-source semantic contract replaces static shot overrides

1. The operator rejected the `SAMPLE_SHOT_CONTINUITY` correction because a shot's cast, blocking, action, and references must be derived from its own storyboard content, never from a shot-number table, scene-wide cast, or referenced props. The static overrides and the default guessed continuity state were removed.
2. The storyboard-table Agent contract now requires a per-row `出镜语义JSON` object. It records `personFree`, ordered `visibleCharacters` with name/position/orientation/actionIn/actionOut, plus whole-frame actionIn/actionOut. `personFree:true` is the only valid zero-person declaration. The TypeScript table parser validates this structured field, and the new Agent-write path rejects any row missing it before saving; the Python production parser consumes the same 15-column/8-column extension.
3. The image reference resolver now uses only the source-declared scene, visible semantic characters, and linked non-character assets. A visible character must resolve to the current asset catalog and be present in the source row/segment's asset references. Missing semantics, ambiguous zero-cast data, unknown roles, or unlinked roles fail before any image request. Segment-level references may contain other cast members, but they are never injected as image references unless declared visible by that row.
4. Current live `storyboardTable` remains the old 14-column source. A read-only import check now stops at `分镜 001 缺少出镜语义JSON；必须重新生成含逐镜人物、站位、朝向与动作承接的分镜表`. No project store, approval, image, paid ledger, provider endpoint, or historical pilot evidence was changed. The r03 hardcoded dry-run is non-authoritative.

Validation: `python3 -m unittest Library.ai.test_chapter001_approved_storyboard_reuse Library.ai.test_continuity_pilot_attempt_ledger Library.ai.test_daojie_gongbi_v2` (`31/31`), `npm test -- --run frontend/lib/studio/storyboard-table.test.ts` (`15/15`), `npm test -- --run frontend/config/build-scripts.test.ts` (`71/71`), `npm test -- --run frontend/components/panels/studio/workflow-tabs.test.ts` (`16/16`), `npm run typecheck`, `npm run lint`, and Python compilation all pass. Regeneration is blocked pending a newly generated, human-reviewed 43-shot storyboard table that supplies the semantic contract; no paid generation authorization is implied.

## Batch 62: 2026-07-20 semantic-store preservation and fresh quality recheck

1. The post-contract audit found and fixed one persisted-boundary gap: `addStoryboard` copied the continuity state but omitted `shotSemantics`, so a storyboard that had declared its exact source cast/action could become semantically incomplete before human review. The store now preserves `shotSemantics` unchanged.
2. Updated approved-storyboard fixtures only to declare the corresponding source semantics and set `sourceSemanticsFingerprint` before their continuity/review fingerprints. The UI fixture contains the actual visible character and sword-wrap prop; scene-only fixtures explicitly declare `personFree=true`. The stale-input regression still changes only its intended input fingerprint.
3. Fresh validation passes: focused continuity suite `4 files / 32 tests`; full Vitest `358 passed / 1 skipped` with `1515 passed / 3 skipped / 1 todo`; `npm run typecheck`; `npm run lint`; and `python3 -m py_compile Library/build_daojie_chapter001_workflow.py`.
4. The current read-only direct visual preflight remains correctly fail-closed at `approved=0`, `pending=43`, `rejected=0`, `stale=0`. The live table still lacks ordered references, continuity state, and human review; no image, provider, TTS, timeline, MP4, paid ledger, or project-store write occurred in this batch.

Current gate: this code repair does not create the required 43 per-row semantic contracts. A newly generated, human-reviewed storyboard table remains required before a V2 manifest/capability dry-run can be current evidence or before any paid shot generation is considered.

## Batch 63: 2026-07-20 source-defined 43-shot semantic storyboard draft

1. Added a non-production semantic source artifact at `research/chapter001-source-semantic-draft-20260720-r01.json` and a hash-pinned local renderer at `research/render_chapter001_semantic_storyboard_draft.py`. The renderer requires the current `work-chapter-001-storyboard-table` source SHA-256 `97c948e408c790b55427cc84f3ff3123da88075819d37e705be4bbef48455b19`; any source-table change fails before it can render a new draft.
2. Rendered `research/chapter001-source-semantic-storyboard-table-20260720-r01.md` and its machine-readable report. All 43 rows have explicit source-defined `sceneViewpointId`, `personFree`, visible characters, visible linked props, positions, orientations, and frame/character action-in/action-out. The six groups are 001-012 dock, 013-019 inn hall, 020-024 inn room, 025-040 school, 041-042 inn night return, and 043 river night.
3. The draft makes six deliberate source corrections backed by the screenplay/director plan: add Zhao Si, the young laborer, and the fire seal to shot 001; add the omitted whip to 010; add the omitted fire seal to 022 and 043; and correct 023-024 from the inn hall to the inn room. It records unlinked narrative details such as the abacus, branch, lamp, bench, and shoes instead of fabricating asset references.
4. Strict Python parsing, source-row asset-resolution, and continuity-group validation pass for all 43 rows. The calculated maximum is six physical references at shot 001, so the draft is structurally within the historical `mikoto / gpt-image-2` nine-reference capability evidence; this is not a replacement for a fresh provider-configured V2 report after a production-table promotion.
5. Focused frontend regressions pass: `48/48` across storyboard table, visual continuity, and studio-store suites. `task.py validate` passes. A fresh direct visual preflight remains fail-closed at `approved=0, pending=43, rejected=0, stale=0`; the live production-store SHA-256 remained `36c3c8112a969cad18c8bcbba451ed32ce94049d69ff16e6130a7e712b6c9a04` before and after. No provider endpoint, paid ledger, image, TTS, timeline, MP4, approval, or project-store write occurred.

Current gate: the three Batch 63 draft artifacts require human semantic review before any new storyboardTable is written into the project store. This review does not approve a production image or authorize a paid image request; prior V2 shot-001 output and authorizations remain historical/rejected evidence.

## Batch 64: 2026-07-20 confirmed semantic source-table promotion

1. The operator confirmed the reviewed source-semantic write scope. The immutable confirmation record is `research/chapter001-source-semantic-apply-confirmation-20260720-r01.json`; it binds the source table, rendered 43-shot table, dry-run report, and pre-write store SHA-256. It authorizes only `--apply --human-confirmed` for the source storyboard table, not a paid request, asset approval, visual approval, provider probe, TTS, timeline, or MP4.
2. Extended `research/render_chapter001_semantic_storyboard_draft.py` with a default dry-run application plan and a dual-gated write path. It rejects stale source hashes, source changes after planning, unexpected JSON diff paths, and post-write SHA mismatches. A live plan proved that the only logical change was `state.agentWorkData[24].data`.
3. The approved apply created `studio-workflow-store.json.bak-source-semantics-20260720-080523-499226`; its SHA-256 is `36c3c8112a969cad18c8bcbba451ed32ce94049d69ff16e6130a7e712b6c9a04`. The written store SHA-256 is `507765e3902b1d99bd77f1bed1e675b83669f901d1ea925fd35e6b544739a82a`, equal to the dry-run target. No image, approval, paid ledger, provider endpoint, TTS, timeline, or MP4 was touched.

## Batch 65: 2026-07-20 semantic prompt-audit repair and current V2 dry run

1. Fixed prompt audit to use a row's declared `shotSemantics.visibleCharacters` whenever it exists. An off-screen speaker in a `personFree=true` frame is no longer misclassified as a visible character, while every declared visible character still requires a matching reference. This removed the false shot-023 requirement for an unseen innkeeper without suppressing real image-reference checks.
2. Expanded V2-safe story-fact normalization for continuity actions containing `断口冷光`, `暗红微光`, and `暗红余光`. A no-write 43-shot scan now has zero V2 audit failures and zero missing declared-character references. The changed V2 contract fingerprint is `c3adeb01498df39fe7cffe301739c10ffb9d1e262206951f5115a6cf5bc4b780`; therefore the older r09 review is not evidence for a paid request under this contract.
3. The new non-mutating evidence is `research/daojie-gongbi-v2-43-shot-dry-run-20260720-r12/report.json` (SHA-256 `81b68fc2a6c64b921486e79ca0bcdda1204229b764f14cd8444a2e298a2c2baf`). It records all 43 rows, `generationEndpointCalled=false`, `generatedImages=0`, `generationAttemptCount=0`, `reusedImages=0`, and `mutatedProductionProject=false`.
4. r12 correctly blocks the full chapter capability report: shot 001 and 033 each need 10 physical references and shot 028 needs 13, exceeding the proven `mikoto/gpt-image-2` capacity of 9. `requestAllowed=false`; no canonical, scene, prop, or previous-frame reference was removed to make room. The request entrypoint rejects the same condition before any provider POST, and a report-level regression covers this boundary.
5. The fresh direct visual preflight remains fail-closed at `approved=0, pending=43, rejected=0, stale=0`; it also reports that current storyboard records lack ordered visual manifests and continuity state. This does not upgrade old images, reviews, or MP4s, and it is not evidence that any visual gate has passed.

Validation: Python compilation; `python3 -m unittest Library.ai.test_apply_chapter001_source_semantics Library.ai.test_chapter001_approved_storyboard_reuse Library.ai.test_continuity_pilot_attempt_ledger Library.ai.test_daojie_gongbi_v2` (`42/42`); focused storyboard/continuity/store Vitest (`48/48`); build-script Vitest (`71/71`); `npm run typecheck`; `npm run lint`; and `task.py validate` all pass.

Current gate: review the r12 43-shot manifest and the capacity report. Paid V2 generation remains unauthorized and technically blocked until the provider/model has an auditable ordered-reference capacity of at least 13, or the product explicitly approves a different reference-transport design that preserves every required continuity reference. Every image remains pending until its own manual review.

## Batch 66: 2026-07-20 capacity-driven reference transport and preflight evidence

1. Added a non-destructive reference transport contract. The original ordered source manifest remains unchanged; only a contiguous canonical `front/side/back` group may become one unlabeled `768x768` local PNG when a verified provider capacity would otherwise be exceeded. Every bundle records source path, source SHA-256, view order, layout, derived SHA-256, and content fingerprint. No scene, prop, canonical, or prior-frame source reference is removed.
2. Added reusable model-reference preflight before any possible request, including dry runs. It converts prepared model payloads into a URI-free report containing only order, MIME type, width, height, bytes, and SHA-256; a real request reuses this exact prepared payload instead of compressing a second time. Remote/uninspectable payloads fail before a request.
3. The new non-overwriting `research/daojie-gongbi-v2-43-shot-dry-run-20260720-r14/report.json` has SHA-256 `20733f654726c3761c7c61a7aa01b855a60e11ff2911284c4dbb004f7fd694f1`. It records 43 V2 prompt-audit passes, `mikoto/gpt-image-2` verified capacity 9, and `requestAllowed=true` for the dry-run transport contract. The only reductions are 001 `10->8`, 028 `13->9`, and 033 `10->8`; each is a deterministic three-view bundle with `remainingReduction=0`.
4. r14 prepared 231 JPEG reference payloads. Every one is at most `768x768`, strictly below 1,000,000 bytes (maximum 138,734), and no `data:image` URI or placeholder credential appears in its research directory. The run records `generatedImages=0`, `generationEndpointCalled=false`, `generationAttemptCount=0`, and `mutatedProductionProject=false`.

Validation: Python compilation and focused continuity suites pass `33/33`; the full V2/semantic Python suite passes `45/45`; focused Vitest passes `87/87`; `npm run typecheck` and `npm run lint` pass. No provider endpoint, paid ledger, production store, approval, TTS, timeline, or MP4 was touched.

Current gate: r14 validates only prompt/reference transport and does not authorize a paid request or approve an image. All 43 visual-review rows remain pending until a separate explicit paid authorization starts a serialized V2 pilot at shot 001, followed by per-shot human approval.

## Batch 67: 2026-07-20 shot-001 pre-request asset-semantic block

1. The operator authorized one new serialized paid V2 request for shot 001. A current provider-model probe reported exactly one `mikoto / gpt-image-2` provider/key and `/v1/models = 200` before the request entrypoint was invoked.
2. The entrypoint stopped before any provider POST because the required `prop-chapter-001-4:base:v1` version is not approved. Its only local image is `/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/tool/a1b148dc-99a2-481d-95c7-9c822bad0c5b.png` (SHA-256 `bbbb2c0a7f3b605c070b1835072675c4a4a1f29127fdc42e0584e36d62c20fa5`), a large black-red flaming pedestal rather than the source-defined small vermilion fire-seal imprint on the mine basket. The local asset database contains no other image-backed fire-seal record; the only other matching record has no file or images.
3. The unique attempted output directory `apps/output/automation/daojie-chapter001-v2-pilot-shot001-20260720-a03/` is empty. The append-only paid ledger remains at 15 historical events, with its newest event the prior 2026-07-19 completed request. No new provider task ID, POST, image, approval, or production-store write exists, so this authorization was not consumed.

Current gate: do not approve, substitute, or remove the required fire-seal reference. A correct source-compatible `太一宗火印` asset must be supplied and human-approved first. A separate explicit paid authorization is required for that asset generation; only then may the unchanged shot-001 authorization path be retried in a new non-overwriting output directory.

## Batch 68: 2026-07-20 authorized fire-seal asset candidate

1. Added the generic `--continuity-asset-candidate` command to `apps/build/automate-daojie-chapter001-video.mjs`. It is manifest-driven, limits candidates to props, requires a V2 prompt-audit/fingerprint, the reviewed provider/model, a single provider/key, explicit paid confirmation, a non-overwriting automation directory, and the global append-only paid ledger. It never writes the production asset library, project store, approval, storyboard, TTS, timeline, or MP4.
2. The user authorized exactly one `prop-chapter-001-4` generation. The immutable source is `research/daojie-gongbi-v2-taiji-fire-seal-asset-paid-authorization-20260720-r01.json`; its zero-network dry-run and fresh `mikoto / gpt-image-2` `/v1/models = 200` probe passed before the POST. The async request completed as task `img_e8d2d96b956d35bd031ee4e9e8c62324`; its ledger chain is `POST_SENT -> TASK_ACCEPTED -> COMPLETED` and no retry/fallback occurred.
3. The provider original is retained at `apps/output/automation/daojie-chapter001-v2-asset-taiji-fire-seal-20260720-a01/taiji-fire-seal-basket-imprint-v1.png`. It is a flat vermilion fire-seal rather than a pedestal, but its full-canvas color audit failed at `0.1663` due to excess xuan-paper margin. A non-destructive tight crop retained the original and passed the V2 color gate at `0.3323`; its `760x768`, `508711` byte transfer thumbnail and pending review record are `research/daojie-gongbi-v2-taiji-fire-seal-asset-review-20260720-r01.json`.
4. Validation: Node syntax, lint, Python V2 suite `9/9`, and focused image-helper/build-script Vitest `75/75` pass. The candidate remains `pending-human-review`; no asset version, storyboard, approval, or production store is promoted by this batch.

Current gate: human review of the tight-cropped fire-seal candidate is required. Only explicit approval may create a new approved `prop-chapter-001-4` version, after which the unconsumed shot-001 authorization may be re-run through a new non-overwriting output directory.

## Batch 69: 2026-07-20 fire-seal approval promotion and shot-001 readiness

1. The operator explicitly approved the fire-seal candidate. The immutable approval record is `research/daojie-gongbi-v2-taiji-fire-seal-human-approval-20260720-r01.json`; it binds the reviewed tight crop and its transfer thumbnail by SHA-256 and does not authorize another paid request.
2. Promoted the candidate non-destructively as `prop-chapter-001-4:base:v1`. The canonical PNG SHA-256 is `5ecf616e96c4efd1fed0ba1374ca626c05b235d11e03842778a73e097e6e8dc3`; the store now contains 32 unique continuity versions and the new version is structurally complete, human-approved, and runtime-valid. The previous incorrect pedestal asset and generated candidate remain unchanged.
3. The promotion result is `research/daojie-gongbi-v2-taiji-fire-seal-promotion-result-20260720-r01.json`. The store backup SHA-256 is `507765e3902b1d99bd77f1bed1e675b83669f901d1ea925fd35e6b544739a82a`; the resulting store SHA-256 is `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`. No provider endpoint or paid ledger was touched by promotion.
4. Updated the full Bible planner to require the current additive 32-version matrix and to write a new `chapter001-daojie-gongbi-v2-32-version-source-matrix` artifact without rewriting the historical 31-version evidence. The fresh r1 matrix has 12 characters, 8 scenes, and 12 props; all 32 sources exist, including the new canonical fire seal.
5. A fresh non-generating shot-001 preflight at `research/daojie-gongbi-v2-shot001-fire-seal-preflight-20260720-r01/report.json` reports six approved required asset versions, zero pending, 8/9 prepared provider references, `requestAllowed=true`, `generationEndpointCalled=false`, `generatedImages=0`, and `mutatedProductionProject=false`.

Current gate: the earlier shot-001 authorization from Batch 67 remains unconsumed because that run stopped before POST. Before using it, run a new zero-cost provider-model probe and bind a new non-overwriting attempt record to the current fire-seal reference. Any ambiguous transport, missing task ID, download/validation failure, or color-gate failure stops without retry; shot 002 remains unauthorized.

## Batch 70: 2026-07-20 shot-001 a05 result and V3 color-contract correction

1. The first corrected wrapper run in `a04` stopped at local provider-config preflight with `KeyError: model` before any provider POST. Its failure row contains a stale older `COMPLETED` request only because the former attempt ID was shared across output directories; it is preserved as incident evidence and is not treated as an `a04` paid request. The runner now derives `attemptId` from the non-overwriting output directory and fails early when paid provider configuration is incomplete.
2. The corrected `a05` wrapper consumed exactly one authorized shot-001 request. The global ledger lines 19-21 record `POST_SENT -> TASK_ACCEPTED -> COMPLETED` for `mikoto / gpt-image-2`, attempt `401914ea16fb:shot-001:shot-001`, and task `img_048e7ccf04f759a54b0b72cec7fe7c06`; the ledger now has 21 lines. No fallback, automatic retry, shot 002 request, visual approval, or production-store write occurred.
3. The provider image and transfer thumbnail are preserved under `apps/output/automation/daojie-chapter001-v2-pilot-shot001-20260720-a05/`. The image SHA-256 is `4e283f40435a7bce4689df8623bb67c9f9f8d428d40907224d8c2ecefbc98243`; the thumbnail SHA-256 is `aa2c33732abd392d672100181bab33d4170dbd0f22c92b40373beccc13adc294`. Zhao Si, the shielding young laborer, dock, whip, and basket are visible, but the frame is nearly monochrome, visibly gray-dirty, and the vermilion fire seal is not a clear focal mark.
4. The local color audit failed at `chromaticPixelRatio=0.1025` against the `0.30-0.70` gate, with no warm/cool pair. Because the provider ledger is already `COMPLETED`, this is recorded as `provider-completed-local-failure`, not an ambiguous paid outcome. The immutable result record is `research/daojie-gongbi-v2-shot001-a05-local-failure-20260720-r01.json`; shot 001 remains unapproved.
5. Upgraded the prompt audit to `daojie-gongbi-v2-prompt-audit-v3`, fingerprint `10db51db7a7b0f7fe247b5b0f2bab78b3dffcd28126df7fdebd0ccd307f245aa`. The contract now targets continuous 30%-40% visible color regions, requires both cool and warm mineral washes, and explicitly rejects inheriting monochrome, gray-white, low-saturation, or dirty media from references. Fresh r15 full-chapter dry-run evidence passes 43/43 prompt audits with maximum prepared provider references 9/9 and no request block; `generationEndpointCalled=false` and no production state was mutated.

Validation: fresh Python continuity/V2 suites pass `47/47`; focused build-script Vitest passes `71/71`; `npm run typecheck`, `npm run lint`, Python compilation, and Node syntax checks pass. The paid-request spec explicitly requires unique per-output `attemptId` and classifies provider-completed local post-processing failures separately from ambiguous requests.

Current gate: `a05` is rejected before approval and its authorization is consumed. The V3 manifest, shot-001 dry run, capability evidence, and the preserved `a05` thumbnail are ready for human review. Another shot-001 POST requires a new explicit paid authorization; shot 002 and later remain unauthorized.

## Batch 71: 2026-07-20 authorized V3 shot-001 a07 upstream failure

1. The operator approved the V3 manifest and authorized exactly one new serialized paid V2 shot-001 request. The immutable authorization is `research/daojie-gongbi-v2-shot001-v3-paid-authorization-20260720-r01.json`; it binds V3 fingerprint `10db51db7a7b0f7fe247b5b0f2bab78b3dffcd28126df7fdebd0ccd307f245aa`, output directory `a07`, one `mikoto / gpt-image-2` key, eight ordered references within verified capacity nine, and excludes retries, fallback, later shots, store writes, and approval.
2. A fresh zero-generation provider probe returned one provider/key and `/v1/models=200`; its exact snapshot is `research/daojie-gongbi-v2-shot001-provider-probe-20260720-r04.json`. The non-overwriting `a06` dry run used V3 prompt audit, 10 source references transported as eight provider references, produced zero generation attempts, and did not call the generation endpoint or mutate production state.
3. The unique `a07` attempt submitted exactly one async POST. The ledger records `POST_SENT -> TASK_ACCEPTED -> AMBIGUOUS` at lines 22-24 for attempt `86463e6c4f80:shot-001:shot-001`, request fingerprint `fdcb4a1791c04061c4e7ee0e69518d07e1c78da66b5d374ef5d054e88226216f`, and task `img_85f150bf07898c401d2db51dfaed351a`. The provider poll terminated with `Image generation task failed: Upstream service temporarily unavailable`.
4. No PNG, transfer thumbnail, report, visual approval, production-store write, retry, provider/key fallback, or shot-002 request was produced. The attempt ledger is preserved in `a07`; the immutable failure result is `research/daojie-gongbi-v2-shot001-v3-a07-ambiguous-failure-20260720-r01.json`.

Current gate: the V3 `a07` authorization is consumed and the paid ledger blocks resubmission. Do not issue another POST. Only provider task-ID recovery or a new explicit authorization that accepts a possible duplicate charge can permit another shot-001 attempt; shot 002 and later remain unauthorized.

## Batch 72: Toonflow-compatible ordered image-edit transport

1. Add a strict provider `requestMode` contract to the Python-to-Node boundary. Preserve the current JSON generations mode; add synchronous multipart `/v1/images/edits` with deterministic field/reference order and a boundary-independent paid fingerprint.
2. Add a separate `toonflow-local-ai / gpt-image-2` capability record with capacity six, `openai-image-edits`, and `primary-per-asset` transport evidence. Do not store or reuse the Toonflow credential.
3. Extend reference transport so the opt-in strategy keeps every logical asset while choosing one deterministic primary source image per `(assetId, versionId, referenceRole)`, preferring character `front`. Preserve all source paths and SHA-256 values in evidence and fail closed when the resulting logical-asset count exceeds capacity.
4. Add focused Node and Python regressions for endpoint/multipart order, async rejection, deterministic primary selection, logical-asset retention, stable order, and capacity failure.
5. Run a shot-001 no-network dry-run with a placeholder local provider configuration. It must report six provider references, `openai-image-edits`, zero generation calls, no ledger/store/approval mutation, and no credential copied from Toonflow.

Current gate: implementation and no-network validation only. A real request remains blocked until the dry-run is reviewed, MYStudio receives its own local-provider credential, and the operator gives a fresh explicit paid authorization.

Result: the Node helper now supports the strict `openai-image-generations-json` and `openai-image-edits` modes. Edit mode rejects async configuration, uses synchronous ordered multipart fields and repeated `image` parts, and fingerprints a canonical boundary-independent descriptor while retaining the existing paid ledger and ambiguity-stop behavior. Python propagates the same mode, rejects capability mismatch, and applies the same transport function in both the continuity pilot and the main storyboard frame entrypoint.

The capability manifest now has an isolated `toonflow-local-ai / gpt-image-2` record with capacity six and `primary-per-asset`. No credential is present. The transport retains every source path/hash in evidence, keeps first logical-asset order, prefers character front views, and fails closed above capacity. The non-overwriting shot-001 dry-run report is `research/daojie-gongbi-v2-shot001-toonflow-edit-dry-run-20260720-r01/report.json`, SHA-256 `34a232c20010426c922aed882ffcace2e58614c29ad4e2805bcfcbbe1ed4d858`; it records source `10`, provider `6`, both character fronts, zero calls, and zero attempts.

The full 43-shot no-network report is `research/daojie-gongbi-v2-43-shot-toonflow-edit-dry-run-20260721-r01/report.json`, SHA-256 `fb054ef62308a159d4a617632305171c5f11fc91f8d14bcc479ccb4b4ef19dd3`. All 43 prompt audits pass, the provider-reference distribution is `{1:1,2:15,3:13,4:10,5:3,6:1}`, maximum six, capability status `ready`, and blocked shots empty. It records `generationEndpointCalled=false`, `generationAttemptCount=0`, `paidAuthorization=false`, and `mutatedProductionProject=false`; neither report contains the placeholder key or image data URI.

Validation: Python focused suites pass `46/46`; focused Vitest passes `78/78`; typecheck, lint, Python compile, Node syntax, JSON parsing, and `task.py validate` pass. The paid ledger remains 24 lines with SHA-256 `1f80b6d011303a5acc89011cff01e83c4c99d4345a0b76da2e525b2e356a7331`; the production store remains SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`. No provider POST, paid-ledger event, approval, production store, TTS, timeline, or MP4 was touched.

Current gate: the Toonflow-compatible transport implementation is complete and dry-run evidence is ready for human review. A real shot-001 request still requires an independently supplied MYStudio credential and a fresh explicit paid authorization that accepts the prior `a07` ambiguity; shot 002 and later remain unauthorized.

## Batch 73: 2026-07-21 Toonflow transport review hardening

1. Re-traced the Python config, capability resolution, logical-asset projection, main storyboard entrypoint, Node multipart builder, paid fingerprint, ambiguity stop, and dry-run report. The 43-shot report was independently checked for source-count parity, unique logical keys, valid selected indexes/hashes, and front-view preference; all 43 entries passed with zero discrepancies.
2. Added a paid-ledger multipart regression that executes the same canonical request twice with different multipart boundaries and attempt IDs. The first request completes; the second is blocked by the prior `COMPLETED` fingerprint before network access, so the mock server observes exactly one POST.
3. Added an image-edit 503 regression with two configured keys. The first ambiguous POST stops provider/key fallback and the server observes exactly one POST.
4. Added a main storyboard entrypoint regression proving `generate_storyboard_frame_with_references` consumes `primary-per-asset`, retains the complete source list, selects the character front view, and projects `openai-image-edits` evidence. The transport is therefore shared by the product entrypoint and continuity pilot rather than existing only in the pilot.

Validation: focused Python suites pass `47/47`; focused Vitest passes `80/80`; typecheck and lint pass. Review found no implementation defect requiring a production-code change. No provider request, paid ledger, production store, approval, TTS, timeline, or MP4 was touched.

Current gate remains unchanged: review the Toonflow-compatible dry-run evidence, provide an independent MYStudio local-provider credential, then explicitly authorize a new paid shot-001 request if the prior `a07` duplicate-charge risk is accepted. Shot 002 and later remain unauthorized.

## Batch 74: 2026-07-21 existing-provider primary-reference selection

1. The operator confirmed `127.0.0.1:8317/v1` is no longer a MYStudio production dependency and no new provider configuration is required.
2. Keep the optional `/v1/images/edits` implementation and tests, but mark `toonflow-local-ai / gpt-image-2` as historical-only so it cannot authorize a request.
3. Bind the verified `primary-per-asset` transport to the existing `mikoto / gpt-image-2` generations/async capability. This ports Toonflow's stable one-image-per-logical-asset discipline without changing the current endpoint or credential source.
4. Re-run shot 001 and all 43 shots without network access. Require six or fewer ordered provider references, all prompt audits passing, no request attempts, and no ledger/store mutation.

Current gate: implementation and dry-run validation only. Do not submit another shot-001 POST without fresh explicit authorization accepting the prior `a07` ambiguity; shot 002 and later remain unauthorized.

Result: `mikoto / gpt-image-2` now uses `primary-per-asset` with its existing `openai-image-generations-json` and async contract. `toonflow-local-ai` remains in the manifest only as `historical-only`; capability assertion rejects it, so `127.0.0.1:8317/v1` cannot become an accidental production dependency.

The shot-001 no-network report is `research/daojie-gongbi-v2-shot001-mikoto-primary-dry-run-20260721-r01/report.json`, SHA-256 `640d0c8529079885ab657f10535b89b5c06375d257a5c8a6b235923224254318`. It retains ten source references, sends six logical provider references, selects both character front views, passes the V3 prompt audit, and records zero generation calls/attempts and no production mutation.

The full 43-shot no-network report is `research/daojie-gongbi-v2-43-shot-mikoto-primary-dry-run-20260721-r01/report.json`, SHA-256 `b5747f80edf1dba8f7539d51f3c91bdb3f8a91b55e765cdba60e04a14d430a3d`. All 43 prompts pass, capability status is `ready`, blocked shots are empty, provider-reference distribution is `{1:1,2:15,3:13,4:10,5:3,6:1}`, and maximum six remains below Mikoto's verified capacity nine. A second source/provider/front-selection audit reports zero discrepancies. No placeholder credential or image data URI is present in either research directory.

Validation: focused Python suites pass `48/48`; focused Vitest passes `80/80`; typecheck and lint pass. No paid request was submitted.

Current gate: no new endpoint or credential configuration is needed. The next possible operation is one newly authorized Mikoto shot-001 paid request using six primary references; authorization must explicitly accept the prior `a07` ambiguous-charge risk. Shot 002 and later remain unauthorized.

## Batch 75: 2026-07-21 authorized shot-001 a08 result and visual precheck

1. The operator explicitly authorized exactly one new paid shot-001 request and accepted the prior `a07` ambiguous-charge risk. The immutable authorization is `research/daojie-gongbi-v2-shot001-mikoto-primary-paid-authorization-20260721-r01.json`; it excludes retries, fallback, shot 002 or later, production-store writes, and visual approval.
2. The `a08` run completed exactly one `mikoto / gpt-image-2` async request. Ledger lines 25-27 contain `POST_SENT -> TASK_ACCEPTED -> COMPLETED` for attempt `28b3877f9865:shot-001:shot-001`, task `img_11783fe610ce9b72fb9a6299d5067987`, and request fingerprint `7486a47e261f0efaf63d079eea4dea547211ee5c306f96f0d52e70f2dd2c6794`. The ledger now has 27 lines and SHA-256 `1b59a61a27a0fd0d708cec383a364dbf19d47eb549d52ddc5ddfe503896cf61d`.
3. The non-overwriting output is `apps/output/automation/daojie-chapter001-v2-pilot-shot001-20260721-a08/shot-001.png`, SHA-256 `9e90eb74e24fcd1ba10d0c6c6ff67c6ba6529ffc8cfa87f5c2913519ae3d2839`. Its strict transfer thumbnail is `768x432`, 248713 bytes, SHA-256 `e0c4d197c87d9086dc37f47245a6d1febff4c7d727198dff043adb005f810e1b`. The report remains `awaiting-human-approval`; no retry, reuse, later-shot request, approval, or production mutation occurred.
4. Automated prompt audit V3 passes. The numeric color audit passes at `chromaticPixelRatio=0.3392`, but its diagnostic fields report `hueFamilies=1`, `dominantHueRatio=0.9504`, and `warmCoolPresent=false`. Visual precheck therefore recommends rejection: the frame is gray-brown and dirty, the young laborer's clothing reads ragged, the character reads older than the locked age, and the vermilion fire-seal mark is not clearly verifiable. Text and watermark checks pass.
5. The Python authorization prompt hash `64281367...` and the paid ledger prompt hash `d05674c9...` represent the prompt before and after the Node clean-image normalization suffix. The difference is recorded explicitly and does not represent a second request. The immutable result evidence is `research/daojie-gongbi-v2-shot001-a08-paid-result-20260721-r01.json`.

Current gate: shot 001 is generated but not approved. A human must explicitly approve or reject this exact thumbnail. No new paid request and no shot 002 request is authorized. The production store remains SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`.

## Batch 76: 2026-07-21 paid-generation break-loop correction

1. Add failing Python/Vitest regressions for `dock-ragged` image/version incompatibility, cross-asset alias ownership, selected-reference V2 color failure, dock evening/morning conflict, missing visible characters in the leading subject section, strict 30% warm/cool and dominant-hue gates, explicit provider semantic-role evidence boundaries, and the Node no-text suffix.
2. Remove the `dock-ragged -> dock-workwear` prompt promotion. Require a new non-overwriting intact-workwear Bible version before any affected storyboard request.
3. Replace raw overlapping alias replacement with unique asset-owned bindings. Assemble concise prompts from `shotSemantics` with visible character identity/position/action first; emit scene time once and remove duplicated action/light/palette prose.
4. Add an exact selected-reference visual preflight and report. Current shot 001 and the 43-shot dry run must be blocked before reference transfer/network with per-asset reasons; dry-run evidence must still be written.
5. Tighten the color gate from the 30% threshold and replace Node's positive `unwanted calligraphy` phrase with an explicit prohibition. Separate transport/capacity evidence from semantic-role evidence in Python and Node reports.
6. Persist a break-loop analysis, update the cross-layer/backend contract and matching generated spec template, then run focused Python/Vitest tests, full 43-shot no-network dry run, typecheck, lint, Python compile, Node syntax and `task.py validate`.

Safety: no provider probe or generation endpoint, no paid-ledger event, no approval write, no production-store mutation, no image overwrite, and no shot 002+ request. Preserve `a08`, all historical manifests, images and review evidence unchanged.

Result: the pre-request gate now audits the exact provider-selected bytes and rejects `dock-ragged`, source/declaration hash drift, incompatible scene time, low-color references, alias ownership collisions, and missing leading subjects before transfer. The 43-shot prompt range fell from 1674-2780 (average 2164) to 1584-2286 (average 1915). Capability evidence now keeps ordered transport/capacity separate from semantic roles; all current semantic-role records remain explicitly unverified with `providerRoleMetadataSent=false`.

Final review found and corrected three additional cross-layer defects. V2 Node transport no longer appends an unreviewed clean-image suffix, so manifest and ledger use the same prompt bytes under `providerPromptPolicy=exact-reviewed-v2`. The local color prefilter now matches the current MA implementation exactly: 30%-70% is the hard band and the color-forward dominant-hue/warm-cool gates start at 45%; a08 still passes the numeric prefilter but remains ineligible for approval under the pending human visual criteria. The no-network runner now selects the sole verified capability record without an API key, removing hidden environment dependence from the 43-shot report.

The formal report is `research/daojie-gongbi-v2-break-loop-43-shot-dry-run-20260721-r05/report.json`, SHA-256 `81b57fb0a5fe0363f4e35551b45a2ac4007d698969d9ca9537cd98d811d01223`. It contains 43 self-verifying prompt SHA-256 values, 43/43 capability-ready entries, zero selected-reference hash mismatches, zero missing leading characters, and zero alias failures. All 43 shots are blocked before network by `reference_color=43`, with `scene_time_conflict=12` and `incompatible_wardrobe_version=6`; `generationEndpointCalled=false`, attempts/paid authorization are zero, and production mutation is false.

Validation: focused Python suites pass `59/59`; Node helper Vitest passes `9/9`. MA parity probes match a08 and the approved fire-seal reference field-for-field. The root-cause record is `research/paid-generation-break-loop-root-cause-20260721.md`; cross-layer and provider-integration specs now carry the prevention contract. This workspace has no `src/templates/markdown/spec/` directory, so no generated spec template was invented or synchronized.

Current gate: do not generate again through the same prompt-only control strategy. Shot 001 requires new non-overwriting control inputs for the low-color dock, Zhao Si, young laborer, whip, and basket; the young laborer also needs intact workwear and the dock needs evening-compatible evidence. A deterministic V2 reference/composition plate is the next no-network engineering option for reusable assets. Any new AI-generated Bible image remains a separately authorized paid operation followed by human approval.

## Batch 77: 2026-07-21 V2 prompt-internal conflict elimination

1. Added prompt-audit v5 regressions for incompatible wardrobe identifiers, legacy gray-blue/deep-gray scene palettes, and broad all-reference inheritance. Raw Bible values remain unchanged in manifest/reference audit evidence.
2. Added shared V2-safe projections for scene palettes and wardrobe labels. Blocked `dock-ragged` references now contribute identity only to review prompts; they are not renamed or promoted, and the selected-reference pixel gate still rejects them before network access.
3. Replaced the trailing `保持所有@图N...一致` instruction with asset-type-scoped inheritance where V2 medium, polychrome balance, intact clothing, current action, composition, and light take priority. Storyboard and derived-asset prompts now keep the negative section last.
4. The fresh no-network report is `research/daojie-gongbi-v2-prompt-conflict-43-shot-dry-run-20260721-r06/report.json`, SHA-256 `7d8ca1e0bef1b86d1645a81bfdb26bd44da067ebfecae98a67da0008b4e2753d`. All 43 prompt hashes self-verify, all 43 prompt audits pass, and no final prompt contains `dock-ragged`, the legacy dock palette, or the broad inheritance sentence.
5. Safety remains fail-closed: all 43 shots are blocked by `reference_color`; 12 retain `scene_time_conflict`; 6 retain `incompatible_wardrobe_version`. The report records no endpoint call, generation attempt, paid authorization, image output, approval, reuse, or production mutation.

Validation: focused Python suites pass `62/62`; focused Vitest passes `80/80`; typecheck, lint, Python compilation, Node syntax, and `task.py validate` pass. The paid ledger remains 27 lines with SHA-256 `1b59a61a27a0fd0d708cec383a364dbf19d47eb549d52ddc5ddfe503896cf61d`; the production store remains SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`.

Current gate: prompt conflicts are removed, but generation remains blocked by the actual selected reference pixels. Do not submit another paid request. The next engineering step is non-overwriting V2 control-input replacement for the low-color and incompatible references, followed by a new no-network review.

## Batch 78: 2026-07-22 role-aware reference color audit and shot-001 replacement plan

1. Corrected the selected-reference color preflight without changing the final-output `audit_color()` contract. Scene/previous-frame references remain full-frame hard-gated; canonical character boards exclude blank paper/alpha margins before the hard gate; prop-state boards use the same subject mask for diagnostics while format, inspectability, content area, and source hash remain hard gates. This prevents a sparse red whip or single-color basket from being judged as a final 16:9 composition.
2. Added regressions for paper-margin exclusion, scene full-frame behavior, prop diagnostic-only behavior, and the workflow integration point. Focused Python suites pass `66/66`; focused Vitest passes `80/80`; typecheck, lint, Python compilation, and Node syntax checks pass.
3. The non-overwriting shot-001 dry run is `research/daojie-gongbi-v2-reference-role-shot001-dry-run-20260722-r01/report.json`, SHA-256 `7d102716d5c252371b9c449cfda9b09cddb577fc18299446c881b7c31fe889d9`. Its prompt audit passes, the whip/basket/fire-seal references pass, and the remaining blockers are exactly the evening dock, Zhao Si, and the young helper; no endpoint call, attempt, generated image, approval, or production mutation occurred.
4. The full 43-shot report is `research/daojie-gongbi-v2-reference-role-43-shot-dry-run-20260722-r01/report.json`, SHA-256 `6255a53fa39fb9137e37e78eaf087c8de22ed3353fe3821ffaad8bb3a4128441`. All 43 prompt hashes and prompt audits pass, capability is ready with maximum six provider references, and all prop-state rows pass. Thirty unique references are used; 16 remain hard failures: four scene viewpoints and twelve canonical characters. These 16 references still cover all 43 shots, so generation remains blocked.
5. Prepared the exact three-job shot-001 replacement plan at `research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260722-r01.json`, SHA-256 `89ff74f71f8aa08a653abe2ec036c12f761ecf5fa7c00e1656d2dd9481feadd8`. Each prompt follows the MA order `subject -> medium -> composition -> color/material -> light -> reference boundary -> negative`, has a self-verifying SHA-256, uses a non-overwriting output path, and retains `paidAuthorization=false`, `requestAllowed=false`, zero automatic retry/fallback, and zero store/approval permission.

Safety verification: the production store remains SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`; the 27-line paid ledger remains SHA-256 `1b59a61a27a0fd0d708cec383a364dbf19d47eb549d52ddc5ddfe503896cf61d`.

Current gate: no paid request is authorized. Shot 001 can only proceed after the three replacement prompts are reviewed and each serialized asset request receives a new explicit one-request authorization; every output must then pass automated checks and human review before a new Bible version is written.

## Batch 79: 2026-07-23 authoritative replacement manifests and zero-network preflight

1. Added `Library/ai/chapter001_continuity_asset_candidate.py` as the authoritative manifest validator and `Library/ai/build_chapter001_reference_replacement_manifests.py` as the reproducible builder. The runner now supports `scene`, `character`, and `prop`, validates the source-plan/prompt/reference/capability/output bindings, permits an unauthorized dry-run without credentials, and requires an exact `requestBindingSha256` authorization before a real request. The production storyboard parser remains fail-closed; only the stale-repair test fixture was supplied with its now-required current `storyboardTable`.
2. The rebuilt V5 plan is `research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260723-r02.json`, SHA-256 `8b4b8f1597b21b2551af39c218c751ab98f430a6f94d6f2c1113d381ded20e4a`. Its three non-overwriting manifests are under `research/daojie-gongbi-v2-shot001-reference-replacement-manifests-20260723-r01/`; all three prompts pass `daojie-gongbi-v2-prompt-audit-v5`. Their exact request bindings are: evening dock `9cd01a4c89dd04f3b3e47f7837818eab6ae4c34dd9b7dde0e69385a7d1a4d664`, Zhao Si `f008f755bc48f0ba0cb28a63bbf47fc3e159d0f13beedb2440ac288d91b27554`, and young helper workwear `7fcec3a5150e26bdc816181eb54049d9b8d655c3704bb1edb2ee25350a8d5e5c`.
3. Three serialized dry-runs wrote only `preflight-report.json` files under `apps/output/automation/daojie-chapter001-v2-bible-replacements-20260723-r02/`. Every report records `ok=true`, `dryRun=true`, `paidAuthorization=false`, `requestAllowed=false`, provider `keyCount=0`, `credentialLoaded=false`, `generationEndpointCalled=false`, `generatedImages=0`, and `mutatedProductionProject=false`; prompt, reference, capability, style, and request-binding hashes match the reviewed manifests. No PNG exists in the output tree.
4. Verification passes: focused asset-validator Python tests `7/7`; selected visual-continuity Python suites `107/107`; focused Vitest `81/81`; full Vitest `359` files and `1526` tests passed with only the existing `1` skipped file, `3` skipped tests, and `1` todo; typecheck, lint, Python compilation, and Node syntax checks pass.
5. Safety baselines remain unchanged after verification: the production store SHA-256 is `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`; the append-only paid ledger remains 27 lines with SHA-256 `1b59a61a27a0fd0d708cec383a364dbf19d47eb549d52ddc5ddfe503896cf61d`. No provider endpoint, paid-ledger event, approval, retry, fallback, or production-store write occurred.

Current gate: no image generation is authorized. Each of the three assets requires a separate explicit one-request paid authorization bound to its exact `requestBindingSha256`, followed by automated checks and human review. Execution must remain serialized and begin with the evening dock; authorization for one asset does not authorize either character asset or shot 001 itself.

## Batch 80: 2026-07-23 evening-dock paid result blocked without retry

1. The user's direct `授权` reply was bound only to evening-dock request `9cd01a4c89dd04f3b3e47f7837818eab6ae4c34dd9b7dde0e69385a7d1a4d664`. The original unauthorized manifest remains unchanged at SHA-256 `556a99f8b2d9e9d8b5e64da7b39815174dcb6d8ab9f45c383e337b429230a327`; the authorized copy and independent authorization record are preserved under `research/`.
2. A fresh no-generation `/v1/models` probe confirmed exactly one `mikoto / gpt-image-2` provider and one key with HTTP 200. The sole asynchronous POST was accepted as task `img_3d545fbf6a3a4d23c91e913935fa784c` and completed once. The ledger contains exactly the three expected `POST_SENT`, `TASK_ACCEPTED`, and `COMPLETED` events; no retry, provider/key fallback, character asset request, or storyboard request occurred.
3. The preserved output is `apps/output/automation/daojie-chapter001-v2-bible-replacements-20260723-r02/dock-main-axis-evening-v2-r01/dock-main-axis-evening-v2-r01.png`, SHA-256 `5f4d612596e9ae270d5c5e10afa7c964091828971fa39406af96d55626316752`. Its strict review thumbnail is `768x432`, 230089 bytes, SHA-256 `e895e9147aac77b55cfb684103c9e444708d413523a0be96a2c94ba817e577d5`.
4. The output is blocked by the authoritative color audit: `chromaticPixelRatio=0.5885` is inside the 30%-70% band, but `dominantHueRatio=0.8067` and `warmCoolPresent=false` fail `warm_cool_balance`. AI-assisted thumbnail inspection also finds digital concept-art construction instead of dominant continuous baimiao/iron-wire linework and a gritty brown-grey finish. The declared left-step/right-boat/center-river/evening layout is present; no legible text or watermark was found. This inspection is not a human approval.
5. The immutable result record is `research/daojie-gongbi-v2-dock-main-axis-evening-paid-result-20260723-r01.json`. The paid ledger advanced from 27 to 30 lines with SHA-256 `1053cf5c294d8f28e35d11ed6b2e83a5c9d764f38362447dd7d788e8b58ea48a`; the production store remains unchanged at SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`.

Current gate: the evening-dock authorization is consumed and its output is ineligible for promotion, approval, or reuse. Do not repeat the same request. A future evening-dock replacement requires a changed control strategy, a new non-overwriting manifest/dry-run, and a new explicit paid authorization. Zhao Si, the young helper, and storyboard shot 001 remain unauthorized.

## Batch 81: 2026-07-23 replacement-prompt single-owner correction

1. The consumed 1279-character evening-dock prompt was traced to mechanical stacking: repeated light/color/negative directives, scene-irrelevant character rules, and weak ownership between asset facts and global locks. The preserved paid result remains blocked by `warm_cool_balance` and by the digital brown-grey visual inspection; it was not retried.
2. Added `daojie-gongbi-v2-reference-replacement-v2`: exactly six ordered sections, a 900-character ceiling, final negative ownership, duplicate rejection, leading reference scope, scene/character rule separation, spatial cold/warm requirements, and warm-white character boards. `prompt_quality_audit()` now recognizes the new `光源` section rather than falsely requiring legacy `光影`.
3. `chapter001_continuity_asset_candidate.py` now recomputes and verifies `promptContractRevision` and `referenceReplacementPromptAudit`, checks them against the source-plan job, and binds the revision into `requestBindingSha256`. Forged audit and revision-drift regressions fail before provider settings.
4. The non-overwriting plan is `research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260723-r03.json`, SHA-256 `ffb99c0a075056a570f07739ab7de619429075b4dc8cdc09868562aaf1528489`; manifests are under `research/daojie-gongbi-v2-shot001-reference-replacement-manifests-20260723-r02/`. Prompt lengths are `646/692/717`, all global and replacement audits pass, and `$ma-imagegen` strict/source lint reports `0` issues and `0` warnings.
5. Three serialized zero-network runs wrote only `preflight-report.json` under `apps/output/automation/daojie-chapter001-v2-bible-replacements-20260723-r03/`. Each records zero credentials, no endpoint call, zero generated images, no production mutation, and an exact-reviewed prompt hash; no PNG exists. The ledger remains 30 lines at SHA-256 `1053cf5c294d8f28e35d11ed6b2e83a5c9d764f38362447dd7d788e8b58ea48a`, and the production store remains SHA-256 `72c01ec8782f6fd8acec8d07116eac4680098e15614ef11fdc13c8734e47a164`.
6. Fresh verification passes: focused prompt/asset tests `31/31`; full `Library/ai` tests `114/114`; full Vitest `359` files and `1526` tests passed with the existing `1` skipped file, `3` skipped tests, and `1` todo; typecheck, lint, Python compilation, Node syntax, and Trellis task validation pass.

Current gate: no paid generation is authorized. The r03 plan and all three r02 manifests require human prompt review; any later asset request needs a new, separate authorization bound to the exact request SHA-256. The failed evening-dock authorization remains consumed.

## Batch 82: 2026-07-23 evening-dock image accepted as a future base only

1. The user-provided `768x432` clipboard PNG was verified against the preserved evening-dock result. It is pixel-identical to the durable review thumbnail after RGB decoding (`meanAbsolutePixelDifference=[0,0,0]`) and represents the preserved `1672x941` original at `apps/output/automation/daojie-chapter001-v2-bible-replacements-20260723-r02/dock-main-axis-evening-v2-r01/dock-main-axis-evening-v2-r01.png`, SHA-256 `5f4d612596e9ae270d5c5e10afa7c964091828971fa39406af96d55626316752`.
2. The user's statement accepts that durable original only as a possible future composition/layout base. A later prompt may inherit the dock axis, left steps/platform/baskets/ore, right boat/bollard/rope, centered river perspective, and evening time; it must not inherit the digital concept-art medium, brown-grey dominant palette, gritty finish, or insufficient baimiao/iron-wire linework.
3. This direction does not approve the image as a final Bible or storyboard output, does not override its failed `warm_cool_balance` audit, does not assign a provider-native reference role, and does not authorize a paid request. The immutable record is `research/daojie-gongbi-v2-dock-evening-base-image-human-direction-20260723-r01.json`; no current r03 plan or r02 manifest was mutated.

Current gate: if another evening-dock image is needed, build a new non-overwriting plan that points to the durable `1672x941` original, run current capability/reference/prompt preflight, and then obtain a new authorization bound to that exact request. Do not use the temporary clipboard path as an execution input.

## Batch 83: 2026-07-23 single-storyboard correction and MA style-contract hold

1. Superseded Batch 82's broad future-base interpretation without deleting or mutating its evidence. The correction is `research/daojie-gongbi-v2-dock-evening-base-image-human-direction-20260723-r02.json`: the supplied dock image is one unbound storyboard frame only, is not a 43-shot/global style reference or Bible asset, and may be used only as the immediately following frame's continuity reference after exact storyboard/shot-group binding from current data.
2. Rechecked the authoritative `$ma-imagegen` source and its active Trellis task. The current files contain gongbi linework, rice-paper texture, mineral color and a partial Song academy template, but they do not yet publish the user's complete six-part core, the `40%/30%/20%/10%` directional tendency, the explicit web-novel-cover ban, or a MYStudio 43-shot semantic regression.
3. Established the intended split runtime without installing packages: MA `.venv` supplies `httpx/openai/pytest`, while the existing ML site-packages supply `cv2`. Fresh regression passes `26/26`, the full skill suite passes `167/167`, and skill sync reports `0` issues. These results prove the existing implementation baseline only; they do not close the missing semantic contract.
4. Recorded the fail-closed interoperability hold at `research/daojie-gongbi-v2-ma-imagegen-style-contract-hold-20260723-r01.json`. All r03 paid requests, Bible generation and storyboard generation are paused. No prior authorization carries forward, and no old output may be promoted as evidence for the revised style.

Current gate: wait for the active MA ImageGen task to land the complete authoritative style core and its own semantic regression. Then capture fresh hashes, port the exact contract into MYStudio tests first, rebuild all 43 prompts non-overwriting, run zero-network audits, and present the manifest for human review. No provider call or image generation is allowed before that sequence completes.
