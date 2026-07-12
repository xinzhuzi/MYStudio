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
