# Downloads/夸克 旧件轻量评估(D2,2026-09-29)

> 定位:laneDocs 泳道 D2——对 `~/Downloads` 与 `~/Downloads/夸克/` 旧件做只读盘点+抽样解读+与仓库能力对照,出处置建议。**全程只读(仅 ls/du/find/head/cat/diff -rq/file/textutil -stdout 等只读命令),旧件零改动、零入库(本报告除外)**;本报告只述结构/依赖/重复度/与仓库重叠面,不评价课程内容质量;课程包内容一律转述,不照抄原文段落(遵 6bd5211 吸收时的 IP 纪律)。
>
> 盘点时间:2026-09-29;所有大小/计数为本会话 `du`/`ls`/`find`/`diff -rq` 实测。

## 一、结构盘点

### 1.1 ~/Downloads/夸克/(10 个实体条目 + .DS_Store,合计 3.2G)

| 条目 | 实测大小 | 性质(一层实查) |
|---|---|---|
| `AI STUDIO洋子-V3.3.1-热修版/` | 5.2M | 课程包:`skills/`×11 + `课程文档/`×3(docx/md 双载)+ `project-template/`(00-08 九阶段目录+AGENTS.md+项目控制件)+ `scripts/`(install_course.py 与 .command/.ps1 安装器)+ `00-开始使用.md` + `V3.3.1-热修说明.md` |
| `fight-video-create-skill/` | 112M | 战斗设计 Skill:SKILL.md+README.md+`scripts/route_reference.py`;`data/` 三件仅 ~409KB(catalog.bin 46,876B/corpus.bin 357,772B/core.fvx 3,904B);大头=`reference/` 111M(26 个 GIF 样本) |
| `工作流/` | 180K | MiniMax-H3 社区流×2(`三采6步lora完美版.json` 110,087B + `终极三采v2版.json` 72,134B) |
| `工作流(1)/` | 180K | **与`工作流/`逐字节相同**(`diff -rq` 实测 IDENTICAL,冗余副本) |
| `工作流(2)/` | 228K | Qwen2.1 社区整合流×2(`▶▷Qwen-image21-图像编辑+生图流（整合）.json` 84,227B + `▶千问2.1扩展整合(自定义skill+姿态图+放大).json` 144,339B) |
| `所有用到的插件git安装地址.txt` | 1,619B | 7 个 ComfyUI 插件 git 地址(rgthree-comfy/ComfyUI-Easy-Use/TE_MAN/TE-Speed-QwenImage21/TE-Speed-VOSR2/comfyUI-llama-TE/comfyui_controlnet_aux)+ TE 启动器/网盘指引 |
| `提示词skill（简单快速）/` | 68K | md×3(角色设定卡Skill-5.4 / Qwen-Image-2.1-文生图 / Qwen-Image-2.1-图像编辑) |
| `提示词矩阵15000条/` | 19M | zip×5(V1/V2/V3 英文 lora cleaned 系列+V1V2 补包) |
| `提示词矩阵15000条(1)/` | 19M | **与`提示词矩阵15000条/`逐字节相同**(`diff -rq` 实测 IDENTICAL,冗余副本) |
| `生骨骼图所需（…补预处理器用）/` | 3.1G | 单文件 `comfyui_controlnet_aux.zip` 3,319,552,267B(controlnet_aux 预处理器离线补装包,对应插件 txt 第 7 项) |

去重后有效体量 ≈3.16G,其中 98% 为骨骼包 zip;文本性内容(洋子包+fight-video 正文+提示词 md)合计 <6M。

### 1.2 ~/Downloads 根(工单范围件)

