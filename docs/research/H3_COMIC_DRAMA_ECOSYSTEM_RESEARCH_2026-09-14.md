# H3 漫剧产线生态调查(2026-09-14)

> 历史研究/交接记录（2026-09-20 适用范围复核）：保留文件名和文内日期对应的判断、未决项与实验结果，未重新执行原实验。旧路径、外部项目能力和当时任务状态仅供追溯；现行操作查[工作流教程](../workflow/WORKFLOW_GUIDE.md)、[开发架构](../engineering/DEVELOPER_ARCHITECTURE.md)。

> 调查范围:AI 视频制作方式全景、MiniMax H3 技能/提示词生态、GitHub 高星漫剧产线、B 站制作流程教程,四路交叉印证。
> 方法:find-skills 三源发现(skills.sh 注册表 + 策展目录 + GitHub 原生搜索)+ 官方仓库直读 + 视频页/飞书手册/RunningHub 工作流页逐条落实。
> 标注口径:【原文】= 直接读了源文件/页面;【转述】= 来自搜索摘要,未读原文。License 均经 `gh api` 核验(2026-09-14)。
> 与现有文档的关系:H3 运行参数见 `docs/comfyui-kb/参数速查.md`,提示词格式规范见 `.agents/skills/minimax-h3/SKILL.md` 与 `.agents/skills/h3-prompt-writing/SKILL.md`(即官方技能本地版);本文收**生态与产线方法论**,不重复参数表。
> 续篇:[漫影吸收分析](./H3_ABSORPTION_ANALYSIS_2026-09-14.md)——本文对照漫影代码实况后的分级吸收裁定建议(P0~P2+不吸收清单)。

## 结论摘要

1. **H3 本地漫剧产线在社区已成体系**:B 站四大学派 + GitHub 三套高星管线(3280★/1857★/1619★)+ 官方 8 生成器技能,方法论高度收敛——「剧本 LLM 拆段 → 资产定妆 → 宫格分镜首帧 → Ref2VA 素材调度 → 批量循环 → 二采精修」。
2. **官方仓库藏着完整工业化规范**:`MiniMax-AI/MiniMax-H3`(8567★)的 `skills/3d-animation-short-generator` 是一份「一句话→动画短片」九步产线规范(空间锚点/自检门/逐镜混合模型/失败回退阶梯),几乎条条可映射进漫影分镜环节。
3. **长视频连贯两条路线并立**:末帧交接(漫影现行) vs 上下文潜空间衔接(前段 A/V latent 喂下一段,音画都不断链)——B 站已实证后者可行(随风「一分钟短剧直出」),GitHub 侧对应 `ptmaster/ComfyUI-PT_H3ConcatAVLatent`。
4. **可吸收资产**:JZL 工作台(MIT)、shuohao shot-recipes 镜头语汇卡库(Apache-2.0)、zenstory 十技能(MIT)、SkyNotSilent 645 条原版提示词库(MIT)。**红线**:MiniMax-H3 仓库本体 NO LICENSE(思路可借鉴、文件禁拷)、BigBanana CC BY-NC-SA(非商用,漫影禁抄)。

---

## 一、AI 视频制作方式全景(2026-09 口径)

按「你锁什么」分六大控制族:

