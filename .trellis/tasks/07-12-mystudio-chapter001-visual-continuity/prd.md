# 第一章分镜长线视觉与人物一致性

## Goal

修复《道劫》第一章 43 镜“逐镜独立抽卡”导致的场景漂移、人物换脸、服装变化、体型变化和相邻镜头走位断裂；吸收 Toonflow 已验证的有序资产引用与分镜连续性机制，并在 MYStudio 项目级存储、图片工作流和真实成片链中形成可重复、可审计的长线一致性闭环。

## Confirmed facts

- 当前正式视频的 43 张分镜图来自 `real-ai-reference-image-workflow`，每镜都有 2–5 张参考资产，不能把问题归因成“完全没有参考图”。
- 当前每镜仍是独立图片请求；请求不包含上一镜结果、连续镜头组、固定视觉生成参数或生成后身份比对。
- `Library/build_daojie_chapter001_workflow.py` 只把 `[scene, *assets]` 转成参考图，并用文本规则宣称“一致”；当前门禁只检查 `@图N`、风格锁和引用存在，不检查实际脸、服装、体型、空间与相邻动作是否一致。
- Toonflow 第一章真实项目位于 `/Users/zhengbingjin/Library/Application Support/toonflow/data/db2.sqlite`，43 条 `o_storyboard.filePath` 均有本地原图。
- Toonflow 按 `o_assets2Storyboard.rowid` 保留每镜资产顺序，再通过 `o_assets.imageId -> o_image.filePath` 复用固定参考图。同一独孤剑尘 `imageId=1` 被 27 镜复用，斩魂剑 `imageId=2524` 被 26 镜复用。
- Toonflow prompt 明确记录景别、人物朝向、画面位置、动作承接、场景变体与固定 `@图N` 身份；例如第 6、7 镜使用完全相同的六项有序参考图，并描述相邻动作承接。
- Toonflow 同一地点会使用受控场景变体，例如金水河码头的晨雾版、反向视角、夜景浓雾版，而不是让模型每镜自由重构空间。
- MYStudio 已存在 `CharacterIdentityAnchors` 六层身份锚点、角色多视图/服装 variation、场景 contact sheet/viewpoints 等数据结构，但当前分镜生图链没有消费这些字段。
- 当前 MYStudio 43 镜计划与 Toonflow 原始 43 镜不是同一套计划。视觉修复不能只加一句提示词，也不能把 Toonflow 原图直接冒充 MYStudio 新生成结果。

## Requirements

### R1. Ordered continuity manifest

- 每镜保存有序参考清单，至少包含顺序、稳定资产 ID、资产类型、固定 image path、角色阶段/服装版本、场景视角版本和来源证据。
- 所有分镜生图入口必须消费同一清单，不得再次按名称临时匹配或重排。
- 同一角色/场景/道具跨镜默认复用同一固定参考版本；版本切换必须有显式剧情原因和起止镜头。

### R2. Character bible and identity lock

- 第一章所有可见命名角色必须有 canonical characterId、基础参考图和可用身份锚点。
- 主角和重复出场角色至少具备正脸/三分之四/全身或等价多视图证据；缺失时先生成并人工批准角色基准资产，再生成分镜。
- 将现有六层身份锚点、negativePrompt、服装 variation 和阶段信息注入分镜 prompt/请求；禁止只依赖角色名称。
- 多人物镜头必须保持参考图与 prompt 中 `@图N` 的一一对应，禁止身份串位。

### R3. Scene bible and controlled viewpoints

- 对重复场景建立空间布局、光线、色板、关键道具位置和受控视角版本。
- 同场景连续镜头只允许在已声明视角间切换；不得每镜重造建筑结构、门窗位置或空间尺度。
- 相邻镜头记录人物九宫格位置、朝向、入画/出画方向和动作承接。
- 分镜表必须逐镜提供结构化的出镜语义：明确可见角色、站位、朝向、每个角色的入/出镜动作和整镜动作承接；无人物镜头必须显式声明。生成链只能从该行语义和它已链接的资产构建角色参考，禁止按镜号、场头演员表、场景或道具推断人物。

### R4. Shot-group generation

- 43 镜按场景和连续动作拆成 shot groups；组内共享角色版本、场景视角、光线、色板和连续性状态。
- 组内生成顺序固定；除资产基准图外，可把上一镜已批准成图作为“构图/状态连续参考”，但不得让上一镜覆盖角色 canonical identity。
- 支持从第一个失败镜头恢复，重跑后下游镜头标记 stale；不得静默复用旧的不一致图片。

