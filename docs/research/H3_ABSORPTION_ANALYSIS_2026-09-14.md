# 漫影吸收分析:H3 漫剧生态 → 本项目(2026-09-14)

> 历史研究/交接记录（2026-09-20 适用范围复核）：保留文件名和文内日期对应的判断、未决项与实验结果，未重新执行原实验。旧路径、外部项目能力和当时任务状态仅供追溯；现行操作查[工作流教程](../workflow/WORKFLOW_GUIDE.md)、[开发架构](../engineering/DEVELOPER_ARCHITECTURE.md)。

> 前置阅读:[H3 漫剧产线生态调查](./H3_COMIC_DRAMA_ECOSYSTEM_RESEARCH_2026-09-14.md)(生态全貌与来源)。
> 本文=把调查对照漫影**代码实况**后的吸收裁定建议;标【待拍板】的项需用户点头才动。
> 实况核验(2026-09-14,rg 全库):分镜表行已含镜号/场景/描述/景别/运镜/时长+台词/声音/关联资产(`storyboard-pipeline-comfy.ts:326`);Remotion shot 已有 TTS/sfx 状态、音频绑定指纹、重复混音风险检测(`workflow-node-model-schema.ts:132`);视频生成路由为云端 provider(`lib/ai/video-generator-routing.ts`)。
> **09-14 晚间更正**:本文早间曾记「官方提示词格式产线零接线」——当日 05:45-05:54 并行会话已落地 `h3-shot-prompt.ts`(I2V 三字段 builder)+`h3-shot-template.json` 单镜模板,该结论过时,下表与 P0-1 已按新实况修正。同日按用户裁定执行「超分不进工作流」:模板已摘浅空间放大两段式与 SeedVR2,改单段直出(详见 KB 分镜图生成与超分指引)。

## 〇、现状对照表(外部能力 × 漫影现状 × 缺口)

| 外部能力 | 来源 | 漫影现状 | 缺口判定 |
|---|---|---|---|
| H3 官方提示词三字段/六节格式 | 官方技能(本地已持有) | **I2V 三字段 builder 已落地**(`h3-shot-prompt.ts`,09-14 并行会话);仍缺 Ref2VA 六节与 FL2VA/L2VA/T2VA 模式 | **半缺,P0 余量** |
| 素材调度指令(@素材名→自动挂参考) | JZL(MIT)/BigBanana | 图像侧有「自动装配 1+3=4 张」;视频侧参考口调度无 | **缺,P0**(=镜级动作) |
| 逐段落盘防崩+自动合并+分段块协议 | JZL(MIT) | Remotion 链有 jobId/mediaPath,无 H3 段落落盘策略 | **缺,P0**(=组装器) |
| 上下文潜空间衔接 vs 末帧交接 | 随风/PT(无license) | 两者皆未建(桥视频待开工) | **缺,P0 选型** |
| 连续性衔接字段+空间锚点四子字段+Hook | 官方九步管线 | 分镜行无这些列 | 缺,P1 |
| 镜头表自检门(lint) | 官方/shuohao | 无分镜 lint | 缺,P1 |
| 双采二采(FaceRefine+VOSR2 人脸精修) | 理不懂/随风 | 清晰度四件套已裁(480P/960P/SeedVR2),无人脸双阶段 | 缺,P1【待拍板:权重共存】 |
| 645 条原版提示词语料 | SkyNotSilent(MIT) | 无提示词语料库 | 缺,P1 |
| 九宫格首帧选构图 | BigBanana/导演台3.0 | 导演工作台有四宫格/S级镜头/视角切换 | 部分有,P2 |
| 镜头语汇卡库(67 卡+何时别用) | shuohao(Apache-2.0) | 导演手册/风格手册有,无逐镜「何时用/别用」卡 | 部分有,P2 |
| 时长按语速折算 | shuohao | 分镜时长列为手填/LLM 估 | 缺,P2 |
| 爽点表/钩子冷开场 | shuohao/官方 8 拍骨架 | 剧本三阶段生成+审核修复已有 | 增量,P2【待拍板:短剧口径】 |
| BGM 整片一条+对白下 duck | 官方规则 | 音乐域(M3)出整曲+Remotion 时间线 | 规则增量,P2 |
| 逐镜混合模型(video_model 字段) | 官方 | H3 单引擎+云端备胎(mikoto 等) | 未来项,P2 |
| 衣橱系统 | BigBanana | **已有**:角色三视图+造型变体(`assets/CHARACTER_GENERATION_GUIDE.md`) | 不吸收 |
| 场景多视角 | BigBanana/漫游者 | **已有**:四视图/联合图(`assets/SCENE_MULTIVIEW_GUIDE.md`) | 不吸收 |
| 首尾帧分镜卡片 | 各家 | **已有**:`director/DIRECTOR_SHOT_CARD_REFERENCE.md` | 不吸收 |
| 全局风格锁(风格词剥离) | 官方/老王 | **已有**:AI 提取风格词+视觉手册(`assets/VISUAL_STYLE_MANAGEMENT.md`) | 不吸收 |
| 台词本聚合音色提示词 | shuohao | **已有**:资产音色分配+自动匹配链路 | 不吸收 |
| API 聚合调度(万象AI式) | 随风 | **已有**:自有 provider 路由体系 | 不吸收 |
| MLX 双栈跑 H3 | Phosphene(MIT) | **违令**:单一套权重铁律(09-10 裁定) | **禁** |