| 控制族 | 手段 | 代表 |
|---|---|---|
| 锁画面端点 | 首尾帧 → 多关键帧(单次最多 16 帧)→ 视频抽帧当关键帧 | 可灵 2.5 Turbo、Wan 2.7/3.0、Kling 序列帧 |
| 锁主体一致性 | 多图参考(Vidu 7 张)、`@` 语义绑定(Seedance 2.0 五图)、多模态参考(Seedance 3.0:30图+10视频+10音频)、视频参考吃 3D 结构、视频模型微调(主体 LoRA) | Seedance 系、可灵 O3、Vidu |
| 锁运动 | 运动笔刷(PixVerse 6 种/5 组+运动曲线)、**静态笔刷**(可灵独有,锁住不许动的区域)、轨迹控制、运镜参数 | PixVerse、可灵、Runway Gen-4 Turbo |
| 锁时间 | 续写/延长、**转场生成**(两段素材间生成转场)、**时间戳定向编辑**(Seedance 2.5:第 3-5 秒把 A 换 B)、绿幕编辑、视角编辑;长视频单镜(Seedance 3.0 30s 一镜) | Seedance 2.5/3.0、Higgsfield |
| 锁声音 | 音画同生三架构:统一多模态单次生成(Veo 3.1/Kling 3.0 Omni/Runway Gen-4.5/Seedance 2.5/Wan 3.0/Sora 2)vs 外挂 TTS vs 静默;Kling 3.0 Omni 五语种口型 + **跨镜头共享音频时间线** | Veo 3.1、Kling 3.0 Omni |
| 组合趋势 | 多镜头单次生成 + 共享音频 + `@` 参考三件套,「一镜成片」冲击分段拼接法 | Seedance 3.0、Kling 3.0 |

对漫影的含义:H3 本身即音画同生架构(音频 VAE),单镜 5s/124 帧裁定与行业方向吻合;行业把「分段协议」内化成模型能力,漫影的分镜×H3 计划(组装器/桥视频/镜级动作)正踩在趋势线上。若补能力,优先级:多图参考(`@` 绑定)> 尾帧起播(L2VA)> 运动/静态笔刷。【转述】

---

## 二、技能生态(find-skills 三源核验)

### 2.1 skills.sh 注册表(按价值排序)

| 技能 | 安装量 | 说明 |
|---|---|---|
| `minimax-ai/minimax-h3@h3-prompt-writing` | 7.7K | **官方提示词技能,本地 `.agents/skills/h3-prompt-writing` 即此**(源仓库 MiniMax-AI/MiniMax-H3),无需重装 |
| `SkyNotSilent/awesome-minimax-h3-cases` 三件套 | MIT/225★ | prompt-library(查 645 条原版提示词,铁律"绝不改写推断")/ tutorial-guide(按 OS/GPU/VRAM 选路线)/ submission-helper |
| `minimax-ai/skills@minimax-multimodal-toolkit` | 638 | MiniMax 官方技能仓(MIT,13544★)里的多模态工具箱 |
| `calesthio/openmontage@minimax-h3` | 239 | H3 蒙太奇技能 |
| `genmedia-labs/skills@ai-video-generation` 等三件 | 470K+ | 通用视频生成/图生视频/视频编辑(泛用) |

### 2.2 GitHub 高星漫剧产线

| 仓库 | 热度 | License | 摘要 |
|---|---|---|---|
| `eternityspring/shuohao-skills` | 3280★ | Apache-2.0 | 小说→漫剧六技能管线(详见 4.1),**附 67 张镜头语汇卡库**(17 配方+50 技法,20 个 H3 官方运镜词全覆盖且完整性是 lint 门) |
| `zenstory-ai/drama-skills` | 1857★ | MIT | 漫剧工作室上千项目实战蒸馏十技能(详见 4.2),五份 Markdown 工程制 |
| `shuyu-labs/BigBanana-AI-Director` | 2150★ | **CC BY-NC-SA(非商用)** | Script-to-Asset-to-Keyframe 工业化平台(详见 4.3);思路可参照,代码禁拷 |
| `xuanyustudio/LocalMiniDrama` | 1619★ | MIT | 本地漫剧工具(Electron+Vue),画布式分镜流水线;roadmap 有「场景图→AI 扩全景」「宫格合图直接生成视频」 |
| `SkyNotSilent/awesome-MiniMax-H3-cases` | 225★ | MIT | 1961 案例库/645 完整原版提示词/25 教程/370 创作者榜,可作提示词语料训练场 |
| `mrbizarro/Phosphene` | 218★ | MIT | Mac MLX 跑 H3+LTX-2.5、角色 LoRA、Pinokio 一键装——**与「单一套权重铁律」冲突,仅记录** |
| `ptmaster/ComfyUI-PT_H3ConcatAVLatent` | 66★ | **无 license** | 任意视频 A/V latent 拼进 H3 采样器=长视频上下文续写;指针 only |
| `hoodtronik/minimax-h3-style-atlas` | 19★ | **无 license** | 基于 ostris/minimax_h3_1k 数据集的 941 风格索引;指针 only |
| `wjluoxiao/ComfyUI-JZL-MiniMax-H3` | 91★ | MIT | B 站「一键短剧导演台」的开源节点包(详见 5.2),09-12 仍活跃 |
| `songguoxs/awesome-video-prompts` | 582★ | 无 license | veo3/veo3.1/kling/hailuo 提示词合集;指针 only |
| `luozhilzh/video-prompt-reverse` | 33★ | — | 视频反推提示词(成片→可复现提示词) |

