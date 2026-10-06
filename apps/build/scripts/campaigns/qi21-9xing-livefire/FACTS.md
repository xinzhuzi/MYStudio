# FACTS — qi21 道劫·九型实弹 预检底册

- 预检时间:2026-10-06 08:4x(本役=apps/build/scripts/campaigns/qi21-9xing-livefire/)
- 预检员纪律:共享真源只读(本轮零改工作流/真源/引擎家);以下每条均注明「实测命令」或「读取出处」;查不到的写明,未推测。
- 结论:**ok=true,problems 空**——工作流在档可解析、九型值齐、九型主体句全部有真源出处、驱动链路与引擎家底全部摸清。三条注记性勘正见 §6(不构成问题)。

---

## 1. 工作流解剖

**待测工作流**:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`

| 项 | 实测值 | 依据 |
|---|---|---|
| md5 | `65d4708ff1d9557caa8813e913b516b6` | `md5 <file>` |
| 大小/mtime | 115,614 B / **2026-10-06 00:35:30** | `stat -f "size=%z mtime=%Sm"` |
| 顶层节点数 | **20**(`nodes[]` 计数;另 `definitions.subgraphs` 2 个子图:[6] 文本提示词类型优化子图 9 节点 / [7] 道劫·加速子图 7 节点,合计 36 节点) | `python3 json.load` 逐节点打印 |
| 可解析 | 是(json.load 通过;顶层键含 id/revision/nodes/links/groups/definitions/config/extra/extensions/version/seed_widgets) | 同上 |

**宿主 [6] 面板**(顶层节点 6,type=`96937bbe-99d1-4f16-a06c-d86b57815d91`「[6] 文本提示词类型优化子图」)的输入槽:
- `正向主体句`(STRING,link 15,来自 [400])、`负向主体句`(STRING,link 218,来自 [404])
- **`型选择`(COMBO,widget 槽,无连线)**——宿主 `widgets_values = ["人物", true]` → **型选择当前默认 = `人物`**(原文照录)
- **`PE启用?`(BOOLEAN,widget 槽,无连线)**——**当前默认 = `true`**(原文照录)

**「型选择」槽全部可选值(十档=九型+自由)**。COMBO 值不在工作流 JSON 里,由节点代码现读真源供给:
- 供给链(代码依据 `apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_base.py`):`bases_list()` = 真源 `daojie_ink_guofeng/json/qi21_bases.json` `types[].zh` 按条目原序(`my_qi21_base.py:139-143`);默认钉死 `DEFAULT_BASE="人物"`(`my_qi21_base.py:69`)。
- 真源实读(`types` 共 10 条):**人物 / 场景 / 道具 / 美宣 / 多视图 / 高清人脸 / 分镜剧情图 / 表情差分 / 概念气氛图** = 九型;第 10 条 = **自由**(1001 P1 起十档;`zh:"自由"`、`positive_text:""`)。
- **现役引擎实测同序十值**:`curl -s http://127.0.0.1:17000/object_info/MyQi21DaojieBase` → combo=上述 10 值(引擎与真源一比一)。
- 注:任务书说「应为九型」——实况=九型+自由共十档,自由是用户可选手档非九型成员(README 称「九型+自由=10 条底座」),非问题。

**采样区当前默认档(原文照录,未改一字)**:
- 宿主 [7](type=`e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e`「道劫·加速子图」)`widgets_values = ["0 · Fun-Acc 4步", 0]` → **加速档默认 = `0 · Fun-Acc 4步`,seed 面板值 = 0**。
- 档位表真源 `my_nodes/nodes/my_qi21_speed_select.py:50-53` `SPEED_MODES = ("0 · Fun-Acc 4步","1 · 直出40步","2 · viggle")`,首项=默认(1002 用户令)。
- 三支路采样器 widgets 原文:
  - [7010] 直出40步·KSampler:`[0, "fixed", 40, 4, "euler", "simple", 1]` → **steps=40 / cfg=4** / euler / simple / denoise=1(即「cfg4」质量档)
  - [7012] viggle6步·KSampler:`[0, "fixed", 6, 1, "euler", "simple", 1]` → steps=6 / cfg=1
  - [7013] T8QwenImage21FunAccPDD4Step:`["Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors", 0, "randomize"]`
  - [7014] seed单源·PrimitiveInt:`[0, "fixed"]`;[7015] 出图速度选择:`["0 · Fun-Acc 4步"]`