### R5. Provider capability contract

- 在运行前精确检测 provider 是否支持多参考图、参考图顺序和图生图/编辑连续性；不支持时必须阻断或降级到明确标记的非最终预览。
- 固定模型、分辨率、比例、风格手册版本和可用的 deterministic 参数；报告必须记录真实发送参数。

### R6. Visual supervision and gates

- 新增结构门禁：有序清单完整、角色/场景版本覆盖、相邻镜头状态连续、prompt 引用无串位。
- 新增视觉门禁：对重复角色做脸部/服装/体型一致性检查，对重复场景做布局/色调检查，对相邻镜头做方向与动作检查。
- 自动分数只用于发现问题；最终图片需形成逐镜 `approved/rejected/reason` 台账。存在拒绝镜头时禁止最终视频标记完成。

### R7. Toonflow evidence and migration boundary

- 建立 Toonflow 第一章只读 fixture/对照报告，保存原始 storyboard、ordered asset/image IDs、prompt 和 golden path 证据。
- 吸收机制，不替换 MYStudio 项目存储，不直接依赖 Toonflow 运行时数据库作为生产依赖。
- Toonflow 原图只作为视觉结构和连续性 golden，不直接覆盖 MYStudio 项目成图。

### R8. Safe regeneration

- 重生成前备份当前 43 张图、工作流 store 和最终 MP4，并生成 manifest；禁止删除现有产物。
- 先以 6–8 镜连续样本通过人工视觉复核，再分场景小批量重生成 43 镜。
- 保留现有口播、固定音色和音频；视觉重生成后重新合成第一章视频，不重新选择音色。

### R9. MA ImageGen art-direction alignment

- 第一章剧情关键帧采用 `$ma-imagegen` 的“道劫水墨国风”单一主通道：工笔负责脸、手、发丝、衣褶和器物结构，写意只承载背景、雾气与远景；竹窗、卷轴等仅是适用场景的内容，禁止作为全局默认。
- 所有最终 prompt 必须包含连续线描、薄层矿物色分染/罩染、平光宣纸照明、30%–70% 可辨彩色、干净完成度和全员完整衣物约束；不得注入 `dirty texture`、破衣褴褛或大面积灰黑脏污等相冲突指令。
- `2D工笔风.png` 只有在 provider 已验证额外 style reference 的容量、顺序和传输时才可使用；验证前不得挤掉 canonical、scene 或上一镜参考，也不得发起付费探测。
- 风格契约版本、启用时的 style-reference SHA-256 和 prompt audit 必须进入连续性指纹。契约变化使旧 pilot 输出失去可继续生成资格，但不覆盖其图片、审核记录或支付台账。

### R10. Prepaid-generation break-loop gate

- 2026-07-21 的 `a08` 结果证明“结构/容量/prompt 字符串通过”不能代表参考图或最终画面符合 V2。每个付费请求前必须审计实际被选中的参考图像素、服装版本、时段、别名所有权和 provider 语义证据，任一项不满足即在网络前阻断。
- R9 的发行向完整衣物合同覆盖 2026-07-15 的旧 `dock-ragged` 服装决定。禁止把旧版本名或提示词字符串改写成 `dock-workwear` 后继续发送同一张破衣参考图；必须使用新的非覆盖完整工装 Bible 版本和新内容指纹。
- 最终提示词必须由当前 `shotSemantics` 驱动，先写所有可见人物的身份、站位、朝向和动作，再写道具/场景事实；不得让人物事实只存在于后半段连续性说明。分镜时段必须来自当前导演场次事实，并与场景光线一致。
- provider 的“接收有序多图/容量”证据不得表述为“理解 reference role”证据。报告必须分别记录 transport/capacity 证据与 semantic-role 证据；当前 JSON `image_urls` 请求不发送独立 role 字段。
- 本轮不授权任何付费请求。修复只允许测试、离线 prompt/引用预检和非覆盖研究证据；不得生成镜头 001 新图或请求镜头 002 及以后。

## Acceptance criteria