另有 `MiniMax-AI/awesome-minimax-h3-integration`(322★)、`Alisa0808/vibe-creating-skill`(141★,双语文生视频提示词)、`q2522879285-source/minimax-h3-prompting-skill-public`(11★,MIT,社区 H3 提示词技能)。

---

## 三、官方提示词体系

### 3.1 本地权重口径(已持有,此处只列索引)

`.agents/skills/minimax-h3/SKILL.md` + `h3-prompt-writing/SKILL.md` 已覆盖:基础模式三字段(`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`)、Ref2VA 六节(`subject_definitions`/`summary`/`retention_analysis`/`detailed_description`+两音频节)、对白 `<d>[语言]…</d>` + (S1) 说话人、`<scenetrans>`/`<cutoff>`、I2V/FL2VA 固定首行与双图对齐句、运镜受控词表、17k+5 帧网格、参考上限 9图3视频3音频12文件。运行参数见 `docs/comfyui-kb/参数速查.md` H3 段。

### 3.2 云端口径(官方公式,Pixo 与官方手册交叉核对)【转述+部分原文】

**完整提示词 = 参考素材说明 + 核心创意 + 分段过程描述**

- **@文件引用十二角色**:角色参考(锁脸)/物体/场景/关键帧(声明首帧或尾帧)/声音/分镜稿/风格/构图/音频复用/动作参考(从视频锁动作)/运镜参考/视频编辑。没声明角色的文件 = 被无视的头号原因。
- 硬上限:合计 12 文件(9 图+3 视频+3 音频,视频/音频各 15s);文生上限 7000 字符;下限 = 主体外貌+场景+动作+风格四要素。
- **六错**:糊成一坨不分层 / 传文件不交代角色 / 要配乐又禁音乐 / 想一镜到底却写「镜头1/镜头2」/ 要面部一致不给锁脸参考 / 提示词太短。
- **救场四规则**:写镜头看得见的别写含义;画面文字原样引号;`non_diegetic_music: N/A` 显式掐音乐;切镜时指明新镜头景别+拍哪个已确立主体(防脸漂移)。
- 计价参考(2026-09):MiniMax Design 768P ¥0.23/s、2K ¥0.40/s,注册免费 3 次;秘塔接入 H3 后 768P ¥0.09/s、2K ¥0.15/s。【转述】

### 3.3 官方 8 个生成器技能(MiniMax-H3 仓库 `skills/`,NO LICENSE→思路可借鉴、文件禁拷)

`h3-prompt-writing` 之外还有 8 个风格化视频生成技能(双语,均读原文):3D 动画短片生成器、极简产品广告、合作游戏开场、手绘实拍融合、MV 字幕、品牌宣传、纸拼贴讲解、纸艺定格讲解。**对漫剧最有价值的是 3d-animation-short-generator**(完整方法论见 4.4);handdrawn-live(手绘实拍融合)的模板技巧:15s 固定五段节奏(0-3/3-6/6-10/10-13/13-15 每段必有新事件)、同一实体连续变形且保留前形态痕迹、相机慢半拍追拍、13-15s 空间级变形收尾、负面词表禁 3DCG/恐怖编码、prompt 跟随用户主语言。