## 一、P0 吸收(对齐 09-14 三件待开工,建议立即做)

### P0-1 官方提示词格式接线(前半已由并行会话落地,余量收窄)

**已落地(09-14)**:`h3-shot-prompt.ts` 的 `buildShotH3Prompt` 已产出 I2V 官方格式——固定首行+`integrated_multimodal_description`/`overall_soundscape`/`non_diegetic_music` 三字段、`<d>[Chinese]` 对白+(S1) 说话人、音频三策略(ambient/full/bare=测试矩阵三开关)、17k+5 帧吸附、中文运镜→官方词表映射;`h3-shot-video-workflow.ts` 将其注入单镜模板。
**余量**:①FL2VA 双图对齐句(尾帧秒数两位小数)/L2VA 尾帧起播/T2VA 三模式;②Ref2VA 六节结构(subject_definitions…retention_analysis…);③云端口径 `@素材名` 十二角色声明。落点同前:`lib/assist/image-studio/` 扩展 builder+金样本对拍。
**来源与合规**:照公开规范自研,不拷官方技能文件(MiniMax-H3 仓库 NO LICENSE)。

### P0-2 素材调度指令系统(镜级动作的后半)

**进展(09-14 晚,任务 09-14-h3-ref2va-line)**:纯函数层已交付——`buildShotH3RefPrompt`(六节 Ref2VA 提示词,<Subject>/<Picture> 绑定)+ `h3-shot-template_ref2va_my.json`(单段直出同构变体:ReferenceToVideo 节点+ref_image_0..4 具名槽+ref2va 权重+去 fl2v LoRA)+ `buildShotH3RefWorkflow`(分镜图恒 ref_image_0,资产按序激活 110-113 槽);双档制=I2V 默认/Ref2VA 一致性加强。**待办**:宿主接线(assetIds→定妆/场景代表图→全尺寸上传,归并行会话域,设计在其任务 design.md)+ **ref2va 权重落位**(引擎家仅 fl2va,外置盘 H3 族有,模型自装铁律不代拷)——实弹 blocked 于此。
**本机实证约束(比 JZL 更细)**:`Picture` 槽位=首/尾帧图,**不是**自由参考槽;场景图禁占 Picture2(参数速查【实测】)。调度器必须区分「语义 Picture 槽」与「自由参考槽」——场景/道具走自由参考,首尾帧走 Picture。(注:此铁律属 I2V/FL2VA 语义;Ref2VA 档无 Picture 首尾帧概念,全部走参考槽并由六节提示词声明分工。)
**来源与合规**:JZL(MIT)可参考其调度实现;BigBanana「上下文注入(场景图+当前服装图)」思路同吸收。

### P0-3 组装器工程件

**是什么**:①`[SHOT_START]` 分段块协议——LLM/拆段产物成为**可回放中间产物**(改一段不用全重跑);②逐段生成后**立即 ffmpeg 落盘**(中途崩溃已生成段不丢)+按序自动合并。
**为什么**:「单日一部剧」的工程底座;漫影 Remotion 链已有 jobId/mediaPath/指纹工程,H3 段落产物对齐 `ProductionFlowRemotionShot.mediaPath` 即可接入既有成片链。
**落点**:分镜×H3 组装器(待开工件);落盘目录对齐引擎家 output 域。
**来源与合规**:JZL USAGE.md 工程模式(MIT)。

### P0-4 桥视频路线选型【建议,终裁归用户】

