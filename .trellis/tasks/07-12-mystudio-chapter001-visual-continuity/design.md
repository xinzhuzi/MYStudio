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