- [7016] Note 原文全文:「**负向仅档1(直出40步 cfg4)生效;档0 FunAcc 无负槽;档2 viggle 蒸馏件 cfg恒1 负向无效**」——九型战役要验负面词必须打档1(cfg4)。

**PE 链现役件(重要)**:子图内 `[4013] = QwenImage21_T2IPromptRewrite`(官方 PE 改写器,[4019]=pe_t2i 模型)——1005 用户裁定换回官方设计(出处:`.trellis/tasks/10-04-chinese-negative-cfg4/implement.md:137`)。cfg4 旧驱动断言 `[4013]=MyQi21ChinesePE` 对现行工作流**已过时**,复用须改锚(见 §3.2)。

---

## 2. 九型对账(工作流型值 × 真源家 × 主体句出处)

**主体句真源出处(三层,全部实测在档)**:

1. **cfg4 战役九型实弹驱动脚本原句**:`/tmp/qi21-ninetype-1004/ninetype_driver.mjs:42-61`——`TYPES[]` 九条,每条含 `idx/name/transparent/subject`,文件头注「subject=docs/prompts/道劫_九型主体句示例.md §1-§9 原文逐字」;每型 seed=4100+idx(4101-4109);透明四型=道具/多视图/高清人脸/表情差分(与 qi21_bases.json rgba_default 对账注释在案)。
2. **运行记录原句**:`/tmp/qi21-ninetype-1004/report-run1-types1to4.json`(shots[].subject 逐型在档,1-4 型实拍记录);5-9 型排队实录 `/tmp/qi21-ninetype-1004/driver2.log`(1004 夜五发均「单发超时 60min」=cfg4 真实态 4/9 的证据;后续续跑账见 `.trellis/tasks/10-04-chinese-negative-cfg4/implement.md:18,45,186`)。
3. **上游文档(终极真源)**:`docs/prompts/道劫_九型主体句示例.md`(24,305 B,九节 `## 1. 人物 … ## 9. 概念气氛图` 与九型一一对应;驱动九句抽验全部在文档内,程序化比对 9/9 命中)。

| # | key(=型值原文) | name(中文名) | rgba_default | 测试主体句出处(原句首 24 字,全文见引) |
|---|---|---|---|---|
| 1 | `人物` | 人物 | false | `ninetype_driver.mjs:44`「一位筑基后期的年轻女修，青玉色道袍束月白…」(147 字;同句 `/tmp/i6-subject.txt` 在档) |
| 2 | `场景` | 场景 | false | `ninetype_driver.mjs:46`「暮春时节的黄昏，废弃的上古祭坛深藏…」(70 字) |
| 3 | `道具` | 道具 | true | `ninetype_driver.mjs:48`「一柄传承千年的青铜剑，剑身暗金底色上盘绕…」(尺寸标注版) |
| 4 | `美宣` | 美宣 | false | `ninetype_driver.mjs:50`「雷劫降临的至暗时刻，白衣剑修独立孤峰之巅…」 |
| 5 | `多视图` | 多视图 | true | `ninetype_driver.mjs:52`「青年刀修玄色劲装束袖束腰，长发高束马尾…」(**分张无持械版**,77 字,正面单视图;cfg4 口径「多视图 77 字=分张无持械版」implement.md:45) |
| 6 | `高清人脸` | 高清人脸 | true | `ninetype_driver.mjs:54`「一位筑基后期的年轻女修面容特写：眉目沉静…」 |
| 7 | `分镜剧情图` | 分镜剧情图 | false | `ninetype_driver.mjs:56`「山雨欲来的渡口，青年刀修玄色劲装束袖束腰…」 |
| 8 | `表情差分` | 表情差分 | true | `ninetype_driver.mjs:58`「青年刀修玄色劲装束袖束腰…九宫格表情差分…」(九格情绪全列) |
| 9 | `概念气氛图` | 概念气氛图 | false | `ninetype_driver.mjs:60`「千年一次的灵潮涨落之夜，悬浮的碎裂古殿群…」 |

- 「cfg4 战役」=Trellis 任务 `10-04-chinese-negative-cfg4`(中文负面×cfg4 档=档1 直出40步/cfg4,负向唯一生效档,见 [7016] Note);其九型实弹主体句即上表。
- 九型中文名=型值原文(真源 `types[].zh` 即中文;key 与 name 同文,九型内唯一)。

---

## 3. 驱动盘点(可复用实弹链路,逐步用法)