- [x] AC1: Toonflow 43 镜只读 fixture 可复现 `storyboard -> ordered assetId -> fixed imageId -> filePath -> golden image`，缺失为 0。
  - 2026-07-17 closure: Toonflow paths resolve under the actual read-only `data/oss/` root. `Library/ai/build_toonflow_portable_fixture.py` created a content-addressed task fixture with `storyboardCount=43`, `goldenImageCount=43`, `referenceCount=132`, `missingImageCount=0`, and verified per-image pixel SHA-256 digests. The independent verifier and unit test pass; no production file or provider was touched. Evidence: `.trellis/tasks/07-12-mystudio-chapter001-visual-continuity/research/toonflow-chapter001-portable-fixture.json`.
- [x] AC2: 第一章所有重复角色和场景均有版本化 continuity manifest，且 43 镜有序参考覆盖率为 100%。
  - 2026-07-13 progress: existing MYStudio storyboard image workflow reference nodes now populate `orderedReferenceManifest` and `continuityState` for 43/43 storyboards; this proves structural coverage but not full approved character/scene bible quality.
- [x] AC3: 测试证明角色六层锚点、多视图、variation、场景 viewpoint 和 ordered references 确实进入最终 provider 请求。
- [x] AC4: 测试证明相邻镜头组共享连续状态，上一镜变化会使依赖镜头 stale，恢复运行不会复用旧不一致图。
- [ ] AC5: 先选码头连续段至少 6 镜；人工确认独孤剑尘、赵四、小杂役的脸、服装、体型和码头空间连续后，才允许全章生成。
  - 2026-07-13 review:码头 `shot-001` through `shot-012` failed visual review; current images must not be marked approved. Evidence: `research/visual-review-20260713.md`.
- [ ] AC6: 43 镜视觉审查台账无 rejected；重复角色、场景和关键道具均有逐镜证据，不能只报告 prompt 合规。
- [ ] AC7: 全章新视频继续满足 43 镜、43 条真实口播、固定音色指纹不变、音视频流完整和时长上限。
- [x] AC8: 产品一键路径在视觉门禁失败时阻断 merge，并显示具体镜头与原因；通过后才输出最终 MP4。
  - 2026-07-13 verification: `npm run smoke:workflow:background:daojie -- --auto-video` correctly blocks final merge with 43 pending visual-review items and no MP4 `finalPath`; background focus evidence stayed clean (`foregroundViolation=false`).
