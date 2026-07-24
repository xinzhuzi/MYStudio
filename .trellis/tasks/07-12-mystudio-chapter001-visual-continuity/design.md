# 第一章视觉连续性技术设计

## Data flow

```text
Toonflow read-only fixture / MYStudio project entities
  -> character and scene bibles
  -> ordered continuity manifest per storyboard
  -> shot-group state and dependency fingerprint
  -> provider capability-aware image request
  -> structural audit + visual supervision
  -> approved storyboard image
  -> existing TTS/audio + video merge
```

## Core contracts

### Continuity asset version

稳定键由 `assetId + versionId` 组成。角色 version 表示基础形象或明确服装/伤势阶段；场景 version 表示固定视角/时间/天气；道具 version 表示剧情状态。每个 version 保存 canonical reference paths、identity anchors、negative constraints 和来源证据。

### Ordered reference manifest

每镜保存 `order/assetId/versionId/type/imagePath/referenceRole/source`。生成节点、报告和 provider request 都从该 manifest 投影，禁止各层重新解析名称。

### Shot group continuity

同一连续段保存 `groupId/previousStoryboardId/sceneVersionId/characterStates/blocking/lighting/actionIn/actionOut`。输入指纹由 prompt、ordered manifest、provider 参数和上一镜 approved evidence 计算；上游变化后当前及下游镜头进入 stale。

### Visual review

审查结果保存 `storyboardId/status/reasons/characterChecks/sceneChecks/transitionChecks/reviewer/evidence`。自动检测只提供问题定位；最终 merge 要求所有需生成镜头为 approved。

## Provider boundary

- Provider adapter 明确声明多参考图、参考顺序、图生图/编辑、seed 等能力。
- 支持连续编辑时，组内请求附加上一镜 approved image，角色 canonical references 始终保持最高优先级。
- 不支持时，仍使用 fixed ordered references，但结果必须经过更严格视觉审查，且不得声称 deterministic identity lock。

### Paid request boundary

The Python pilot owns logical job/shot metadata and explicit operator
authorization. The Node helper owns normalized prompt/reference transfer bytes,
the actual generation endpoint, and the request payload hash. Both layers share
the append-only `paid-image-request-ledger.mjs` contract; its latest blocking
status prevents a duplicate fingerprint before network I/O. Ledger-backed pilot
calls are single-provider/single-key and never use provider/key fallback after a
transport-ambiguous POST.

## Compatibility

- 保留现有 `StoryboardItem.mediaRef` 和 image workflow graph；新增字段可选读取，迁移后新生成必须写全。
- 旧图保留为 revision 0；新图使用 revision/approved 状态，不覆盖前先备份。
- 口播、audioRef、voiceProfileId 和 fixed binding fingerprint 不参与视觉重选。

## Rollback

每批生成前记录 store、43 图、MP4 和 continuity manifest 的 SHA-256；失败时将新 revision 标记 rejected，不删除旧 revision。恢复只需切回旧 approved mediaRef。

## Asset approval and transfer contracts

- `ContinuityAssetVersion` 同时保存结构完整性、内容指纹和可选人工批准记录。`approved` 仅是“人工批准存在且指纹仍匹配”的派生结果。
- 资产内容指纹覆盖参考图路径/哈希、视角、身份锚点、服装版本，以及场景布局、光线、色板和 viewpoint。任一输入变化都会使资产批准和依赖分镜审核失效。
- 每镜必须有且只有一个 `scene-viewpoint` 与 `continuityState.sceneVersionId/sceneViewpointId` 完全匹配；其他场景引用使用 `secondary-scene`。
- `VisualReviewResult` 增加关键道具检查和文字/水印检查；引用资产未批准时产品 UI 不允许提交镜头批准。
- inline provider 图片统一经过 transfer gate：最长边约 768px，按质量/尺寸逐级降级，严格 `<1,000,000 bytes`，并记录尺寸、字节数和 SHA-256。

## Storyboard promotion and authoritative reuse

- 逐镜生成链的人类批准只用于证明当前输出可作为下一镜状态参考；它不能直接伪装成产品 `VisualReviewResult`。产品终审仍必须在推广后逐镜完成人物、场景、道具、转场和文字/水印检查。
- 全章推广使用独立 CLI，默认 dry-run，写入同时要求 `--apply` 与 `--human-confirmed`。它必须验证 43/43 输出、原图 SHA-256、独立 `<1,000,000` byte `_thumb.png`、逐镜批准指纹和完整六组报告。
- 推广图写入项目内的内容寻址 revision 路径，不覆盖旧分镜图；store 写入前建立独立备份。推广后镜头清除已重生成的 stale 状态，但视觉审核只能是 `pending`，不得自动变为 `approved`。
- 真实 direct-video 只能复用已经通过产品视觉终审的当前 media revision，并保留其 ordered manifest、continuity state 和 review input fingerprint；不得再次调用图片 provider 或用新生成图绕过已有批准。