### 3.1 现役 App 级 E2E(最新一代,10-06 00:46 全绿)

`apps/build/scripts/daojie-t2i-app-e2e.mjs`(979 行;骨架=cdp-daojie-krea2-ink-e2e.mjs):
- 步骤段 S0 预检/选口 → S1 启动装机应用 → S2 道劫项目 → S3 本地模型画布(引擎幂等) → S4 关标签 → S5 侧栏开 qi21-道劫-t2i → **S6 真前端 queuePrompt 出图** → **S6b 装配全文进 PE 硬闸(真出图)** → S7 收摊。双拍全链 ≈50-65min(单拍采样 ≈23-30min)。
- 关键开关:`--skip-gen` 干跑 / `--skip-pe`;`CDP_PORT` 自选 9222-9239 空闲口(9222 常被并行探针占);`KEEP_APP=1` 保留应用。
- 产物:`apps/output/daojie-t2i-app-e2e/`(report.json + t2i-result.png + t2i-result-pe.png)。**实测最新 report.json(2026-10-06 00:46):S6 排队图 PE 三闸/S6 引擎完成/S6 出图/S6 /view 取证/S6b 硬闸/S7 收摊全部 ok=true**——即 db41519 提交句「实弹E2E全绿(含一次真实出图446s)」的落盘账。
- S6b 现役排队图断言域(db41519 D5 重锚后,复用时照此):**PE.prompt←PE开关口0 / 主体句源含头 18 字 / BASE←型底座+锁层A 逐字 739 字 三闸**;抓取走引擎 `/queue` 内容过滤(装配域 PE+本产线前缀),防应用侧异拍抢位。

### 3.2 战役级九型直排驱动(cfg4 用过,主体句+断言最全)

`/tmp/qi21-ninetype-1004/ninetype_driver.mjs`(405 行;ENGINE 默认 `http://127.0.0.1:17321`,`ENGINE_URL` 可覆写)。逐步链路:
1. **前置 gate**:`GET /system_stats` 引擎在;`GET /object_info/MyQi21DaojieBase` combo 含九型;PE 件在册(原文断言 MyQi21ChinesePE,**现行工作流已换官方件,此断言须改为 QwenImage21_T2IPromptRewrite**)。
2. **装载**:读仓库真源工作流 JSON → 动态插桩 [499] easy showAnything 接 [6] 负向出槽(links.push + nodes.push)→ Chrome(独立 profile,CDP 口)开引擎前端 → `window.app.loadGraphData(wfJson, true, true, name)` → 等 `isGraphReady` 与画布节点数。
3. **置值**:宿主子图 widget 用 `setViaHook(子图uuid, 槽名, 值)`(w.value=新值 + host.onWidgetChanged);普通节点用 `setNodeWidget(400,"value",主体句)`。面板槽名实测:`[6] 型选择/PE启用?`,`[7] 速度档位/seed`(asm/acc 面板 widgets 留档 report.notes)。
4. **排队图断言(投前 gate)**:`await window.app.graphToPrompt()` 干跑 → queueAsserts:型值/PE 布尔/PE 链形/双编码接线/宽高连线/速度档/seed/主体句逐字指纹。**⚠️ 过时锚(勿照抄)**:[4013]=MyQi21ChinesePE、`[4015].prompt←[6:4014,0]` 内联形态、`[4012].boolean` 槽名——现行链形以 §3.1 的 D5 三闸 + 现场排队图为准;速度档字符串以 SPEED_MODES 为准。
5. **投递**:`POST /prompt` body=`{prompt, client_id}`;拒答(node_errors 非空)即停。
6. **等待**:WS `ws://<engine>/ws?clientId=<id>`(executing node=null=完成/execution_error/进度;停滞>SHOT_TIMEOUT_MS 超时);或轮询 `/history/<pid>`。卡拍:`POST /interrupt`;拍间清场:`POST /free {unload_models:true,free_memory:true}`。
7. **取证**:`GET /history/<pid>` → outputs 文本(`ui.text`:401 正向/499 负向/6:4020 PE 思考)与图(outputs[8].images[0] 直出 / outputs[504] 2K);`GET /view?filename=&subfolder=&type=output` 下 PNG;透明型 alpha 门=引擎 venv `python3 -c "PIL Image …"` 查 RGBA+alpha0 占比(cfg4 判定线:出图+正向中文≥80%+型负面/锁层负面双命中;b3d8647 后 S9 已升机器门 RGBA+四角 alpha≤8)。
- cfg4 投递铁律(§24 教训,**继续适用**):**必须现场 graphToPrompt 转换投递,禁用历史 API 快照;投前在队列 prompt 对象上断言链形**——「核队列不核文件」(implement.md:18)。

