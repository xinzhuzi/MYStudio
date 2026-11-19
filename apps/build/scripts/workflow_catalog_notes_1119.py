#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作流详解·语义注记表(1119 立)。

被 workflow_catalog_gen_1119.py 合并进 docs/comfyui-kb/工作流详解.md。
维护口径:
- desc=功能与机制(人工写,不与结构面重复);status=在役状态;note=依赖/坑/契约。
- 结构数字(节点/链/分组/模型清单)由生成器自动提取,勿写进注记(避免双源漂移)。
- 历史沿革真源=docs/comfyui-kb/漫影工作流清单.md;本表只记「现在是什么」。
"""

CURATED_NOTES: dict[str, dict[str, str]] = {
    # ---------------------------------------------------------------- 0_分镜
    "0_分镜/分镜工作流.json": {
        "desc": "分镜产线通用模板(唯一件)。四阶段组=剧本创作与立意→导演规划与视觉资产→分镜拆解与网格规划→视频生产与剪辑成片,内嵌 9999 说明节点(恒环节锚点)。",
        "status": "在役·运行时真源",
        "note": "09-15 零实体裁定:运行时不生成逐章/逐镜文件;App 分镜管线按当前章数据克隆注入直开(storyboard-pipeline-comfy.ts STAGE_TEMPLATE_REPO_ID);单镜视频由组装器现装直开。",
    },
    # ---------------------------------------------------------------- 1_图片/Flux.3
    "1_图片/Flux.3/flux3-文生图.json": {
        "desc": "FLUX.3 klein 蒸馏 t2i 画布件(官方模板子图展开平铺改造)。int8 convrot 三件套(flux3_image_klein_sd/qwen3vl_4b/flux2-vae);PE AI 扩写组默认关(9GB PE 件不随包);蒸馏档 CFG=1。",
        "status": "停用(1101 裁定,树内保留产线不调用)",
        "note": "8GB 卡 offload 常态首图分钟级;引擎 ≥v0.41.1;出图 seed=randomize。",
    },
    "1_图片/Flux.3/flux3-图像编辑-多参考.json": {
        "desc": "FLUX.3 klein 多参考图像编辑(官方 image_edit 模板平迁移改):LoadImage→ReferenceMultiLatent 多参考装配→采样主链。",
        "status": "停用(1101)",
    },
    "1_图片/Flux.3/flux3-道劫-t2i.json": {
        "desc": "道劫十型×FLUX.3 t2i(1016 补做件):双子图=道劫提示词与 RGB 画幅+正负文本编码;显式 Windows 9B AI 扩写;FLUX 15步/CFG1。十型 RGB 已生成逐件核验。",
        "status": "停用(1101;道劫出图 1117 起默认 QwenImage2.1 域)",
    },
    # ---------------------------------------------------------------- 1_图片/MiniMax
    "1_图片/MiniMax/1_文生图/道劫-t2i.json": {
        "desc": "道劫×H3-Image 文生图(官方 t2i 模板克隆,新式子图件)。三层装配文预填(风格底座+人物海报型+主体句,真源 qi21_bases.json);现行口径=PE 英文扩写链开(1113 对拍定谳:中文直喂背景错伪,PE 链全修复);TE 纠偏 nvfp4_awq。",
        "status": "装机在役(Win)",
        "note": "宿主层雷刻碑:新式子图件 widget 生效层=根层宿主节点 wv,子图内 wv 是被连线覆盖的死副本,改参必须双层同步。1113 LoRA 废案已摘(美漫判定不合格)。",
    },
    "1_图片/MiniMax/2_图生图/道劫-i2i.json": {
        "desc": "道劫×H3-Image 图像编辑(官方编辑模板克隆 27 节点,唯一手术=TE 纠偏 nvfp4_awq)。LoadImage+`<Picture n>` 多参考+TextGenerateV2 PE 扩写+ImageCompare 前后对照;VAE 必接=参考图 latent 锚定。",
        "status": "装机在役(Win)",
    },
    "1_图片/MiniMax/5_角色设定卡/道劫-角色设定卡.json": {
        "desc": "道劫设定卡 B 线(H3-Image 版,1113 正册化):master t2i(人物海报型三层装配 1664×2496)→六路 edit 直投(侧/背转view+面部/侧头/腕/腰推近)→武器 t2i(3456×1280)/特效 t2i(2048²)→MySheetCardComposer 格式一 v1 固定底框合成 4K 整卡。",
        "status": "在役(Win)",
        "note": "分格指令/模板/seed 真源=qi21_bases.json#sheet_card;生成器 daojie_sheet_workflow_build_1113.py+契约互锁。",
    },
    "1_图片/MiniMax/官方-H3图像-文生图.json": {
        "desc": "MiniMax H3-Image 官方 t2i 模板(Comfy-Org 原样零改动):新式子图件,ResolutionSelector 出幅,默认 4MP 防低显存/原生上限 16MP,6步 Euler/simple CFG1 蒸馏无负面词。",
        "status": "官方模板(Win 在役可用;Mac 引擎 <0.45 打开即红)",
        "note": "模型四件已装 Win(int8 DiT 21G/TE 复用视频线 nvfp4/VAE/PE);引擎 ≥0.45。",
    },
    "1_图片/MiniMax/官方-H3图像-图像编辑.json": {
        "desc": "MiniMax H3-Image 官方图像编辑模板(原样零改动):MiniMaxH3ImageConditioning image_1=被编辑图+`<Picture n>` 多参考槽(至多 16 张)+TextGenerateV2 PE 扩写+ImageCompare 对照。",
        "status": "官方模板(Win 在役可用;Mac 打开即红)",
    },
    # ---------------------------------------------------------------- 1_图片/MossImage
    "1_图片/MossImage/moss-t2i.json": {
        "desc": "MOSS-Image SFT 文生图画布件(bf16 三件套+KOOK 观澜 LoRA 可旁路+SLG 跳层 22/end0.5+25步 CFG3.0 er_sde/simple)。",
        "status": "可跑(Win;moss-win-campaign-1025 役件)",
    },
    "1_图片/MossImage/moss-图像编辑.json": {
        "desc": "MOSS-Image 图像编辑(官方 TextEncodeMOSSImageEdit 链:edit_format+参考图直入+1MP·对齐16 随原图+SLG end1.0/30步 CFG4 Euler/normal);1108 补腿官方 edit LoRA rank_64。",
        "status": "可跑(Win)",
        "note": "edit LoRA 未落盘期间为弱档。",
    },
    "1_图片/MossImage/moss-t2i-dmd-4step.json": {
        "desc": "MOSS DMD 4步加速草稿线:DMD LoRA@1.0+euler+4步+CFG1+SLG end0;>1024 用 6-8 步;观澜@0.6 发车器动态注入;30s/发≈25步线的 1/8.6。",
        "status": "可跑(Win;草稿专用)",
    },
    "1_图片/MossImage/moss-t2i-版式.json": {
        "desc": "官方 SFT Layout 版式引导 t2i:CreateBoundingBoxes 画框+MOSSImageLayoutPrompt JSON 布局提示词+TextGenerate 提词增强默认开;三加载器映射在位 bf16 档。",
        "status": "官方吸收件(1108)",
    },
    "1_图片/MossImage/moss-base-t2i.json": {
        "desc": "官方 Base t2i 原样零改动参照件。",
        "status": "参照(base 底模 moss_image_base_int8_convrot 未装候令)",
    },
    "1_图片/MossImage/moss-base-t2i-版式.json": {
        "desc": "官方 Base Layout 版式件原样零改动。",
        "status": "参照(依赖同 base 底模未装)",
    },
    "1_图片/MossImage/moss-颜色深度控制.json": {
        "desc": "官方 color_depth_control:MoGe3 几何保持换角色/服装/场景(内嵌 Geometry Estimation 子图);DiT/TE/VAE 已映射 bf16。",
        "status": "官方吸收件(控制 LoRA+MoGe 权重未装候令)",
    },
    "1_图片/MossImage/moss-漫画一键生成器.json": {
        "desc": "炮老师「MOSS 漫画一键生成器 纯本地免费版」原样零改动。三层链:DapaoComicOptions 表单(四页签:风格题材/分镜节奏 7 档分格/对白字效/参考角色六槽)→本地导演 Qwen3.8-VL 27B GGUF(参考图全经 VLM 转文字)→MOSS 出图(50步 CFG3.5 er_sde+SLG+观澜+1280×1920)。",
        "status": "装机在役(Win;1111 装役毕,实弹多风格 3/3 过)",
        "note": "已知短板=背景道具小字错字,主体对白稳;产物恒落 apps/output。",
    },
    "1_图片/MossImage/moss-道劫-t2i.json": {
        "desc": "道劫范式×MOSS 产线画布件:MyMossDaojieBase 十四选一(moss_bases.json 派生库)→MyQi21PromptAssembly 三层装配直复用→双臂(原生50 观澜+SLG / DMD8步,ComfySwitchNode 懒选择)→白底转透明腿(MOSS 无 alpha,ColorToMask+闭运算+高斯软边)→SeedVR2 2K 尾档默认旁路。",
        "status": "可跑(Win;1108 开线,实弹四型五发)",
        "note": "MOSS=flux2-vae 纯 RGB,透明承载=型文底色句+抠图后链;提示词工程资料不入库住 docs/comfyui-kb/参考_提示词工程/。",
    },
    "1_图片/MossImage/moss-道劫-t2i-api.json": {
        "desc": "moss-道劫-t2i 默认臂直投模板,注入锚 5.text/6.text/8.seed/7.wh。",
        "status": "桥模板(侧栏滤除)",
    },
    # ---------------------------------------------------------------- 1_图片/QwenImage2.1
    "1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_t2i.json": {
        "desc": "官方 Qwen-Image-2.1 文生图模板(Comfy-Org 原样零改动,子图封装)。",
        "status": "官方模板(SHA256 锚防漂移)",
    },
    "1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_image_edit.json": {
        "desc": "官方改图/换装编辑模板(原样零改动)。",
        "status": "官方模板(SHA256 锚)",
    },
    "1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_background_removal.json": {
        "desc": "官方抠主体/去背景模板(原样零改动)。",
        "status": "官方模板(SHA256 锚)",
    },
    "1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json": {
        "desc": "道劫主线文生图(道劫默认件,1117 用户裁定)。双子图架构:提示词类型优化子图(MyQi21DaojieBase 九型选一+MyQi21PromptAssembly 三层装配+PE 改写+RGBA 官方公式)+加速子图(MyQi21SpeedSelect 五档:直出40/viggle/turbo8/混动40步+缓存等);⑤超分尾档=SeedVR2(mode=4 旁路保档,复活才用)+⑤b Gem 分块超分(1119 v2=照抄皮肤件磨皮后续组同构 11 节点/18 线:零独立加载器直吃主链 bf16,SamplerCustomAdvanced+ManualSigmas σ表,配方=restore@1.0+turbo r178+C 句+4K 帽 8.25MP)。",
        "status": "在役·道劫默认线",
        "note": "默认档=3·混动 40步+缓存(1101 裁定);1118 起大图超分=件内 Gem②普通细节链 10MP;σ表固化 viggle 支路;②④b 洗底·透明除渣子图;装配文真源=qi21_bases.json。",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-t2i.json": {
        "desc": "Q2-1 通用文生图(官方 t2i 换算):bf16 三件套→ResolutionSelector 官方档位→25步 cfg1 euler/simple;PE 提示词改写组默认旁路(开启即自动扩写)+RGBA 透明开关。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-daotu-rgba-t2i.json": {
        "desc": "道具透明底 RGBA 一步直出(Q2.1 VAE 原生透明,边缘模型自画零抠像):SplitImageWithAlpha 拆 RGB+MASK→SaveImageWithAlpha 存透明 PNG。替代 K2『纯白生成+rembg』两步路。",
        "status": "在役",
        "note": "道具纪律=写有什么不写没有什么(正向直陈);官方 RGBA 头尾句逐字。",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-sanlian-t2i.json": {
        "desc": "三联多视图直出(TE-MAN 一键三视图形态设计吸收,只仿零拷):空潜 1536×512 直给(三格各 512²),三联结构模板预填(左正中侧右背+同姿势同光照+不越分界线)。",
        "status": "在役(B4 吸收件)",
        "note": "宫格=中间产物,切割后才作参考(p2_grid_cut.py --rows 1 --cols 3)。",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-t2i-seedvr2.json": {
        "desc": "t2i+SeedVR2 放大一条龙:1024² 直出→SeedVR2 7B sharp fp8 短边 2048 出 2K 成品;放大组可整组旁路只出直出图。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-titlecard-t2i.json": {
        "desc": "中文标题卡/章封面排版直出(Q2-1 中文文字排版强项):resolution=2048 原生 2K 方图;文字写法=要出的字直双引号包住+单语不混排;seed 恒 424242=同 seed 换字不换版式。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json": {
        "desc": "qi21-道劫-t2i 展平 API 桥模板(qwen21_bridge_template_build.py --target t2i 生成);组装器/引擎直投面。",
        "status": "桥模板(侧栏滤除)",
    },
    "1_图片/QwenImage2.1/1_文生图/t2i-无审查-超分.json": {
        "desc": "无审查版 t2i(皮肤件组合件克隆):子图④臂挂 NSFW 双 LoRA 默认旁路(7210 f23gg NSFW-Qwen2.1@1.0+7211 femaledVaginus L22-31@1.0,手动打开)+Gem②磨皮尾档;空潜默认 1024²。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/1_文生图/t2i-皮肤-超分.json": {
        "desc": "皮肤修复组合件:t2i-通用骨架(④PrunaAI 6步/2048²)+尾档=Gem 怼脸件磨皮支嫁接(GemTiledUpscale 10MP 切 2MP 块→viggle-turbo@1.0+restore@0.5+ItsGem face@0.5 六步逐块重绘→Stitch keep_colors 0.76);双路输出=直采 2048²+磨皮 10MP。",
        "status": "在役",
        "note": "1118 起大图超分正典=件内 Gem②普通细节链 10MP。",
    },
    "1_图片/QwenImage2.1/1_文生图/t2i-通用.json": {
        "desc": "通用 t2i(七臂加速域件):加载器→提示词→加速子图(MyQi21SpeedSelect 档位)→④PrunaAI 臂默认 2K(LatentUpscaleBy ×2,1024²→2048²)+超分尾档组。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/2_图生图/qi21-bfs-换头.json": {
        "desc": "BFS 换头(Beauty Face Swap):双图(人物+头像)→BFS 换头 LoRA(bfs_head_v1.1)驱动 TE 指令换头;面部 identity 迁移,管脸不管身。",
        "status": "可跑(1022 入库)",
        "note": "与 VNCCS 姿势系同族不同域。",
    },
    "1_图片/QwenImage2.1/2_图生图/qi21-edit.json": {
        "desc": "官方换装编辑换算件:PE-I2I 改写组(看图改写,中文进中文出,默认直写)+双参考编码+加速子图;1101 起默认档3混动 40步+缓存。",
        "status": "在役",
    },
    "1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json": {
        "desc": "道劫风格图生图·生修合一(Q2-1 无传统 img2img:图输入即指令编辑零 denoise):双图预缩→BatchImages 双通道(PE 看全图/编码器吃选图)→装配子图(指令占①层:指令+型底座+美术风格底座)→双参考分线(直出臂双参考/加速臂单参考,0928 黑图修复铁则)→⑤b Gem 尾档(1119 v2 同 t2i 件 11 节点新式采样;1117 起大图超分=件内 Gem②10MP,SeedVR2 mode=4 旁路)。",
        "status": "在役·道劫默认线",
        "note": "组装用途=道劫美术风格转换;指令起草规范=docs/prompts/Qwen-Image-2.1/09-图生图指令写作规范.md。",
    },
    "1_图片/QwenImage2.1/2_图生图/qi21-道劫-img2img.json": {
        "desc": "严格经典图生图=低 denoise 重绘(同构图精修/改细节):单参考→装配三段→负面真接线→viggle LoRA(v0.3 6step r256@1.0)→KSampler 6步 dn0.6(低噪尾段起步)。",
        "status": "在役",
        "note": "与 qi21-道劫-i2i(满噪参考图编辑 dn1.0)范式分野互备;off-distribution 警示+逃生口入 Note。",
    },
    "1_图片/QwenImage2.1/2_图生图/qi21-道劫-换脸-局部重绘.json": {
        "desc": "换脸局部重绘役件(1023):脸部遮罩+透明参考处理。",
        "status": "存档",
    },
    "1_图片/QwenImage2.1/2_图生图/qwen21-multiref-edit.json": {
        "desc": "多参考拼装编辑(角色设定表/换装/多资产):三 LoadImage 预置(人物/服装/道具),prompt 以 `<imageN>` 指代与连线次序对应,上限 16 图;resolution=0 原尺寸 32 对齐;25 步官方编辑档。",
        "status": "在役",
        "note": "VAE 必接 TE(0930 实弹坑);指令英文优先。",
    },
    "1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json": {
        "desc": "qi21-道劫-i2i 展平 API 桥模板;image_engine/qwen21.py i2i 分流运行时覆写(组装用途=道劫美术风格转换)。",
        "status": "桥模板(侧栏滤除)",
    },
    "1_图片/QwenImage2.1/2_图生图/qwen21_Gem_Face_zoom_V1.json": {
        "desc": "ItsGem 怼脸放大(GemTiledUpscale 10MP 切 2MP 块×overlap256 逐块 6步重绘→亚像素配准拼回);三支同 seed 对拍:强细节(restore@0.5)/普通细节(face_lora@1.0)/磨皮(restore0.5+face0.5,keep_colors 0.76)。",
        "status": "存档参照(1109 入库;边界=仅怼脸,半身全身易崩)",
        "note": "Note 与实参不符处以 JSON 为真源:加速 LoRA 真身=r256,存盘 out_* 前缀,LoRA 无 qwen21/ 前缀。",
    },
    "1_图片/QwenImage2.1/3_社区模板/Qwen21-Turbo-9步-全功能.json": {
        "desc": "黑鹤001 整合流(官方 Turbo checkpoint 蒸馏进权重):五件套合一画布(常规编辑/扩图/元素移除/局部重绘/单图编辑+文生图)rgthree 组开关切换;编辑 9 步/文生图 8 步防材质过强。",
        "status": "Win 专用件(turbo int8 底模+PE+GGUF+功能 LoRA×3 随批配置;Mac 可见模型未布勿开)",
    },
    "1_图片/QwenImage2.1/3_社区模板/skill姿态图放大-扩展整合.json": {
        "desc": "黑鹤001 姿态图放大整合件(本地化改造:Skill 文本手贴+comfyui_controlnet_aux 装机+VOSR2→SeedVR2 替换+云端子图本地化)。",
        "status": "社区件(本地化)",
    },
    "1_图片/QwenImage2.1/3_社区模板/全能图片编辑-官方PE.json": {
        "desc": "宏雷HyLan 官方 PE 提示词强化编辑流(原样入库,生态 100% 已装零缺件):图1-6 多图槽+提示词强化组+SEEDVR2 放大。",
        "status": "社区件(原样)",
    },
    "1_图片/QwenImage2.1/3_社区模板/全能文生图-官方PE.json": {
        "desc": "宏雷HyLan 官方 PE 文生流(原样入库零缺件):提示词强化+画幅分辨率组+SEEDVR2 放大。",
        "status": "社区件(原样)",
    },
    "1_图片/QwenImage2.1/3_社区模板/社区-VNCCS姿势-t2i.json": {
        "desc": "VNCCS 姿势 t2i(Arekejoker 源,API 格式原样拷贝):int8 三件套→40步 cfg1 euler/simple。",
        "status": "社区件(API 格式,侧栏滤除)",
    },
    "1_图片/QwenImage2.1/3_社区模板/社区-VNCCS姿势-edit.json": {
        "desc": "VNCCS 姿势 edit(API 格式原样):t2i 同骨架+LoadImage 画布→TE images.image_1 指令编辑。",
        "status": "社区件(API 格式,侧栏滤除)",
    },
    "1_图片/QwenImage2.1/3_社区模板/社区-四合一换装捏人-Goohai.json": {
        "desc": "孤海四合一素材库换装捏人(原样零改动):四库随机/上传(服装1490/姿势1674/发型1255/人像1501)→七组合布尔选模板→PE-I2I GGUF 看参考图自动写中文编辑指令→T8 三叠加速(Sage+BlockCache+Spectrum)28步 cfg1。",
        "status": "装机在役(Win;1111 装役毕)",
        "note": "固有随机性(着装遵循/脸角度/偶发 PE 截断)三源皆有,产线用须逐发目检;总账 12 发可交付 5/12、崩坏 0。",
    },
    "1_图片/QwenImage2.1/3_社区模板/社区-局部换脸天花板-Dapao.json": {
        "desc": "炮老师局部换脸(BFS 换头 LoRA 官方骨架+炮氏五层封装):DapaoFaceSwapRegion 参数面板+规则引擎(22 语义开关→中文条款)→三图参考编码→qi21_bf16+三 LoRA 链→DapaoFaceHarmonize(LAB 场差+关键点 RBF)贴回。",
        "status": "装机在役(引擎在位=夸克拷贝版;Toolbox 暂缓纳册候上游追更)",
        "note": "工作流自带「仅限自用丨不准商用」;低清小图嘴部窗 fabric 误判;换发型身份必须 true。",
    },
    "1_图片/QwenImage2.1/3_社区模板/社区-无审查直出-t2i.json": {
        "desc": "无审查直出 t2i(蓝本=Arekejoker 作者实弹件):int8 三件套→femaledVaginus LoRA(槽可换四件)→EasyCache→主段 50步 cfg2.5 er_sde dn1.0→精炼段 25步 dn0.35。",
        "status": "社区件(1109 入库)",
    },
    "1_图片/QwenImage2.1/3_社区模板/编辑生图整合-TE.json": {
        "desc": "黑鹤001 编辑生图整合件(本地化改造:TESpeed 移除/TE Enhancer→TextGenerate/TE_MAN→showAnything):图像编辑+文生双模式+八图槽。",
        "status": "社区件(本地化)",
    },
    "1_图片/QwenImage2.1/4_姿势编辑/qi21-道劫-人物姿势.json": {
        "desc": "道劫人物姿势工作流(1108 持械挂腰根治役):MyQi21DaojieBase 选型→三层装配→FisherPoseStudio 人偶(文字摆姿)→FisherQwenFreePose(pose_json+image2 立绘)→声明句拼接→VNCCS 姿势 LoRA@1.0+25步/CFG1。",
        "status": "在役",
        "note": "五轮实弹配方烙进默认值(v5 终态=手持病根治+挂腰成立);无头批量路=poseReferenceFile 文件引用。",
    },
    "1_图片/QwenImage2.1/4_姿势编辑/qwen21-pose-edit.json": {
        "desc": "姿态迁移(DWPose 骨骼作第二参考):AIO_Preprocessor 自动提骨骼→存证+`<image2>` 进 TE→指令措辞控强度(无 ControlNet strength)。",
        "status": "在役",
        "note": "实弹定谳:照片类参考一把出(85%),水墨画意素材检出弱(25%);骨骼图黑底彩线=正常形态。",
    },
    "1_图片/QwenImage2.1/4_姿势编辑/官方-fisher-pose-无限姿势.json": {
        "desc": "Fisher-Pose 官方参照件(31 节点/5 Fisher 类):QwenFreePose+AnyAngleCamera/Encode 任意机位;改线两节点(底模 bf16/TE heretic)。",
        "status": "参照(姿势驱动三层:固定姿势零交互/新姿势需浏览器编辑器/纯 Python 不存在)",
        "note": "换机位分支六模型未装不可跑,警示入 Note。",
    },
    "1_图片/QwenImage2.1/4_姿势编辑/社区-VNCCS姿势-PoseStudio.json": {
        "desc": "VNCCS 姿势台(schema v3 多角色 transform JSON)×人物图→姿势迁移指令→25步 cfg1→rgthree 对比。",
        "status": "姿势台/人偶捕获器(1109 定性:经 TE 图槽做姿势迁移=无效路线;有效用途=捕获人偶喂 Fisher 件)",
        "note": "唯一改线=LoRA 路径平铺化;依赖 VNCCS_Utils 插件。",
    },
    "1_图片/QwenImage2.1/4_姿势编辑/道劫-摆姿-fisher.json": {
        "desc": "道劫摆姿产线(Fisher 官方参 1010 实证版):image1 人偶=姿势 × image2 立绘=外观,extra_prompt 四件套模板(人物归属句+人偶封禁句+色彩锚+场景句)。",
        "status": "在役",
        "note": "四件套锚配方 1010 同 seed 七发实证(缺一层出一层病)。",
    },
    "1_图片/QwenImage2.1/5_角色设定卡/qwen21-charcard-t2i.json": {
        "desc": "CharacterCardStudio 官方一键卡改造件(v3 终版=E混动加速):Turbo LoRA→LazyCache→40步;Splitter 删=raw 直出+detail-fix 删(质感差异源);修原版 clip 误接 bug。",
        "status": "在役",
        "note": "依赖 AICG3D 插件;v1/v2 两轮否决在档(8步版式遵循不足/25步 17min 偏浓)。",
    },
    "1_图片/QwenImage2.1/5_角色设定卡/道劫-角色设定卡-t2i.json": {
        "desc": "道劫设定卡 Qwen 版孪生件(1113,与 MiniMax 版同模式同底框):master t2i→六路编辑→武器/特效→MySheetCardComposer;提示词枢纽 MySheetPromptHub 单点固化(主体句+角名+背景类型唯一旋钮→13 出分)。",
        "status": "在役",
        "note": "提示词独立真源=qi21_bases#sheet_card_qwen(与 H3 块分源互斥由契约锁);模型=qi21 四件+turbo r256;批量路=daojie_sheet_b_pipeline.py --engine qwen。",
    },
    "1_图片/QwenImage2.1/5_角色设定卡/道劫-角色设定卡-i2i.json": {
        "desc": "设定卡 i2i 双件版:master=LoadImage→multiref 图生图;与 t2i 版同枢纽同底框。",
        "status": "在役",
    },
    # ---------------------------------------------------------------- 1_图片/SeeThrough
    "1_图片/SeeThrough/seethrough-basic.json": {
        "desc": "单图动漫角色层分解基础链(SIGGRAPH 2026 see-through,官方件原样):LoadImage→双模型加载(LayerDiff+Depth)→GenerateLayers→GenerateDepth→PostProcess→SavePSD;20+ 透明语义图层+深度 PSD 导出。",
        "status": "装机在役(1111 双机装机毕;Live2D 拆件前置)",
        "note": "运维规:Win 共卡=崩引擎雷(两崩两愈),日常测试=Mac;重跑恒 group_offload=true;只拆人物不拆道具。",
    },
    "1_图片/SeeThrough/seethrough-layer-editor.json": {
        "desc": "图层合成器前端形态:basic 链去 SavePSD 换 SeeThrough_PartsToLayers→ImageCompositor。",
        "status": "装机在役",
    },
    # ---------------------------------------------------------------- 1_图片/krea2
    "1_图片/krea2/1_文生图/K2-NSFW专业流-旧版0901.json": {
        "desc": "K2 NSFW 专业流旧版(0901),子图封装。",
        "status": "停用(1101 K2 域裁定)",
    },
    "1_图片/krea2/1_文生图/K2-多视图.json": {
        "desc": "K2 多视图出图:五组同构(模型加载/LoRA 尺度栈/采样/提示词链 12 带/画布)。",
        "status": "停用(1101;权重 09-23 退役外置盘备份)",
    },
    "1_图片/krea2/1_文生图/K2-宫格生图.json": {
        "desc": "K2 宫格生图(多格构图),五组同构。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/1_文生图/K2-文生图-超集.json": {
        "desc": "K2 文生图超集:LoRA 栈全家桶(尺度 44/45+画风 68-70 默认旁路;细节 67+光影 46+加速 47 激活)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/1_文生图/K2-文生图-道劫.json": {
        "desc": "K2 道劫文生图主线(水墨国风·线描硬锁):[50] 主体句→[80] 型底座→编码→[90] LoRA 栈按型分流子图(双击=9 条真实加载线,45 实件)。",
        "status": "停用(1101;道劫默认 1117 起切 QwenImage2.1 域)",
        "note": "型配方单源=qi21_bases.json(1004 集中化令)。",
    },
    "1_图片/krea2/1_文生图/K2-文生图-道劫-二采版.json": {
        "desc": "道劫 t2i 二采实验档:单模型双采(一采出构图→像素回炉→二采 dn0.35 精修),整组旁路=退单采;母版字节不动。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/1_文生图/K2-文生图-风格参照.json": {
        "desc": "K2 文生图+风格参照图。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/1_文生图/K2-文生图.json": {
        "desc": "K2 通用文生图(Krea2 Turbo 8 步),五段流:输入提示→编码→采样→VAE 解码→保存。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/1_文生图/krea2-t2i.json": {
        "desc": "krea2 域默认文生图桥模板(UNET krea2_turbo_bf16);comfyui_bridge 默认 t2i 路由+前端静态 import。",
        "status": "桥模板(运行时硬依赖,不得移动/改名)",
    },
    "1_图片/krea2/1_文生图/krea2-nsfw-pro.json": {
        "desc": "krea2 域 NSFW 桥模板(use_lora 路由);健康门禁硬依赖。",
        "status": "桥模板(运行时硬依赖)",
    },
    "1_图片/krea2/1_文生图/t2i.json": {
        "desc": "manying_t2i 映射桥模板(前缀剥段);LocalModelStudio 显式发送。",
        "status": "桥模板(运行时硬依赖)",
    },
    "1_图片/krea2/1_文生图/t2i-fast.json": {
        "desc": "manying_t2i_fast 加速档桥模板。",
        "status": "桥模板(运行时硬依赖)",
    },
    "1_图片/krea2/1_文生图/krea2-daojie-t2i.json": {
        "desc": "原 09-14 分镜无参考图路由件(1019 转档案;分镜原生 qwen-image-2.1);死节点已摘。",
        "status": "桥模板·档案(契约测试仍锚)",
    },
    "1_图片/krea2/2_图生图/K2-NSFW专业流-图生图.json": {
        "desc": "K2 NSFW 专业流图生图版(参考图输入组)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/2_图生图/K2-人脸精修-道劫.json": {
        "desc": "高清人脸精修(九型配方·高清人脸辅路):人物图裁脸精修 dn0.35 起步,[80]+[90] 栈联动。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/2_图生图/K2-图生图.json": {
        "desc": "K2 通用图生图(Krea2Edit 引导编辑):原始图载入→尺寸解析→风格条件→采样→Grounded Edit 出图。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/2_图生图/K2-无审查全家桶(4K放大+提示词增强).json": {
        "desc": "K2 无审查全家桶(113 节点大件):Image to prompt+Prompt enhancer 双段+ClownsharKSampler+二段 4K 放大+色彩校正;六子图嵌套。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/2_图生图/K2-表情差分-道劫.json": {
        "desc": "表情差分(九型配方·表情差分辅路):人脸变体 dn0.25 起步。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/2_图生图/K2-角色换装.json": {
        "desc": "K2 角色换装(官方 AliveAi t2i 换装 demo 本地化):[101] 服装参考图唯一输入+换装 LoRA(outfit_transfer)。",
        "status": "停用(1101;基准=docs/comfyui-kb/参考_换装工作流/)",
    },
    "1_图片/krea2/2_图生图/K2-角色设定-道劫.json": {
        "desc": "道劫设定卡 B 线母件(K2 版):模型+道劫 LoRA 栈([90] 设定板档五件+charsheet 独立恒挂)→参考图臂(1024² 一图六用)→补丁与条件→采样出图;B 线 v6+档3混动在役(1112 0a61ef25:编辑路 40步 cfg4+Fix+LazyCache+表情行×5+逐格名+版式回灌)。",
        "status": "在役·B线 v6",
        "note": "换配方→派生裁窗须重靶向;「停用」裁定不覆盖此件(B 线独立在役)。",
    },
    "1_图片/krea2/2_图生图/K2-角色设定-道劫-专家模式.json": {
        "desc": "B 线专家模式(原 8 件 LoraLoader 链原样副本,LoRA 效果不理想 09-21 退役)。",
        "status": "档案(回滚路径)",
    },
    "1_图片/krea2/2_图生图/krea2-daojie-i2i.json": {
        "desc": "道劫 i2i 桥格式备件(1019 转档案,死节点已摘)。",
        "status": "桥模板·档案(契约测试仍锚)",
    },
    "1_图片/krea2/3_改图/K2-图像编辑-整合流.json": {
        "desc": "K2 图像编辑整合流(93 节点四模式):双图编辑/单图编辑/图像扩展/局部重绘移除,组开关切换。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/3_改图/K2-无衣物-稳定.json": {
        "desc": "K2 无衣物·快(krea2edit 指令编辑·整图改形态保脸·不用涂)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/3_改图/K2-无衣物-遮罩.json": {
        "desc": "K2 无衣物·精(双模型分割→融合+两遍重绘,涂哪改哪)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/3_改图/K2-道劫修手.json": {
        "desc": "道劫修手件(K2 域)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/3_改图/krea2-edit-ref.json": {
        "desc": "krea2 域有参考图编辑桥模板(_REQUIRED_TEMPLATES 之一+分镜装配+前端静态 import)。",
        "status": "桥模板(运行时硬依赖,不得移动/改名)",
    },
    "1_图片/krea2/3_改图/krea2-uncloth-instruct.json": {
        "desc": "无衣物链后备桥模板(run-uncloth.ts 引用;健康门禁硬依赖)。",
        "status": "桥模板(运行时硬依赖)",
    },
    "1_图片/krea2/4_上色/K2-画稿上色.json": {
        "desc": "K2 画稿上色(krea2edit 编辑式·破限全开)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/4_上色/K2-画稿上色-叠底.json": {
        "desc": "画稿上色·叠底版(上色重绘×原线稿正片叠底)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/4_上色/K2-画稿上色-测试.json": {
        "desc": "画稿上色测试件(Sam&Max 涂色书预填)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/5_风格扩展/K2-风格扩展流（3946种）.json": {
        "desc": "K2 风格扩展流(通配符随机提示词,krea2 外卡 3k 共 2.1 万种)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/5_风格扩展/K2-风格扩展流（图生图版）.json": {
        "desc": "风格扩展流图生图版。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/6_修复超分/K2-SeedVR2修复.json": {
        "desc": "K2 SeedVR2 图像修复(单步)。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/6_修复超分/K2-SeedVR2降噪后4K.json": {
        "desc": "K2 SeedVR2 降噪后 4K 放大。",
        "status": "停用(1101)",
    },
    "1_图片/krea2/6_修复超分/K2-去噪精修.json": {
        "desc": "K2 去噪精修(道劫风格锁·重绘降噪档)。",
        "status": "停用(1101)",
    },
    # ---------------------------------------------------------------- 2_视频
    "2_视频/H3视频/1_漫影自研/单镜.json": {
        "desc": "H3 视频正典主线(1119 由旧名三采-单镜件改名而来,见漫影工作流清单 1119 笔)。七组全链:输入→加载模型→一采(H3 底模 Cobijada+pika LoRA·8步·960×544,r2v 多参考/i2v 首帧双模式三 Seam 懒选择)→二采(TaoMate LoRA 3步·1440×832,默认终档)→三采(ReCaVSR 主线·2880×1664)→四采修脸组(5000 段·远景/高清双档·默认旁路)→终档组 p-final。四输出口 p1-preview/p2-final/p3-recavsr/p-final。",
        "status": "在役·正典",
        "note": "Note103 运行法则:发车拆链+POST /free;分辨率阶梯按输入图 AR 推导;四采开关=#1065(默认 False=旁路);5012 画布宽高=5011 追踪器出口联线禁手填。",
    },
    "2_视频/H3视频/1_漫影自研/一镜到底-分段.json": {
        "desc": "一镜到底·分段(multiseg,>15s 域闭环):六组=加载模型→一采正典臂(turbo+lcm+sol-attn+ChunkFFN2+kitchen+σshift[6,3] 外接,enable_cache=False)→一采分段(pika 8步)→一采直出→二采精修(TaoMate 3步·1440×832)→三采超分(ReCaVSR scale2)。36 节点 A 方案;交叉=记录项正典(硬底 36,cap40)。",
        "status": "在役",
        "note": "两步法口径:整图含段 B=引擎崩禁;41 节点 6 组出厂实弹全过;2×10s 超限域闭环。",
    },
    "2_视频/H3视频/1_漫影自研/导演台.json": {
        "desc": "导演台(1114 真复刻终态·新形态一条链):4 loader(UNET/TE/视频VAE/音频VAE)→导演台节点[MyDirectorConsole]→CreateVideo→SaveVideo。多镜/阶段三勾选(勾啥跑啥:p1-draft 草片/p2-final 重采样/p3-recavsr 文件化交接 2K)+章草片/章终片 ffmpeg 外拼。",
        "status": "在役(tag v0.0.5)",
        "note": "执行链=节点内 director_executor.py 直调引擎在册节点类,配方 DIRECTOR_RECIPE 焊死(母本 66 节点接线逐位同源);断点续跑=检查点 glob 跳过。",
    },
    "2_视频/H3视频/2_固定线/社区-480P生成-SolAttn加速-480P直出.json": {
        "desc": "固定线·480P 直出(社区件收编):SolAttn 加速单段 480P。",
        "status": "固定线在役",
    },
    "2_视频/H3视频/2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json": {
        "desc": "固定线·960P 精修直出:480P 生成+H3 Latent Upscaler 二段精修到 960P。",
        "status": "固定线在役",
    },
    "2_视频/H3视频/3_超分后处理/relayvsr-超分-2x.json": {
        "desc": "RelayVSR 2× 超分主力(1106 裁定·官方 Streaming 形态 3 节点):LoadVideo→RelayVSRModelLoader→RelayVSRUpscaleStreaming,视频文件直进直出整片不落张量,音轨 AAC 直拷;offload 恒开。",
        "status": "在役·超分主力",
        "note": "1.09-1.17s/帧(RTX PRO 4000);崩脸对拍胜 SeedVR2(无重绘漂移)。",
    },
    "2_视频/H3视频/3_超分后处理/seedvr2-超分-1080p.json": {
        "desc": "SeedVR2 7B 1080p 档(原产线标准档,1106 起降备用修复系=崩脸救援)。",
        "status": "备用",
    },
    "2_视频/H3视频/3_超分后处理/seedvr2-超分-4x.json": {
        "desc": "SeedVR2 4x 档(1028 横评质量王 W1:sharp fp8+swap36+offload,短边 1408→2432×1408)。",
        "status": "备用",
    },
    "2_视频/H3视频/3_超分后处理/社区-视频文件直接超分-SeedVR2.json": {
        "desc": "视频文件直接超分(社区件收编):LoadVideo→SeedVR2 三件;tiled 512/160 实战值。",
        "status": "在役(参数参照源)",
    },
    "2_视频/H3视频/4_模板/H3-文生视频-480p.json": {
        "desc": "官方 H3 文生视频 480p 模板(recipes 登记锚定)。",
        "status": "官方模板(unverified)",
    },
    "2_视频/H3视频/4_模板/H3-首尾帧运镜版.json": {
        "desc": "官方 H3 首尾帧运镜版模板。",
        "status": "官方模板(unverified)",
    },
    "2_视频/H3视频/4_模板/官方本地-I2V-480P.json": {
        "desc": "官方 I2V 480P(子图封装;Pika H3 Flex 官方模板族,六-NFE ManualSigmas 采样契约)。",
        "status": "官方模板",
    },
    "2_视频/H3视频/4_模板/官方本地-R2V-480P-需解冻ref2va.json": {
        "desc": "官方 R2V 480P 参考图生视频(ref2va 权重已删不可实弹,解冻后再校锚)。",
        "status": "官方模板(needs-unfreeze)",
    },
    "2_视频/H3视频/4_模板/官方本地-T2V-480P.json": {
        "desc": "官方 T2V 480P(子图封装)。",
        "status": "官方模板",
    },
    "2_视频/H3视频/5_云端API/官方API-T2V-480P.json": {
        "desc": "H3 云端 API T2V 480P(官方 API 面模板)。",
        "status": "参照(云端 API)",
    },
    "2_视频/H3视频/5_云端API/官方API-R2V-480P.json": {
        "desc": "H3 云端 API R2V 480P。",
        "status": "参照(云端 API)",
    },
    "2_视频/H3视频/5_云端API/官方API-FLF2V-480P.json": {
        "desc": "H3 云端 API 首尾帧 480P。",
        "status": "参照(云端 API)",
    },
    "2_视频/H3视频/6_视频重制/viggle-remake-edit.json": {
        "desc": "Viggle 视频重制·编辑:源视频+编辑指令→内容改、运镜/时序/音轨保;RemakeConditioning/KeyframeUntil/Noise 三节点组;底座走现役 Cobijada hybrid。",
        "status": "装机在役(1112 v3 可见替换实证闭环)",
        "note": "勿以包内 UI 默认名 fl2va_bf16 直投;243 帧墙。",
    },
    "2_视频/H3视频/6_视频重制/viggle-remake-edit-single-ref.json": {
        "desc": "Viggle 重制·单参考编辑变体。",
        "status": "装机在役",
    },
    "2_视频/H3视频/6_视频重制/viggle-remake-swap.json": {
        "desc": "Viggle 重制·换主体:swap LoRA 驱动主体替换。",
        "status": "装机在役",
    },
    "2_视频/H3视频/7_测试/AIMixer-t2v.json": {
        "desc": "AIMixer 官方示例·文生音视频(11 节点基础单段);导演台 v1 母本参照。",
        "status": "参照件(1113 入库)",
    },
    "2_视频/H3视频/7_测试/AIMixer-r2v.json": {
        "desc": "AIMixer 示例·参考生视频(11 节点,我方产线同模式)。",
        "status": "参照件",
    },
    "2_视频/H3视频/7_测试/AIMixer-external-groups-i2v.json": {
        "desc": "AIMixer 示例·程序化正门 i2v(22 节点,外置组装配)。",
        "status": "参照件",
    },
    "2_视频/H3视频/7_测试/AIMixer-二采-加速.json": {
        "desc": "AIMixer 示例·Refine 二采+加速档(21 节点)。",
        "status": "参照件",
    },
    "2_视频/H3视频/7_测试/TESSERA-超分-1080p.json": {
        "desc": "TESSERA 精修超分独立件(1110 入库,1112 三采纯净化役迁入 7_测试):整株移植三采-单镜 TESSERA 旁路组;参数=api_formal_v4 定谳(×1.5 lanczos/σ1,0.7,0.4,0/er_sde/taomate@0.7/sol-attn τ1.5/CRF12);LoadVideo 吃任意片,零外部依赖零出线。",
        "status": "在役(质量档精修;盘面住 7_测试,清单 3_超分后处理行滞留旧位)",
    },
    "2_视频/H3视频/7_测试/fasth3-单镜视频-i2v.json": {
        "desc": "FastH3 单镜 I2V(首帧锚定;1027 主线双件之一)。",
        "status": "退役(1105 在位停用;fasth3 底模 1111 物理删=永不可跑)",
    },
    "2_视频/H3视频/7_测试/fasth3-单镜视频-t2v.json": {
        "desc": "FastH3 单镜 T2V(纯文生基础版)。",
        "status": "退役(同上)",
    },
    "2_视频/H3视频/7_测试/fasth3-二采超分-2x.json": {
        "desc": "FastH3 二采超分 2x(1028 横评质量王 W6:LBH 3D latent 上采样+8步 dn0.45 浅二采+零值音轨包裹)。",
        "status": "退役(底模已删永不可跑)",
    },
    "2_视频/H3视频/7_测试/pika-单镜视频-fl2v.json": {
        "desc": "Pika fl2v 单镜(1101 主线件,1105 被三段链吸收;Cobijada 化活体标本)。",
        "status": "档案(历史主线)",
    },
    "2_视频/H3视频/7_测试/pika-单镜视频-ref2v.json": {
        "desc": "Pika ref2v 单镜(1101 入库,分镜产线 r2v 族母体;被三段链吸收)。",
        "status": "档案(历史主线)",
    },
    "2_视频/H3视频/7_测试/一采探顶-RelayVSR-2K.json": {
        "desc": "一采探顶测试件(1117):三采-单镜剥 TaoMate 二采段,一采 VAEDecode 直连 RelayVSR 内置臂;ResolutionSelector 阶梯入口。阶梯实测 1440/1600/1792/1920 四档全过,一采 1440×832→RelayVSR X2→2880×1664 成片。",
        "status": "测试件(结论已入档)",
    },
    "2_视频/H3视频/7_测试/三采-单镜-RelayVSR-1110.json": {
        "desc": "三采-单镜 1110 版(阶梯 960×544→1440×832→RelayVSR 1920×1080;100 节点含 TESSERA 质量档)。",
        "status": "档案(1111 换防 ReCaVSR 退役)",
    },
    "2_视频/H3视频/7_测试/三采-单镜-RelayVSR.json": {
        "desc": "RelayVSR 内置臂对拍变体件(1117 役;74 节点,对拍败于 ReCaVSR 终裁主线不动)。",
        "status": "档案(已测备选)",
    },
    "2_视频/H3视频/7_测试/三采-单镜-修脸.json": {
        "desc": "融合修脸件(1119 役毕:正典 87 深拷贝+嫁接 10 新节点 5101-5110):SAM3 链(sam3.1_multiplex+CLIP face+VideoTrack+TrackToMask)吃 5011.crops,mask 双用=清洗支路+原始 mask 直连;DifferentialDiffusion 串 5014;VOSR2 尾档。双臂对拍胜(+113.6% 脸区清晰度);4K 验活过(ch002 3840×2220)。",
        "status": "测试(1119 实弹三验毕,候转正)",
        "note": "生成器=h3_face_refine_fusion_1118.py;契约 test_three_stage 件册锚同步。",
    },
    "2_视频/H3视频/7_测试/三采-单镜-小脸修复.json": {
        "desc": "小脸修复克隆件(1117):正典+四采组 5001-5024(FaceRefine 链:LoadVideo 吃 p3→TrackCrop YOLO 追踪→InjectLatent→AudioLock→PerFrameDenoise→Stitch→p4);裸 Cobijada+turbo 迷你链=引擎缓存命中。",
        "status": "测试(第二章镜16 四段实弹 PASS)",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-T2V.json": {
        "desc": "PikaFlex T2V UI 母本(官方模板子图封装;fl2va/ref2va 底模已删=纸面参照)。",
        "status": "档案(pika 双主力线亲生母本)",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-FL2VA首尾帧.json": {
        "desc": "PikaFlex FL2VA 首尾帧 UI 母本。",
        "status": "档案",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-REF2VA参考图.json": {
        "desc": "PikaFlex REF2VA 参考图 UI 母本(平铺形)。",
        "status": "档案",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-T2V-加速双叠.json": {
        "desc": "PikaFlex T2V 加速双叠 API 变体(EasyCache τ0.2/0.15-0.95+ModelAttentionBackend kitchen INT8;-11.79% 热对热)。",
        "status": "档案(API 格式,侧栏滤除)",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-FL2VA首尾帧-加速双叠.json": {
        "desc": "PikaFlex FL2VA 加速双叠 API 变体。",
        "status": "档案(API 格式)",
    },
    "2_视频/H3视频/7_测试/官方本地-PikaFlex-REF2VA参考图-加速双叠.json": {
        "desc": "PikaFlex REF2VA 加速双叠 API 变体。",
        "status": "档案(API 格式)",
    },
    "2_视频/H3视频/7_测试/社区-Easy-一键多模式-480P.json": {
        "desc": "Easy-Use 一键多模式 480P(实验件)。",
        "status": "存档≠在役",
    },
    "2_视频/H3视频/7_测试/社区-Easy-两段精修-480P.json": {
        "desc": "Easy-Use 两段精修(一段动作构图+二段 W4A8 低 denoise)。",
        "status": "存档≠在役",
    },
    "2_视频/H3视频/7_测试/社区-H3三采6步lora完美版.json": {
        "desc": "班长三采 6步 lora 件(夸克留档;BanZhang 生态插件公开渠道无货=永不可装)。",
        "status": "存档(精髓已吸收进自研单镜)",
    },
    "2_视频/H3视频/7_测试/社区-H3终极三采v2版.json": {
        "desc": "班长终极三采 v2(同上永不可装)。",
        "status": "存档",
    },
    "2_视频/H3视频/7_测试/社区-H3小脸修复-SAM.json": {
        "desc": "南风 H3-FaceRefine SAM 版(作者 example 原样归档:Impact Pack FaceDetailer 视频化——H3FaceTrackCrop(YOLO+InsightFace)→H3InjectVideoLatent→H3PerFrameDenoise(按脸尺寸缩放 dn)→H3FaceStitch 亚像素贴回);1118 排障毕全链 success,卡点=修脸步表情口型漂移。",
        "status": "参照件(嫁接面=SAM3 遮罩双用+差分扩散)",
        "note": "作者环境=GGUF 装载器+lightx2v 4step,我方引擎不装属预期。",
    },
    "2_视频/H3视频/7_测试/社区-H3小脸修复-矩形.json": {
        "desc": "南风 H3-FaceRefine 矩形版(30 节点,同 SAM 版机制)。",
        "status": "参照件",
    },
    "2_视频/H3视频/7_测试/社区-TTS-语音生成-480P.json": {
        "desc": "TTS 语音驱动视频模板(fl2va 底模已删不可跑)。",
        "status": "存档",
    },
    "2_视频/H3视频/7_测试/社区-480P生成-潜空间放大到960P.json": {
        "desc": "480P 潜空间放大到 960P(被 2_固定线 960P 精修取代)。",
        "status": "存档",
    },
    "2_视频/H3视频/7_测试/社区-480P生成-960P精修-SolAttn加速-SeedVR2超分2K.json": {
        "desc": "固定线同款+旧 SeedVR2 尾档(超分主力 1106 已转 RelayVSR)。",
        "status": "存档",
    },
    "2_视频/H3视频/7_测试/社区-FreeVideo-All-in-One-N卡专用.json": {
        "desc": "FreeVideo All-in-One(N 卡备档件;模型 46.9G 住 Windows 尝鲜机)。",
        "status": "存档",
    },
    "2_视频/H3视频/8_数字人/数字人-音频驱动.json": {
        "desc": "数字人·音频驱动口型(1111 萝卜嫁接画布件):三段展开(LoadAudio→TrimAudioDuration 切片→ref_audios 参考音频口+MiniMaxH3NativeAudioLock 锁音 latent 双通道)+22 帧桥(MotionContextSaveLatent→ContextLatentTaperNoise→MotionContext 合入下段)+逐段 SaveVideo;σ=官方 6-NFE 七值 euler_ancestral。",
        "status": "在役(嫁接我方 Cobijada+pika flex ref2va 栈,52G 零下载)",
    },
    "2_视频/H3视频/8_数字人/无限时长-循环拼接.json": {
        "desc": "无限时长·循环拼接:自产音轨 VAEDecodeAudio+AudioConcat 跨段接力+SaveAudio 收口+MotionContextTrim 动态剪桥;循环数=自动算;JS 模语义网格 4s→90f。",
        "status": "在役(1111 实弹 PASS:双缝连续/亮度平滑)",
    },
    "2_视频/H3视频/8_数字人/340-H3数字人V6-萝卜原件.json": {
        "desc": "萝卜 340 集原件归档(B站 BV13BWu6rEjR;原样零改动):音频驱动口型 RB 系自研节点(RB_Code/RB_SaveImages 等)。",
        "status": "档案(RB 节点引擎未装,画布直开缺件属预期;机制已解构嫁接)",
    },
    "2_视频/H3视频/8_数字人/340-H3无限时长V6-萝卜原件.json": {
        "desc": "萝卜无限时长 V6 原件归档(同上;循环数=int((音乐帧-段帧-24)/(段帧-22))+1)。",
        "status": "档案",
    },
    # ---------------------------------------------------------------- 3_声音
    "3_声音/Drama3/drama3-配音-文生语音.json": {
        "desc": "Drama-3 TTS 文生语音起步件(官方 workflow_basic 骨架+Loader 改 w4a8):T8DramaLoader(expert_cache/RAM 放置)+Generate+Decode+SaveAudio。",
        "status": "装机在役(Win;1111 实弹五发全 PASS)",
        "note": "V3 节点 API 投单:io 带 default 但无 optional=True 的字段全部 required 必须显式传。",
    },
    "3_声音/Drama3/drama3-配音-多角色场景.json": {
        "desc": "Drama-3 多角色场景件:script 逐行「角色: 台词」+characters 音色描述+scene 场景描述+generation_mode 四档(together/per_line/per_line_context/per_speaker);一段文本 16 说话人=漫剧配音线正身。",
        "status": "装机在役(Win)",
    },
    "3_声音/Yue2/yue2-整曲-官方版.json": {
        "desc": "YuE2 整曲生成官方版(人声+伴奏完整曲)。",
        "status": "在役",
    },
    "3_声音/Yue2/yue2-bgm-纯音乐-lora版.json": {
        "desc": "BGM 纯音乐构图(YuE2+instrumental LoRA):歌词槽五标签逐行 [intro][verse][chorus][bridge][outro];style/lyrics 单源两节点同源。",
        "status": "在役",
    },
    "3_声音/Yue2/yue2-bgm-纯音乐-lora版-api.json": {
        "desc": "BGM 面板 repo 源桥模板(yue2_bgm_api_export.py 导出)。",
        "status": "桥模板(工作台 BGM 面板)",
    },
    "3_声音/Yue2/yue2-出谱-abc版.json": {
        "desc": "ABC 单独出谱(YuE2GenerateABC 只出谱不出音频);配 -api 为 BGM 面板「先出谱」源。",
        "status": "在役",
    },
    "3_声音/Yue2/yue2-出谱-abc版-api.json": {
        "desc": "出谱桥模板。",
        "status": "桥模板",
    },
    "3_声音/Yue2/yue2-翻唱-记谱版.json": {
        "desc": "翻唱·记谱重渲:LoadAudio 参考曲→SheetSage2AudioToABC(mode=melody)→YuE2GenerateMusic 保旋律重渲新风格;mode 配对铁律入 Note。",
        "status": "在役",
    },
    "3_声音/Yue2/yue2-翻唱-记谱版-api.json": {
        "desc": "翻唱桥模板(参考曲经 /comfy/execute images 注入)。",
        "status": "桥模板",
    },
}
