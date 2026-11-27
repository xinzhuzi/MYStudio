# 生图工作流(1_图片)与 Win/Mac 两台引擎的模型·节点对账与处置

> **状态(1126 18:07):P0 只读对账完成,待 D1–D9 用户审核。** 本轮未改工作流、未下载模型、未装节点、未改 recipe/代码、未重启引擎、未跑出图、未写 Git。P1–P4 未经批复不施工。
>
> **状态(1127 10:4x):D1–D9 已批复(1126 19:15)。P1 经用户裁定不施工(见「施工阶段」P1 裁定),转入 P2 标缺。** 截至本条仍未改任何工作流 JSON。
>
> **状态(1127 12:5x):P2 工作流说明部分已写入 51 件**(见「施工阶段」P2 执行记录);App 入口停用(8 件桥接模板 + LocalModelStudio 两档)未做,待另批施工;契约测试与热覆盖、提交待用户在终端执行。

## 修订记录

> 多会话协作:改本文件前先查 mtime,距上次修改 <30 分钟先与用户确认;每次修改追加一行。

| 时间 | 会话 | 修改 |
|---|---|---|
| 1126 16:3x | Quick | 建档:问题、对账方法、按线处置建议、决策点 D1–D9、施工阶段 P0–P4、给编码代理的 P0 提示词 |
| 1126 18:07 | Qoder | 完成 P0 只读对账:Win 最新快照、Mac 未启动复查、105 件图片矩阵、App 真入口证据、11-23 基线差异;仅勾选 P0 三条 AC,D1–D9 仍待批复 |
| 1126 19:15 | Quick | 决策表「批复」列落字(D1–D7、D9 按建议;D8 允许按清单提交);勾选「D1–D9 用户批复落字」AC(补记行) |
| 1127 10:4x | Quick | P1 裁定落字:Krea2 72 处不改、Qwen 1 处待 Mac 快照;记分隔符跨引擎问题;状态行更新;转 P2 |
| 1127 12:5x | Quick | P2 说明部分执行:复扫(与 1126 逐件一致)→ 脚本预演 51/51 → 写入 51 件(45 前置 + 6 新增卡)→ 重跑幂等 0 件 → 复扫结构零变化;P1 Krea2 理由勘误(Mac 已退役) |

## Goal

1126 用户问「哪些 trellis 任务没处理完,比如生图工作流这块逻辑」。核对结论:H3 审计任务(`archive/2026-11/11-23-h3-selfdev-workflow-fixes`)只修了**结构**(连线、槽位、计数器),全库 172 件现 E=0 / W=1;但 **`1_图片/` 下 102 件从未和引擎对过模型与节点**,「缺模型」提示也只给 16 件 H3 视频件加过,图片件 0 件。

目标:让每一件生图工作流处于下面三种状态之一,且打开就能看出来:

1. **可跑**:所需模型与节点在其目标引擎上都在位,并实跑过一次;
2. **标缺**:工作流内有统一的「缺模型 / 缺节点」说明(缺什么、在哪台引擎缺、怎么补),且相关 recipe/入口不得当作可用;
3. **归档**:用户决定不再维护,移出或加「存档·勿用」。

## 已知事实(1126 P0 实况)

完整证据:`research/image-reconcile-1126.md`、`research/image-reconcile-rows-1126.json`、`research/app-image-entrypoints-1126.md`。

### 引擎与扫描实况

| 引擎 | 实况 | 证据 |
|---|---|---|
| Win `192.168.0.101:17000` | 2026-11-26 17:20:49 +08 实拉;ComfyUI `0.46.3`、Python `3.12.3`、RTX PRO 4000 Blackwell;`/object_info` 9,815,741 B,SHA256 `eb73760b3ba835aaa0a05451f924d55c2489454f9156025f9576b38a5d0ee24d`;4,138 节点类、187 模型名 | `research/engine-fetch-meta-1126.json`、`system-stats-win-1126.json`、`object-info-win-1126.json` |
| Mac | 端口现查装机家 `manifest.json` 为 17001;17:20 首次与 18:07 复查均为 `Connection refused`,状态 `not-running-or-unreachable`;未启动、未重启、无 `/object_info` 快照 | `research/mac-engine-recheck-1126.json` |

