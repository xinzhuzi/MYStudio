# TE MAN 可吸收性深度排查（2026-09-15）

> 对象：tl2012tl/TE_MAN v3.7（B 站 TETAE 同源）。排查范围=仓库全部明文资产：9 个 skills、17 个 web/js 交互件（已反混淆精读）、`te_bernini_backend` 后端 fork、根层明文 py、LICENSE、config.ini。
> 探针克隆：`/tmp/te_man_probe`（易失）；本报告为沉淀真源。
> **License 定性**：根 LICENSE=全权利保留（仅限学习阅读，严禁复制/修改/衍生/发布）→ **一切吸收只仿设计，禁拷任何代码/文案**。后端 fork 例外：kijai WanVideoWrapper 血统为 Apache-2.0（若确需可从上游合法取，但也用不上）。

## 一、资产全景定性

| 层 | 是什么 | 可读性 |
|---|---|---|
| 31 个 .pyd | 全部核心生成节点（Grok/GPT Image2/Gemini/Sora2/VEO/HappyH3 等），Cython 编译 Windows 二进制 | 不可读，macOS 物理不可加载 |
| skills/（9 个） | H3 提示词 DSL + 8 个场景化创作流程，明文 markdown | ✅ 全读 |
| web/js/（17 个） | 画布交互件，javascript-obfuscator 混淆 | ✅ 反混淆后全读 |
| te_bernini_backend（59M） | kijai ComfyUI-WanVideoWrapper 瘦身 fork（Apache-2.0，多源：Alibaba Wan/city96 GGUF/WanMove/Enhance-a-Video）；TE 增量=Bernini in-context 参考视频编辑。59M 中 36M 是上游机器的提示词缓存脏数据、20M 是 T5 tokenizer，无权重 | ✅ 全读，对 MPS 无用 |
| 根层明文 py | grid_split_routes（宫格切割 route）、Grok_Safe_PY（API 前输入自动缩放包装层）、zzzz_*（后加载覆盖节点映射的猴子补丁） | ✅ 全读 |

## 二、可吸收矩阵

### A 层：知识/协议层（零开发，写进知识库即得）