### 3.3 三层提示词收据(三层全部实测在场)

1. **image-prompts 日志**:`<引擎家>/logs/image-prompts-YYYYMMDD.log`。行格式:`[MY出图][入队][时间] number=N prompt_id=<uuid>` / `[MY出图][摘要] 加载器|分辨率|保存前缀|LoRA|KSampler…` / `[MY出图][全量JSON] {API prompt 全量}`。实测 `logs/image-prompts-20261006.log` 尾条:2026-10-06 00:38:32 pid=`ebe48f94-…`(即 E2E 真出图拍;现有 0916/1004/1005/1006 四日卷)。
2. **PNG 元数据**:引擎直出 PNG tEXt 块 key=`prompt`=API 格式全量 JSON。实测 `output/MYStudio-2K_00026_.png` tEXt prompt 12,220 B。保存前缀两道:`QI21道劫文生图_`(直出 [8])与 `MYStudio-2K`(2K [504])。
3. **history prompt JSON**:`GET /history/<pid>` → `entry.prompt`(队列 API prompt)+ `entry.outputs`(文本与图清单)。实测 ebe48f94:status=success,outputs 键=[401,8,504,505]。

### 3.4 PE 终稿取件配方(pe_final_fetch 系)

`python3 apps/build/scripts/pe_final_fetch_1004.py [条数,默认3]`
- 原理:只读 `GET /history?max_entries=…`,抽 showAnything 类文本输出口([401] 预览/[4020] PE 思考)打印「最终进编码器提示词」全文(PE 开=英文终稿,PE 关=中文装配全文);零写盘零碰引擎。
- 端口:自动 `ps aux` 里 main.py 的 `--port`;取不到兜底 **17000**(与现行 manifest engine.port 一致,实测可用)。
- 出图后随时跑;引擎未应答时脚本自提示「先打开漫影出一图」。

### 3.5 其他可复用件

- `apps/build/scripts/campaigns/qi21_s6_harvest_0930.py`——事后收割范式:按拍签名(型 base+档位+seed 四元组)从 /history 补取 status/图/最终文本,适用驱动器半路崩后的补账。
- `apps/build/scripts/campaigns/daojie_nineform_recipe_livefire_0919.py` / `nineform_livefire_0922.py`——K2 侧九型直排旧役(引擎直排范式,seed=42 口径),本役 Q2.1 参考价值有限,列为在档。

---

## 4. 引擎家底

依据 `.agents/skills/comfyui/machine.md` + 全部实测(2026-10-06 08:4x):

### 4.1 家路径与软链门(搬家役在途实况)

- **门在「漫影工作室」层,不在 comfyui 层**:`stat -f '%HT'` 实测——`~/Library/Application Support/漫影工作室` = **Symbolic Link** → `/Users/zhengbingjin/Project/IP/漫影工作室`(readlink 原文);门下 `comfyui` 经门为普通 Directory,realpath 归一=`/Users/zhengbingjin/Project/IP/漫影工作室/comfyui`。
- ⚠️ machine.md:11-13 写「门=comfyui 路径本身」——与实测差一层,**以实测为准**;任何路径比较前先 `realpath` 归一(勿拿门路径与实体路径做字符串直比)。旧路径引用经门一律有效。
- `MYSTUDIO_COMFYUI_HOME`:本预检 shell **未设置**(`<unset>`);节点四层候选链以此 env 为最高层覆盖(`my_qi21_base.py:88`),不设时走 dev 真源家层——现役引擎实测读到的就是仓库真源家(object_info combo 与真源一比一)。

### 4.2 引擎家 git 基线

- `git -C /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI status --porcelain` → **0 行输出(空基线,符合「引擎家 git 恒 0 改动」)**;HEAD=detached(分支名 HEAD)。
- 口径注记:引擎家**根**目录(`…/comfyui`)本身不是 git 仓(`fatal: not a git repository`)——「引擎家 git」指 `<家>/ComfyUI` 源码仓,基线查这里。

### 4.3 启动配方与端口账本