- [x] AC9: 当前项目源数据、旧 43 图和旧 MP4 均有可追溯备份，重生成过程无破坏性删除。
  - 2026-07-13 blocker: current configured image providers are still only `凡人:gpt-image-2` and `torchai:gpt-image-2`; last real generation failed with `insufficient_user_quota`. Regeneration cannot proceed safely until a funded/capable provider is configured or topped up.
  - 2026-07-16 progress: `mikoto:gpt-image-2` completed one real v5 Bible generation through the provider's asynchronous image-task API. The resulting 独孤剑尘 thumbnail is `768×576`, `344,937 bytes`, and remains `pending` until explicit human visual approval; this resolves the earlier provider/quota blocker but does not satisfy AC5 or AC6.
  - 2026-07-16 progress: 独孤剑尘 v5-r2 uses a `512×768` / `135,357 bytes` composite transfer reference to align the character board with the oilcloth-wrap canonical. Its three views share one rope layout and expose no waist sword or blade; the `768×576` / `384,731 bytes` output remains `pending`, with the still-rectangular bundle silhouette requiring human approval.
  - 2026-07-16 progress: the independently generated 油布剑包 v5 candidate has three ordered orthographic views, a transfer thumbnail of `768×576` / `342,993 bytes`, and no exposed weapon in AI-assisted inspection. It remains `pending`; the inspection is not a human approval.
  - 2026-07-16 retry required: the first 灵矿藤筐 v5 candidate passed the `768×576` / `337,607 bytes` transfer gate, but its shattered-state panel still contains and spills substantial ore. This contradicts shot 10's empty-basket state, so the candidate is retained for evidence but must not be promoted or approved.
  - 2026-07-16 progress: 灵矿藤筐 v5-r2 corrects the failed state while preserving the intact/empty/shattered identity; the shattered panel contains only broken rattan and no ore. Its `768×576` / `327,781 bytes` thumbnail remains `pending` for explicit human approval.
  - 2026-07-16 progress: 灵矿 v5 provides intact-spiked, pressure-cracked/brine, and fragment states and passed the `768×576` / `362,660 bytes` transfer gate. It remains `pending`; the loaded ore in the basket board must still be aligned to this canonical appearance before either asset is promoted.
  - 2026-07-16 progress: 灵矿藤筐 v5-r3 uses a `512×768` / `146,218 bytes` composite transfer reference to align its loaded state with the canonical dark blue-grey ore while keeping the intact-empty and broken-empty states ore-free. Its `768×576` / `358,853 bytes` thumbnail remains `pending` and supersedes r2 only after explicit human approval.
  - 2026-07-16 progress: the v4 赤练蛇皮鞭 source was reused without mutation and produced a standalone `768×512` / `645,456 bytes` transfer thumbnail plus a pending-review report. Its four-panel presentation still requires explicit human confirmation as one canonical prop board.
  - 2026-07-16 retry required: the v4 残卷 source passed the `768×512` / `647,244 bytes` transfer gate but failed visual preflight because multiple legible text lines remain beside the required `等` anchor and the four panels vary in tie/end-cap details. It is retained as failed evidence and must not be promoted.
  - 2026-07-16 progress: 残卷 v5 contains exactly one legible red `等` character and no other text, seal, or pseudo-writing in AI-assisted inspection. Its `768×576` / `313,322 bytes` thumbnail remains `pending` for explicit human approval.
  - 2026-07-16 progress: 监工赵四 v4 preserves the same wide-square face, severe eyes, long black hair, stocky build, and worn grey-white overseer clothing across portrait/front/side/back views in AI-assisted inspection. Its `768×576` / `353,056 bytes` thumbnail remains `pending` for explicit human approval.
  - 2026-07-16 progress: 小杂役 v4 preserves one slight adolescent body, ragged short jacket/trousers, bare feet, and consistent portrait/front/side/back views; the face is soft and androgynous but not an adult face. Its `768×576` / `342,427 bytes` thumbnail remains `pending` for explicit human age/gender approval.
  - 2026-07-16 progress: 金水河码头 v4 preserves the declared main axis: wet steps/platform and baskets/ore on the left, bollards/rope/boat on the right, centered river perspective and misty mountains under cold diffuse light. Its `768×512` / `300,457 bytes` thumbnail remains `pending` for explicit human approval.
  - 2026-07-16 blocker update: the non-overwriting `old-laborer-turnaround-r2` correction also ended after its only POST with `UND_ERR_SOCKET: other side closed`; the durable report records `ambiguousPaidRequest=true` and `resubmitAllowed=false`. `young-laborer-turnaround-r2` was not submitted. The Bible now requires explicit human authorization before any ambiguous paid request is retried, or a documented provider task ID recovery path; no automatic provider/tool fallback is permitted.
  - 2026-07-17 explicit authorization: the user accepts the possible duplicate charge and authorizes exactly one non-overwriting resubmission of the old laborer as `old-laborer-turnaround-r3`, exactly one non-overwriting resubmission of the girl as `girl-turnaround-r2`, and the first submission of `young-laborer-turnaround-r2`. These jobs must use the freshly verified single-provider/single-key probe path, run serially, preserve all prior failure evidence, and stop the remaining paid calls on any new ambiguous failure.
  - 2026-07-17 rerun result: `old-laborer-turnaround-r3` consumed its one authorized POST and again ended with `UND_ERR_SOCKET: other side closed`, with no task ID, output image, or thumbnail. Its unique durable report records `generationEndpointCalled=true`, `generatedImages=0`, `ambiguousPaidRequest=true`, and `resubmitAllowed=false`; therefore `girl-turnaround-r2` and `young-laborer-turnaround-r2` were not submitted.
- 2026-07-17 recovery finding: Mikoto's public `1k异步文档` now provides verified endpoints for immediate task-ID creation and polling. The local helper already implements this exact contract and passes its mock regression. Switching the next paid attempt to `asyncMode=true` is no longer a guessed capability, but still requires a new authorization because the old-laborer r3 allowance was consumed and the stop-on-ambiguity gate halted the remaining jobs.
- 2026-07-17 explicit authorization renewal: the user authorizes exactly one non-overwriting asynchronous resend for `old-laborer-turnaround-r4`, exactly one non-overwriting asynchronous resend for `girl-turnaround-r2`, and the first asynchronous submission for `young-laborer-turnaround-r2`, accepting possible duplicate charges. These three calls must be serialized through the verified single-provider/single-key probe path; any new ambiguous failure immediately stops the remaining calls. Prior failure evidence and all old outputs remain immutable.
  - 2026-07-17 renewed explicit authorization: the user accepts possible duplicate charges and authorizes exactly one asynchronous, non-overwriting resend of the old laborer as `old-laborer-turnaround-r4`, exactly one asynchronous, non-overwriting resend of the girl as `girl-turnaround-r2`, and the first asynchronous submission of `young-laborer-turnaround-r2`. Run them serially through the verified single-provider/single-key path; preserve r2/r3 evidence and stop all remaining paid calls on any new ambiguous failure.