| 件 | 实测 | 性质 |
|---|---|---|
| `IPEqual` | 10,180B | **Clash 网络代理配置 YAML**(mixed-port 7890/geodata/fake-ip DNS 等,head 实读),与 AI 产线零关联 |
| `QWEN-IMAGE2.1+全能图片编辑(官方提示词强化)v2.json` | 97,312B | ComfyUI UI 格式工作流,39 节点/25 类型(rgthree 组管理件+PE 改写链) |
| `QWEN-IMAGE2.1+全能文生图(官方提示词强化)v2.json` | 73,222B | 同上,27 节点/21 类型 |
| `图片编辑PE-官方原版.docx` | 27,468B | 官方 PE 系统提示词原文(英文,「Edit Prompt Enhancer — General (v2, 精简版)」,textutil 只读 stdout 抽样) |
| `文生图PE-官方原版 - 副本.docx` | 23,770B | 同上(t2i 侧「Image Prompt Rewriting Expert」) |
| `character-sheet-prompts/` | 8 子项 | 角色设定图提示词合集:两个高星仓库 README(nanobanana 系 189,693B/80,766B)+ 四个子仓(anime-character-sheet-prompter/awesome-nanobanana-pro/comfyui-krea2edit/gpt-image-2-character-sheet/krea2-character-sheet)+ 自整理精选 `X_角色设定图提示词精选_0918.md`(17,303B,X+GitHub 来源,面向云端角色一致性模型) |

范围外备注:`qi21-livefire-0929/`(今日 11:03 创建,在用工作目录)非旧件,未盘点未触碰。
外置盘对照:`/Volumes/郑冰津/AI/` 已挂载;`Qwen21/` 内含 PE/TE 权重(qwen3.5_9b pe-i2i bf16 等)与 manifest——PE 权重真源在盘,不在 Downloads。

## 二、抽样解读(性质/版本/依赖,均转述)

1. **洋子包=Agent 驱动 AI 影视课程包 V3.3.1 单包热修版**:`skills/` 实列 11 个主流程(ai-film-router、film-synopsis/treatment/screenplay/worldbuilding/characters/acting/cinedance/lira-assets、film-expert-bridge、film-knowledge-bridge);机制要点(00-开始使用.md 转述)=11 主流程+71 可选技能分支(自称由 50+ 社区工作流融合)、视频提示词模型仅 Seedance 2.5/2.0+MiniMax H3 三选、本地知识库 A/B/C 可选模式、项目写入锁与草稿/确认稿分离、旧提示词随镜头清单确认即禁用。`课程文档/03-71项技能融合调用表.md`(170 行)=分阶段编号菜单表(00-A~G 镜头语言工具归导演顾问内置,01 起逐阶段列技能分支)。project-template 为九阶段目录(00_inbox~08_delivery)+项目控制件(routing/reference-memory/artifact-registry/session-checkpoint 等)。**该包与 6bd5211 吸收笔的来源课程包同源**(版本 V3.3.1-热修版、含 71 项表,与吸收记录描述吻合;版本对应系推断,以用户确认为准)。
2. **fight-video-create-skill**:战斗/动作分镜设计 Skill,机制(SKILL.md 转述)=关键词路由→按需读单一方案、命中数排序+强字段权重、单字/高频词降权与 weak_fallback 回退、招式效果样本 GIF 必交付(故 reference/ 111M/26 GIF 为样本库);资料封装为二进制包(catalog/corpus/core.fvx),正文不可直读、经命令检索。
3. **QWEN json×2+PE docx×2**:同一体系——工作流为「官方提示词强化(PE)v2」社区整合版(UI 格式,rgthree 组管理+PE 链,依赖插件 txt 中 TE 系插件),docx 为配套官方 PE 系统提示词原文(英文 v2,edit/t2i 各一)。
4. **工作流(2) 两件**:图像编辑+生图整合流 73 节点(rgthree 组 11 个)、扩展整合流 29 节点含 `QwenTE_SkillLoader`×2(TE 插件专属节点,姿态图/放大/skill 加载)。
5. **工作流(=1) H3 两件**:MiniMax-H3 社区流(三采 6 步 lora 版 35 节点/终极三采 v2),含 `banzhangVideoCombine`/`BanZhang_VRAM_Cleaner`/`VAEDecodeAudio` 等三方节点。
6. **生骨骼图 zip**:controlnet_aux 离线补装包(插件 txt 自述「一般已经安装过了,没安装过的网盘补一下预处理器」),3.1G 为预处理器模型体积。