**建议**:末帧交接先行,上下文潜空间衔接(A/V latent 喂下一段)留实验位。依据:①衔接路线 B 站已实证可行但工程复杂度(latent 拼接/显存/调试)显著更高;②末帧交接与已裁定的音频三开关测试矩阵兼容,增量最小;③衔接路线的独立参考 `PT_H3ConcatAVLatent` 无 license 只能看思路,自研成本要预留。

## 二、P1 增强(近期吸收)

| # | 项 | 内容与落点 | 备注 |
|---|---|---|---|
| P1-1 | 分镜数据模型扩展 | 分镜行加三组列:**连续性衔接**(承接上镜/交接下镜)、**空间锚点**(固定地标+画面相对位置/人物位置机位视角/退场人物状态/光位基线)、**Hook 类型**(受控词表)。改 `workflow-node-model-schema` 族+分镜表两行制渲染 | 官方九步管线核心;Remotion 侧已有指纹工程,列扩展成本低;表行会变宽,UI 需适配(折叠/摘要) |
| P1-2 | 镜头表自检门(lint) | 六项硬检做成脚本化质量门:单镜 ≤15s(漫影 5s 裁定下天然过)/单镜 ≤3 重要角色/同场景地标+光位继承/跨镜连续性链成链/每秒指令覆盖(5s 镜=5 条)/hook 密度 | 漫影已有质量门文化(shuohao 全脚本门禁同思路);lint 报告进分镜面板 |
| P1-3 | 双采二采(清晰度视频侧) | 480P 测试/960P 生产(已裁)之后加 **FaceRefine+VOSR2 人脸双阶段精修**档,对齐「清晰度四件套」图像侧 SeedVR2 的地位 | 【待拍板】新增两套权重与单一套铁律的关系:VOSR2 归超分域与 SeedVR2 是否互斥/替换,须用户裁定 |
| P1-4 | 提示词语料库 | 装 SkyNotSilent prompt-library 技能(MIT),645 条原版提示词做 builder 对拍与 LLM 翻译器 few-shot 语料 | 装技能需用户确认(第三方代码全项目权限) |

## 三、P2 候选(按需/待拍板)

- **九宫格首帧选构图**:导演工作台四宫格的姊妹模式(同镜 9 视角选构图,整图或裁单格作首帧)。三方印证但均为思路层(无可拷代码)。
- **shot-recipes 67 卡镜头语汇库**(Apache-2.0 可吸收带署名):导演手册挂「何时用/何时别用」卡库;20 个 H3 官方运镜词全覆盖,与 P0-1 运镜换算互补。
- **时长按语速确定性折算**:台词字数×语速→镜时长预算,替代手填;shuohao 思路(规范可自研)。
- **爽点表/钩子冷开场**:短剧向剧本质量门。【待拍板】漫影是否走短剧赛道口径——现剧本链(三阶段生成+审核修复)偏叙事电影向。
- **BGM duck 规则**:成片时间线「对白/音效下压 BGM、整片一条 BGM 不逐镜配乐」——Remotion 混音段规则增量。
- **逐镜混合模型**:`video_model` per-shot 字段(H3 默认+云端备胎回退)——等漫影接入第二视频引擎后再做。
- **light2V 8 步加速 LoRA**:【待实测】Turbo 伤音频前例在案,先跑音频 VAE 对照实验再定。

## 四、明确不吸收(已有等价或违令)

已有等价:衣橱(造型变体)/场景多视角(四视图)/首尾帧卡片/风格锁(AI 提取风格词)/音色聚合分配/provider 路由聚合——见对照表「不吸收」行,勿重复建设。
违令:MLX 双栈(Phosphene)触单一套权重铁律;BigBanana 代码(CC BY-NC-SA 非商用);MiniMax-H3 仓库 8 技能**文件**(NO LICENSE,思路可借鉴);style-atlas/PT_H3ConcatAVLatent/awesome-video-prompts(无 license,指针 only)。

## 五、建议实施顺序

```
P0-1 提示词 builder ──┐
P0-2 素材调度 ────────┼─→ 分镜×H3 镜级动作(三件待开工之二)
P0-3 组装器工程件 ────┘
P0-4 桥视频:末帧交接先行 → 衔接实验位
P1-1/P1-2 分镜模型扩展+lint(可与 P0 并行,数据模型先行)
P1-3/P1-4 与后续打包轮同批
```

P0 四件全部合规可立即开工;P1-3 与 P1-4 的两处【待拍板】、P2 的短剧口径与 light2V 实验等用户裁定。
