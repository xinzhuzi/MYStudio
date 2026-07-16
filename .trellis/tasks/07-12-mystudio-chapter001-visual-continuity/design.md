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
