# PRD:画稿上色工作流(K2 线·带破限)

> **历史方案边界（2026-09-20 复核）**：本文件记录 2026-09-07 的规划、决策或排障经验；其中待批/在途状态、插件与权重库存、Desktop 端口和工作流路径均限定当时。本轮未重新运行该实验或查询外部模型发布状态，不能据此改动现行环境。当前引擎与模板入口见 [ComfyUI 引擎指南](../../settings/COMFYUI_ENGINE_GUIDE.md)和[漫影工作流清单](../漫影工作流清单.md)。

> Trellis 计划产物 | 创建 2026-09-07 | 状态:调查完成,待用户决策(见「开放问题」)

## 一、目标

为用户的画稿(线稿类)新建一条**上色产线**:输入黑白画稿,输出按指定配色上色的成图。
要求挂载本机现有破限模型生态(heretic TE + Mystic/pussy LoRA),单模型原则不破(图像线=K2)。

## 二、已确认事实(调查结论)

### 本机现状
- K2 全套在位:turbo bf16 DiT / qwen3-vl-4b-heretic TE / Mystic XXX v3 + pussy@0.15 + NSFW V4(备用)/ identity LoRA
- 稳定流(`K2图像/改图/Krea2_无衣物_稳定.json`,20节点)= krea2edit 指令编辑线,已实测跑通:
  **Mystic@2.0=审查解锁门槛**(低于此指令不生效)、identity@1.0=编辑闸、denoise1.0/CFG1/10步
- krea2edit 插件原生支持**第二参考图**(GroundedEncode.image_b / ModelPatch.source_image_b)=架构级参考取色入口
- 未装:comfyui-krea2-controlnet、controlnet_aux

### 社区调查(国外)
- **ComfyUI 官方模板**「Add Color to Line Art Illustration」:Gemini3 Pro/Nano Banana Pro 云端 API——违背离线+单模型原则,仅提示词工程可参考("color this line art in full color, ..."句式)
- **Reddit/YouTube 主流**:FLUX-ControlNet-Union-Pro 2.0 动漫上色、SDXL+lineart ControlNet——都是别家模型,K2 无对应物
- **facok/comfyui-krea2-controlnet**(162★):节点支持 lineart/canny/pose/normal,**但 README 只给了 depth 权重源**(Patil/Krea-2-depth-controlnet,862MB);lineart 权重无公开下载源
- **tori29umai/krea2-controlnet**(HF):仅 anythng 轮廓引导(实验性,"宽松跟随,细节靠提示词",自认精细轮廓/人脸不可靠);**lineart=Planned 未发布**;配套插件=controlnetPlus(社区 0-2★未采纳)

### 社区调查(国内)
- B站高热度教程(BV1ym421g7oU 等):SD1.5/SDXL+ControlNet lineart 上色 + **参考任意图片取色**(参考图取色=高需求模式)
- 官方中文模板同 color_illustration(云端 API)
- **Qwen-Image-Edit-2511+着色LoRA 漫画批量上色**(visionpaletteai):同 TE 家族(Qwen3-VL)思路可借鉴,但引入第二模型违反单模型原则
- CSDN/知乎:SDXL 图生图扩展上色、文→线稿→上色动画全流程

### 技术结论
1. **K2 无现成 lineart Control 权重** → ControlNet 管线今天不可行(除非自训或等 tori29umai 发布)
2. 可行路线:
   - **B1. krea2edit 编辑式**[:稳定流同栈] 线稿作 source_image + 上色指令 → 零新下载,破限门槛已实测;风险=线稿保真度待实测(krea2edit 训练于成品图编辑,线稿属分布外)
   - **B2. krea2edit 参考取色式**[:B1+image_b] 第二参考图接彩色图,指令"用参考图配色" → B1 的扩展,覆盖高需求模式
   - **C. 图生图式**:VAEEncode(线稿)+denoise 0.8+ 提示词描述色彩 → 最简,但线稿结构保持无保障
3. 破限融入:上色指令若触发 DiT 审查(裸露画稿),Mystic@2.0 门槛预计同样适用(稳定流实证);NSFW LoRA 与编辑闸的串联结构=稳定流已验证形态

## 三、需求(已定稿,2026-09-07 四项决策收敛)

- R1 新工作流落位 `K2图像/上色/Krea2_画稿上色.json`(文件夹已建)
- R2 **路线=krea2edit 编辑式**(Q1 裁决):线稿作 source_image+上色指令,零新下载零新依赖
- R3 **色彩控制=文字+参考图双模式**(Q2 裁决):启用 image_b 双图链,模式A文字描述(默认)/模式B参考图取色
- R4 **画稿类型=多种混合通用型**(Q3 裁决):指令模板带三段可插拔适配(纯线稿/素描/色稿)
- R5 **NSFW=包含,破限全开**(Q4 裁决):heretic+Mystic@2.0+pussy@0.15,与稳定流同级
- R6 上色指令配方按「动作锚」方法论设计(禁否定句/色彩具体到色名/单目标)
- R7 输出可复现(seed 固定口+说明卡,沿用现有交付规范)

## 四、验收标准(定稿)

- 同一张测试线稿,上色指令下:线稿结构可辨(轮廓/五官/服装形态不崩)、色彩符合指令描述
- 模式B(参考取色)出图色调与参考图同族
- NSFW 画稿场景破限生效(指令不被审查吞掉)
- 首张实测图过用户人眼验收