- [x] AC10: 新的离线门必须使当前镜头 001 和 43 镜 manifest 在网络前明确阻断，至少报告 `dock-ragged` 版本不兼容、被选参考图不满足 V2 色彩方向、码头傍晚/晨雾冲突、别名所有权冲突（若存在）、主体前置缺失（若存在）和 semantic-role 证据边界；修复后不得触碰 provider、台账、store、批准或旧输出。
  - 2026-07-21 closure: `research/daojie-gongbi-v2-break-loop-43-shot-dry-run-20260721-r05/report.json` records 43/43 blocked before transfer/network with `reference_color=43`, `scene_time_conflict=12`, and `incompatible_wardrobe_version=6`; selected-reference hash mismatch, missing leading characters, and alias failures are all zero. Capability is 43/43 ready while semantic roles remain explicitly unverified with `providerRoleMetadataSent=false`. All 43 prompt SHA-256 values self-verify under `providerPromptPolicy=exact-reviewed-v2`; endpoint calls, attempts, paid authorization, and production mutation are zero. Report SHA-256: `81b57fb0a5fe0363f4e35551b45a2ac4007d698969d9ca9537cd98d811d01223`.

## Out of scope

- 不照搬 Toonflow SQLite/OSS 作为 MYStudio 的生产存储。
- 不训练自有 LoRA、InstantID 或人脸模型；若现有 provider 无法达到要求，先通过能力门禁暴露限制，再单独规划模型升级。
- 不修改小说正文、口播文本或固定音色绑定。
- 不在首批直接全量覆盖 43 张图；必须先通过连续样本门禁。

## 2026-07-15 Grill decisions and fresh blockers

- 用户选择 **Bible 先行**：任何角色、场景或关键道具版本都不能再因字段齐全或文件存在而自动批准；必须有与当前内容指纹匹配的人工批准记录。
- 码头 pilot 默认逐镜串行：当前镜批准后，批准图才可作为下一镜的状态参考；全新 pilot 必须报告 `generatedImages=7`、`reusedImages=0`。
- 独孤剑尘 `grey-town` 基准必须是银白长发、破旧灰袍、背负三层油布剑包，禁止露出腰悬完整剑；小杂役 `dock-ragged` 必须是十二三岁少年、褴褛短褐与破旧裤装、赤足，禁止及踝长袍和成年女性脸。
- 分镜 23–24 的主场景必须是 `悦来客栈斗室/inn-room-window-axis`；`金水塾馆` 只能作为窗外 secondary scene，不能替代主场景版本。
- 所有本地或 data-URI 图片发送前必须生成约 768px 的缩略图，实际二进制严格 `<1,000,000 bytes`；解码或压缩失败时在网络请求前硬失败。
- 当前 43 镜保持 `pending`，不得使用脚本或自动 reviewer 批量写成 `approved`。

## 2026-07-17 paid-request safety contract

- 连续性 pilot 的每个付费请求必须带 `logicalJob`、`logicalShot`、`attemptId` 和显式 `--confirm-paid-request`；默认恢复、换 output 目录和视觉失败都不能隐式授权新 POST。
- Node helper 在真实缩略图准备完成后计算 `promptSha256`、有序 `referenceSha256`、实际 generation endpoint、`payloadSha256` 和 `requestFingerprint`，并写入跨 output 的 append-only ledger。
- 同一 fingerprint 出现 `POST_SENT`、`TASK_ACCEPTED`、`AMBIGUOUS` 或 `COMPLETED` 时，在网络请求前硬阻断；pilot 还必须是单 provider、单 key、`singleAttempt=true`，禁止 fallback。
- 旧报告缺少 task/endpoint/payload 证据时只能标为未充分观测，不能由 `generatedImages` 推断付费次数或安全重跑。