另:仓库 `scripts/readme/` 证实 2K 路线 = hosted regenerate(Context-IR → regenerate-2k),本地开源侧无 2K。

---

## 四、漫剧制作技巧汇编(按产线阶段)

### 4.1 shuohao-skills(Apache-2.0)【原文】

- 管线:大纲五件套(改编说明/人物表/**爽点表**/分集梗概/资产清单)→ 角色设定集 → 美术设定集 → 剧本(场次+**节拍流**,逐集时长按**语速确定性折算**,台词本按角色聚合带音色提示词直通 TTS)→ 分镜。
- 分镜节奏门:**段 ≤15s → 单镜 2-5s 硬门**;主图钉 0.00 秒、子图钉各自切点;「H3 提示词对齐指令与切点时刻**逐字对账**」是脚本化质量门。
- shot-recipes:67 卡 = 17 配方卡(这场戏这一刀怎么切)+ 50 技法卡(**何时用/何时别用**,运镜/机位/景别/构图/焦段景深/光线/特殊技巧七类)。
- 全部技能自带零依赖 selftest;报告脚本化质量门(大纲 14 道/美术 11 道/剧本 10 道/分镜 17 道)。

### 4.2 zenstory drama-skills(MIT)【原文】

- 十技能:`short-drama`(入口/视觉方向 Look Development)→ novel-analyze(原著抽样快评)→ develop(分集地图)→ write → assets(人物/造型/场景/道具+连续性决策)→ image-prompts(lookdev 风格帧+参考板)→ storyboard(**Coverage Audition**:关键场次先比较信息时机/观看位置/表演空间再定镜头)→ video-prompts(单镜动作/多人物表演与**注意交接**/声音/起止状态/跨镜时间线音乐规格)→ produce(**投产前强制确认门禁**,任务有界预览)→ review。
- 工程制:每集只维护五份 Markdown(剧本/视觉设定/分镜/图片提示词/视频提示词);供应商凭据不进项目,adapter 可插拔。
- 来历:自家漫剧工作室上千项目蒸馏,替换掉 8 万行自建一体化工具——「留在自建工具里的只剩排队抽卡」。

### 4.3 BigBanana(CC BY-NC-SA,思路 only)【原文】

- 核心理念「先画后动」:先生成精准首帧(和可选尾帧)→ 模型在两帧间插值 → 全程受「角色定妆照+场景概念图」强约束。
- **衣橱系统**:每角色多套造型(日常/战斗/受伤)基于 Base Look,面部恒定服装可换。
- **上下文注入**:生成分镜图自动挂「当前场景图 + 角色当前服装图」,解决不连戏。
- **九宫格视角预览**:一键拆 9 视角先确认描述再生成,整图当首帧或裁单格。
- 网格化分镜表 + 镜头密度按时长自动规划;导出高清关键帧+MP4 片段进剪辑。

### 4.4 官方 3D 动画短片生成器九步管线(NO LICENSE,思路 only)【原文·SKILL.cn.md 全文】

