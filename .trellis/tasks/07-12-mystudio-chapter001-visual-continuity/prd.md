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

## Acceptance criteria

- [ ] AC1: Toonflow 43 镜只读 fixture 可复现 `storyboard -> ordered assetId -> fixed imageId -> filePath -> golden image`，缺失为 0。
- [ ] AC2: 第一章所有重复角色和场景均有版本化 continuity manifest，且 43 镜有序参考覆盖率为 100%。
- [ ] AC3: 测试证明角色六层锚点、多视图、variation、场景 viewpoint 和 ordered references 确实进入最终 provider 请求。
- [ ] AC4: 测试证明相邻镜头组共享连续状态，上一镜变化会使依赖镜头 stale，恢复运行不会复用旧不一致图。
- [ ] AC5: 先选码头连续段至少 6 镜；人工确认独孤剑尘、赵四、小杂役的脸、服装、体型和码头空间连续后，才允许全章生成。
- [ ] AC6: 43 镜视觉审查台账无 rejected；重复角色、场景和关键道具均有逐镜证据，不能只报告 prompt 合规。
- [ ] AC7: 全章新视频继续满足 43 镜、43 条真实口播、固定音色指纹不变、音视频流完整和时长上限。
- [ ] AC8: 产品一键路径在视觉门禁失败时阻断 merge，并显示具体镜头与原因；通过后才输出最终 MP4。
- [ ] AC9: 当前项目源数据、旧 43 图和旧 MP4 均有可追溯备份，重生成过程无破坏性删除。

## Out of scope

- 不照搬 Toonflow SQLite/OSS 作为 MYStudio 的生产存储。
- 不训练自有 LoRA、InstantID 或人脸模型；若现有 provider 无法达到要求，先通过能力门禁暴露限制，再单独规划模型升级。
- 不修改小说正文、口播文本或固定音色绑定。
- 不在首批直接全量覆盖 43 张图；必须先通过连续样本门禁。

## Goal

深度对照 Toonflow 第一章真实分镜与生图链，修复 MYStudio 跨镜场景、人物身份、服装、构图和状态连续性，并重生成验收。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