| # | 吸收件 | 来源 | 对我们的落位 | 备注 |
|---|---|---|---|---|
| A1 | **H3 提示词 DSL**：五模式（T2VA/I2VA/FL2VA/L2VA/Ref2VA）+ 固定字段（integrated_multimodal_description / overall_soundscape / non_diegetic_music / Ref2VA 六节）+ 受控标记（`<d>`对白/`<scenetrans>`/retention 枚举）+ 说话人全局编号 + 对白逐字保真 | skills/h3-prompt-writing | 对照升级 `.agents/skills/h3-prompt-writing`：补 FL2VA/L2VA 模式概念、retention 标记、声画归属规则 | 与我们技能同名同构，两项目独立收敛；字段口径可互补 |
| A2 | **多镜拼接五大衔接锁**：口型锁（切点=句间停顿/强鼓点）、节奏锁（Beat Grid+Speed Ramping）、色彩锁（全局 LUT/Film Grain 掩盖跨批次色差）、空间锁（尾帧→下一镜首帧/同向运镜/Match Cut）、文字动态锁 + Master Audio 母带独占 | skills/mv-subtitle | 漫影单镜→组装器协议对照清单（组装器已有两段式，衔接锁补全拼接协议） | 直击"逐镜生成拼起来不像一部片"问题 |
| A3 | **分镜质控机检硬门**：hook 密度、单镜≤15s、单镜≤3 角色、空间锚点继承、每秒指令覆盖、跨镜连续性链 | skills/3d-animation | 分镜表生成后的机检清单（导演规划链加质检步骤） | 把质控做成可机检规则 |
| A4 | **一致性锚点协议**：空间锚点链（固定地标+画面相对位置+光位基线）、身份锚点"捐赠/不捐赠"清单（参考图只捐轮廓发型比例，不捐摄影质感）、参考卡一卡一职隔离 | skills/co-op + mv-subtitle | 参考图体系规范升级（我们 1+3 参考图装配立规矩） | 防真人照片质感污染风格化渲染 |
| A5 | **⚠️ 宫格版式泄漏教训**：minimalist 技能明确弃用四宫格锚定图——"视频模型会把宫格版式带进成片"，改用三张独立锚定照片 | skills/minimalist | 宫格方案的边界警示：宫格作**中间产物+切割后**用是安全的（v1.0 演示即此管线）；宫格图**直接当视频参考**必泄版式 | 对"宫格吸收件"的关键约束条件 |
| A6 | **流程治理三件**：分阶段确认门+失败回退阶梯（三败才弹卡片）、最新资产纪律（重做后下游禁用旧版）、轻量旁路（单镜/单图需求不跑全流程）+ 负向默认值（默认不加旁白/字幕写成硬规则） | 全部 skills 通用骨架 | 漫影 AI 编排链（导演规划→分镜→生成）的治理规则 | 已部分符合；对照补缺 |
| A7 | **文案逐字自检门**：计划台词未逐字出现在最终 prompt 则禁派发 | skills/minimalist | 生成派发前校验（台词/屏幕文字完整性） | 防漏词，一小时内可加的校验 |
| A8 | 技能库工程范式：SKILL.md+SKILL.cn.md 双语同构、meta.yaml 双语标签、references/ 按需加载、agents/*.yaml 跨 agent 接口 | skills/ 结构 | 我们 .agents/skills 的工程升级方向 | 备查 |

### B 层：工程件（仿写，按价值排序）

| # | 件 | 核心设计（仿写要点） | 难度 | 价值 | 与现状关系 |
|---|---|---|---|---|---|
| B1 | **截帧回灌** | 视频节点内播放器+"截取当前帧"→上传 input→自动生成图片节点（继承 prompt 元数据） | 中 | 高 | keyframes 体系已有，缺"出片→抽帧→候选关键帧→回接"最后一跳；纯 ffmpeg+桥 |
| B2 | **A/B 对比器双件** | 图：canvas 滑动帘+2-7x 放大镜（零后端）；视频：双 video 滑帘+rAF 同步（syncToken 防竞态）+帧对齐（frame_count 换算）+A/B 声道 | 中/中高 | 高 | 审片刚需；H3 输出自带 frame_count/frame_rate 可直接用；应用侧已有生成记录对比，画布侧节点件补关键帧迭代场景 |
| B3 | **宫格生图+切割** | 一次生成 N 宫格→rows×cols/任意框选 crop 切割→产物回 input 变新输入（切割逻辑极简：PIL crop 两 route） | 中 | 高（需对拍） | K2 出宫格规整度待同题对拍；受 A5 约束：切割后再用，宫格图本身不当参考 |
| B4 | **三视图资产** | 一键三视图做角色参考资产（配合 A4 身份锚点规范） | 中 | 高（需对拍） | 参考图体系升级形态 |
| B5 | **批量队列治理协议** | graphToPrompt→deepClone→改 index→**连线闭包裁剪（只执行当前线）**→queuePrompt 循环；间隔节流、断点续跑（从第 N 号）、随机序、精确停队（只 DELETE 自己提交的 pending） | 中 | 高 | 漫影已有 App 侧批量入口（一键生图）；吸收的是**断点续跑/间隔防压/精确停队/闭包裁剪**四协议，非入口本身 |
| B6 | **并发运行高亮** | progress_state 事件 + litegraph `node.strokeStyles` 函数式描边（~150 行） | 低 | 中高 | 画布侧"跑到哪几镜"可见；App 侧队列徽章已有，此件补画布场景 |
| B7 | **超级存图模式（子集）** | ①存图节点底部 prompt 面板（python 回传+折行+双击复制）②框选裁切（比例锁定）→新节点回灌 ③宫格拆分成节点阵列 | ①中②中③低 | 中高 | ①=图 prompt 可追溯（生成记录已有应用侧，画布侧补）；②③=关键帧迭代/分镜种子 |
| B8 | 双击自动连最近兼容口 | 双击输出口→全图最近类型兼容空闲输入 connect | 中 | 中高 | 大图连线提速；我们画布零触碰裁定下若做须落漫影侧栏件 |
| B9 | H3 @引用编辑器 | 连线的参考图变 @芯片+自动维护参考素材说明（与漫影 H3 产线同构） | 中高 | 中高 | 若做参考图一致性管理再升位 |
| B10 | empty-release 钩子 | litegraph `empty-release` 事件可拿"用户想连什么类型"→放手即推荐节点 | 低 | 备查 | 知识点，暂无需求 |

### C 层：通用技术范式（做画布侧件时的手册）

- 节点 UI 三板斧：`beforeRegisterNodeDef` patch 原型五钩子（onNodeCreated/onExecuted/onResize/onSerialize/onConfigure）；纯 canvas 自绘 widget（`{type:'custom',computeSize,draw,mouse}`+命中矩形缓存+`serialize:false`）；DOM widget 必须 pointer/wheel 转发回 `app.canvas._xxx_callback`；状态存 `node.properties` 随工作流携带。
- Safe-PY 包装层：在不可改节点外再包一层纯 Python 输入规范化（如 API 前图片总像素自动缩放——与我们「参考图 768px<1MB」铁律同域，应用侧已有，此为画布侧同思路）。
- 零注册嵌入式后端：fork 包 `NODE_CLASS_MAPPINGS={}` 防与用户已装上游插件撞 ID，由宿主按路径惰性 import 直调——漫影桥/侧栏扩展同款思路的旁证。
- TeaCache 步进缓存：设备无关的视频扩散 20-50% 提速思路；H3 的 ComfyUI 节点是否暴露需验证。
- transition-aware context window + prefix frames：无缝视频续接概念，对组装器衔接思路有启发。

### D 层：不吸收（结论+理由）

| 件 | 理由 |
|---|---|
| Wan 系本地模型线（bernini fork 全部能力） | A14B 级在 MPS 不可行（提速杠杆全 CUDA）；1.3B 质量不敌 H3；与 K2+H3 无互补 |
| fp8/sage/flash/radial 注意力算子 | CUDA-only，MPS 无对应路径 |
| 无限画布深度改造 | 与 ComfyUI 零触碰+分镜零实体策略冲突 |
| 构想台 AI 助手 | 漫影 App 已有对话/编排层，重复建设 |
| 素材库侧栏（面板+后端全套） | App 已有资产管理（assets.db/参考图体系），重复建设；仅"重命名后全图扫描更新引用"思路可借 |
| 3D 导演台 | 价值中高但 three.js+骨骼成本大，列远期观察 |
| 连线搜索预填 / 快捷断连（默认关闭件）/ 音频 IO 节点 | 营销件/低价值/App 侧已有音频台账 |
| 整合包+中转站分发形态 | 供应链不可控，与开源自研双许可相悖 |

## 三、建议执行序（待拍板）

1. **P0 知识沉淀**（零开发）：A1-A7 写进 `docs/comfyui-kb/` 参考区 + 技能对照升级 → 本报告即是第一步
2. **P1 白捡工程件**：B1 截帧回灌 → B2 对比器双件
3. **P2 需同题对拍**：B3 宫格+切割 → B4 三视图（对拍裁定按 09-15 功能优先裁定）
4. **P3 协议吸收**：B5 批量治理四协议并入 App 侧批量链
5. **远期观察**：B6-B10、3D 导演台、TeaCache(H3 验证)

## 四、排查方法备注

- web/js 为 javascript-obfuscator 混淆，子代理写了解码脚本在 Node vm 还原字符串后精读（`/tmp/te_man_probe/deob.js`，随 tmp 失效）
- bernini 定性证据：nodes_sampler.py 等文件头 kijai 版权头+Apache-2.0、目录 1:1 复刻 WanVideoWrapper、`CATEGORY="WanVideoWrapper"`
- 59M 构成：text_embed_cache 36M=上游运行期脏数据（bf16 cuda:0 512×4096 T5 嵌入，.gitignore 本忽略）、T5_tokenizer 20M，无权重夹带