## 五、开放问题

(空——Q1 路线/Q2 色彩控制/Q3 画稿类型/Q4 NSFW 范围已于 2026-09-07 全部裁决,折叠进第三节需求;lineart 追问见五·补)

## 五·补:lineart Control 权重全景(用户追问「哪个模型/为什么用不了/能否扩展」的调查终稿)

| 权重 | 作者 | 状态 | 对"线稿上色"适用性 |
|---|---|---|---|
| Krea-2-depth-controlnet | Patil | ✅已发布(862MB,rank64) | ❌深度图控制,非线稿 |
| Krea-2-pose-controlnet | thedeoxen | ✅已发布 | ❌骨架姿态控制,非线稿 |
| krea2-anythng | tori29umai | ✅已发布 | ❌自认「宽松剪影引导,非精确描边」;细轮廓/脸/小物体不可靠(README原文) |
| **krea2-lineart** | tori29umai | ❌**Planned,无日期** | ◀缺的就是它 |
| refcontrol-lineart | thedeoxen | ✅但发布在**FLUX.2 Klein** | ❌架构不同,K2 用不了 |
| delicate-lineart-coloring | ilkerzgi | ✅已发布 | ❌文生图风格件(100步快训),自己画线稿风图,**不能吃外部线稿**,方向相反 |

**为什么用不了**:Control LoRA=「节点件+权重件」两件套,facok 节点件成熟(162★)但**线稿类型权重全世界无人发布**——K2 公开训练产物仅 depth/pose/anythng 三个。

**能否扩展(三路)**:
1. 等社区——tori29umai 训练配方已公开(106,786对轮廓/RGB+两阶段7000步+rank64)或 thedeoxen(已给 FLUX.2 做了 lineart,K2 版可能跟进);零成本无日期
2. 自训——配方公开,本机 M4 Max 可训(TrainLoraNode 在),但 10 万对数据准备=大工程;缩小规模(几百对)可训弱版,属远期选项
3. **架构替代(已选)——krea2edit 编辑式**:K2 的 VL TE(Qwen3-VL)天生看懂线稿,线稿作 source_image+ref_boost 参考注入,与 Control「锁结构」目标殊途同归

## 六、Out of Scope(初判)

- 批量上色/文件夹批处理(先单图跑通)
- 视频上色、动画序列(属视频线)
- 自训 Control LoRA / 引入第二模型(Qwen-Edit 等)

## 六·补:迭代路线图(首版交付后的演进顺序)

1. **v1(本计划)**:单图上色,文字+参考双模式,冒烟验收
2. **v1.1(随用随调)**:指令配方库扩充——按用户实际画稿类型沉淀句式变体;参数甜点回填(ref_boost/分辨率)
3. **v1.2(用户令时)**:模式B取色专项验收+指令调优;NSFW 画稿实测
4. **v2(需求驱动)**:批量上色(文件夹遍历,BatchMaker/Loop 链,社区成熟件)
5. **被动升级**:lineart Control 权重发布(Plan D 触发)→ 主路线架构升级,保线上限提高
6. **跨线协同(远期可选)**:与褪衣线组合——画稿上色→成品图→褪衣改形态(两段式管线,各线职责不变)

## 七、决策日志(trellis)

| 日期 | 决策 | 裁决 | 备注 |
|---|---|---|---|
| 09-07 | 技术路线 | krea2edit 编辑式 | 用户确认;追问 lineart 可用性→已查不可行(五·补) |
| 09-07 | 色彩控制 | 文字+参考图双模式 | 用户选(推荐项) |
| 09-07 | 画稿类型 | 多种混合通用型 | 用户选 |
| 09-07 | NSFW 范围 | 包含,破限全开 | 用户选(推荐项) |
| 09-07 | 备选体系 | Plan B~F 六级路线 | 文档深化时补充,design 第六节 |
| 09-07 | 错误应对 | runbook 故障树 A1~C | 文档深化时补充,独立 runbook 文件 |

## 八、来源

- [ComfyUI 官方上色模板](https://comfy.org/workflows/templates-color_illustration-926bb8ebaa04/)
- [facok/comfyui-krea2-controlnet](https://github.com/facok/comfyui-krea2-controlnet)
- [tori29umai/krea2-controlnet (HF)](https://huggingface.co/tori29umai/krea2-controlnet)
- [Patil/Krea-2-depth-controlnet (HF)](https://huggingface.co/Patil/Krea-2-depth-controlnet)
- [B站:ComfyUI 线稿上色自由(参考图取色)](https://www.bilibili.com/video/BV1ym421g7oU/)
- [B站:一键线稿上色 SD1.5+SDXL](https://www.bilibili.com/video/BV1Lw411y7G3/)
- [Qwen 漫画批量上色工作流](https://visionpaletteai.com/products/qwen-manga-colorization-comfyui-workflow)
- [nomadoor 线稿上色指南](https://comfyui.nomadoor.net/en/ai-capabilities/line-art-coloring/)
- [Reddit: flux lineart coloring](https://www.reddit.com/r/comfyui/comments/1hymk61/flux_lineart_coloring/)
- 本机 krea skill(项目内 .agents/skills/krea/)