- 当前工作树扫描 175 件:UI 149、子图定义 52、wrapper 13、API 13。`1_图片/` 共 **105 件**:UI 89、other 14、API 2。结果:`research/audit-win-current-1126.json`。
- 建议状态:**可跑候选 46 / 标缺 58 / 归档候选 1**。“可跑候选”只表示 Win 默认活跃路径静态模型、节点、非媒体控件值检查通过,**不等于已实跑**;Mac 全部未核。
- Win 活跃缺模型 160 处 / 27 个名;活跃缺节点 7 个实例;活跃字面写法不符 73 处;非媒体非法控件值 16 处。全部状态分别为 234 处 / 40 个名、16 个实例、94 处、18 处。
- 结构告警已人工定性:新控件/socketless 误报 12、真实断链 2、悬空输出 link 卫生 1、输出全旁路 1。不能把扫描器原始 E/W 下降直接称为已修复。

| 线 | 件数 | 可跑候选 | 标缺 | 归档候选 |
|---|---:|---:|---:|---:|
| krea2 | 36 | 0 | 36 | 0 |
| Flux.3 | 3 | 0 | 3 | 0 |
| MiniMax | 5 | 3 | 2 | 0 |
| MossImage | 10 | 4 | 6 | 0 |
| QwenImage2.1 | 41 | 29 | 11 | 1 |
| SeeThrough | 2 | 2 | 0 | 0 |
| SenseNova | 8 | 8 | 0 | 0 |

### App 实际派发(P0 最高优先级)

- **确定真入口 5 件**:`QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json`、`QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json`、`QwenImage2.1/5_角色设定卡/道劫-角色设定卡-i2i.json`、`krea2/1_文生图/t2i.json`、`krea2/1_文生图/t2i-fast.json`。
- 前三件 Qwen 真入口是 Win 静态可跑候选;后两件 Krea2 真入口标缺:`t2i.json` 缺 3 个活跃模型,`t2i-fast.json` 缺 4 个活跃模型,均无活跃缺节点。**D2 应优先处理这两个仍可从 LocalModelStudio 选到的标缺入口。**
- **仅后端条件分支 3 件**:`krea2-t2i.json`、`krea2-edit-ref.json`、`krea2-nsfw-pro.json`;只证明 `comfyui-bridge` 能力,默认 UI 自动可达性未证,不计入确定真入口。
- 其余 97 件未发现真入口。画布绑定候选、注释、展示文案、已停用 K2/Flux3 族、独立 `/v1/images/uncloth` 链均不算直接派发。

### 与 11-23 基线对比

| 项目 | 11-23 | 1126 | 差异 |
|---|---:|---:|---|
| Win ComfyUI | 0.46.2 | 0.46.3 | 小版本升级 |
| `/object_info` 字节 | 9,570,074 | 9,815,741 | +245,667 |
| 节点类 / 模型名 | 4,063 / 185 | 4,138 / 187 | 净 +75 / +2 |
| 扫描文件 | 165 | 175 | +10 |
| 缺模型名 / 引用 | 67 / 305 | 68 / 305 | +1 名;活跃引用 224 → 223 |
| 缺节点类 / 实例 | 29 / 65 | 31 / 67 | 活跃实例仍 30 |
| 写法不符 / 存疑 / I4 | 7名94处 / 10处 / 24处 | 同左 | 总量未变 |
| 结构原始 E/W/I | 27 / 50 / 286 | 18 / 2 / 286 | 主要为 schema/识别漂移,不能当作修复量 |

- 文件集净增 10:新增 10 件图片工作流(含 SenseNova 现为 8 件),同时 4 件视频从 H3 `7_测试` 迁到 `6_视频重制`;无图片文件删除。
- 引擎直接清单对比:新增 84 个类、移除 9 个类;新增 SenseNova 的 `sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors` 与 `sensenova_u1.6_8b_mot_int8_convrot.safetensors`,无模型名移除。
- 新缺模型仅 `segm/manga_panel.pt`(1 处非活跃引用);11-23 已缺的被引用模型没有补齐。原 29 个缺节点类仍缺,新增 2 个均为视频孤儿节点 `FreeVideoGenerate`、`FreeVideoMedia`。
- 已知 PE 分叉 `qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors`、`qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors` 继续按 App 别名映射「不计缺」,矩阵单独注明。`Power Lora Loader (rgthree)` 等无静态列表节点只标“存疑”。

**D1 必须重新裁定的冲突:** 本档原建议把 Krea2、SeeThrough 放 Mac;但 `.agents/skills/comfyui/machine.md:80-84` 已明确 Krea2 于 09-23/24 在 Mac 退役并删权重,当前 Mac 图片线只保留 Qwen Image 2.1。因此不能按旧建议把 Krea2 缺口转嫁 Mac;SeeThrough 的原 Mac 方案也需一并复核。