1. **全局视觉风格锁**:渲染风格/角色造型/比例语言(2.5-3 头身 Q 版)/毛发/材质(SSS)/表演风格(挤压伸展)/动态/情绪尺度 + 负向约束(不要写实/扁平二次元/塑料皮肤/僵硬),全线产物统一挂载。
2. 项目简报(一句话 What-if/情绪前提/时长画幅**选项卡强制确认**/台词模式)。
3. 故事大纲:Want/Need/缺陷 + **8 拍因果骨架** + 守门检查(主角主动/危机由缺陷放大/巧合不解决问题/结局回收情绪锚点/台词揭示关系变化)。
4. **角色卡**:主 3/4 视角+正侧背三视图+表情+材质服装道具细节+重要道具标注+「身份锁」重复声明;锁定后警告:改设计=下游全重做。
5. **无人物场景卡**:只有环境,禁人物/剪影/手;关键光态+情绪子空间+**连续性地标**(同场景跨镜头保持屏幕位置的固定物体,如 door-frame 右侧 1/3)+光位基线。
6. **六列标准镜头表**:`镜头编号&时长 | 连续性衔接 | 参考锚点(空间+身份) | Hook类型 | 镜头描述(每秒指令) | 音频与对白轨`。参考锚点四子字段必填:固定地标(带画面相对位置)/人物位置(机位视角)/**退场人物状态**(离屏位置+原因,至少跟踪 1 镜)/光位基线。每秒指令 5 要素:动作姿态表情/镜头运动/空间位置/音频线索/与下一秒交接;亚秒节拍 `2.0–2.5s` 但禁时间空隙。
7. **镜头表自检门(六项硬检,不过不许进分镜)**:Hook 密度(受控词表,每连续 3 镜至少 1 个 reveal/reversal/callback,首尾镜必带强 hook)/单镜 ≤15s/**单镜 ≤3 重要角色**/同场景多镜地标+光位一致或带连续性备注/每秒指令全覆盖/跨镜连续性链逐行成链(状态翻转必须显式标 `HARD CUT — 时间跳 2h`)。
8. 分镜默认**纯文本**(每镜一节+可选 ASCII 布局,零成本);铅笔分镜 opt-in;重点迭代镜**抽独立节点**局部返工、改完回填。渲染前**剥离双绑定标签**(`[char:…][scene:…][shot:…]`)。
9. **逐镜混合模型**:H3 默认(包装/文字 UI/双声道/性价比,每秒指令可几乎原文送入,前缀强调设计语言)+ Seedance 2.0 表演回退(弹性 squash-and-stretch/复杂运镜,前缀强调电影感),镜头表加 `video_model:` 字段;**失败回退阶梯**:强化锚点重试→缩镜 ≤6s 拆行→一键切另一模型→3 败才问用户。BGM 整片一条,对白/音效下 duck,不逐镜配乐。

### 4.5 生图与提示词实战(知乎/各站)【原文】

- 漫剧生图六要素:景别→画面事物→时间光照→色调→构图→质量词;**拒绝比喻修辞**(写「鲤鱼跃出水面高度较高」不写「像长了翅膀」);有台词镜头用**近景正面**(给对口型留余地)。
- 人物定妆照固定核心特征(服装/发型/身形),后续围绕基础造型补细节;美术风格词从参考图**剥离提炼**(去事物与氛围,只留纯风格短语)统一挂载。
- H3 玩法(知乎沃垠AI,8 玩法均附完整提示词):参考图作唯一视觉锚点+材质蒙太奇(事件密度 0.25-0.45s/件)、字体动效(第一视角进入字体空间)、片头卡点流(时间轴 0.3s 粒度)、**音频参考驱动混剪**(给音乐+素材让 H3 按节奏硬切/转场/分屏)、电商换装一句话、科普长镜头 one-shot、游戏概念片(4 参考图+1 音色参考,15s×2 段,视觉语言「70% 科幻悬疑+30% 冷感孤独」比例化氛围声明)。

---

## 五、B 站制作流程落实分析

### 5.1 四学派版图

