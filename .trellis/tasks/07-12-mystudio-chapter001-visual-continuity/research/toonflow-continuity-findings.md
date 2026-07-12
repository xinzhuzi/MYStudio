# Toonflow 与 MYStudio 长线视觉一致性调查

## Evidence summary

1. Toonflow 分镜生成入口：`Toonflow-app/src/routes/production/storyboard/batchGenerateImage.ts`。
2. Toonflow 每镜参考图顺序来自 `o_assets2Storyboard.rowid`；通过固定 `assetId -> imageId -> o_image.filePath` 取图，`getAssetsImageBase64()` 再按输入 imageId 顺序恢复。
3. 同一资产在跨镜中稳定复用固定 imageId：独孤剑尘 `imageId=1`、27 镜；斩魂剑 `imageId=2524`、26 镜；金水塾馆 `imageId=2511`、14 镜。
4. Toonflow 第 6、7 镜复用完全相同的有序参考集合：独孤剑尘、监工赵四、小杂役、斩魂剑、赤练蛇皮鞭、金水河码头反向视角；prompt 明确 3/4 朝向、前中后位置与上一动作结果。
5. Toonflow 使用受控场景变体：晨雾版、反向视角、夜景浓雾版、大堂正反打视角、斗室昏暗版。这些变体本身也是固定 imageId 资产。
6. Toonflow provider 输入仍是逐镜调用；稳定性主要来自上游资产、顺序、分镜状态和项目风格上下文，而不是神秘的全章单次生成。
7. MYStudio 当前真实 runner 每镜重新调用 provider，参考顺序由 `[scene, *assets]` 临时构造；没有版本化 ordered manifest、上一镜状态、镜头组或视觉验收。
8. MYStudio 已有六层身份锚点、角色多视图/variation、场景 contact sheet/viewpoints，但当前 `build_daojie_chapter001_workflow.py` 只传图片路径和通用一致性文案，没有读取这些结构。
9. 当前门禁 `assert_storyboard_prompt_audit()` 只验证提示词结构，不验证输出视觉结果；这解释了为什么报告 43/43 合规但肉眼仍明显漂移。
10. 当前 MYStudio 分镜计划与 Toonflow 原始计划不同，资产集合和镜头节奏也不同；视觉修复必须先修数据契约，不能继续盲目重抽当前图片。

## Root-cause ranking

| Rank | Root cause | Impact |
|---:|---|---|
| 1 | 分镜计划缺少明确朝向、位置、动作承接和受控场景视角 | 相邻镜头叙事和空间跳变 |
| 2 | 没有持久化有序参考 manifest，参考集合由名称临时解析 | 角色/场景引用不稳定、顺序漂移 |
| 3 | 六层身份锚点、多视图和服装版本未进入分镜请求 | 人物换脸、体型和服装漂移 |
| 4 | 每镜独立生成，没有 shot-group 状态和前镜连续参考 | 动作、构图和光线无法承接 |
| 5 | 只做 prompt 审计，没有输出视觉审查 | 不一致图片仍被标记 ready 并进入视频 |
| 6 | Provider 能力与实际参数未形成一致性契约 | 多参考图可能被弱消费或身份混淆 |

## Design implication

优先实现数据和门禁，再重生成：`character/scene bible -> ordered manifest -> shot group continuity -> provider request -> visual supervision -> approved image -> video merge`。仅增加提示词长度或批量重跑不会解决根因。