## 11-23 Win 基线(原记录,已由上方 1126 实况复核)

来源:`archive/2026-11/11-23-h3-selfdev-workflow-fixes/research/engine-audit-1123-verify.md`(Win 引擎 `192.168.0.101:17000`,ComfyUI 0.46.2,快照 `engine-object-info-1123.json`)。

| 线(件数) | 缺什么 | 备注 |
|---|---|---|
| **Krea2(36)** | 专用文本编码器 `Krea2-Engineer-V1-bf16`(37 处 / 34 件,引擎 clip 槽零 Krea2 系);底模 `krea2_turbo_bf16`(引擎只有 `Krea2\krea2_turbo_int8_convrot`);约 15 个 LoRA 引擎没有 | 另 **92 处 LoRA 分隔符写法不符**(工作流 `/`,引擎 `\`);`Power Lora Loader (rgthree)` 里 3 个 LoRA 目录层级不符。1123 用户裁定「Krea2 暂不下载」,改名方案 `krea2-rename-plan-1123.md` 搁置,但工作流上**没有任何提示** |
| **Flux.3(3)** | `flux3_image_klein_sd_int8_convrot`、`qwen3vl_4b_int8_convrot` | 含道劫件 `flux3-道劫-t2i.json`(有契约测试 `test_flux3_daojie_workflow_contract.py`) |
| **MiniMax H3 图像(2)** | `qwen3vl_32b_minimax_h3_int8_convrot` | `官方-H3图像-文生图`、`-图像编辑` |
| **MossImage(5)** | `flux2-vae_small`、`moss_image_sft_int8_convrot`、`moss_image_edit_lora_rank_64_bf16`、`moss_image_color_depth_control`、`moge_3_vitg_fp16` | base/版式/编辑/颜色深度 |
| **QwenImage2.1(约 10)** | `bfs_head_v1.1*` 换头 LoRA、PE 编码器 int8 版、`qwen3vl_8b_bf16`、`Qwen-Image-2.1-outfit-swap`、社区件的 seedvr2 gguf、fisher-pose 一组 | `qi21-道劫-i2i` / `qi21-edit` 的 PE bf16 名属「已知分叉」(App 侧别名换算),不计缺 |
| **缺节点** | `ClownsharKSampler_Beta`、`Image Saver` 系列、`ComfyUI-Krea2T-Enhancer`(K2-无审查全家桶);`DapaoFaceHarmonize/SwapRegion`(社区-局部换脸天花板-Dapao);`DF_Text_Box`(社区-四合一换装捏人) | 打开即报缺节点 |

**这份清单的缺口(P0 要补):**

- 只对了 **Win**,而且是 11-23 的旧快照。图片线(尤其 Krea2、SeeThrough)按原方案主要跑 **Mac 引擎**,Mac 从未对账。
- 11-26 新入库的 **SenseNova 6 件**(`1_图片/SenseNova/`,含 `sn-道劫-t2i/i2i` 及 api 形)、以及装 SenseNova 后的引擎状态,都不在清单里。
- **App 实际会发车的生图工作流**没有清单。11-23 只核了视频 recipe;图片侧的入口(设定卡 B 线 `asset-sheet-card-bline.ts` → `道劫-角色设定卡-i2i.json`、道劫各型底座 `qi21_bases.json`/`moss_bases.json` 指向的件、分镜生图正典 qi21 t2i/i2i 等)要列出来,它们缺模型的优先级最高。
- `Power Lora Loader (rgthree)` 这类不暴露文件列表的节点,只能对引擎全局 LoRA 表判,属「存疑」,要单独列。

## 对账方法(P0,只读)

1. **拉两台引擎最新 `/object_info`**(只读 GET,不重启、不装、不下载):
   - Win:`http://192.168.0.101:17000/object_info`(先 `GET /system_stats` 记版本;队列有任务也可以拉,不影响执行)。
   - Mac:本机引擎端口以装机家 `manifest.json` 的 `engine.port` 现查为准(`.agents/skills/comfyui/machine.md`;禁抄常量)。Mac 引擎未启动就记「未启动,本轮只对 Win」,不要为对账擅自启动。
   - 存 `research/object-info-{win,mac}-1126.json`,记 SHA256 与拉取时间。
2. **跑扫描器对账**:`python3 .trellis/tasks/archive/2026-11/11-23-h3-selfdev-workflow-fixes/research/workflow_audit.py --object-info <快照> --json research/audit-{win,mac}-1126.json`。脚本已能在归档位置自动找仓库根(1124 S3 修过)。**只取 `1_图片/` 的结果入本档**,视频件结果附表即可。
3. **按「件 × 引擎」出矩阵** `research/image-reconcile-1126.md`:每件一行,列 = 线、目标引擎(按 D1)、Win 缺模型/缺节点/写法不符、Mac 同、是否被 App 入口引用、建议状态(可跑/标缺/归档)。
4. **与 11-23 对比**:哪些是 11-23 之后补齐的、哪些是新增缺口(尤其 SenseNova)。
5. **App 入口清单**:grep 前端/后端代码与 `studio-manuals` 底座 JSON 里对 `1_图片/` 工作流的引用(含按文件名、按 recipe id、按底座 `workflow` 字段),列出「App 会发车」的件。注:按文件名 grep 会误中注释(如 `t2i.json`),要人工确认是真入口。

## 处置建议(按线;均待用户裁定)

| 线 | 建议 | 理由 |
|---|---|---|
| Krea2 | **先标缺,不下载**(沿用 1123「暂不下载」);若 D3 选择恢复这条线,再按 `krea2-rename-plan-1123.md` 执行:①分隔符统一为引擎写法;②UNET 改用引擎在位的 int8(或补下 bf16);③**TE `Krea2-Engineer-V1` 没有替代,必须下载** | 34 件都依赖 TE,不补 TE 整线不能跑;改名只解决写法,不解决缺件 |
| Flux.3 | 看 D4:若道劫要用 flux3 线,补下两件模型(底模 + qwen3vl_4b);否则标缺 | 有道劫件和契约测试,说明曾是候选生产线 |
| MiniMax H3 图像 | 标缺;要用时补 `qwen3vl_32b_minimax_h3_int8_convrot` | 引擎已有 H3 视频用的同族 TE,先核是否可复用(不同量化名不可直接互换,要实测) |
| MossImage | 先核 `moss-道劫-t2i`(App 道劫底座线)是否全在位;其余 5 件标缺 | `moss-道劫-t2i` 11-23 没列缺,但要在两台引擎复核 |
| QwenImage2.1 | 道劫正典件(qi21-道劫-t2i/i2i、设定卡)两台引擎复核必须全在位;换头/换脸/社区件标缺 | 正典件是生产线 |
| SenseNova | P0 首次对账后再定 | 新入库,无基线 |
| 缺节点的社区件 | 标「缺节点」;是否安装插件看 D6 | 装插件改引擎环境,要用户明令 |
| 写法不符(非 Krea2) | 统一成引擎实际写法(只改字符串,不改结构) | 引擎按字面校验,写法不符等于缺 |

**「缺模型 / 缺节点」说明的统一格式**(和 16 件 H3 视频件已用的标注对齐,施工前先读其中一件确认现格式):放在工作流说明卡(MarkdownNote)顶部,写清:缺的模型或节点名、哪台引擎缺、需要放到哪个目录、来源链接(给作者主页,不给直链)、是否已被用户裁定暂不补。

## 决策点(待用户批复)

| ID | 要定的事 | 选项 | 建议 | 批复 |
|---|---|---|---|---|
| D1 | 每条生图线的**目标引擎** | 只 Win / 只 Mac / 两台都要能跑 | 按线定:道劫正典(qi21、Moss 道劫、设定卡)两台都要;Krea2、SeeThrough 按原方案 Mac;社区件只 Mac 或不保证 | 1126 19:15 用户批:按建议 |
| D2 | 「标缺」的形式 | 只在说明卡加提示 / 加提示并把入口(recipe、底座引用)标不可用 / 移到单独目录 | 加提示 + 入口标不可用 | 1126 19:15 用户批:按建议 |
| D3 | Krea2 线去留 | 继续搁置(标缺) / 恢复(下载 TE + 处理 UNET + 改分隔符) / 归档 | 继续搁置,先标缺;用户要用再恢复 | 1126 19:15 用户批:按建议 |
| D4 | Flux.3 线去留 | 补模型 / 标缺 / 归档 | 标缺,除非道劫近期要用 | 1126 19:15 用户批:按建议 |
| D5 | MiniMax H3 图像、MossImage 非道劫件、QwenImage2.1 换头换脸件 | 补模型 / 标缺 / 归档 | 标缺 | 1126 19:15 用户批:按建议 |
| D6 | 缺节点的社区件 | 装插件(改引擎环境) / 标缺 / 归档 | 标缺;装插件另行明令 | 1126 19:15 用户批:按建议 |
| D7 | 是否允许下载模型 | 不允许 / 逐件请示 / 按 D3–D5 批复的线批量下载 | 逐件请示(给大小与来源) | 1126 19:15 用户批:按建议 |
| D8 | git | 禁写操作,只备份 / 允许按清单提交 | 由用户定;不允许时每件改前 `.bak-1126` + SHA256 | 1126 19:15 用户批:允许按清单提交(不 `git add -A`,他链在途件不碰) |
| D9 | 施工方式 | 交本地编码代理 / 用户手动 | 交编码代理(要拉引擎、跑扫描器、跑测试) | 1126 19:15 用户批:按建议 |

## 施工阶段(待批)

- **P0 只读对账**(可先做):按「对账方法」1–5 产出 `research/object-info-*`、`audit-*`、`image-reconcile-1126.md`;回填本档「已知事实」为 1126 实况;列出 App 入口清单。**门**:两台引擎(或注明 Mac 未启动)对账结果齐全;没有改动任何工作流。
- **P1 写法统一**(D8 后):只改模型名字符串的分隔符/目录层级,使之与引擎实际名逐字一致;只改「引擎实有、仅写法不符」的项。**门**:扫描器对应项归零;相关契约测试绿。
  - **P1 裁定(1127 用户批「按建议注明并转 P2」)— 本阶段不施工**。依据 `research/image-reconcile-rows-1126.json`:Win 活跃写法不符 73 处 = 20 件,全部建议状态「标缺」、均无 App 真入口。
    - **Krea2 72 处 / 19 件:不改。** 全是分隔符差(件内 `Krea2-画风/…`,Win 引擎报 `Krea2-画风\…`),涉及 6 个名(DetailSlider 20、水墨武侠漆艺鎏金 18、identity_edit 14、AsianMix 12、NSFW 两件各 4)。按 D1(Krea2 目标引擎=Mac)与 D3(继续搁置),现写法对 Mac 本就正确,按 Win 改反而破坏 Mac。
      - **1127 勘误**:`.agents/skills/comfyui/machine.md` 记 Krea2 已于 09-24 在 Mac 退役、权重已删,上句「现写法对 Mac 本就正确」不成立(`research/image-reconcile-1126.md` §6 早已标出此冲突)。「不改」结论仍成立,理由改为:D3 搁置,两台现均不可跑,改写法无收益;D1 对 Krea2 的「Mac」在恢复该线时重定。
    - **QwenImage2.1 1 处:暂不改,待 Mac 快照。** `3_社区模板/编辑生图整合-TE.json` 写 `Qwen\qwen_image_2.1_int8_convrot.safetensors`,Win 实际在根目录无 `Qwen\` 层;Mac 未启动、目录层级未知,改了可能修 Win 坏 Mac。该件另有可选支路缺模型,改后仍为「标缺」。
    - **记录的结构性问题(待另行裁定)**:Win 用 `\`、Mac 用 `/`,同一份 JSON 无法对两台引擎同时「逐字一致」。凡 D1 定为「两台都要」的线,本阶段门「扫描器对应项归零」在现规则下不可达;需另定方案(加载时归一分隔符,或按引擎分别维护),不在本任务 P1 内处理。
    - **门的处置**:P1 门不判通过也不判失败,记「按裁定不适用」;Mac 引擎启动并拿到 `/object_info` 后,重跑扫描器复核 Qwen 这 1 处再定。
- **P2 标缺**(D1/D2 后):按统一格式给所有「可跑」之外的件加说明;按 D2 处理入口。**门**:每件都有明确状态;App 入口不再指向标缺件,或指向时有拒发提示。
  - **P2 用户裁定(1127 10:41)**:LocalModelStudio Krea2 标准档/加速档按 D2 停用;归档候选 `skill姿态图放大-扩展整合.json` 只标缺;说明部分先预演后执行。
  - **P2 执行记录(1127 12:5x)— 说明部分已写入,入口部分未做**
    - 范围:58 标缺 + 1 原归档候选 = 59 件;其中 UI 件 51 件写入,8 件 App 桥接模板(无画布说明卡)不改 JSON,留给入口拒发处置。
    - 工具:`apps/build/scripts/campaigns/image_p2_mark_missing_1127.py`(默认预演;`--apply` 写入);数据 `research/p2-banners-1127.json`。规则:45 件前置到指定宿主说明卡 `widgets_values[0]`,6 件新增 MarkdownNote(画布最右侧,`properties.manying_p2_mark="1127"`,`last_node_id`+1);断言连线/分组/子图定义/其余节点/其余控件值逐字段不变,原件须逐字节回放才改;幂等(横幅以 `【标缺·不可跑(` 识别)。
    - 写前门:复扫 `research/audit-win-current-1127.json` 与 1126 逐件一致;51 件 mtime 均 ≥30 分钟;51 件与 git index 逐件一致(无他链在途改动)。
    - 结果:预演 51/51 断言通过 → `--apply` 写入 51 件 → 重跑预演「需写入 0」(幂等)→ 复扫 `research/audit-win-after-p2-1127.json`:总计 E18/W1/I286、缺模型 305/223、写法 94 全不变;仅 6 件新增卡节点数 +1。备份与 SHA256 清单 `research/bak-p2-1127/manifest.json`(51 件,回读一致)。
    - Krea2 横幅「目标引擎」按 machine.md 写为「D1 批 Mac,但 Mac 已退役,两台现均不可跑」,不照抄 D1 原文。
    - 已知风险:14 件有生成/手术脚本引用,重跑这些脚本可能冲掉横幅 → 再跑本脚本即可补回(幂等)。
    - **未做**:①契约测试(本机沙盒无 pytest,待用户在终端跑);②热覆盖装机包/引擎缓存与 `canvas_deploy.mjs --audit`(装机目录在允许范围外);③提交(沙盒内 git 不可用);④App 入口停用——后端 `comfyui_bridge.py` 对 8 件 Krea2 桥接模板拒发、前端 `LocalModelStudio.tsx` 两档置灰(前端需重新打包),待另批。
    - **门状态**:「每件都有明确状态」——UI 件 51/51 达成,桥接模板 8 件待入口处置;「App 入口不再指向标缺件或有拒发提示」——未达成。
- **P3 补模型 / 装节点**(D3–D7 逐项批复后):下载落既有分类目录,字节核账;装节点另行明令。**门**:补齐的线各实跑一件(隔离前缀),出图核对。
- **P4 收口**:更新清单 `docs/comfyui-kb/漫影工作流清单.md` 中相关行的状态;写 `delivery.md`(改了什么、跑了什么、没跑什么)。

## 边界与纪律

- 改工作流 JSON 前必读 `.agents/skills/node-graph/SKILL.md`;引擎驱动与模型选型读 `.agents/skills/comfyui/SKILL.md` 与 `machine.md`。
- 不重启引擎、不改引擎环境、不下载模型、不装插件,除非用户对该项明令。
- 对账只读;实跑一律隔离前缀(图片线按各自约定的验证目录),跑完即清。
- 只按清单提交(若 D8 允许),不 `git add -A`;他链在途文件不碰。
- 11-23 快照里「已知分叉·不计缺」的 PE bf16 名(App 侧别名换算)继续不计缺,但要在矩阵里注明。

## Acceptance Criteria

- [x] P0:Win / Mac 两份最新 object_info(或注明 Mac 未启动)+ 对账结果 + `image-reconcile-1126.md` 矩阵入 `research/`。证据:`research/engine-fetch-meta-1126.json`、`research/mac-engine-recheck-1126.json`、`research/object-info-win-1126.json`、`research/audit-win-current-1126.json`、`research/image-reconcile-1126.md`;Mac 未启动/不可达,无伪造快照。
- [x] P0:App 会发车的生图工作流清单,每件写明依据(代码位置或底座字段)。证据:`research/app-image-entrypoints-1126.md`、`research/app-image-entrypoints-1126.json`;5 件确定入口、3 件仅后端条件分支,均附精确文件行号与调用链。
- [x] P0:本档「已知事实」按 1126 实况回填,标出与 11-23 的差异。证据:本档「已知事实」及 `research/image-reconcile-1126.md` 基线对比;保留 11-23 原记录,并标出 D1 的 Mac/Krea2 冲突。
- [x] D1–D9 用户批复落字(1126 19:15:D1–D7、D9 按建议;D8 允许按清单提交)
- [ ] P1–P3 按批复执行,各阶段门通过并附证据
- [ ] 每件 `1_图片/` 工作流处于「可跑 / 标缺 / 归档」之一,扫描器(带两台引擎快照)对「可跑」件零缺模型、零缺节点
- [ ] `delivery.md` 写清做了什么、没做什么