| 学派 | 代表 | 核心资产 | 路线 |
|---|---|---|---|
| 随风系 | Ai_随风+万象AI | [飞书手册](https://ncn23j3mkzrg.feishu.cn/wiki/FCWgw0KxaiOe5ckySCWcfUsjn5g)(8 产线总索引,每条配视频+RH 在线工作流+网盘本地版+仙宫云部署) | 云端+批量 |
| 理不懂/机智流 | 理_不懂(2.07 万播放「单日一部剧」) | ComfyUI 工作台(开源=JZL 节点包) | 本地全自动 |
| Work-Fisher | 3.8 万播放全流程课 | 全套提示词模板+RH 云端工作流 | 手动精修 |
| 漫游者系 | 方法论输出 | 工业级分镜 V2/720° 全景导演台/96 视角 lora/一人剧组 9 skills | 模型无关 |

随风 8 产线:①万象AI+RH+H3 批量(万象AI=自研调度软件,聚合 API,产出直通剪映草稿) ②[一分钟短剧直出](https://www.bilibili.com/video/BV15Ybk6QEAc/)(H3 多参+自动循环+**上下文潜空间衔接**) ③[双采工作流](https://www.runninghub.cn/post/2088225624673574914/)(自动提示词+加速 LoRA) ④多参多宫格导演台 3.0 ⑤H3 加速专题(light2V 8 步加速 LoRA;注意 Turbo 伤音频前例,light2V 对音频 VAE 影响待实测) ⑥基础批量 ⑦全自动漫剧 ⑧RHTV 无限画布半手搓精品。另有《橘子汽水味的夏天》全 H3 开源完整案例、Singularity 二创优化模型(画质增强/动态模糊修复/去油腻/增特效)。【原文(手册+视频页)】

### 5.2 JZL 短剧导演台(开源可考,工程最完整的「全自动」)【原文·README+USAGE.md】

一个节点完成**剧本分段→参考调度→编码→采样→解码**,输出接 ffmpeg 落盘/合并:

- **四运行模式**:故事拆解(按情节拆 N 段)/故事扩展(先 LLM 扩写再拆)/**穿透生成**(跳过 LLM,识别 `[SHOT_START]` 块逐段,否则单段)/仅提示词输出(只出六段格式文本不生视频)。
- **素材调度指令**:提示词 `@素材名` 或 `类型:槽位名` 自动匹配;**路径自动推断**——有视频参考→REF2VA,否则按参考图数量选首尾帧/首帧/文生;守官方上限;分段 1~48。
- **本地 LLM 当导演**:llama-server 子进程(进程隔离、跑完即停释放显存)做剧本/镜头处理,目标格式=官方六段 Ref2VA。
- **批量工程**:逐段顺序生成,**每段跑完立即 ffmpeg 落盘**(崩溃不丢已生成段)+自动合并;「视频保存分配」节点接 VHS 逐段保存。
- **独门**:`ref_scale` 参考值面积放大 1.0~5.0(match 模式,面积倍率)——放大参考图占比保人脸;配套节点还有素材管理器/故事节点/提示词增强/**音乐歌词节点**。

### 5.3 其余工作台要点【原文(视频页简介)+转述】

- 理_不懂「全自动漫剧连续镜头工作台」:官方六段 Ref2VA 提示词+素材调度指令+「动作导演级」润色;五模式全覆盖(音画同步/文生/图生/首尾帧/参考图生);批量循环;**高清+精修双轨输出**;AIGC 检测规避+光效补帧(商业投放向);配套翻车分析(H3 长视频三大病:跳变/模糊/劣化)与 **FaceRefine+VOSR2 双阶段人脸超清重绘**对策。V5 加「万能后续节点」解耦。
- Work-Fisher:画布资产生成(RHTV)+文戏多图参考手动版(RH);**FLUX-Klein 分镜流**(九宫格选图+万物局部修复+强一致性,最低 8G);高动态打斗完整提示词模板;12G 显存 H3 优化(10s 视频 450s 出)。
- 漫游者:720° 全景图导演台(多人物站位)、3D360° VR 场景图(一致性+位置关系)、96 视角一致性图+LoRA 训练 ZIP、分镜衔接设计器、秒级时间测算模板、情绪提示词、一人剧组(1 人+9 skills+RHTV 无限画布)。

### 5.4 跨源共识(B站+GitHub+官方三方印证)

1. **双采/双出**:768P 出运动构图→二采精修人脸;与官方「本地 768P→hosted 2K regenerate」同构。
2. **素材调度指令**(`@素材名`→自动挂参考):JZL/机智罗/BigBanana/zenstory 四方收敛。
3. **宫格分镜**(九宫格选构图):B 站(FLUX-Klein/导演台 3.0)+GitHub(BigBanana)+官方(9 宫格模板)三线印证。
4. **上下文潜空间衔接**(A/V latent 续写):随风+PT_H3ConcatAVLatent,音画都不断链。
5. **本地 LLM 当导演**(剧本拆解+镜头级增强→官方六段格式):JZL llama-server 与机智罗 OpenAI 兼容后端两种实现;官方 H3-Context-IR 同思路。
6. **批量工程三件套**:逐段落盘防崩/自动合并/列表分发循环——「单日一部剧」的工程底座。
7. **`[SHOT_START]` 块协议**:分段标记让「已处理剧本」成为可回放中间产物。

---

## 六、映射漫影(对齐 09-14 分镜×H3 三件待开工:组装器/桥视频路线/镜级动作)

| 落点 | 对应外部实践 | 建议 |
|---|---|---|
| 桥视频路线选型 | 上下文潜空间衔接 vs 末帧交接 | 末帧交接先行、衔接路线留实验位(与「音频三开关测试矩阵」兼容) |
| 组装器 | JZL 逐段 ffmpeg 落盘+自动合并(MIT 可吸收);`[SHOT_START]` 块 | 吸收为组装器中间产物协议 |
| 镜级动作/素材调度 | `@素材名`+路径自动推断(视频参考→REF2VA/按图数→首尾帧/首帧/文生) | 对齐资产面板+分镜环节自动装配到 9图3视频3音频槽位 |
| 清晰度 | 双采二采(FaceRefine+VOSR2 人脸双阶段) | 「清晰度四件套」补视频侧二采环节 |
| 提示词层 | 官方六段 Ref2VA 已是本地技能目标格式;645 条原版提示词库 | 案例库作分镜→视频提示词翻译器语料 |
| 分镜环节 | 空间锚点四子字段/自检门六项/连续性地标(官方)+切点对账(shuohao) | 可做成分镜面板 lint;镜头语汇卡库(Apache-2.0)作模板底稿 |
| 宫格 | 九宫格选构图(BigBanana/导演台 3.0/FLUX-Klein) | ManyingShot 网格已有,九宫格作分镜首帧新模式候选 |
| 衣橱 | BigBanana 衣橱系统(多造型 Base Look) | 资产面板「造型变体」维度候选(漫影已有 CHARACTER_GENERATION_GUIDE 三视图/造型变体,增量对齐) |
| 剧本层 | 爽点表/钩子前 3 拍冷开场(shuohao)/8 拍骨架+守门(官方) | 剧本环节质量门候选 |
| TTS | 台词本按角色聚合带音色提示词(shuohao) | 与现有资产音色分配链路对齐 |

---

## 七、License 红线(2026-09-14 `gh api` 核验)

| 资源 | License | 处置 |
|---|---|---|
| MiniMax-AI/MiniMax-H3(含 8 官方生成器技能) | NO LICENSE | **思路可借鉴、文件禁拷**;本地 h3-prompt-writing 属既有资产,维持现状 |
| shuohao-skills / zenstory / SkyNotSilent / LocalMiniDrama / MiniMax-AI/skills / JZL | Apache-2.0 / MIT | 可吸收,带署名 |
| BigBanana | CC BY-NC-SA(非商用) | 只参照思路,禁抄代码(漫影=商用授权产品) |
| style-atlas / PT_H3ConcatAVLatent / awesome-video-prompts | 无 license | 指针 only |
| RunningHub 工作流 / 万象AI / RHTV | 服务/商业软件 | 照节点图自建无碍;软件仅参照 |

## 八、参考链接全集

**官方**: [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) · [skills 总览](https://github.com/MiniMax-AI/MiniMax-H3/blob/master/skills/README.md) · [3d-animation-short-generator 中文版](https://github.com/MiniMax-AI/MiniMax-H3/blob/master/skills/3d-animation-short-generator/SKILL.cn.md) · [handdrawn-live 中文版](https://github.com/MiniMax-AI/MiniMax-H3/blob/master/skills/handdrawn-live-video-generator/SKILL.cn.md) · [MiniMax-AI/skills(MIT)](https://github.com/MiniMax-AI/skills) · [海螺 H3 开源生态页](https://hailuoai.com/h3-open) · [MiniMax Design](https://design.minimaxi.com/) · [Pixo 官方公式解读](https://pixo.video/zh/blog/minimax-h3-prompt-guide) · [实在智能六层结构](https://www.ai-indeed.com/encyclopedia/29229.html) · [Metaso 零基础教程](https://metaso.cn/minimax-h3/guide/) · [EvoLink 40 条核验提示词](https://evolink.ai/zh/minimax-h3-prompts) · [Morphic 分镜模板](https://morphic.com/zh/resources/how-to/minimax-h3-prompts)

**GitHub 产线**: [shuohao-skills](https://github.com/eternityspring/shuohao-skills) · [drama-skills](https://github.com/zenstory-ai/drama-skills) · [BigBanana](https://github.com/shuyu-labs/BigBanana-AI-Director) · [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama) · [awesome-MiniMax-H3-cases](https://github.com/SkyNotSilent/awesome-MiniMax-H3-cases) · [Phosphene](https://github.com/mrbizarro/Phosphene) · [minimax-h3-style-atlas](https://github.com/hoodtronik/minimax-h3-style-atlas) · [PT_H3ConcatAVLatent](https://github.com/ptmaster/ComfyUI-PT_H3ConcatAVLatent) · [ComfyUI-JZL-MiniMax-H3](https://github.com/wjluoxiao/ComfyUI-JZL-MiniMax-H3) · [JZL USAGE.md](https://github.com/wjluoxiao/ComfyUI-JZL-MiniMax-H3/blob/main/docs/USAGE.md)

**B 站**: [随风·H3 使用手册(飞书,8 产线索引)](https://ncn23j3mkzrg.feishu.cn/wiki/FCWgw0KxaiOe5ckySCWcfUsjn5g) · [一分钟短剧直出](https://www.bilibili.com/video/BV15Ybk6QEAc/) · [理不懂·全自动连续镜头工作台](https://www.bilibili.com/video/BV1RCbZ6FEb6/) · [一键短剧导演台 V5](https://www.bilibili.com/video/BV1H5t366E2b/) · [纯本地短剧工厂](https://www.bilibili.com/video/BV1SpbX6uEoS/) · [Work-Fisher·短剧全流程](https://www.bilibili.com/video/BV1T68c6ZEDm/) · [FLUX-Klein 分镜流](https://www.bilibili.com/video/BV12ukMBqEwb/) · [机智罗镜像](https://www.compshare.cn/images/rSDYsmxtwhxT)

**实战文章**: [知乎·H3 8 神仙玩法](https://zhuanlan.zhihu.com/p/2070173165301642568) · [100天AI漫剧出海 Day4](https://zhuanlan.zhihu.com/p/2025892734955692234) · [秘塔 H3 低成本方案](https://zhuanlan.zhihu.com/p/2073789014956688025) · [开源 H3 拍狐娘讲六祖坛经](https://zhuanlan.zhihu.com/p/2071238347062878864) · [RunningHub 双采工作流](https://www.runninghub.cn/post/2088225624673574914/) · [RunningHub 文戏多图参考](https://www.runninghub.cn/post/2090347206778904577/)
