# LoRA 库存台账(09-19)
**扫描快照日:2026-09-19**(下述全量扫描/引用计数基线=当日三面快照;「home 副本/用户区 N json」等计数均属此快照);**最近核账日:2026-10-10**(10-10 Krea2 外置对账落账:#1-#21 全系 21 件早于 09-23 已整体迁外置卷 `/Volumes/郑冰津/AI/Krea2/models/loras/`(五子目录+DCS 根件,凭卷根 manifest-retired-0923.jsonl——sha256 全套 21 条在册,10-10 抽验 275B 服从度件哈希一致;外置 loras 目录 mtime 09-23 23:14),本地 loras 零 Krea2 残留(find 实测,五目录连壳不在);各行补「外置位」注记(对齐 #22 H3 行格式),引用列按 10-10 复扫勘正(旧→新,子图感知口径补 refscan 仅扫顶层 nodes 的盲区,大头=道劫/二采版 `sg:[90] LoRA栈` 9 加载线);10-10 复测 BROKEN=71 节点/129 串=Krea2 系断链(件外置非丢失)+既有留档断链(R2V[145]/viggle r64/r128)+新发现 `QI2.1_AnyAngle`(4 串)/`QuadView_krea2_v1`(2 串)本机从未有件;#21 勘正=角色设定系 [164] 装载槽现指 QuadView_krea2_v1,DCS 节点级引用归零;同日 #24 consistency 迁 `/Volumes/郑冰津/AI/Qwen/`(迁后 sha256 前缀 4f44ada1 双验一致,凭据 apps/build/scripts/backups/manifest-migrated-consistency-1009.jsonl;脚本 lora_migrate_consistency_1009.sh 原 apps/build/scripts/ 位已被 10-10 清理役归档至 archive/2026-10/scripts-campaign-retired-1010/,自归档位原样执行);零删除(kill 仍走勾选,_trash_0919 恒未建);前账 2026-10-08(10-08 viggle v0.3 满血化役落账:#25 v0.2.1→v0.3-r256 换件(旧件删除,凭据 apps/build/scripts/backups/qi21_viggle_v03_1008/manifest-retired-v021-1008.jsonl);道劫 viggle 腿=官方未合并节点 ViggleTurboLora(拒 bf16 合并丢 30%)+ViggleTurboSigmas(动态shift)+9步双段链(SplitSigmas 7+2/段B 底模摘LoRA/DisableNoise 续采);新入库 #28 e-n-v-y Fix v2.0(第三臂库存,零产线引用);引擎家新增 custom_nodes/viggle-turbo 官方双节点(非 loras 实体,附记);前账:2026-10-04(10-04 DMAD 战役落账:#27 补登 + #22 状态更新——单镜视频线 1003 A/B 对拍赢、1004 预授权换 DMAD 默认档,#22 旧件引擎位保留未删(余 5 线引用未迁移),详见 docs/comfyui-kb/档案/DMAD-4步LoRA转制与单镜线换档-1003.md;前账 10-03:10-03 两件补登:viggle-turbo r256 09-24 落盘 / Fun-Acc T8 09-26 落盘,10-02 备案的两笔装机欠账清账;面板侧 taxonomy 域针/件级注/测试于 09-24/09-26 落盘当日已随登,本轮 vitest 12 passed 幂等复验)

> **生成方式**:扫描脚本 `apps/build/scripts/daojie_lora_refscan.py`(只读)对三面全量扫描后人工合并定谳——仓库工作流库 54 json(UI `nodes[].widgets_values[_named]` + API/桥 `graph` 递归)+ 引擎家用户区 3 json(09-19 快照数;该批用户区件已于 09-21 清账删除,用户区此后按落位规范恒零——10-04 实测又有 09-23 写入残留 2 件+索引 1 件,属违反落位规范的滞留脏态,见 `工作流落位规范.md`§四与 `workflow_placement_audit.py` 红项,不属本台账扫描面)+ my_nodes 数据面 2 json,共 59 个;对装机家 `~/Library/Application Support/漫影工作室/comfyui/models/loras/` 实际文件判存。
> **首扫(修复前)**:2026-09-19 晚,`BROKEN=13`(引用了不存在文件的节点数;柔水彩×5 节点/复古漫×6 节点/charsheet 模板路径×1/H3 模板×2——审计 §1 只记了其中 4 处,超集/风格参照的 [70] 复古漫与 H3 模板两处为本轮扫描新发现)。
> **复扫(修复后)**:`BROKEN=1`(仅 H3 官方 R2V 模板 [145],见断链节;道劫 t2i 实测零断链,a245ce9 已收口,本轮未触碰该文件)。
> **判存口径**:LoRA 加载节点(类型名含 lora,如 LoraLoaderModelOnly)与 my_nodes 数据面为权威口径(引用即判存);非 LoRA 节点(checkpoint/VAE/TE/DiT/pack)中的同名扩展名字符串仅当命中库内实体才计为引用(pack 内嵌 lora 槽不漏账),未命中的 298 条列入「存疑模型串」不计断链(离线无法判其所属模型域,绝大多数为 VAE/TE/DiT/预览件)。
> **kill 仅为建议,本台账不执行任何删除**;处置两步制(回收目录 7 天后真删)待用户逐项勾选后另轮执行(PRD R5)。

## 一、库存决策表(27 件实体,≈14.77 GB=原 12.81+#27 新增 1.956;引用计数=修复后复扫实测;#24/#25/#26 为 10-02/10-03 逐件补登,#27 为 10-04 补登(DMAD 战役赢分支落账)——#25/#26 引用计数=10-03 全域实读(仓库库+引擎家用户区+my_nodes 数据面,含 definitions 子图,补 09-19 refscan 仅扫顶层 nodes 的口径盲区))

> **「home 副本」列注(10-04 勘正)**:表中「home 副本」「home 道劫/超集副本」等引用方计数=**09-19 扫描快照**(当时用户区尚存副本);该批用户区件已于 09-21 清账删除,用户区按 `工作流落位规范.md`§四口径恒零——引用计数中的 home 分量现仅具历史对账意义,不代表现存文件。
> **「引用」列注(10-10 勘正)**:箭头「旧→新」=09-19 快照→10-10 复扫;无箭头=两次一致。复扫为**子图感知口径**(含 `definitions.subgraphs[]` 内节点,补 refscan 顶层 nodes 盲区,同 #25/#26 的 10-03 全域实读口径),扫描面 92 json 实测(repo+home+mynodes;home 用户区现仅 3 件 qi21/fisher 系、my_nodes 数据面 daojie_loras.json 已不存——Krea2 系引用现全部来自 repo `1_图片/K2图像/` 域,主力=道劫/二采版 `sg:[90] LoRA栈·按型分流` 子图九线+超集/风格参照/角色设定专家模式顶层)。

| # | 文件(相对 loras/) | 大小 | 引用 | 引用方(节点级) | 定谳出处 | 建议 | 勾选 |
|---|---|---|---|---|---|---|---|
| 1 | Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors | 418 MB | 11→**41** | 道劫t2i[47]常开;风格参照[47];t2i-fast[14];修手[10];home 道劫/超集副本[47] | research §1「速度档核心」 | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 2 | Krea2-功能/Krea2-服从度ProjectorScale.safetensors | **275 B** | 4→**36** | 道劫t2i[81]常开×0.01;home 道劫[81] | research §1「09-19 A/B 定谳入库」;实测=真 275 字节件(仅 lora_A[1,12]+lora_B[1,1] 两枚 F32 标量张量打 `text_fusion.projector`,非断头;§1「275M」系笔误) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl;10-10 外置件 sha256 抽验一致),本地零残留 | ☐ |
| 3 | Krea2-功能/Krea2-编辑identity_edit_v1_2.safetensors | 1.7 GB | 43→**35** | 道劫t2i[19]/角色设定[19]旁路;三视图/宫格/超集/风格参照/图生图/i2i/编辑整合流×4/无衣物稳定/edit-ref/uncloth/上色×3/风格扩展i2i/去噪精修[42]+home 副本 | research §1「身份编辑系,跑 t2i 曾致丑=仅编辑流用」 | **keep**(编辑线核心);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 4 | Krea2-功能/Krea2-编辑outfit_transfer.safetensors | 1.1 GB | 1 | 角色换装[100](换装流 09-19 验证过;10-10 复扫仍 1=同一处) | research §1 | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 5 | Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors | 11 MB | 23→**42** | 人物三件之一:道劫t2i[67]常开+超集[67]默认激活+风格参照/角色设定[67]+home 副本;数据面 daojie_loras.json 九型全组(数据面件现不存,10-10 复扫计入=超集/风格参照/专家模式+道劫双版 LoRA栈子图) | research §1;PRD R1;commit a8ca8f7(九型数据面) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 6 | Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors | 224 MB | 16→**28** | 人物三件之一:道劫t2i[76]×0.4+超集[76]+角色设定[76]×1.0+home 副本;数据面 6 组 | research §1(卡口径「面孔·」不占画风名额) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 7 | Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors | 224 MB | 19→**36** | 人物三件之一:道劫t2i[73]×0.3+超集[73]+角色设定[173]×0.4+home 副本;数据面 7 组 | research §1(国风主锚;场景免用=09-19 裁定) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 8 | Krea2-画风/金雾仙侠GoldenMisty.safetensors | 448 MB | 6→**24** | 道劫t2i[87]默认旁路(6c4278d 入流)+home 副本;数据面「场景/概念气氛图」2 组×0.6 | research §8(09-19 实拍唯一倾向件);R2 对拍进行中 | **keep**(R2 后定区间);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 9 | Krea2-画风/Krea2-淡彩线描插画_v1.safetensors | 218 MB | 4 | 道劫t2i[82]默认旁路+home 副本(10-10 复扫仍 4=道劫双版 LoRA栈子图 [146] 各 2) | research §8(19:28 落盘);旧 .part 断头已清 | **keep**(R2 对拍中);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 10 | Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors | 218 MB | 4 | 道劫t2i[83]默认旁路+home 副本(10-10 复扫仍 4=道劫双版 LoRA栈子图 [147] 各 2) | research §8(20:14 落盘) | **keep**(R2 对拍中);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 11 | Krea2-画风/Krea2-水彩湿画wash_v1.safetensors | 224 MB | 4→**8** | 道劫t2i[84]默认旁路+home 副本 | research §8(20:42 落盘) | **keep**(R2 对拍中);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 12 | Krea2-画风/Krea2-暗笔刷darkbrush.safetensors | 448 MB | 14→**10** | 道劫t2i[69]/超集[69]/风格参照[69]/角色设定[69]旁路+home 副本×3 | research §1「按需件(候选清理/保留待用户勾选)」 | **kill 候选**(有引用,删须先摘节点;R2 后定);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留——kill 勾选后执行位=外置卷件 | ☐ |
| 13 | Krea2-画风/Krea2-美学Masterpiece_v51.safetensors | 205 MB | 10→**16** | 道劫t2i[77]/超集[74]/角色设定[77]旁路+home 副本×2 | research §1「按需件(候选清理待勾选)」 | **kill 候选**(有引用,删须先摘节点;R2 后定);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留——kill 勾选后执行位=外置卷件 | ☐ |
| 14 | Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors | 218 MB | 10→**8** | 道劫t2i[78]×0.5/超集[75]/角色设定[78]+home 副本×2 | research §1(消融处方后降权保留;§2 勘误现态=旁路×1,与处方差异 R2 核定) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 15 | Krea2-画风/Krea2-风格参照style_reference.safetensors | 436 MB | 2 | 风格参照流[72](10-10 复扫仍 2=同处双轨) | research §1(风格参照流在役) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 16 | Krea2-光影/Afterlight_v1.safetensors | 109 MB | 14→**18** | 道劫t2i[46]/超集[46]/风格参照[46]/角色设定[46]旁路+home 副本×3 | research §1(消融裁定旁路=电影化主因) | **keep**(消融定谳旁路件);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 17 | Krea2-NSFW/KREA 2 Mystic XXX v3.safetensors | 218 MB | 20→**18** | NSFW 破限双件之一:超集[44]/三视图[44]/宫格[44]/风格参照[44]/文生图[70]/nsfw-pro[75]/无衣物稳定[44]/上色×3[44]+home 副本 | research §1(NSFW 独立线) | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 18 | Krea2-NSFW/Krea 2 pussy.safetensors | 218 MB | 20→**18** | 同上([45]/[71]/[78] 位) | research §1 | **keep**;外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 19 | Krea2-NSFW/Krea 2 NSFW V4.safetensors | 436 MB | **0** | 无(全库零引用,复扫实测;10-10 复扫仍 0) | 本轮扫描实测(审计 §1 按 4 件分组记,未细分) | **kill 候选**(零引用;NSFW 线治理另册,勾选才动);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留——kill 勾选后执行位=外置卷件 | ☐ |
| 20 | Krea2-NSFW/krea2_nsfw_v2.safetensors | 218 MB | **0** | 无(全库零引用;10-10 复扫仍 0) | 本轮扫描实测 | **kill 候选**(同上);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留——kill 勾选后执行位=外置卷件 | ☐ |
| 21 | DynamicCharacterSheet_krea2_v1.safetensors(根) | 872 MB | 2→**0** | 角色设定[164](官方挂法=必先于 ModelPatch);上游模板 DCS`[164]`（本轮路径修复后入列）——**10-10 勘正**:角色设定系双件 [164] 装载槽现指 `QuadView_krea2_v1.safetensors`(本机从未有,断链 2 串),DCS 文件名仅存 properties.models/标题元数据,节点级引用归零 | research §1;本轮修复④ | **keep**(角色设定流核心;复用须回改槽指本件或自外置卷回迁);外置位 /Volumes/郑冰津/AI/Krea2/models/loras/ 同相对路径在位(09-23 迁,凭卷根 manifest-retired-0923.jsonl),本地零残留 | ☐ |
| 22 | minimax_h3_fl2v_turbo_4step…avg_rank_28_bf16.safetensors(根) | 394 MB | 8 | H3 固定线×2/超分2K/潜空间[41] 各双轨(10-04 换档后复测:单镜视频已换 #27,余 4 文件 8 处;TTS 子图 1 处按本台账口径另计) | research §1(H3 线不动);1003 dmad-win | **keep→退役预备**(单镜线已换 #27 DMAD(1003 A/B 对拍赢+1004 预授权);引擎件保留未删——余 5 线激活引用未迁移(固定线×2+社区×3 含 TTS 子图);外置位 /Volumes/郑冰津/AI/H3/loras/ 同件在位,sha256 前缀 c139f520 双侧 10-03/10-04 核一致;5 线迁移后另行清件) | ☐ |
| 23 | minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors(根) | 1.96 GB | 9 | H3 官方模板×4/Easy×2 等 | research §1(H3 线不动) | **keep**(同上) | ☐ |
| 24 | qwen-image-2.1-consistency.safetensors(根) | 152 MiB | **0** | 无(未编入工作流;10-02 grep 仓库库/my_nodes 数据面/引擎家用户区零命中复验;10-10 迁前 refscan 复测仍 0) | 10-01-consistency-lora-eval research+lora-facts.md 终局「不编入留库备用」;10-02 装机补登(159,436,496 B,sha256 前缀 4f44ada1;HF=ausboss/Qwen-Image-2.1-Consistency-LoRA,step 1500,Qwen 研究许可非商用) | **keep**(照片类素材改图漂移时手动挂;仅英文指令,中文链黑图判死;FunAcc 叠加无害;40步时间税约+80%);**10-10 已外置** /Volumes/郑冰津/AI/Qwen/qwen-image-2.1-consistency.safetensors(1009 用户令「这个无用也迁移走」;迁后 sha256=4f44ada1… 双验一致,本地清位;凭据 apps/build/scripts/backups/manifest-migrated-consistency-1009.jsonl;脚本 lora_migrate_consistency_1009.sh 自 archive/2026-10/scripts-campaign-retired-1010/ 原样执行) | ☐ |
| 25 | Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors(根) | 1.36 GB | 3 | t2i [7] 加速子图 [7011] **ViggleTurboLora(官方未合并节点)** ×1.0;i2i/edit [7011] LoraLoaderModelOnly ×1.0(10-08 t2i 满血化换官方节点=拒 bf16 合并丢 30% 更新;i2i/edit 未随令仍通用加载) | 10-08 v0.2.1→v0.3 换件+满血化(旧件已删,凭据 manifest-retired-v021-1008.jsonl,md5前16=0e366bf463bca0aa;t2i 档2=官方 9步满血双段:ViggleTurboSigmas 9点动态shift+SplitSigmas 7+2+段B 底模摘LoRA+DisableNoise 续采;v0.3 官方口径=less grain/cleaner surfaces) | **keep**(Q2-1 道劫线 viggle 档主件) | ☐ |
| 26 | Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(根) | 346 MB | 3 | Q2-1 道劫三件 t2i/i2i/edit 各 [7] 加速子图内 [7013] T8QwenImage21FunAccPDD4Step model_file 直载(10-08 起仅 i2i 速度选择器现选「0 · Fun-Acc 4步」档,t2i 本件默认已改「2 · viggle」[7013] 转待命支路;pose-edit [13] 卡文提及不计) | 09-26 装机落盘;10-03 补登(345,632,904 B;4步 PDD 蒸馏件——需配 T8 专用采样节点 4步/cfg1/无负面词,TE 须 Qwen3-VL 8B 系) | **keep**(Q2-1 道劫线 FunAcc4步加速件,面板 fileNote 同口径) | ☐ |

| 27 | dmad_minimax_h3_4step_full_critic_comfyui_bf16.safetensors(根) | 1.95 GB | 2 | 单镜视频[41] LoraLoaderModelOnly ×1.0(wv+named 双轨;10-04 换档落地) | 10-03 DMAD 战役(s6-win);10-04 补登(1,956,172,424 B,sha256 前缀 ab92f1c7,10-03 实算/10-04 复算一致;HF ZhengmingYu/DMAD full_critic 4step rank-128 经 apps/build/scripts/dmad_lora_convert_1003.py 转制融合 qkv/bf16) | **keep**(单镜视频线默认档——1003 A/B 对拍赢+1004 预授权采用;配方/对拍/回滚详见 docs/comfyui-kb/档案/DMAD-4步LoRA转制与单镜线换档-1003.md) | ☐ |
| 28 | qwen2.1-detail-fix-2.0.safetensors(根) | 55 MB | 2 | ①qi21-道劫-t2i [7026] LoraLoaderModelOnly ×1.0→[7010] 直出40步支路(官方域);②[7027] ×0.5→[7011] viggle 段A 实验臂(1009 用户令「也挂 viggle 看效果」,旁路即回纯官方链) | 10-08 入库(e-n-v-y Fix v2.0,rank8,ComfyUI 原生 key+gate_up 融合命名;对症底模 gpt-image 瑕疵/细节散乱/手;**官方工作流口径(10-09 查实):LoraLoaderModelOnly×1.0,20步 cfg3.5,采样器 res_2m_nc+调度 bong_tangent(引擎均缺,直出档保 euler/simple),真负向含手部词;viggle 叠加=未验证组合(蒸馏轨×20步标定),0.5 起步候扫参**;同族 Opinionated 版按裁定不装=会改构图) | **keep**(qi21 双挂:直出在役+viggle 实验) | ☐ |

**kill 候选小计 4 件(#12/#13/#19/#20,约 1.3 GB)——全部只是建议,勾选前零动作。**(10-10 注:四件已整体外置 /Volumes/郑冰津/AI/Krea2/,约 1.3 GB 指外置卷占用;勾选 kill 后的执行位=外置卷对应件,本地已无件可动——本轮零删除复核:_trash_0919 恒未建。)

## 二、断链与修复(本轮收口)

首扫 `BROKEN=13` 节点 → 修复后复扫 `BROKEN=1`。修复脚本 `apps/build/scripts/daojie_lora_refclose.py`(幂等,复跑零变化;零文件删除,全部动作=「摘除指向已删/不存在文件的旁路节点」与「改路径对齐实名」两类的实例;每文件过 workflow_graph_lint 门禁=改前遗留问题零新增):

| # | 断链(修复前) | 处置 | 落点 |
|---|---|---|---|
| 1 | 超集[68] 柔水彩(mode=0!文件已被用户令删除=运行时必炸) | 摘节点+splice 直连(旧线39→新线52)+卡文 4 行删+幽灵号「画风件[68/69/70]」→「[69]」 | 仓库超集 |
| 2 | 超集[70] 复古漫(旁路,件从未在盘) | 摘节点(旧线41→新线53) | 仓库超集 |
| 3 | 风格参照[68] 柔水彩(旁路) | 摘节点(旧线39→新线47)+卡文 2 行删 | 仓库风格参照 |
| 4 | 风格参照[70] 复古漫(旁路) | 摘节点(旧线41→新线48) | 仓库风格参照 |
| 5 | 角色设定[68] 柔水彩(旁路) | 摘节点(旧线4→新线42) | 仓库角色设定(清除令收尾三处之③) |
| 6 | 角色设定[70] 复古漫(旁路) | 摘节点(旧线6→新线43) | 仓库角色设定 |
| 7 | DCS 模板[164] → `krea/krea2_charactersheet_full_v1.safetensors` | 改路径对齐盘上实名 `DynamicCharacterSheet_krea2_v1.safetensors` | 仓库 DCS 模板 |
| 8 | 潜空间放大[41] named.lora_name → `Minimax_H3\…lightx2v…`(positional 已本地化为盘上 turbo 4step) | named 对齐 positional 实名 | 仓库 H3 社区模板 |
| 9-10 | home MY-K2_文生图_超集[68]/[70] | 同款摘除+卡文清理(清除令覆盖全部残引;改前备份 `/tmp/lora_refclose_home_backup_0919/`) | 引擎家用户区 |
| 11-12 | home MY-K2_文生图_道劫[68]/[70] | 同款摘除+卡文+幽灵号「(68/69/70/73/76/77/78)」→「(69/73/76/77/78)」 | 引擎家用户区 |
| 13 | **官方本地-R2V-480P-需解冻ref2va.json [145] → minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors** | **未修——唯一遗留断链**。该节点 mode=0(active,H3 ref2v 模板的提速主件),文件本机从未有;「下装」或「摘除/旁路」改变模板语义,须用户勾选 | 呈下方勾选区 |

> 道劫 t2i(K2-文生图-道劫.json)首扫/复扫均**零断链**([68] 已由 a245ce9 摘除、卡文已清);该文件为并行会话工作区,本轮全程未触碰(git 实测 0 改动)。
> 柔水彩(retroanime 同理)物理删除史:用户令 + a245ce9(盘删+道劫[68]摘+卡段删);本轮为该清除令的残引收尾,该件自此在库内零实体零引用。

## 三、存疑模型串(298 条,不计断链)

非 LoRA 加载节点里未命中 loras/ 实体的模型扩展名字符串,绝大多数为 VAE/TE/DiT/预览件(如 qwen_image_vae、krea2_turbo_bf16、minimax_h3_fl2va_pruned、taeh3、seedvr2、yue2、music3 系),属其它模型域,不由本台账判存。其中人工核出一条与 LoRA 相关,呈报:

- **社区-TTS-语音生成-480P.json 节点[18](H3 官方 pack `466b2449…`)槽位字符串 `H3\minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors`**——pack 内嵌 lora 槽指向本机不存在的 lightx2v turbo 件;pack 子图定义不在该 json 内(definitions 仅存标记串),离线无法安全改槽。若要启用该模板,须下装该件或引擎内改槽。☐ 处置(下装/引擎内改/不动)

## 四、用户勾选区(kill 执行与遗留断链处置)

| 项 | 内容 | 勾选 |
|---|---|---|
| kill-A | #19+#20 NSFW 零引用双件(654 MB,直接进 `_trash_0919/`)——**10-10 注:双件已外置 Krea2 卷,勾选后执行位=删外置卷件,本地无件** | ☐ |
| kill-B | #12 暗笔刷(448 MB,先摘 7 节点)——建议 R2 对拍后定;10-10 注:已外置 Krea2 卷,勾选后执行位=外置卷件 | ☐ |
| kill-C | #13 Masterpiece(205 MB,先摘 5 节点)——建议 R2 对拍后定;10-10 注:已外置 Krea2 卷,勾选后执行位=外置卷件 | ☐ |
| repair-R2V | H3 R2V 模板 [145] ref2va turbo:下装(约 394 MB 级)/摘除/不动 | ☐ |
| repair-TTS | 上节 TTS pack lightx2v 槽:下装/引擎内改/不动 | ☐ |
| repair-VIG64 | 社区-编辑生图整合-TE.json [661]/[663] LoraLoaderModelOnly×2 → `Qwen\Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors`(r64 变体本机从未有,10-03 补登轮全域实读新发现;该社区件 09-19 全量扫描后入库故未入 09-19 断链账):下装 r64/改槽对齐 r256/不动 | **✅ 不动**(2026-10-03 用户裁定;依据:产线锚官方荐档 r256@6步×1.0,r64=低秩 4 步变体非升级;4 步生态位已由 Fun-Acc PDD 占据;真跑该社区件时改槽指在位 r256+步数 4→6 即可;断链=留档预期态,同 BanZhang 红节点口径) |

> 勾选后执行走 PRD R5:两步制回收目录 `<home>/models/loras/_trash_0919/`,7 天后真删;执行轮再复扫本台账口径核零断链。

## 五、抽验(AC3,≥3 件引用计数独立复核)

- 暗笔刷:grep 全域 26 命中 − 卡文/标题文本命中 12 = 节点 widget 引用 14 = 扫描 14 ✅(7 文件×wv+named)
- 金雾:repo t2i`[87]`（wv+named）+home t2i`[87]`（wv+named）+daojie_loras.json 2 条 = 扫描 6 ✅
- outfit_transfer:换装[100] 仅 wv 无 named = 扫描 1 ✅(grep 3 命中含标题文本,正确排除)
- 门禁:my_nodes pytest `tests/` 59 passed;五件被修仓库文件 workflow_graph_lint 逐件过(改前遗留零新增;风格参照 HEAD 自带 2 项 AABB/LoadImage 遗留,非本轮引入)