## 三、与仓库关系及处置建议

| # | 旧件 | 仓库对应(实查) | 关系判定 | 处置建议 |
|---|---|---|---|---|
| 1 | 洋子包(5.2M) | 6bd5211 已吸收其方法论(四域八件:吸收分析档/跨镜连续性规范/道劫招式库三件/direct-zh+SKILL);吸收档 §六已裁定六项「明确不吸收」(菜单体系/知识库桥/检查点等) | 方法论吸收已闭环;包内 skills/菜单/安装器形态正是已裁不吸收面 | 留档原位,不入库;无再吸收动作(如用户再令另议) |
| 2 | fight-video-create-skill(112M) | `docs/prompts` IP 区道劫_战斗招式库三件(6bd5211 自创,种子招名对照包内逐名 grep 零命中在案) | 同域功能(战斗/动作分镜),仓库件独立成体系;包内 111M 为 GIF 样本与加密语料 | 留档;不入库;如需对照研究按需人工取样 |
| 3 | QWEN json×2+PE docx×2 | `1_图片/Q2-1图像/` 七件(0_官方模板三件 SHA256 锚零改动+自研 qwen21-t2i/qi21-edit/qi21-道劫-t2i/qi21-道劫-i2i)+`docs/prompts/Qwen-Image-2.1/`00-06(01 官方PE机制/02 ComfyUI侧实录/03 技能全景) | 仓库 Q2-1 走官方模板血统且 PE 机制已实录成档;Downloads 件为 TE 插件系社区变体(节点生态 rgthree/TE 与仓库官方+核心件路线不同),未见能力缺口 | 留档;PE 权重真源已在 `/Volumes/郑冰津/AI/Qwen21/`,无需自 Downloads 取 |
| 4 | 夸克 H3×2(360K) | `2_视频/H3视频/` 17 件(1_漫影自研/2_固定线/3_超分后处理/4_官方本地模板/5_云端API/6_社区模板;社区件以「社区-」前缀入槽) | 两件为社区变体,现库零同名零同型(三采/lora 全域 grep 零命中);如要收编天然槽位=6_社区模板 | 本轮不入库;留档;是否收编待用户裁定 |
| 5 | 提示词skill 3 md(68K) | `qwen-image-2-1-prompter` 技能+`docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库`+K2/Q2-1 角色设定件 | 仓库提示词工程真源已成体系 | 留档 |
| 6 | character-sheet-prompts | `krea2edit-prompts` 技能/K2 角色设定线(09-21 曾清账删除官方镜像 DCS) | 域重叠;其中 `X_角色设定图提示词精选_0918.md` 为**用户自整理件**(非课程包,X+GitHub 来源注录),仓库未见对应收编 | 留档;X_精选是否收编 docs/prompts 待用户裁定 |
| 7 | 生骨骼图 zip(3.1G) | 引擎侧 controlnet_aux 可经 git 安装(插件 txt 附官方地址),离线包仅为免网补预处理器 | 可再获取性高,体积大 | 不入库;留 Downloads 由用户自行处置 |
| 8 | IPEqual | 无 | Clash 代理配置,与仓库零关联 | 留档 |
| 9 | `工作流(1)/`、`提示词矩阵15000条(1)/` | — | 与正本逐字节相同(diff -rq 双证),纯冗余副本 | 本工单不动;如用户清空间可删两副本(省 ~19.2M) |

**总原则**:全部旧件留 `~/Downloads` 原位,零改动、零入库(工单约束②);本报告为唯一新增文件。仓库侧现有能力(官方模板锚定+自研四件+H3 六槽+提示词工程文档体系)已覆盖上述旧件的功能面,未见必须入库的缺口件;两处「待用户裁定」项=夸克 H3 社区流收编与否、X_角色设定精选收编与否。