## MA ImageGen Art Direction v2

- `daojie-gongbi-v2` 是分镜 prompt 的版本化本地契约。它从 `$ma-imagegen` 的道劫水墨国风静态契约和 `2D工笔风` 元数据提炼，但 MYStudio 运行时不依赖 Unity 项目绝对路径。
- 契约固定装配顺序为：剧情/身份事实、工笔与写意的媒介分层、镜头空间、矿物色与材质、平光纸面照明、针对本镜的负面约束。场景模块只能补充本镜的道具、空间与冷暖关系，不能重引全局竹窗、卷轴、瀑布或灰蓝滤镜。
- Node 默认 generations 模式仍传有序 `image_urls`；经能力清单显式选择时，可改用 Toonflow-compatible `/v1/images/edits` multipart 传输。只有在不付费能力契约或一次另行授权的探测证实容量后，才可在末位追加 style reference。否则用文本风格锁，不删除任何逻辑连续性资产。
- `styleContractVersion`、启用时的 style-reference SHA-256 和实际 prompt 纳入 input fingerprint。v2 与 006–009 的旧指纹不同，旧图只能保留为审计证据，不能在 v2 下作为 010 的上一镜引用；重新进入 pilot 必须从受影响的首镜开始并获得新的付费授权。
- 每个新输出先过静态 prompt audit，再过 `$ma-imagegen` 的 PNG `audit-color`，再进行人工线描/综合色彩/衣物/水印审稿。自动门只会阻断或标记，不会批准图片。

## Toonflow-compatible image edit transport

- Provider configuration adds an explicit finite `requestMode`: the existing `openai-image-generations-json` mode keeps JSON `image_urls`, while `openai-image-edits` uses synchronous multipart `POST /v1/images/edits`. The edit mode rejects `asyncMode=true` before network access.
- Multipart fields follow the verified Toonflow adapter order: `model`, `prompt`, `size`, `quality`, then one repeated `image` part per ordered provider reference. The paid-request payload fingerprint uses a canonical boundary-independent descriptor, so random multipart boundaries cannot bypass duplicate-payment protection.
- A capability may opt into `referenceTransportStrategy=primary-per-asset`. The complete ordered source manifest and every logical `(assetId, versionId, referenceRole)` remain present in evidence, while provider transport selects one deterministic primary image for each logical asset. Character groups prefer `front`; otherwise they retain the first source image.
- This transport matches Toonflow's stable asset-to-image semantics instead of sending front/side/back sheets as separate provider references. Unknown strategies, incomplete logical groups, over-capacity output, remote/unverifiable source images, or missing request-mode agreement fail closed.
- The Toonflow local runtime is historical mechanism evidence only and is not a MYStudio production dependency. Production keeps the existing `mikoto / gpt-image-2` generations/async contract while applying the same `primary-per-asset` ordered-reference projection. No new endpoint or credential is required; every paid request still requires explicit authorization.

## Reference visual and semantic preflight

- Prompt bindings are asset-owned. Lookup aliases may help locate a source image, but they cannot enter prompt replacement ownership; an alias owned by more than one logical asset is a structural failure rather than a replacement-order choice.
- The preflight audits the exact provider-selected image for each logical asset. It records color audit diagnostics, wardrobe-version compatibility, scene time compatibility, source SHA-256, role and asset/version identity. A human approval does not waive a new V2 incompatibility discovered in the selected pixels or version contract.
- `dock-ragged` remains a historical store key only. It is incompatible with V2 generation and cannot be textually promoted. A new intact-workwear version must use a non-overwriting version ID, canonical image and content fingerprint.
- Prompt order is `reference index -> visible subjects/actions -> shot image facts -> concise identity/scene continuity -> medium -> composition -> palette/light -> negatives`. Repeated scene lighting, color palette and action prose are emitted once.
- Capability reports distinguish `transportEvidence` from `semanticRoleEvidence`. Ordered `image_urls` plus prompt markers are observable transport behavior; they are not provider-native role metadata and must be reported as such.
- Dry runs collect all blocking findings without network access and persist a complete report. Real runs assert the same preflight immediately before reference transfer and provider invocation.
- V2 provider transport is byte-preserving for prompt text. The reviewed manifest `promptSha256` and paid ledger `promptSha256` identify the same prompt; only legacy non-V2 requests may use the Node clean-image suffix.
- The local color prefilter mirrors MA `audit_polychrome_image`: 30%-70% is the hard chromatic band, while dominant-hue and warm/cool hard gates begin at 45%. Its diagnostics do not replace the seven-field human review.
- A no-network full-chapter run selects the sole `status=verified` provider/model from the capability manifest without loading an API key. Zero or multiple verified records fail closed instead of depending on hidden process configuration.