- **现役引擎进程(在跑,实测 ps)**:pid 92224 = `<家>/venv/bin/python <家>/ComfyUI/main.py --listen 127.0.0.1 --port 17000 --enable-manager --gpu-only --reserve-vram 16 --use-pytorch-cross-attention --input-directory <家>/input --output-directory <家>/output`(实体路径直跑)。
- **manifest 账本**(`<家>/manifest.json` engine 块):`port: 17000`;`launchArgs: {vramPolicy: "gpu-only", reserveVramGb: 16, attentionMode: "pytorch-cross-attention"}`;`version: "v0.38.2---g3c169c2"`(sha 3c169c2…);torch 2.14.0。**端口现查法=`grep '"port"' <家>/manifest.json`(engine_manager 扫 17000-17999 首空闲写回;禁抄常量)**。
- 实测 LISTEN 账:**17000=引擎**(lsof + /system_stats 200,comfyui_version 0.38.0,python 3.12.7,device mps);17596=漫影 App 主进程;17595=`image_gen.main`(App 侧图生成服务);17923/17931=他会话 python 测试引擎(**勿占勿杀**);App 现带 `--remote-debugging-port=9223`(E2E 选 CDP 口时避开)。
- 机器:1×Apple M4 Max,统一内存 128GB,device `mps`(machine.md + system_stats 一致)。
- 无人值守手拉配方(machine.md 口径):**不存在已验证的 headless 手拉**;引擎由 MYStudio engine_manager 按需拉起,重启优先走 App。(cfg4 役曾用 `nohup venv/bin/python ComfyUI/main.py --listen 127.0.0.1 --port 17321 …` 全参手拉并 object_info 三查后使用,记录在 dwfrun-39fc3920;属战役特例,复用须同做三查。)
- 版本勘正:machine.md 写 v0.37.0 已旧——现役 API 自报 0.38.0 / manifest v0.38.2。
- manifest 遗留字段:`engine.modelsDir` 仍指已退役的 `/Users/zhengbingjin/Project/ComfyUI/models`(字段原样记录;现役模型加载实测正常——引擎在跑且 10-06 00:43 仍出新图,以实跑为准)。

### 4.4 「漫影工作室」App 进程

**在跑**:pid 92129 = `/Applications/漫影工作室.app/Contents/MacOS/漫影工作室 --remote-debugging-port=9223`(ps 原文;CDP 9223 开着,App 级 E2E 可直接 attach 或自选空口)。

### 4.5 引擎现役快照(供本役起手判读)

- 引擎 UP:127.0.0.1:17000 `/system_stats` 200。
- `object_info/MyQi21DaojieBase` combo 十值在册(§1);PE 权重=`text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors`(image-prompts 摘要实测在用);直出 DiT=`qwen_image_2.1_bf16.safetensors`,主 TE=`qwen3vl_8b_bf16_heretic.safetensors`,VAE=`qwen_image_2.1_vae_bf16.safetensors`;viggle LoRA 唯一件 v0.2.1-6step-r256。
- 引擎 output 最近产物:`QI21道劫文生图__00105_.png`(10-06 00:43)、`MYStudio-2K_00026_.png`(10-06 00:46)。

---

## 5. 本役目录树(已建)

```
apps/build/scripts/campaigns/qi21-9xing-livefire/
├── FACTS.md   ← 本册
├── images/    (实弹产物图落位)
├── runs/      (运行记录/report)
├── verify/    (判定/取证脚本产物)
└── logs/      (驱动与引擎日志副本)
```

## 6. 勘正与备注(非问题,不改 ok 判定)

1. **工作流 mtime 勘正**:任务书称 mtime 2026-10-05 21:53;实测 **2026-10-06 00:35:30**——文件在任务书快照后被 db41519(2026-10-06 01:05 提交)收编(工作流+子图+E2E+测试四件),该版即「实弹 E2E 全绿」版。预检以实测版为准(md5 65d4708f…),后续如需旧版对账用 git 历史回取。
2. **json/ 家件数**:任务书「预期六份 JSON」;实测 `daojie_ink_guofeng/json/` = **5 份 JSON** + README.md(qi21_bases / qi21_strip_lexicon / daojie_lora_stack / daojie_loras / prompt_layering),与该家 README.md 资产表(列 5 件)一致;色卡正典按家规住 `../ma_sync/palette-canon.json`(不在 json/)。九型对账只依赖 qi21_bases.json,不受影响。
3. **「型选择=九型」口径**:槽实值=九型+自由共十档(设计如此,1001 P1);九型=前九,自由=第十。本役打九型即可,自由不在九型清单。
