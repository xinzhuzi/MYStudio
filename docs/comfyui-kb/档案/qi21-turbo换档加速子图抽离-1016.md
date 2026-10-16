# 战役收据:qi21 turbo 换档·加速子图抽离单一真源(役号 1016turbo)

> 日期:2026-10-16。真源链:**工作流 JSON(手术脚本唯一写点)→ 蓝图件(脚本抽取)→ 装机/引擎家(数据级同步)**。
> 终审:换人终审 9 findings(2 medium+7 low)全数修复复跑过(1016turbo.r2)。

## 一、动机

道劫三件(t2i/i2i/edit)加速子图档0 长期为 Fun-Acc T8 臂(`T8QwenImage21FunAccPDD4Step`,外部 T8 插件 + 346MB 蒸馏 LoRA):

- **插件依赖**:未装 T8 插件的机器档0 节点红(依赖警示长期挂卡);T8 插件 license unknown(curated_plugins.json)。
- **edit 域结构性白图**:1002 R2 定谳 Fun-Acc PDD 系蒸馏头对 edit 指令式改图文本分布外崩溃(PE 关×FunAcc 三发全透白图;1003 翻案须 PE 开才绿)。
- **零真源**:三件内嵌加速子图定义各自独立 uuid 无共享、无蓝图件、无跨件一致性锚(提示词子图 1001 起有蓝图机制,加速子图缺位)。

官方侧:Qwen-Image-2.1-Turbo 官方发布(Comfy-Org 仓),官方点名的 LoRA 等价挂法=底模+`qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors`(913,314,512 B,sha256=`208dd43250e1e01467ba190572ae2e7107a7870ec1ff026bc65f791fa1e80e95`),8 步 cfg1 euler+σ表随检查点分发(model_index.json `sample_sigmas`)。节点面全为引擎核心件(ManualSigmas/SamplerCustomAdvanced/BasicGuider/KSamplerSelect/RandomNoise——引擎 v0.39.0 全在场,静态 file:line 逐一核验),零插件依赖。

## 二、FunAcc 退役与 turbo 换档

**换臂**(三件同构手术,`apps/build/scripts/qi21_accel_turbo_1016.py` 唯一写点):

- 移除 `[7013] T8QwenImage21FunAccPDD4Step` + 其全部 5 线(model/正源/latent/seed/出线;内容锚 target/origin==7013 恰 5 线断言)。
- 新增 turbo 臂(见 §五接线表):t2i/i2i=`[7028] LoraLoaderModelOnly(官方 avg_rank_178 ×1.0)→[7029] BasicGuider cfg1→[7030] ManualSigmas(官方σ串逐字)→[7031] SamplerCustomAdvanced`,噪声/采样器复用 viggle 臂 `[7017]/[7018]`;edit 另加专属 `[7032] RandomNoise/[7033] KSamplerSelect`(edit viggle 臂=KSampler 塌缩形无共享件)。
- 正源按形:t2i=positive(-10:1)/i2i·edit=positive_single(-10:3/-10:2)——0928「少步蒸馏须单参考」域保守沿用,实弹另证。
- `[7015] MyQi21SpeedSelect` 槽名 `latent_funacc`→`latent_turbo`(槽位/连线不动);edit 速度档位 widget 四面双写 `'0 · Fun-Acc 4步'`→`'0 · Turbo 8步'`(宿主 wv[0]/wvn/sg.widgets/内部 7015 wv)。
- seed 扇出:t2i/i2i=恰两线(7010.seed+7017.noise_seed,T8 线退役);edit=恰三线(7010/7012.seed+7032.noise_seed)。

**py 面**:`my_qi21_speed_select.py` SPEED_MODES 首项 `("0 · Turbo 8步","latent_turbo")`(承 1002 提首位,DEFAULT_MODE=MODES[0] 机制不动);`__init__.py` 显示名;`rgba_select.py` 注释。

**funacc 文件处置实况**:FunAcc LoRA(346MB,md5=`894c3b79b7eec3434450a118017965a5` 本役实算)+T8 插件 `Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8` **零删除零移动留盘=回滚杠杆**(台账 #26 退役收口);引擎家 py 改动须**重启引擎才生效**(归后续引擎管家,本役未动引擎进程)。

**存量面代价**(台账 #26 自救三层):①盘上/引擎家用户区件携旧档串重开时档位下拉重选即愈(报错自带合法档枚举);②localStorage 草稿层(Comfy.Workflow.Draft.v2 恢复优先级高于盘上文件+App 宿主 kept-modified 守卫不重载新图)——旧臂画布换臂后继续被还原,--sync-home 救不了此层,须画布内显式放弃草稿或档位重选;③仓库活件零复制旧档串(rg 清零口径成立)。

## 三、加速子图单一真源机制

三份蓝图 v0.4 单根形新立(决策①):

```
my_nodes/subgraphs/qi21-道劫-加速子图.json        (t2i)
my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json
my_nodes/subgraphs/qi21-道劫-加速子图-edit.json
```

- 由手术脚本从术后宿主**抽取生成**(不手写):根图恰一节点 id=1/type=定义 uuid(=宿主 sg uuid),definitions.subgraphs[0]=宿主 sg 定义 deepcopy+category=漫影,根节点 widget=宿主面板镜像。
- 同步通道:原钦定 `qi21_blueprint_sync_1001.py` 已于 10-10 删除(契约§九.3 缺口)——本役以 `qi21_accel_turbo_1016.py` 承担(默认模式=手术+蓝图抽取双写;--check=只读验锚+canonical-除-id 对比;幂等)。
- 一致性锚:契约测试新增 `TestAccelBlueprintAnchors1016`(三蓝图 canonical-除-id 全锚+根 widget 镜像,镜像 :3909 提示词蓝图先例);契约 :3928 陈旧 sync 指针已改指本役脚本。
- 分发链:electron-builder extraResources→装机 sync_my_nodes→引擎家 custom_nodes/my-nodes/subgraphs/→重启注册 /global_subgraphs(引擎侧行为本役未实跑,深拷贝铁律=拖入即独立副本)。

## 四、改动全表(20 文件=原 17+P3 清尾 3;.bak 系 17 件;r4 终审补登全)

| 域 | 文件 | 改动 |
|---|---|---|
| py | `my_nodes/nodes/my_qi21_speed_select.py` | 档串/槽键/文档随动 |
| py | `my_nodes/__init__.py` | 显示名→默认Turbo 8步 |
| py | `my_nodes/nodes/my_qi21_rgba_select.py` | :43 注释随动 |
| 测试 | `my_nodes/tests/test_my_qi21_speed_select.py` | 全文件清扫重写(单件 13 passed;「31 passed」=并跑同目录 test_my_qi21_rgba_select.py 18 之和——r4 终审口径注) |
| 工作流 | `qi21-道劫-t2i.json` / `qi21-道劫-i2i.json` / `qi21-edit.json` | 换臂手术+Note(双镜像)+组框+edit 四面+横排布局 |
| 蓝图 | `qi21-道劫-加速子图{,-i2i,-edit}.json` | 新立三件(抽取) |
| 测试 | `tests/test_qwen21_workflow_contract.py` | (a)-(i) 全块:turbo 常量/MODE_TURBO/token 组/want_targets/干跑互锁 v3 精确表/四处 T8_CLASS 禁面删不换/白名单 ManualSigmas 入册/锚 [7013]→[7028]/TestAccelBlueprintAnchors1016 |
| 脚本 | `apps/build/scripts/qi21_accel_turbo_1016.py` | 手术+抽取+--check+--sync-home(fail-closed/mtime 守卫/幂等) |
| fire | `qi21_t2i_workflow_fire.py` | --turbo 参数+Turbo 分支(删 Fun 死分支)+docstring+6:4032 字段名首发勘误(旧四件名→美术风格/负向词表两名,活体 object_info 三源对齐;r4 终审补记) |
| fire | `qi21_i2i_workflow_fire.py` | win 映射三处 fun→Turbo:7031+tchain/vig_only/--tier 枚举 |
| docs | `LoRA库存台账.md` | #26 退役收口(md5/自救三层)+#30 turbo 新行 |
| docs | `参数速查.md` | 道劫三件结构/默认档/F3 判词/viggle steps 分形 |
| docs | `05-道劫规范提示词库.md` | :50 活口径一句 |
| docs | `.agents/skills/comfyui/machine.md` | 两簇「默认=Fun-Acc 4步」现状句勘正(1016turbo 换臂/勘正括注;P3 清尾,r4 终审补登) |
| 脚本 | `apps/build/scripts/qwen21_bridge_template_build.py` | :9/:13 docstring FunAcc 陈旧 prose 勘正(桥零再生成+档位发车=fire 职责;P3 清尾,r4 终审补登) |
| docs | `docs/comfyui-kb/子图工作流工程契约.md` | §九.3 补「同步通道=手术脚本双刷纪律」勘正括注(qi21_blueprint_sync_1001 已删 6e693716;P3 清尾,r4 终审补登) |
| 同步 | 装机 Resources+引擎家 custom_nodes/my-nodes | --sync-home 15 件(预备份;**不含引擎家用户区**=placement_audit 会话恒零写入策略面) |
| 模型 | 引擎家 models/loras/qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors | 下装落位(§六) |

`.bak-1016turbo` 全表=**17 件**:speed_select/__init__/rgba_select/test_my_qi21_speed_select/test_my_qi21_rgba_select/test_qwen21_workflow_contract/三工作流/台账/速查/05库/fire 两件(以上 14)+machine.md/bridge 生成器/工程契约.md(P3 清尾 3,r4 终审补登)。(py speed_select 的 .bak=git HEAD 版直出,件本役前 git 干净;test_my_qi21_rgba_select 件本体零净改=.bak 同字节,回拷=noop。)

## 五、turbo 臂节点级接线

```
[7028] LoraLoaderModelOnly「Turbo·官方avg_rank_178」 wv=[qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors, 1.0]
  model ← 边界 -10:model 直连(t2i/i2i/edit link4400;底模唯一挂件,不与 viggle/Fix 同挂)
  out → [7029].model (link4403)
[7029] BasicGuider (cfg1 纯正向无负口;CFGGuider+空负数学等价)
  conditioning ← 边界正源按形(t2i=positive -10:1 / i2i·edit=positive_single -10:3/-10:2, link4401;0928 单参考域)
  out → [7031].guider (link4404)
[7030] ManualSigmas wv=["1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"]
  (=官方 model_index sample_sigmas 8 步+模板补终止0,9 元素)
  out → [7031].sigmas (link4407)
[7031] SamplerCustomAdvanced
  noise ← [7017]:0(t2i/i2i 复用 viggle 臂)/[7032]:0(edit) (link4405)
  sampler ← [7018]:0(t2i/i2i)/[7033]:0(edit) (link4406)
  latent_image ← 边界 -10:latent (link4402)
  out LATENT → [7015].latent_turbo (link4408) → -20 汇流
[7032] RandomNoise(edit 专属) noise_seed=widget 转输入 ← [7014] (link4409)
[7033] KSamplerSelect(edit 专属) wv=[euler]
```

布局横排右向零左向线:7028[1340,140]/7029[1650,140]/7031[1970,140]/7030[1650,260]+edit 7032[1000,140]/7033[1000,260];sg.state 与 root 计数器 bump 7033/4409。

## 六、门禁收据(基线 vs 术后,全部实跑)

| 门禁 | T0 基线(役前实跑) | 术后(终态实跑) |
|---|---|---|
| my_nodes 套件 | 3 failed(test_my_qi21_api_pe 三道=并行役 art_style_base 在途容红)+514 passed | **3 failed 同集**+514 passed——零新增红 |
| 契约三件合跑 | 11 failed+132 passed(并行役 i2i Note 短卡重写+qi21_bases 十型互锁在途容红) | **11 failed 逐名 diff 全同**(实跑 diff 空)+133 passed(+1=TestAccelBlueprintAnchors1016)——零新增红 |
| placement_audit | 9/10,唯一 FAIL=用户区 5 件(战前既存容红) | **9/10 同 FAIL**;真源计数 **89==89**(零变化:不新增删工作流文件,蓝图住 my_nodes/subgraphs 不入 workflows 树) |
| 手术脚本 --check | — | 三件术后锚+蓝图 canonical-除-id 全过;幂等复跑 noop;三工作流 [7013]/`0 · Fun-Acc 4步` 残文 rg=0 |
| turbo 选集 | — | `-k "turbo or speed or lazy or funacc or select"`=16 passed+1 failed(=基线红单内 i2i_select_fixed_sentences_verbatim) |
| 漫影工作流清单 | — | 零改动判定:计数零变化实证;清单内 Fun-Acc 提及均历史沿革叙述(旧 id [198][176]/359步时代入库账),非活口径,终审未列 finding |

修复轮(r2)增量:终审 9 findings 全修——t2i/i2i Note 现在时 [7013] 机制文/seed 三采句/旧档串引文清零(_verify_post 新增 `[7013]` 残文拦截面);契约 :3917/:4886 锚 [7013]→[7028];fire 两 docstring;台账 #26 三层自救;速查 viggle steps 分形;补刀后 --sync-home 重同步 15 件。

## 七、首发实弹收据

> 贴入(主 agent 落账令材料,2026-10-16;引擎管家产出,只取证不判图)。役内前史(下装经过)如实保留于下段。

本役实跑更正与补充:**turbo LoRA 已于役内下装落位**——疑件两采样(31s 间隔)证停滞(145,836,721 B/mtime 05:41:53 冻结/sha256=`091af2b0…`≠官方)后,后台 curl 下载官方件到临时名(exit 0,无 curl 92)→sha256==`208dd43250e1e01467ba190572ae2e7107a7870ec1ff026bc65f791fa1e80e95`+913,314,512 B 双验→原子 mv;落位终态 `stat`=913,314,512 B/10-16 07:00:03,落位后 shasum 复验一致。主役侧 curl 92 记录(役前时点)系另一尝试,与本役成功收据并存如实记。**落账时点更新:引擎经 App 重启后由引擎管家完成 turbo 档首发实弹,收据全文如下。**

---

# qi21-道劫-t2i · turbo 档首发实弹收据

**档位:「turbo 8步 LoRA 形·Mac bf16·首发实弹」**

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/道具-turbo1016首发.png` | fire 脚本 DONE 行,文件在场 1,346,843 B |
| 引擎侧产物名 | `QI21_t2i_wf_00005_.png` | fire stdout `DONE QI21_t2i_wf_00005_.png (80s)` |
| prompt_id | `850f0f8b-303a-4ef4-81a3-1a092b003467` | fire stdout `queued <pid>` |
| 宽×高 | **1024 × 1024**(8-bit,彩色型 6=RGBA,道具型 1:1 透明底设计) | PNG IHDR 直读 |
| 耗时 | **80 秒**(POST /prompt → 产物下载完毕;引擎本会话首个任务,含模型冷加载) | fire 脚本计时输出 |
| 本次种子 | **2035662262**(随机,未传 --seed,fire :106 random.randint(1,2**31-1)) | fire stdout `[fire] 型=道具 档=0 · Turbo 8步 seed=2035662262(随机)` |
| 发车命令 | `python3 apps/build/scripts/qi21_t2i_workflow_fire.py --type 道具 --turbo --out .../道具-turbo1016首发.png` | 本会话实跑,exit 0 |

## turbo 档执行图实证(自 PNG 元数据 prompt 块直读,即引擎实际执行图)

- `[7:7028] LoraLoaderModelOnly`:lora_name=`qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors`,strength_model=**1.0**,model←`[1,0]` 裸底模(不与 Fix 串联)✓
- `[7:7029] BasicGuider`:model←7:7028,conditioning←`[4015,0]` 正向(cfg1 纯正向,无 negative 口)✓
- `[7:7030] ManualSigmas`:σ=`1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0`(官方 model_index sample_sigmas 逐字+终止0,9 元=8 步)✓
- `[7:7031] SamplerCustomAdvanced`:noise←7:7017(seed=2035662262)、sampler←7:7018(euler)、sigmas←7:7030、latent←`[4,0]` 空潜 ✓
- `[5] VAEDecode.samples←[7:7031,0]`(turbo 臂直出)✓;图内**无** 7:7010 KSampler(直出40)与 viggle 件(7011/7020-7024)——单臂互斥成立 ✓
- 权重三件套:UNET=`qwen_image_2.1_bf16.safetensors`(Mac bf16 线)、TE=`qwen3vl_8b_bf16_heretic.safetensors`、VAE=`qwen_image_2.1_vae_bf16.safetensors`

## 装配链佐证

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/道具-turbo1016首发.装配文.txt`(fire 从 history [401] 双显示框取的终稿真值:主体句=青铜剑示例库§3首例;正向终稿含透明格式锁与全量画面语言;负向终稿 367 字风格负向)
- 主体句(入图):「一柄传承千年的青铜剑,剑身暗金底色上盘绕细密云雷纹,剑格铸成兽首衔环,剑柄缠深红丝绳,穗尾垂一枚带裂纹的灵玉。」

## PNG 元数据 prompt 块全文(逐字,34,383 字节,单行紧凑 JSON)

> sha256(该块)= `128b95efae8d3ae263f877d5b0699d0b83b1a2cf07e7286052c4f14dd4b23e16`
> 字节级副本:`apps/output/bgscope-r3-9types/道具-turbo1016首发.prompt元数据.json`(与 PNG 内嵌同源,供复核本内嵌文本逐字保真)

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u9053\u5177", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u9053\u5177:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd": ["400", 0], "\u8d1f\u5411\u63d0\u793a\u8bcd": ["404", 0], "\u7c7b\u578b\u53e5\u6b63\u5411": ["6:4010", 0], "\u7c7b\u578b\u53e5\u8d1f\u5411": ["6:4010", 3], "\u753b\u5e45\u5bbd": ["6:4010", 1], "\u753b\u5e45\u9ad8": ["6:4010", 2], "\u900f\u660e\u6a21\u5f0f": ["6:4010", 4], "\u7cfb\u7edf\u63d0\u793a\u8bcd": ["6:4030", 0], "\u8272\u5361": ["6:4031", 0], "\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7-\u6b63\u5411": ["6:4032", 0], "\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7-\u8d1f\u5411": ["6:4032", 1]}}, "6:4014": {"class_type": "MyQi21FinalOutput", "inputs": {"\u6b63\u5411\u63d0\u793a\u8bcd": ["6:4013", 0], "\u8d1f\u5411\u63d0\u793a\u8bcd": ["6:4013", 1], "\u900f\u660e\u6a21\u5f0f": ["6:4013", 2]}}, "6:4030": {"class_type": "MyQi21\u7cfb\u7edf\u63d0\u793a\u8bcd", "inputs": {"\u5185\u5bb9": "# \u56fe\u50cf\u63d0\u793a\u8bcd\u6269\u5199\u4e13\u5bb6\n\n\u4f60\u5c06\u7528\u6237\u7684\u56fe\u50cf\u9700\u6c42\u6269\u5199\u4e3a\u4e00\u6bb5\u5b8c\u6574\u7684\u4e2d\u6587\u753b\u9762\u63cf\u8ff0\u957f\u6587\u3002\n\u4f60\u4e0d\u662f\u5728\u8ddf\u7528\u6237\u5bf9\u8bdd\uff0c\u4e5f\u4e0d\u662f\u5728\u8ddf\u6e32\u67d3\u5668\u5bf9\u8bdd\u2014\u2014\u4f60\u662f\u4e00\u4e2a\u89c2\u5bdf\u8005\uff0c\u5728\u62a5\u544a\u753b\u9762\u91cc\u6709\u4ec0\u4e48\u3002\n\n## \u88c1\u51b3\u5e8f(\u6761\u6b3e\u51b2\u7a81\u65f6,\u6309\u6b64\u5e8f\u4ece\u9ad8\u5230\u4f4e\u88c1\u51b3,\u4e0d\u5f97\u5c31\u8fd1\u53d6\u6743)\n\n1. \u6838\u5fc3\u89c4\u5219\u7b2c4\u30015\u6761(\u8272\u8bcd\u9010\u5b57\u7981\u6362/\u90e8\u4ef6\u951a\u70b9\u96f6\u4e22\u5931)\u2014\u2014\u6c38\u4e0d\u8c41\u514d,\u540e\u6587\u4efb\u4f55\u7ae0\u8282(\u542b\u900f\u660e\u8c41\u514d)\u90fd\u4e0d\u5f97\u63a8\u7ffb;\n2. \u900f\u660e\u8c41\u514d(\u4ec5[\u900f\u660e]=\u5f00\u65f6\u751f\u6548)\u2014\u2014\u53ea\u5220\u73af\u5883\u5185\u5bb9,\u53ea\u8c41\u514d\u73af\u5883\u8bcd\u7684\u4fdd\u7559\u4e49\u52a1;\n3. \u8272\u5361\u9009\u9898\u2014\u2014\u53ea\u7ea6\u675f\"\u65b0\u589e\"\u7684\u8272\u5f69\u63cf\u8ff0,\u4e0d\u8986\u76d6\u539f\u6587\u5df2\u6709\u8272\u8bcd;\n4. \u516b\u6b65\u5de5\u4f5c\u6cd5/\u6da6\u70bc\u8865\u5145\u2014\u2014\u7ed3\u6784\u6307\u5357,\u670d\u4ece\u4ee5\u4e0a\u5404\u6761\u3002\n\n## \u6838\u5fc3\u89c4\u5219\n\n1. **\u8f93\u51fa\u8bed\u8a00**\uff1a\u63cf\u8ff0\u6b63\u6587\u5fc5\u987b\u4f7f\u7528\u4e0e\u7528\u6237\u8bf7\u6c42\u76f8\u540c\u7684\u8bed\u8a00\u3002\u7528\u6237\u7528\u4e2d\u6587\u5199\uff0c\u4f60\u5c31\u7528\u4e2d\u6587\u5199\u3002\n2. **\u56fa\u5b9a\u4e0e\u5f00\u653e**\uff1a\u7528\u6237\u56fa\u5b9a\u4e86\u7684\uff08\u7269\u4f53\u540d\u3001\u6570\u91cf\u3001\u989c\u8272\u3001\u4f4d\u7f6e\u3001\u5bbd\u9ad8\u6bd4\uff09\u5fc5\u987b\u539f\u6837\u4fdd\u7559\uff1b\u7528\u6237\u6ca1\u63d0\u7684\u7531\u4f60\u51b3\u5b9a\uff0c\u4f46\u8981\u5408\u4e4e\u753b\u9762\u903b\u8f91\u3002\uff08\u552f\u4e00\u4f8b\u5916:\u900f\u660e\u5f00\u65f6\u7684\u73af\u5883\u8bcd,\u89c1\u900f\u660e\u8c41\u514d\u3002\uff09\n3. **\u7981\u4ee4\u5904\u7406**\uff1a\u7528\u6237\u8f93\u5165\u4e2d\u7684\u7981\u6b62\u6761\u6b3e\uff08\u5982\"\u7981\u6b62\u5bc6\u96c6\u8936\u7f51\"\uff09\u662f\u4f60\u7684\u5de5\u4f5c\u7eaa\u5f8b\uff0c\u9ed8\u9ed8\u9075\u5b88\uff0c\u4e0d\u8981\u5728\u63cf\u8ff0\u4e2d\u590d\u8ff0\u3002\u900f\u660e\u5220\u9664\u540c\u7406:\u5220\u4e86\u5c31\u5220\u4e86,\u7ec8\u7a3f\u4e0d\u5199\u300c\u5df2\u79fb\u9664\u300d\u300c\u4ec5\u5199\u300d\u7b49\u6267\u884c\u8bf4\u660e,\u4e5f\u4e0d\u628a\u672c\u6307\u4ee4\u7684\u539f\u6587\u53e5\u5b50\u6284\u8fdb\u7ec8\u7a3f\u3002\n4. **\u8272\u8bcd\u9010\u5b57\u7981\u6362**\uff1a\u7528\u6237\u539f\u6587\u4e2d\u7684\u8272\u8bcd\uff08\u5982\u300c\u9752\u7389\u8272\u300d\u300c\u6708\u767d\u300d\u300c\u6697\u7ea2\u300d\uff09\u662f\u5b9e\u4f53\u951a\u70b9\uff0c\u7981\u6b62\u66ff\u6362\u4e3a\u8272\u5361\u6807\u51c6\u8bcd\u6216\u4efb\u4f55\u540c\u4e49\u8bcd\u2014\u2014\u8272\u5361\u9009\u9898\u53ea\u9002\u7528\u4e8e\u65b0\u589e\u7684\u989c\u8272\u63cf\u8ff0\uff0c\u4e0d\u8986\u76d6\u5df2\u6709\u539f\u6587\u3002\u539f\u6587\u5199\u300c\u9752\u7389\u8272\u9053\u888d\u300d\u5c31\u5fc5\u987b\u8f93\u51fa\u300c\u9752\u7389\u8272\u9053\u888d\u300d\u3002\n5. **\u90e8\u4ef6\u951a\u70b9\u96f6\u4e22\u5931**\uff1a\u539f\u6587\u63d0\u53ca\u7684\u6bcf\u4e2a\u90e8\u4ef6\u4e0e\u573a\u666f\u5143\u7d20\uff08\u5251\u9798/\u5251\u683c/\u5251\u7a57/\u8170\u5e26/\u53d1\u7c2a/\u5c71\u95e8/\u706f\u7b3c/\u533e\u989d\u7b49\uff09\u5fc5\u987b\u5728\u7ec8\u7a3f\u4e2d\u51fa\u73b0\uff0c\u4e00\u4e2a\u4e0d\u6f0f\u2014\u2014\u900f\u660e\u5f00\u65f6\u90e8\u4ef6\u7167\u5e38\u5728\u573a,\u573a\u666f\u5143\u7d20\u82e5\u5c5e\u73af\u5883\u5b9a\u4f4d\u5219\u6309\u900f\u660e\u8c41\u514d\u5220\u9664\u3002\n6. **\u4e3b\u8272\u4f18\u5148**\uff1a\u4e3b\u4f53\u53e5\u660e\u6587\u670d\u88c5/\u5668\u7269\u4e3b\u8272\uff08\u5982\u300c\u7384\u8272\u52b2\u88c5\u300d\u300c\u9752\u7389\u8272\u9053\u888d\u300d\u300c\u6731\u7ea2\u6218\u888d\u300d\uff09=\u7ec8\u7a3f\u7b2c\u4e00\u4e3b\u8272\uff1a\u63cf\u8ff0\u670d\u88c5/\u5668\u7269\u5fc5\u987b\u4ee5\u8be5\u8272\u4e3a\u4e3b\u5bfc\u8272\u8c03\uff08\u53ef\u660e\u6697\u5206\u5c42\u3001\u53ef\u7eb9\u6837\u7ec6\u8282\uff09\uff0c\u5927\u9762\u79ef\u57fa\u5e95(\u4ec5\u5173\u6a21\u5f0f)\u3001\u7f69\u67d3\u3001\u73af\u5883\u8bed\u8a00\u4e0d\u5f97\u6de1\u5316\u6216\u66ff\u4ee3\uff1b\u8272\u5f69\u51b2\u7a81\u6309\u88c1\u51b3\u5e8f\uff0c\u4e3b\u8272\u6700\u5148\u843d\u5b9e\u3002\n7. **\u80af\u5b9a\u5f0f\u89c6\u89c9\u8bed\u8a00**\uff1a\u7ec8\u7a3f\u6b63\u6587\u53ea\u9648\u8ff0\u300c\u753b\u9762\u91cc\u6709\u4ec0\u4e48\u300d\u2014\u2014\u7981\u5426\u5b9a\u5f0f\u5224\u8bcd\uff08\u300c\u65e0X\u300d\u300c\u4e0d\u7559X\u300d\u300c\u4e0d\u7834\u574fX\u300d\u300c\u4e0d\u751f\u786c\u300d\u7c7b\uff09\u4e0e\u8bc4\u8bed\uff08\u300c\u81ea\u7136\u300d\u300c\u548c\u8c10\u300d\u300c\u5f97\u5f53\u300d\u300c\u6070\u5230\u597d\u5904\u300d\u7c7b\u8bc4\u4ef7\u8bcd\uff09\uff1b\u5fc5\u8981\u9650\u5236\u6539\u5199\u4e3a\u660e\u786e\u7684\u6570\u91cf\u3001\u72b6\u6001\u548c\u4fdd\u7559\u8981\u6c42\uff1b\u7f3a\u5931\u80a2\u4f53\u7b49\u4e8b\u5b9e\u987b\u6e05\u695a\u5199\u660e\u3002\u8d1f\u5411\u8bcd\u8868\u4e0d\u4f5c\u4e3a viggle \u6863\u5df2\u751f\u6548\u7684\u7ea6\u675f\u3002\n\n## \u516b\u6b65\u5de5\u4f5c\u6cd5\n\n### \u7b2c\u4e00\u6b65\uff1a\u5206\u6790\u9700\u6c42\n\u5217\u51fa\u7528\u6237\u56fa\u5b9a\u4e86\u4ec0\u4e48\u3001\u4ec0\u4e48\u662f\u5f00\u653e\u7684\u3002\n\n### \u7b2c\u4e8c\u6b65\uff1a\u786e\u5b9a\u753b\u5e45\n\u4e0a\u4e0b\u6587\u7ed9\u4e86[\u753b\u5e45]\u5bbd\u00d7\u9ad8\u5c31\u76f4\u63a5\u91c7\u7528\uff0c\u753b\u9762\u63cf\u8ff0\u6309\u6b64\u7eb5\u6a2a\u6bd4\u7ec4\u7ec7\uff0c\u4e0d\u8981\u81ea\u884c\u6539\u9009\uff1b\u6ca1\u7ed9[\u753b\u5e45]\u624d\u6839\u636e\u5185\u5bb9\u5b9a\u753b\u5e45\u65b9\u5411\uff1a\u6a2a\u6784\u56fe\u9ed8\u8ba4 16:9\uff0c\u7ad6\u6784\u56fe\u9ed8\u8ba4 2:3\uff0c\u6b63\u65b9\u5f62\u9ed8\u8ba4 1:1\u3002\n\n### \u7b2c\u4e09\u6b65\uff1a\u5199\u5f00\u5934\u53e5\n\u5f00\u5934\u53e5\u5fc5\u987b\u7acb\u523b\u4f20\u8fbe\uff1a\u753b\u5e45\u65b9\u5411\u3001\u5a92\u4ecb\u3001\u98ce\u683c\u3001\u4e3b\u4f53\u3001\u80cc\u666f\u57fa\u8c03\uff08\u900f\u660e\u5f00\u65f6\u4e0d\u5199\u300c\u80cc\u666f\u57fa\u8c03\u300d\u56db\u5b57,\u76f4\u63a5\u5199\u300c\u900f\u660e\u5e95\u7d20\u6750\u300d\uff09\u3002\n\n### \u7b2c\u56db\u6b65\uff1a\u6e05\u70b9\u753b\u9762\u5143\u7d20\n\u5929\u7a7a\u3001\u5149\u7ebf\u3001\u8fdc\u666f\u3001\u4e2d\u666f\u3001\u8fd1\u666f\u3001\u4e3b\u4f53\u3001\u914d\u9970\u3001\u9053\u5177\u2014\u2014\u9010\u9879\u6e05\u70b9\uff0c\u786e\u4fdd\u65e0\u9057\u6f0f\u3001\u65e0\u591a\u4f59\u3002\uff08\u900f\u660e\u5f00\u65f6\u6309\u900f\u660e\u8c41\u514d\u88c1\u526a,\u53ea\u6e05\u70b9\u4e3b\u4f53/\u914d\u9970/\u9053\u5177\u3002\uff09\n\n### \u7b2c\u4e94\u6b65\uff1a\u4ece\u4e3b\u4f53\u51fa\u53d1\u63cf\u8ff0\n\u4ece\u5934\u90e8\u5230\u811a\u90e8\uff08\u6216\u4ece\u6574\u4f53\u5230\u5c40\u90e8\uff09\u9010\u5c42\u63cf\u8ff0\uff1a\u53d1\u578b/\u9762\u90e8\u8868\u60c5/\u670d\u88c5\u8d28\u611f/\u914d\u9970/\u624b\u90e8/\u59ff\u6001\u3002\n\u624b\u90e8\u63cf\u8ff0\u670d\u4ece\u6765\u6e90\u4e8b\u5b9e\uff1a\u5728\u573a\u624b\u90e8\u4e0e\u6240\u6301\u7269\u54c1\u8854\u63a5\u6e05\u695a\uff1b\u7f3a\u5931\u7684\u624b\u81c2\u6216\u624b\u638c\u4fdd\u6301\u7f3a\u5931\u3002\n\n### \u7b2c\u516d\u6b65\uff1a\u5149\u7ebf\u4e0e\u6c1b\u56f4\n\u5149\u6e90\u65b9\u5411\u3001\u5f3a\u5ea6\u3001\u8272\u6e29\uff1b\u5927\u6c14\u900f\u89c6\uff1b\u6574\u4f53\u60c5\u7eea\u57fa\u8c03\u3002\uff08\u900f\u660e\u5f00\u65f6\u6309\u900f\u660e\u8c41\u514d\u88c1\u526a,\u53ea\u5199\u843d\u5728\u4e3b\u4f53\u8eab\u4e0a\u7684\u5149\u3002\uff09\u7167\u660e\u6309\u7528\u9014\u548c\u6765\u6e90\u4e8b\u5b9e\uff1a\u591a\u89c6\u56fe\u3001\u8138\u90e8\u4e0e\u8868\u60c5\u8bbe\u5b9a\u56fe\u91c7\u7528\u4fbf\u4e8e\u8fa8\u8ba4\u7684\u5747\u5300\u6f2b\u5c04\u5149\uff1b\u5267\u60c5\u56fe\u6309\u5b9e\u9645\u65f6\u6bb5\u3001\u5149\u6e90\u65b9\u5411\u4e0e\u660e\u6697\u5173\u7cfb\u7ec4\u7ec7\u7167\u660e\uff0c\u591c\u666f\u4fdd\u7559\u591c\u8272\u3001\u706f\u706b\u4e0e\u53d7\u5149\u5c42\u6b21\u3002\u7ebf\u63cf\u4e0e\u7f69\u67d3\u4fdd\u6301\u7edf\u4e00\u753b\u6cd5\u3002\n\u900f\u660e\u5173\u5199\u73af\u5883\u4e0e\u80cc\u666f\u65f6\u7b14\u58a8\u653e\u4f4e\u9891\uff1a\u7a7a\u95f4\u4e0e\u6c14\u6c1b\u4ea4\u7ed9\u8fde\u7eed\u5e73\u6ed1\u7684\u5927\u8272\u9762\u4e0e\u6982\u62ec\u5f62\u4f53\uff0c\u8fdc\u666f\u6309\u5b9e\u9645\u573a\u666f\u6982\u62ec\u8f6e\u5ed3\u3001\u526a\u5f71\u4e0e\u5927\u6c14\u900f\u89c6\uff1b\u5de5\u7b14\u3001\u7ebf\u63cf\u3001\u7f69\u67d3\u96c6\u4e2d\u4e8e\u7126\u70b9\u4e3b\u4f53\u4e0e\u5173\u952e\u90e8\u4ef6\uff1b\u5149\u7684\u843d\u70b9\u670d\u4ece\u4e3b\u4f53\u53ca\u753b\u9762\u89c6\u89c9\u91cd\u5fc3\u3002\n\n### \u7b2c\u4e03\u6b65\uff1a\u6536\u675f\u6574\u4f53\n\u4e00\u6bb5\u603b\u7ed3\u6027\u7684\u6784\u56fe\u63cf\u8ff0\uff1a\u89c6\u89c9\u91cd\u5fc3\u3001\u5f15\u5bfc\u7ebf\u3001\u7559\u767d\u3001\u8282\u594f\u3002\uff08\u900f\u660e\u5f00\u65f6\u6309\u900f\u660e\u8c41\u514d\u88c1\u526a,\u53ea\u603b\u7ed3\u4e3b\u4f53\u59ff\u6001\u4e0e\u5b8c\u6574\u6027\u3002\uff09\n\n### \u7b2c\u516b\u6b65\uff1a\u8f93\u51fa\n\u63cf\u8ff0\u5fc5\u987b\u662f\u4e00\u6bb5\u8fde\u8d2f\u7684\u4e2d\u6587\u957f\u6587\uff0c\u50cf\u4e00\u4e2a\u89c2\u5bdf\u8005\u5728\u63cf\u8ff0\u4ed6\u770b\u5230\u7684\u5b8c\u6210\u753b\u9762\uff1b\u7bc7\u5e45\u968f\u4fe1\u606f\u590d\u6742\u5ea6\u51b3\u5b9a\uff0c\u5355\u4e00\u5668\u7269\u53ef\u77ed\uff0c\u591a\u89c6\u56fe\u548c\u590d\u6742\u573a\u666f\u6309\u9700\u5c55\u5f00\uff1b\u4e0d\u8bbe\u6700\u4f4e\u5b57\u6570\uff0c\u4e0d\u4e3a\u51d1\u5b57\u6570\u589e\u6dfb\u7269\u4ef6\u3002\n\n## \u8f93\u51fa\u683c\u5f0f\n\n\u8fd4\u56de\u4e00\u4e2a\u4e25\u683c\u6709\u6548\u7684 JSON \u5bf9\u8c61\uff0c\u5355\u884c\uff0c\u524d\u540e\u65e0\u5176\u4ed6\u5185\u5bb9\uff1a\n\n{\"rewritten_prompt\": \"<\u4e2d\u6587\u63cf\u8ff0\u957f\u6587>\"}\n\n## \u8272\u5361\u9009\u9898(\u5fc5\u505a)\n\n\u4f60\u5728\u5199\u7ec8\u7a3f\u524d,\u5fc5\u987b\u4ece\u4e0a\u4e0b\u6587\u3010\u9879\u76ee\u8272\u5361\u9009\u9879\u6e05\u5355\u3011\u7ed9\u51fa\u7684\u8272\u5e93(\u542b\u2605\u5728\u7528\u8bcd)\u4e2d**\u4e3b\u52a8\u9009\u51fa** 2-5 \u4e2a\u8272,**\u65b0\u589e\u7684\u8272\u5f69\u63cf\u8ff0**\u7528\u4e14\u4ec5\u7528\u9009\u4e2d\u7684\u8272\u8bcd\u6765\u5199\u3002\n\n**\u8fb9\u754c**:\u672c\u8282\u53ea\u7ba1\"\u65b0\u589e\"\u7684\u8272\u5f69\u63cf\u8ff0\u3002\u539f\u6587\u5df2\u6709\u8272\u8bcd(\u9752\u7389\u8272/\u6708\u767d/\u6697\u7ea2\u7b49)\u6309\u6838\u5fc3\u89c4\u52194\u9010\u5b57\u4fdd\u7559\u2014\u2014\u4e0d\u66ff\u6362\u3001\u4e0d\u8bd1\u6210\u8272\u5361\u8bcd\u3001\u4e5f\u4e0d\u5fc5\u51fa\u73b0\u5728\u9009\u4e2d\u5217\u8868\u4e2d\u3002\n**\u9009\u6cd5**(\u51712-5\u5e2d):\u80cc\u666f\u886c\u5e95 1 \u5e2d(\u4ec5\u5173\u6a21\u5f0f;\u900f\u660e\u5f00\u65f6\u65e0\u80cc\u666f,\u6b64\u5e2d\u8ba9\u7ed9\u4e3b\u4f53\u8272,\u4e3b\u4f53\u8272\u6700\u591a\u53ef\u9009\u81f3 4 \u5e2d) | \u4e3b\u4f53\u8272 1-3 \u5e2d | \u70b9\u775b 0-1 \u5e2d(\u4ec5\u6765\u6e90\u4e8b\u5b9e\u5b58\u5728\u65f6)\n**\u7eaa\u5f8b**:\u8272\u8bcd\u5fc5\u987b\u843d\u5230\u5b9e\u7269\u8f7d\u4f53(\u90e8\u4ef6/\u6750\u8d28/\u5e03\u9762);\u5149\u7167\u53ef\u4ee5\u5199\u65b9\u5411/\u5f3a\u5ea6/\u8272\u6e29,\u4f46**\u4e0d\u7ed9\u5149\u6548\u8d4b\u8272\u5361\u8bcd**(\u8272\u5361\u8bcd\u53ea\u843d\u5b9e\u7269);\u7981\u88f8\u8272\u8bcd(\u8272+\u6750\u8d28\u7ec4\u5408)\n**\u4f18\u5148**:\u2605\u5728\u7528\u8bcd\u4f18\u5148\u4e8e\u5907\u9009;\u51b2\u7a81\u88c1\u51b3\u5e8f(\u9ad8>\u4f4e):\u660e\u6587\u8bbe\u5b9a\u8272(Source facts/\u89d2\u8272\u6863\u6848) > \u6750\u8d28\u672c\u8272(\u9ed1\u9ca8\u76ae/\u9ec4\u94dc\u7b49) > \u73af\u5883\u4e0e\u65f6\u6bb5\u4e8b\u5b9e > \u591a\u5f69\u884c\u9884\u7b97(\u672c\u578bcolor_recipe) > \u70b9\u7f00\u5efa\u8bae(\u6700\u5148\u5220)\n\n## \u900f\u660e\u6a21\u5f0f\n\n\u4e0a\u4e0b\u6587\u4e2d\u4f1a\u6807\u6ce8\u300c[\u900f\u660e] \u5f00\u300d\u6216\u300c[\u900f\u660e] \u5173\u300d:\n\n- **\u5f00=\u900f\u660e\u7d20\u6750\u56fe**:\u7981\u865a\u6784\u4efb\u4f55\u7e41\u6742\u80cc\u666f\u73af\u5883/\u8fdc\u666f\u53d9\u4e8b/\u5927\u6c14\u6548\u679c,\u4ea6\u7981\u94fa\u8bbe\u4efb\u4f55\u5355\u8272\u886c\u5e95(\u80cc\u666f\u5c06\u88ab\u5b8c\u5168\u900f\u660e\u5316);\n  \u6309\u7c7b\u578b\u4e0e\u4e3b\u4f53\u53e5\u6307\u5b9a\u7684\u53d6\u666f\u8303\u56f4\u6784\u56fe\uff0c\u8303\u56f4\u5185\u7684\u4e3b\u4f53\u4e0e\u90e8\u4ef6\u5b8c\u6574\u3001\u8fb9\u7f18\u6e05\u6670\uff1b\u7279\u5199\u4fdd\u6301\u5bf9\u5e94\u7c7b\u578b\u6307\u5b9a\u7684\u8138\u90e8\u6216\u5934\u80a9\u53d6\u666f\u3002\u5149\u7167\u53ea\u4ea4\u4ee3\u4e3b\u4f53\u53d7\u5230\u7684\u6548\u679c\u3002\n- **\u5173=\u5e38\u89c4\u6210\u56fe**:\u6b63\u5e38\u63cf\u8ff0\u73af\u5883\u3001\u80cc\u666f\u3001\u6c1b\u56f4\u3001\u5149\u7167\u2014\u2014\u539f\u6587\u73af\u5883\u5143\u7d20(\u4e91\u6d77/\u5c71\u95e8\u77f3\u9636\u7b49)\u7167\u5e38\u4fdd\u7559\u4e0d\u5220,\u4e0d\u4f7f\u7528\u300c\u900f\u660e\u5e95\u7d20\u6750\u300d\u7b49\u900f\u660e\u63aa\u8f9e\u3002\n\n### \u900f\u660e\u5f00\u65f6\u7684\u6b65\u9aa4\u8c41\u514d\n\n**\u6388\u6743\u8303\u56f4(\u7a84)**:\u672c\u8282\u53ea\u5220\u73af\u5883\u5185\u5bb9\u2014\u2014\u552f\u4e00\u88ab\u8c41\u514d\u7684\u662f\u73af\u5883\u8bcd\u7684\"\u539f\u6587\u4fdd\u7559\u8d44\u683c\"\u3002\u6838\u5fc3\u89c4\u52194/5\u4e0d\u5728\u8c41\u514d\u4e4b\u5217:\u90e8\u4ef6\u951a\u70b9\u4ecd\u7136\u96f6\u4e22\u5931\u3001\u539f\u6587\u8272\u8bcd\u4ecd\u7136\u9010\u5b57\u4fdd\u7559\u3002\u5220\u7684\u53ea\u662f\u73af\u5883,\u4e0d\u662f\u4e3b\u4f53\u3002\n\n- **\u539f\u6587\u73af\u5883\u8bcd\u5220\u9664**:\u539f\u6587\u4e2d\u7684\u73af\u5883\u63cf\u8ff0\u8bcd(\u5c71\u95e8\u77f3\u9636/\u4e91\u6d77/\u8fdc\u666f/\u5929\u7a7a/\u8fdc\u5904/\u80cc\u666f\u7b49)\u4e00\u5f8b\u4ece\u7ec8\u7a3f\u5220\u9664,\u5373\u4f7f\u5b83\u5728\u539f\u6587\u4e2d\u51fa\u73b0\u3002\u4e3b\u4f53\u52a8\u4f5c(\u5982\u300c\u53f3\u624b\u6309\u5251\u67c4\u300d)\u4e0e\u5149\u7167\u65b9\u5411(\u5982\u300c\u5de6\u4fa7\u659c\u7167\u300d)\u4fdd\u7559\u3002\n- **\u98ce\u683c\u5e95\u5ea7\u7684\u80cc\u666f\u53e5\u8df3\u8fc7**:\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7\u4e2d\u63cf\u5199\u80cc\u666f/\u8fdc\u666f\u7684\u53e5\u5b50(\u5982\u300c\u80cc\u666f\u662f\u2026\u5c71\u6c34\u57fa\u5e95\u300d\u300c\u8fdc\u666f\u4ee5\u591a\u5f69\u6655\u67d3\u300d)\u900f\u660e\u5f00\u65f6\u4e0d\u5e76\u5165\u7ec8\u7a3f,\u53ea\u53d6\u5176\u753b\u6cd5/\u7ebf\u6761/\u5de5\u827a\u53e5\u3002\n- **\u90e8\u4ef6\u4fdd\u5168**:\u5220\u73af\u5883\u2260\u5220\u90e8\u4ef6\u3002\u90e8\u4ef6\u4e0e\u73af\u5883\u540c\u53e5\u65f6(\u5982\u300c\u7acb\u4e8e\u5c71\u95e8\u77f3\u9636\u524d,\u7cfb\u6708\u767d\u8170\u5e26\u300d),\u5220\u73af\u5883\u3001\u7559\u90e8\u4ef6(\u300c\u7cfb\u6708\u767d\u8170\u5e26\u300d)\u3002\u6bcf\u4e2a\u90e8\u4ef6\u951a\u70b9\u7167\u5e38\u9010\u4e00\u5728\u573a,\u4e00\u4e2a\u4e0d\u6f0f\u3002\n- **\u7b2c\u4e09\u6b65**:\u5f00\u5934\u53e5\u4ee5\u300c\u900f\u660e\u5e95\u7d20\u6750\u300d\u66ff\u4ee3\u80cc\u666f\u57fa\u8c03\u3002\n- **\u7b2c\u56db\u6b65**\u53ea\u6e05\u70b9\u4e3b\u4f53+\u914d\u9970+\u9053\u5177(\u4e0d\u6e05\u70b9\u5929\u7a7a/\u8fdc\u666f/\u4e2d\u666f/\u73af\u5883\u5143\u7d20)\u3002\n- **\u7b2c\u516d\u6b65**\u53ea\u5199\u843d\u5728\u4e3b\u4f53\u8eab\u4e0a\u7684\u5149(\u4e0d\u5199\u5927\u6c14\u900f\u89c6/\u73af\u5883\u5149/\u80cc\u666f\u5149)\u3002\n- **\u7b2c\u4e03\u6b65**\u53ea\u603b\u7ed3\u4e3b\u4f53\u59ff\u6001\u4e0e\u753b\u9762\u5b8c\u6574\u6027(\u4e0d\u5199\u7559\u767d/\u5f15\u5bfc\u7ebf/\u80cc\u666f\u8282\u594f)\u3002\n- **\u7b2c\u516b\u6b65**:\u900f\u660e\u4e3b\u4f53\u65e0\u9700\u8865\u80cc\u666f\u6216\u51d1\u5b57\u6570\uff0c\u51c6\u786e\u5b8c\u6574\u5373\u53ef\u3002\n- **\u7528\u8bcd**:\u7ec8\u7a3f\u4e0d\u51fa\u73b0\u300c\u80cc\u666f\u300d\u300c\u4ec5\u5199\u300d\u300c\u5df2\u79fb\u9664\u300d\u300c\u900f\u660e\u6a21\u5f0f\u300d\u7b49\u6307\u4ee4\u8bcd\u6c47\u2014\u2014\u5b83\u4eec\u662f\u7ed9\u4f60\u770b\u7684\u89c4\u5219\u7528\u8bed,\u4e0d\u662f\u753b\u9762\u8bed\u8a00\u3002\n\n## \u5168\u6587\u6da6\u70bc\u8865\u5145\n\n- \u8f93\u5165\u662f**\u4e09\u5c42\u6b63\u7a3f**(\u4e3b\u4f53\u53e5+\u578b\u5e95\u5ea7+\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7)\u65f6=**\u6da6\u70bc\u6a21\u5f0f**:\u7ed3\u6784\u7167\u65e7,\u8eab\u4efd\u6bb5/\u90e8\u4ef6\u6e05\u5355/\u6750\u8d28\u8272\u53f7/\u8272\u951a/\u753b\u6cd5\u5173\u952e\u53e5\u9010\u5b57\u8bed\u4e49\u4e0d\u4e22,\u53ea\u505a\u6da6\u8272\u8854\u63a5\u3001\u589e\u5f69\u8865\u7ec6\u8282\u3001\u53bb\u5197\u4f59\u91cd\u590d\u3002\u6b64\u65f6\u516b\u6b65\u5de5\u4f5c\u6cd5\u4ec5\u4f5c\u67e5\u6f0f\u53c2\u8003,\u4e0d\u4f5c\u91cd\u5199\u6a21\u677f\u2014\u2014\u4e0d\u5f97\u81ea\u884c\u5206\u8282\u3001\u4e0d\u5f97\u52a0\u300c\u4e3b\u4f53\u63cf\u8ff0:\u300d\u4e4b\u7c7b\u7684\u6807\u9898\u3001\u4e0d\u5f97\u91cd\u7ec4\u6bb5\u843d\u3002\n\n## \u6765\u6e90\u4e8b\u5b9e\u4e0e\u683c\u5f0f\u8fb9\u754c\n\u6765\u6e90\u4e8b\u5b9e\u4f18\u5148\u4e8e\u901a\u7528\u753b\u6cd5\u548c\u7c7b\u578b\u9ed8\u8ba4\uff1a\u5e74\u9f84\u3001\u80a2\u4f53\u6570\u91cf\u3001\u78e8\u635f\u3001\u6c61\u6e0d\u3001\u8840\u8ff9\u3001\u591c\u666f\u4e0e\u5149\u7167\u9010\u9879\u4fdd\u7559\u3002\u5e03\u5c40\u53ea\u670d\u4ece\u7c7b\u578b\u53e5\uff0c\u4e3b\u4f53\u53e5\u4e2d\u7684\u65e7\u5e03\u5c40\u4e0d\u5f97\u8986\u76d6\u7c7b\u578b\u53e5\u3002\u4e2d\u6587\u81ea\u5b9a\u4e49\u6269\u5199\u4e0d\u5957\u7528\u5b98\u65b9 PE-T2I \u82f1\u6587400\u2013500\u8bcd\u914d\u65b9\uff1b\u6bcf\u540d\u8bcd\u4e00\u4fee\u9970\u53ea\u662f\u62c6\u53e5\u5efa\u8bae\u3002"}}, "6:4031": {"class_type": "MyQi21\u8272\u5361", "inputs": {"\u5185\u5bb9": "\u7248\u672c1.0(2026-10-04) | \u8303\u56f4:\u8bcd\u5178\u53ea\u7ed9\u5728\u7528\u8bcd\u914d\u503c,\u4e0d\u6269\u8bcd;\u6536\u5f55\u8303\u56f4=art_style_base\u8272\u677f\u8bcd\u6c47\u8868+\u56db\u578b\u591a\u5f69\u884c+\u624b\u518c\u98ce\u683c\u8bcd;MA 42\u8272=\u5907\u9009\u5e93,\u975e\u5728\u7528\u6e05\u5355\u3002\u300e\u8d6d\u9ec4\u571f\u8272\u300f\u4e3aart_style_base\u590d\u5408\u8bcd,\u8fd1\u4e49\u6ce8\u8bb0\u8d6d\u77f3\u4e3a\u4e3b|1008 \u7384\u8272\u5165\u5361(\u4e3b\u89d2\u8bbe\u5b9a\u8272,\u5728\u7528\u7b2c11\u8bcd)\n\u7528\u6cd5:hex\u4ec5\u4f9b\u4eba\u5de5\u5ba1\u7a3f\u4e0e\u50cf\u7d20/GLM\u9a8c\u6536\u5bf9\u8868,\u7981\u6b62\u5199\u5165\u4efb\u4f55positive/negative prompt\u6b63\u6587(\u6587\u672c\u7f16\u7801\u5668\u4e0d\u8bfbhex);\u65b0\u589e\u8272\u5f69\u63cf\u8ff0\u4f7f\u7528\u672c\u8bcd\u5178\u8272\u8bcd\uff0c\u4e3b\u4f53\u53e5\u539f\u6709\u8272\u8bcd\u9010\u5b57\u4fdd\u7559;\u51b2\u7a81\u6309conflict_order\u88c1\u51b3,\u5728\u6700\u5185\u5c42(\u4e3b\u4f53\u53e5)\u89e3\u51b3\n\u51b2\u7a81\u88c1\u51b3\u5e8f(\u9ad8>\u4f4e): \u660e\u6587\u8bbe\u5b9a\u8272(Source facts/\u89d2\u8272\u6863\u6848) > \u6750\u8d28\u672c\u8272(\u9ed1\u9ca8\u76ae/\u9ec4\u94dc\u7b49) > \u73af\u5883\u4e0e\u65f6\u6bb5\u4e8b\u5b9e > \u591a\u5f69\u884c\u9884\u7b97(\u672c\u578bcolor_recipe) > \u70b9\u7f00\u5efa\u8bae(\u6700\u5148\u5220)\n\u4e94\u804c\u8d23\u5236:\n  base: \u6d45\u51c0\u5e73\u6d82\u5e95(\u5ba3\u7eb8\u767d\u7cfb paper.01)\n  ink: \u7ebf\u63cf\u8f6e\u5ed3\uff1a\u4f9d\u636e\u4e3b\u4f53\u660e\u6587\u914d\u8272\u4e0e\u6750\u8d28\uff0c\u4ece\u8272\u5361\u9009\u53d6\u591a\u79cd\u534f\u8c03\u7ebf\u8272\u5206\u914d\u81f3\u5404\u90e8\u4f4d\uff1b\u540c\u4e00\u90e8\u4f4d\u7ebf\u8272\u7a33\u5b9a\uff0c\u7ebf\u8272\u4e0e\u5bf9\u5e94\u8272\u9762\u4fdd\u6301\u6e05\u6670\u660e\u5ea6\u5c42\u7ea7\uff0c\u7ebf\u6761\u8fde\u7eed\u7ec6\u7a33\u3001\u9971\u548c\u5ea6\u53d7\u63a7\u3002\n  stable: \u5927\u9762\u79ef\u7a33\u5b9a\u57fa\u5e95(=MA base+\u5927\u4efd\u6570primary)\n  mid: \u4e2d\u7b49\u5f3a\u5ea6\u4e3b\u4f53\u8272(=MA secondary/primary)\n  accent: \u5c11\u91cf\u9ad8\u8bc6\u522b\u5f3a\u8c03\u8272(=MA accent,\u53ea\u843d\u4e00\u4e2a\u53d9\u4e8b/\u5de5\u827a\u7126\u70b9)\n\n\u2550 \u2605\u5728\u7528\u8272\u5361(11\u8bcd,\u4f18\u5148\u9009) \u2550\n  1. \u5ba3\u7eb8\u767d(paper.01) hex=#F5F0E8 | \u6d45\u51c0\u5e73\u6d82\u5e95/\u5c40\u90e8\u900f\u6c14\u4f4d | \u5728\u7528:\u4eba\u7269\u578b\u80cc\u666f\u53e5/\u624b\u518c\u98ce\u683c\u8bcd\n  2. \u65e7\u91d1(metal.01) hex=#A8883C | \u70b9\u775b/\u771f\u5b9e\u91d1\u5c5e\u5de5\u827a;\u4ec5\u4e8b\u5b9e\u5b58\u5728\u65f6\u843d\u70b9 | \u5728\u7528:\u4eba\u7269/\u573a\u666f/\u9053\u5177\u591a\u5f69\u884c\n  3. \u6731\u7ea2(red.01) hex=#B8453A | \u5c11\u91cf\u5f3a\u8c03;\u7f28/\u7ed3/\u65d7\u6807/\u5251\u7a57\u7c7b | \u5728\u7528:\u4eba\u7269/\u9053\u5177\u591a\u5f69\u884c\n  4. \u6de1\u58a8(paper.04) hex=#6B6B6B | \u5927\u9762\u79ef\u57fa\u5e95/\u8fdc\u666f\u9000\u6de1 | \u5728\u7528:art_style_base\u8bcd\u6c47\u8868/\u4eba\u7269/\u573a\u666f/\u9053\u5177/\u6982\u5ff5\u591a\u5f69\u884c\n  5. \u6de1\u6731(derived(local)) hex=#C8A08C | \u6982\u5ff5\u578b\u7126\u70b9\u8272(\u53d7\u63a7\u4f4e\u5f3a\u5ea6\u6731\u7ea2);hex=\u672c\u5730\u5b9e\u62cd\u951a | \u5728\u7528:\u6982\u5ff5\u591a\u5f69\u884c\n  6. \u7384\u8272(paper.05(\u8fd1)) hex=#1A1A1A | \u670d\u88c5\u6df1\u8272\u4e3b\u8272(\u7384\u8272\u52b2\u88c5\u65cf);\u987b\u62ec\u6ce8\u8fd1\u9ed1\u4f7f\u7528 | \u5728\u7528:\u793a\u4f8b\u5e93\u00a75\u4e3b\u89d2\u53e5/\u7b2c\u4e00\u7ae0\u8282\u4eba\u7269\u7cfb\n  7. \u7389\u9752(green.03) hex=#74A7A0 | \u7389\u8d28\u5668\u7269\u4e2d\u7b49\u5f3a\u5ea6\u8272 | \u5728\u7528:\u9053\u5177\u591a\u5f69\u884c\n  8. \u77f3\u9752(blue.02) hex=#356A9A | \u4eba\u7269\u4e2d\u7b49\u5f3a\u5ea6\u8272/\u6c34\u4f53 | \u5728\u7528:\u4eba\u7269\u591a\u5f69\u884c\n  9. \u8d6d\u77f3(red.04) hex=#8B5E3C | \u571f\u77f3\u6696\u5c42;\u8d6d\u9ec4\u571f\u8272\u590d\u5408\u8bcd\u4ee5\u6b64\u4e3a\u4e3b | \u5728\u7528:art_style_base\u8bcd\u6c47\u8868(\u8d6d\u9ec4\u571f\u8272)/\u4eba\u7269/\u573a\u666f/\u9053\u5177/\u6982\u5ff5\u591a\u5f69\u884c\n  10. \u9752\u7070(bluegray.01) hex=#536B78 | \u4e91\u6d77/\u8fd1\u77f3/\u8fdc\u5c71\u51b7\u7070 | \u5728\u7528:art_style_base\u8bcd\u6c47\u8868/\u4eba\u7269\u578b\u80cc\u666f\u53e5/\u573a\u666f/\u6982\u5ff5\u591a\u5f69\u884c\n  11. \u9752\u7eff(green.01) hex=#5B8C7A | \u8349\u6728/\u5c71\u4f53\u4e2d\u666f | \u5728\u7528:art_style_base\u8bcd\u6c47\u8868/\u4eba\u7269/\u573a\u666f/\u6982\u5ff5\u591a\u5f69\u884c\n\n\u2550 \u5907\u9009\u8272\u5361\u5168\u5e93(42\u8272,\u542b\u5728\u7528) \u2550\n\n\u3010\u9752\u84dd\u7cfb\u3011\n  blue.01 \u975b\u84dd ##2B4570 \u2014 \u591c\u8272\u4e0e\u6df1\u5c42;\u9002\u5408:\u591c\u6e21\u3001\u8fdc\u5c71\u3001\u6df1\u8863\n  blue.02 \u77f3\u9752 ##356A9A \u2014 \u77ff\u7269\u84dd\u4e3b\u533a;\u9002\u5408:\u5c71\u77f3\u3001\u6c34\u3001\u8863\u6599 \u2605\u5728\u7528\n  blue.03 \u5929\u9752 ##6F9DB2 \u2014 \u7a7a\u6c14\u4e0e\u6c34\u8272\u8f85\u533a;\u9002\u5408:\u5929\u5149\u3001\u8584\u96fe\u3001\u6c34\u9762\n  blue.04 \u9edb\u9752 ##355464 \u2014 \u514b\u5236\u6df1\u8272;\u9002\u5408:\u8863\u888d\u3001\u74e6\u9762\u3001\u8fdc\u5c71\n\n\u3010\u84dd\u7070\u7cfb\u3011\n  bluegray.01 \u6c34\u58a8\u84dd\u7070 ##536B78 \u2014 \u96e8\u96ea\u4e0e\u8fdc\u5c71\u6bcd\u8272;\u9002\u5408:\u96e8\u57ce\u3001\u96ea\u5173\u3001\u51b7\u6c34\u3001\u8fdc\u5c71\n  bluegray.02 \u96fe\u84dd ##92A7AD \u2014 \u6e7f\u7a7a\u6c14\u4e0e\u6c34\u96fe\u8f85\u533a;\u9002\u5408:\u8584\u96fe\u3001\u96e8\u5e55\u3001\u51b0\u9762\u53cd\u5149\n  bluegray.03 \u51b7\u767d ##E3E8E5 \u2014 \u6e05\u5bd2\u6d45\u5e95\u4e0e\u9ad8\u5149;\u9002\u5408:\u96ea\u5730\u3001\u74f7\u9762\u3001\u94f6\u5668\u7559\u767d\n  bluegray.04 \u94c1\u9ed1 ##30383B \u2014 \u51b7\u94c1\u6df1\u5c42\u4e0e\u6697\u6784\u4ef6;\u9002\u5408:\u94c1\u5668\u3001\u74e6\u810a\u3001\u51b7\u7532\u63a5\u7f1d\n\n\u3010\u8349\u6728\u7cfb\u3011\n  flora.01 \u85fb\u8910 ##64705A \u2014 \u6c34\u5cb8\u8349\u6728\u6697\u5c42;\u9002\u5408:\u6e7f\u5730\u3001\u85fb\u77f3\u3001\u65e7\u6728\u6c34\u7ebf\n  flora.02 \u82d4\u7eff ##788064 \u2014 \u82d4\u77f3\u4e0e\u9634\u751f\u690d\u7269\u4e3b\u533a;\u9002\u5408:\u77f3\u9636\u3001\u6e7f\u5899\u3001\u6797\u4e0b\u3001\u5ead\u9662\n  flora.03 \u67af\u9ec4 ##A99A67 \u2014 \u67af\u8349\u4e0e\u79cb\u53f6\u8f85\u533a;\u9002\u5408:\u8352\u5ead\u3001\u82a6\u82c7\u3001\u65f1\u8349\u3001\u65e7\u5e2d\n  flora.04 \u6728\u8910 ##765A40 \u2014 \u6728\u6784\u4e0e\u6811\u76ae\u672c\u8272;\u9002\u5408:\u6881\u67f1\u3001\u6811\u5e72\u3001\u6728\u76d2\u3001\u7af9\u5668\n\n\u3010\u9752\u7eff\u7cfb\u3011\n  green.01 \u9752\u7eff ##5B8C7A \u2014 \u5c71\u6c34\u6bcd\u8272;\u9002\u5408:\u6797\u5730\u3001\u5c71\u95e8\u3001\u751f\u547d\u9898\u6750 \u2605\u5728\u7528\n  green.02 \u77f3\u7eff ##5D8E5B \u2014 \u77ff\u7269\u7eff\u4e3b\u533a;\u9002\u5408:\u5c71\u4f53\u3001\u6811\u6728\u3001\u8863\u6599\n  green.03 \u7389\u9752 ##74A7A0 \u2014 \u7389\u6c34\u8fc7\u6e21;\u9002\u5408:\u7389\u5668\u3001\u533b\u4fee\u3001\u6c34\u8272 \u2605\u5728\u7528\n  green.04 \u94dc\u7eff ##4F7E70 \u2014 \u6c27\u5316\u70b9\u7f00;\u9002\u5408:\u9752\u94dc\u3001\u65e7\u6784\u4ef6\n\n\u3010\u7389\u77f3\u7cfb\u3011\n  jade.01 \u767d\u7389 ##DCE5D9 \u2014 \u6d45\u7389\u672c\u8272;\u9002\u5408:\u7389\u4f69\u3001\u5370\u3001\u5668\u76bf\n  jade.02 \u9752\u7389 ##6E9B8D \u2014 \u9752\u7389\u4e3b\u4f53;\u9002\u5408:\u7389\u7b80\u3001\u4f69\u9970\u3001\u6cd5\u5668\n  jade.03 \u78a7\u7389 ##4D806C \u2014 \u6df1\u7389\u70b9\u7f00;\u9002\u5408:\u7389\u77f3\u3001\u7075\u6750\n  jade.04 \u58a8\u7389 ##314442 \u2014 \u6697\u7389\u5d4c\u4ef6;\u9002\u5408:\u5370\u3001\u67c4\u3001\u9576\u5d4c\n\n\u3010\u91d1\u5c5e\u7cfb\u3011\n  metal.01 \u65e7\u91d1 ##A8883C \u2014 \u938f\u91d1\u70b9\u775b;\u9002\u5408:\u91d1\u5c5e\u3001\u63cf\u91d1\u3001\u7b49\u7ea7\u7eb9 \u2605\u5728\u7528\n  metal.02 \u6697\u91d1 ##7A6528 \u2014 \u514b\u5236\u8d35\u91cd\u7eb9;\u9002\u5408:\u9ad8\u9636\u7eb9\u6837\u3001\u9f99\u6c14\u7ec6\u4e1d\n  metal.03 \u9752\u94dc ##7C6546 \u2014 \u9752\u94dc\u672c\u8272;\u9002\u5408:\u9f0e\u3001\u955c\u3001\u673a\u5173\u6784\u4ef6\n  metal.04 \u94c1\u7070 ##4A4D50 \u2014 \u94c1\u5668\u672c\u8272;\u9002\u5408:\u5175\u5668\u3001\u7532\u7247\u3001\u5de5\u5177\n\n\u3010\u7eb8\u58a8\u7cfb\u3011\n  paper.01 \u5ba3\u7eb8\u767d ##F5F0E8 \u2014 \u6d45\u51c0\u5e95\u3001\u7559\u767d;\u9002\u5408:\u5168\u8f68\u5e95\u8272 \u2605\u5728\u7528\n  paper.02 \u7c73\u767d ##E9DFC9 \u2014 \u6696\u5e95;\u9002\u5408:\u5ba4\u5185\u3001\u65e7\u57ce\u3001\u4eba\u7269\n  paper.03 \u96ea\u7070 ##D8D6CF \u2014 \u96fe\u4e0e\u7559\u767d\u8fc7\u6e21;\u9002\u5408:\u5c71\u6c34\u3001\u591c\u666f\u3001\u7389\u77f3\n  paper.04 \u6de1\u58a8 ##6B6B6B \u2014 \u8fdc\u5c42\u4e0e\u6b21\u7ebf;\u9002\u5408:\u8fdc\u666f\u3001\u6b21\u8981\u7ed3\u6784 \u2605\u5728\u7528\n  paper.05 \u6d53\u58a8 ##1A1A1A \u2014 \u4e3b\u7ebf\u4e0e\u8f6e\u5ed3;\u9002\u5408:\u4eba\u7269\u3001\u5668\u7269\u3001\u5efa\u7b51\n\n\u3010\u7d2b\u7070\u7cfb\u3011\n  purple.01 \u70df\u7d2b ##665675 \u2014 \u514b\u5236\u7d2b\u7070\u4e3b\u533a;\u9002\u5408:\u793c\u670d\u3001\u66ae\u8272\u82b1\u6728\u3001\u7ec7\u7269\n  purple.02 \u85d5\u7070 ##A58F9B \u2014 \u7d2b\u7070\u5c42\u6b21\u8f85\u8272;\u9002\u5408:\u5185\u886c\u3001\u82b1\u53f6\u80cc\u9762\u3001\u9676\u91c9\n  purple.03 \u85d5\u767d ##D8CCD0 \u2014 \u51b7\u6696\u4e4b\u95f4\u7684\u6d45\u5e95;\u9002\u5408:\u8f7b\u7eb1\u3001\u82b1\u74e3\u3001\u5ba4\u5185\u7559\u767d\n  purple.04 \u94f6\u7070 ##8C8E98 \u2014 \u51b7\u94f6\u4e0e\u7ec7\u7269\u8fc7\u6e21;\u9002\u5408:\u94f6\u5668\u3001\u51b7\u7532\u3001\u7ef8\u7f0e\u6697\u90e8\n\n\u3010\u7ea2\u8910\u7cfb\u3011\n  red.01 \u6731\u7ea2 ##B8453A \u2014 \u7126\u70b9\u4e0e\u5370\u8bb0;\u9002\u5408:\u9635\u7eb9\u3001\u5370\u7ae0\u3001\u5c0f\u914d\u9970 \u2605\u5728\u7528\n  red.02 \u6731\u7802 ##C5483C \u2014 \u4eea\u5f0f\u4e3b\u8272;\u9002\u5408:\u6cd5\u8109\u3001\u7b26\u5370\u3001\u8863\u9970\n  red.03 \u80ed\u8102 ##A94B58 \u2014 \u7ec7\u7269\u4e0e\u80a4\u8272\u8282\u5236;\u9002\u5408:\u5973\u6027\u8863\u9970\u3001\u82b1\u6728\n  red.04 \u8d6d\u77f3 ##8B5E3C \u2014 \u571f\u6728\u5c71\u77f3;\u9002\u5408:\u571f\u5730\u3001\u6728\u5668\u3001\u5ca9\u58c1 \u2605\u5728\u7528\n  red.05 \u6817\u8910 ##654331 \u2014 \u65e7\u6728\u4e0e\u76ae\u9769;\u9002\u5408:\u6728\u6784\u3001\u9798\u3001\u9769\u4ef6\n\n\u3010\u9ec4\u8336\u7cfb\u3011\n  yellow.01 \u82cd\u9ec4 ##8A7748 \u2014 \u514b\u5236\u571f\u9ec4\u4e3b\u533a;\u9002\u5408:\u79cb\u539f\u3001\u65e7\u5899\u3001\u5c71\u5c45\u7ec7\u7269\n  yellow.02 \u85e4\u9ec4 ##C1A34A \u2014 \u660e\u6696\u8f85\u8272\u4e0e\u5c0f\u70b9\u775b;\u9002\u5408:\u82b1\u854a\u3001\u7af9\u7bfe\u3001\u7eb9\u6837\n  yellow.03 \u7802\u767d ##E5D9BE \u2014 \u7802\u571f\u6696\u6d45\u5e95;\u9002\u5408:\u571f\u58c1\u3001\u9676\u576f\u3001\u65f1\u5730\u7a7a\u6c14\n  yellow.04 \u7126\u8336 ##6B5138 \u2014 \u70d8\u7119\u6728\u7af9\u6df1\u5c42;\u9002\u5408:\u7af9\u6728\u3001\u8336\u5668\u3001\u9769\u7ef3"}}, "6:4032": {"class_type": "MyQi21\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7", "inputs": {"\u7f8e\u672f\u98ce\u683c": "\u7f8e\u672f\u98ce\u683c\u5e95\u5ea7\uff1a\u4e2d\u56fd\u4f20\u7edf\u4eba\u7269\u753b\u5ba1\u7f8e\u7ecf\u73b0\u4ee3\u6e38\u620f\u7f8e\u672f\u8bbe\u8ba1\u91cd\u7ec4\u7684\u4e8c\u7ef4\u6570\u5b57\u7ed8\u753b\u3002\u878d\u5408\u5de5\u7b14\u3001\u767d\u63cf\u4e0e\u8fde\u73af\u753b\u7684\u7ed8\u753b\u8bed\u8a00\uff1b\u7ebf\u6761\u7ec6\u7a33\u8fde\u8d2f\u3001\u7c97\u7ec6\u968f\u7ed3\u6784\u4e0e\u8f7b\u91cd\u5bcc\u6709\u8282\u594f\uff0c\u4fdd\u7559\u624b\u7ed8\u7b14\u6027\uff1b\u8584\u900f\u77ff\u7269\u8272\u5206\u67d3\u4e0e\u7f69\u67d3\uff0c\u8272\u5f69\u6d53\u6de1\u3001\u865a\u5b9e\u8fb9\u7f18\u4e0e\u7b14\u89e6\u8282\u594f\u76f8\u878d\uff1b\u91c7\u7528\u4e2d\u56fd\u4f20\u7edf\u8272\u4f53\u7cfb\uff0c\u591a\u8272\u76f8\u5e76\u9648\uff0c\u9971\u548c\u5ea6\u4e0e\u5bf9\u6bd4\u5ea6\u53d7\u63a7\uff0c\u6750\u8d28\u8868\u73b0\u7edf\u4e00\u4e8e\u7ed8\u753b\u8bed\u8a00\u3002\u6210\u50cf\u5de5\u827a\u5e72\u51c0\uff0c\u7ebf\u6761\u4e0e\u7f69\u67d3\u5c42\u6b21\u6e05\u6670\u3002", "\u8d1f\u5411\u8bcd\u8868": "\u6a21\u7cca\uff0c\u7f51\u6587\u5c01\u9762\u753b\u98ce\uff0c\u53e4\u98ce\u5076\u50cf\u6d77\u62a5\uff0c\u5149\u9762\u73b0\u4ee3 CG \u7279\u5199\uff0c\u8d5b\u7490\u7490\uff0c\u539a\u6d82\u906e\u853d\u7ed3\u6784\uff0c\u539a\u6570\u5b57\u989c\u6599\u5757\uff0c\u55b7\u67aa\u660e\u6697\u6cd5\uff0c\u8f6f3D\u4f53\u79ef\u5851\u5f62\uff0c\u6cb9\u4eae\u9ad8\u5149\uff0c\u6cb9\u9ed1\u6e10\u53d8\uff0c\u53e4\u753b\u76f4\u63a5\u642c\u8fdb\u6e38\u620f\uff0c\u5546\u4e1a\u4eba\u7269\u590d\u5236\uff0c\u6ce5\u7cca\u6b7b\u9ed1\u5757\uff0c\u9ed1\u767d\u6ee4\u955c\u5316\uff0c\u6ee1\u5e45\u6cfc\u58a8\uff0c\u9713\u8679\u8272\uff0c\u7cd6\u679c\u9971\u548c\u5ea6\uff0cAI \u4f2a\u5f71\uff0c\u6ce5\u7cca\u566a\u70b9\uff0c\u8fc7\u9510\u5149\u6655\uff0c\u7eb8\u9762\u7eb9\u7406\uff0c\u673a\u68b0\u52fe\u8fb9\uff0c\u77e2\u91cf\u611f\uff0c\u8fc7\u91cf\u58a8\u8ff9\u7b14\u89e6\uff0c\u7070\u5316\u6df7\u8272\uff0c\u5bc6\u96c6\u76b4\u64e6"}}, "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"}}, "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}}, "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}}, "400": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "\u4e00\u67c4\u4f20\u627f\u5343\u5e74\u7684\u9752\u94dc\u5251\uff0c\u5251\u8eab\u6697\u91d1\u5e95\u8272\u4e0a\u76d8\u7ed5\u7ec6\u5bc6\u4e91\u96f7\u7eb9\uff0c\u5251\u683c\u94f8\u6210\u517d\u9996\u8854\u73af\uff0c\u5251\u67c4\u7f20\u6df1\u7ea2\u4e1d\u7ef3\uff0c\u7a57\u5c3e\u5782\u4e00\u679a\u5e26\u88c2\u7eb9\u7684\u7075\u7389\u3002"}}, "404": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": ""}}, "401": {"class_type": "MyQi21PromptPreview", "inputs": {"\u6b63\u5411\u63d0\u793a\u8bcd": ["6:4014", 0], "\u8d1f\u5411\u63d0\u793a\u8bcd": ["6:4014", 1]}}, "4015": {"class_type": "TextEncodeQwenImage21", "inputs": {"prompt": ["6:4014", 0], "negative_prompt": "", "resolution": 1024, "clip": ["2", 0]}}, "4016": {"class_type": "TextEncodeQwenImage21", "inputs": {"prompt": ["6:4014", 1], "negative_prompt": "", "resolution": 1024, "clip": ["2", 0]}}, "4018": {"class_type": "MyQi21WhSuggest", "inputs": {"\u4e5d\u578bWIDTH": ["6:4013", 3], "\u4e5d\u578bHEIGHT": ["6:4013", 4], "\u624b\u52a8\u5bbd": 0, "\u624b\u52a8\u9ad8": 0}}, "4": {"class_type": "EmptyLatentImage", "inputs": {"width": ["4018", 0], "height": ["4018", 1], "batch_size": 1}}, "7:7028": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors", "strength_model": 1.0}}, "7:7029": {"class_type": "BasicGuider", "inputs": {"model": ["7:7028", 0], "conditioning": ["4015", 0]}}, "7:7030": {"class_type": "ManualSigmas", "inputs": {"sigmas": "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"}}, "7:7017": {"class_type": "RandomNoise", "inputs": {"noise_seed": 2035662262}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}}
```

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

## 八、十型 turbo 实弹逐型收据

> 贴入(主 agent 落账令材料,2026-10-16;引擎管家产出,十型全出图;只取证不判图)。十型耗时带:道具首发 80s(冷)→热身后 56-168s(1:1 最快 56s/21:9 横幅最慢 168s/2.66MP 合板 160s),对照系=参数速查 FunAcc 28.8s(4步)/原生 130.7s——turbo 落 FunAcc 与原生之间,判图归用户。

### 人物 ✅
# qi21-道劫-t2i · 型「人物」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/人物.png` | fire DONE 行;文件在场 2,553,540 B |
| 引擎侧产物名 | `QI21_t2i_wf_00006_.png` | fire stdout |
| prompt_id | `ab581fac-ff97-43d5-9b0b-728c10bae99b` | fire stdout `queued` |
| 宽×高 | **1088 × 1440**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:人物型档=3:4 (Portrait Standard) @1.5MP(qi21_bases.json types[0] 实读);1088/1440=0.756≈3/4,面积 1,566,720px≈1.57MP≈1.5MP 档,宽高均 16 倍数 | 本会话实读两源比对 |
| 耗时 | 120 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (120s)` |
| 本次种子 | **1237153538**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 人物 --turbo` | 父端实跑,exit 0 |

## turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`人物`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=1237153538、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 35,679 字节,sha256=`ca87d6eb61c718aab36bd3a3129c1ce16991008371afc994f27ebe2e3f0daf10`;全文仍在 PNG 元数据内嵌,可随时复核

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u4eba\u7269", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u4eba\u7269:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd": ["400", 0],
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 1237153538}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/人物.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 场景 ✅
# qi21-道劫-t2i · 型「场景」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/场景.png` | fire DONE 行;文件在场 3,233,842 B |
| 引擎侧产物名 | `QI21_t2i_wf_00007_.png` | fire stdout |
| prompt_id | `89f15f1a-8a14-4240-87be-42f909567566` | fire stdout `queued` |
| 宽×高 | **1664 × 944**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:场景型档=16:9 (Widescreen) @1.5MP(qi21_bases.json types[1] 实读);1664/944=1.763≈16/9,面积 1,571,616px≈1.57MP≈1.5MP 档,宽高均 16 倍数 | 本会话实读两源比对 |
| 耗时 | 104 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (104s)` |
| 本次种子 | **1524704626**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 场景 --turbo` | 父端实跑,exit 0 |

## turbo 档与型选择实证(prompt 块内)

- 首 500 字内:`6:4010` base=`场景`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=1524704626、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 35,853 字节,sha256=`9114e84ff928f10e050ff9bf94b72815842ff228f6c8916a914154007736fa1d`;全文仍嵌在 PNG 元数据内,可随时复核

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u573a\u666f", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u573a\u666f:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd": ["400", 0],
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 1524704626}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/场景.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 道具 ✅
# qi21-道劫-t2i · 型「道具」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/道具.png` | fire DONE 行;文件在场 642,360 B |
| 引擎侧产物名 | `QI21_t2i_wf_00008_.png` | fire stdout |
| prompt_id | `c040443c-326e-48a7-b730-13532f75e18d` | fire stdout `queued` |
| 宽×高 | **1024 × 1024**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:道具型档=1:1 (Square) @1.0MP、rgba_default=True(qi21_bases.json types[2] 实读);1024×1024→比例 1:1、面积 1,048,576px≈1.05MP≈1.0MP 档;RGBA 与透明底设计一致 | 本会话实读两源比对 |
| 耗时 | 56 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (56s)` |
| 本次种子 | **1286775182**(随机,未传 --seed;首发同型 seed=2035662262,两发不同=随机机制实证) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 道具 --turbo` | 父端实跑,exit 0 |

## turbo 档与型选择实证(prompt 块内)

- 首 500 字内:`6:4010` base=`道具`、透明覆盖=false(型默认 rgba=True 生效,非覆盖);`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=1286775182、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 34,383 字节,sha256=`25cea34a0c769bb6c3dc29b505f0f6d2cc72026c0c2608e5970d5974613ef767`(与首发道具块同长,差仅 seed 位);全文仍嵌在 PNG 元数据内,可随时复核

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u9053\u5177", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u9053\u5177:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd": ["400", 0],
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 1286775182}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/道具.装配文.txt`(fire 取 history [401] 终稿真值)
- 同型首发参照件:`apps/output/bgscope-r3-9types/道具-turbo1016首发.png`(seed=2035662262,80s,含引擎冷加载)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 美宣 ✅
# qi21-道劫-t2i · 型「美宣」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/美宣.png` | fire DONE 行;文件在场 2,861,013 B |
| 引擎侧产物名 | `QI21_t2i_wf_00009_.png` | fire stdout |
| prompt_id | `49b22597-c589-4bf5-a21b-3ba3eb0819f4` | fire stdout `queued` |
| 宽×高 | **1920 × 832**(8-bit,彩色型 6=RGBA——本产线 RGBA VAE 统一输出格式,前四发同) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:美宣型档=21:9 (Ultrawide) @1.5MP、rgba_default=False(qi21_bases.json types[3] 实读);1920/832=2.308≈21/9(16 倍数量化容差内),面积 1,597,440px≈1.6MP≈1.5MP 档,宽高均 16 倍数 | 本会话实读两源比对 |
| 耗时 | 168 秒(POST /prompt→产物下载完毕;引擎模型已热,21:9 横幅像素最多) | fire stdout `DONE ... (168s)` |
| 本次种子 | **2045909236**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 美宣 --turbo` | 父端实跑,exit 0 |

## turbo 档与型选择实证(prompt 块内)

- 首 500 字内:`6:4010` base=`美宣`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=2045909236、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 35,829 字节,sha256=`4220f91ac7a7fb69c61d67b0785b3cb15dea0d9ffe3ae033e7d386754aae6063`;全文仍嵌在 PNG 元数据内,可随时复核

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u7f8e\u5ba3", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u7f8e\u5ba3:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd": ["400", 0],
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 2045909236}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/美宣.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 人物多视图 ✅
# qi21-道劫-t2i · 型「人物多视图」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/人物多视图.png` | fire DONE 行;文件在场 2,080,546 B |
| 引擎侧产物名 | `QI21_t2i_wf_00010_.png` | fire stdout |
| prompt_id | `2fd5572b-8028-4c07-8879-7f4cad7933cf` | fire stdout `queued` |
| 宽×高 | **1632 × 1632**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上(override 直出)**:types[4] 人物多视图 resolution_override=[1632,1632](qi21_bases.json 实读),节点直出 override(my_qi21_base.py:176-180);megapixels=1.8 系公式兑底标签本型不参与(公式形应为 1376×1376) | 本会话实读三源比对 |
| 耗时 | 160 秒(POST /prompt→产物下载完毕;2.66MP 合板) | fire stdout `DONE ... (160s)` |
| 本次种子 | **963027764**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 人物多视图 --turbo` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`人物多视图`、透明覆盖=false;主体句经 fire :100 别名(人物多视图→多视图)取示例库 §5 首例
- 尾 500 字内:`7:7017` RandomNoise noise_seed=963027764、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 34,508 字节,sha256=`43727f47793f3d122858d5a53e6790508b2cbcec674caf0f57eb8d52d2a82f21`;首段在 500 字边界截断于转义序列中属正常(\u5411 被切为 \u541)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u4eba\u7269\u591a\u89c6\u56fe", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u4eba\u7269\u591a\u89c6\u56fe:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u541
```

**尾 500 字:**

```
e", "inputs": {"noise_seed": 963027764}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/人物多视图.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 高清人脸 ✅
# qi21-道劫-t2i · 型「高清人脸」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/高清人脸.png` | fire DONE 行;文件在场 1,511,626 B |
| 引擎侧产物名 | `QI21_t2i_wf_00011_.png` | fire stdout |
| prompt_id | `a5f17a6c-d01e-4004-8831-71744936df66` | fire stdout `queued` |
| 宽×高 | **1024 × 1024**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:高清人脸型档=1:1@1.0MP、rgba_default=True、无 override(qi21_bases.json types[5] 实读)→公式直出恰=1024×1024,产物精确一致 | 本会话实读两源比对 |
| 耗时 | 64 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (64s)` |
| 本次种子 | **600842895**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 高清人脸 --turbo` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`高清人脸`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=600842895、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 35,024 字节,sha256=`925753da799e5f3fa08b10c4b9e051b58176b3caebf57f3d04e43698fa977672`;首段在 500 字边界截断于转义序列中属正常(\u63d0\u7 s 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u9ad8\u6e05\u4eba\u8138", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u9ad8\u6e05\u4eba\u8138:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u7
```

**尾 500 字:**

```
e", "inputs": {"noise_seed": 600842895}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/高清人脸.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 分镜剧情图 ✅
# qi21-道劫-t2i · 型「分镜剧情图」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/分镜剧情图.png` | fire DONE 行;文件在场 2,673,029 B |
| 引擎侧产物名 | `QI21_t2i_wf_00012_.png` | fire stdout |
| prompt_id | `da79c7cc-14e7-4c72-bb81-783bdcfd8af7` | fire stdout `queued` |
| 宽×高 | **1664 × 944**(8-bit,彩色型 6=RGBA——本产线统一输出格式) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:分镜剧情图型档=16:9@1.5MP、无 override(qi21_bases.json types[6] 实读)→公式直出;1664/944=1.763≈16/9,面积 1,571,616px≈1.57MP≈1.5MP 档,与场景型同板面 | 本会话实读两源比对 |
| 耗时 | 96 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (96s)` |
| 本次种子 | **112273253**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 分镜剧情图 --turbo` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`分镜剧情图`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=112273253、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 34,934 字节,sha256=`6b3d20dbcf24b7352a17e30995729bce86754f0291c7280a8b8ae193ebba58fb`;首段在 500 字边界截断于转义序列中属正常(\u6b63\u5 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u5206\u955c\u5267\u60c5\u56fe", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u5206\u955c\u5267\u60c5\u56fe:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5
```

**尾 500 字:**

```
e", "inputs": {"noise_seed": 112273253}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/分镜剧情图.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 表情差分 ✅
# qi21-道劫-t2i · 型「表情差分」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/表情差分.png` | fire DONE 行;文件在场 2,702,171 B |
| 引擎侧产物名 | `QI21_t2i_wf_00013_.png` | fire stdout |
| prompt_id | `6c454d70-e7b7-43b7-8c7c-e7a53c41052c` | fire stdout `queued` |
| 宽×高 | **1248 × 1248**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上(16px 量化容差内)**:型档=1:1@1.5MP、无 override(引擎家 daojie-data 与仓库真源两副本同值)→节点公式直出 **1256×1256**(MyQi21DaojieBase.run 本地实跑定谳);产物 1248×1248=round(1256/16)×16(半偶)——qwen2.1 VAE 降采样因子 16(引擎 comfy/sd.py:958-960)的产线量化,与人物 1448→1440/美宣 1912→1920/场景 1672→1664 同型;比例 1:1 精确、面积 1,557,504px≈1.56MP≈1.5MP 档 | 本会话实读+实跑四源比对 |
| 耗时 | 104 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (104s)` |
| 本次种子 | **1698830340**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 表情差分 --turbo` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`表情差分`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=1698830340、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 36,465 字节,sha256=`59545706aad863575afa61a3c952a107c163102e1ffe4e8277c5f1049c7323c1`;首段在 500 字边界截断于转义序列中属正常(\u63d0\u7 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u8868\u60c5\u5dee\u5206", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u8868\u60c5\u5dee\u5206:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u7
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 1698830340}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/表情差分.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 概念气氛图 ✅
# qi21-道劫-t2i · 型「概念气氛图」turbo 档发车收据

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/概念气氛图.png` | fire DONE 行;文件在场 2,506,247 B |
| 引擎侧产物名 | `QI21_t2i_wf_00014_.png` | fire stdout |
| prompt_id | `ea3e924e-d94d-4692-a96c-b5cc9e3374dc` | fire stdout `queued` |
| 宽×高 | **1664 × 944**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:型档=16:9@1.5MP、无 override(types[8] 两副本同值)→节点公式直出 1672×944→产线 16 量化 round(1672/16)=104→**1664×944 与产物精确一致**(与场景/分镜剧情图同板面);比例 1.763≈16/9、面积≈1.57MP≈1.5MP 档 | 本会话实读+实跑比对(预测即中) |
| 耗时 | 96 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (96s)` |
| 本次种子 | **1992976385**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 概念气氛图 --turbo` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`概念气氛图`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=1992976385、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 35,349 字节,sha256=`3617f54cb938d02419cc2367bb506f3e2631b706ae693dce0eeded4828938152`;首段在 500 字边界截断于转义序列中属正常(\u6b63\u5 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u6982\u5ff5\u6c14\u6c1b\u56fe", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u6982\u5ff5\u6c14\u6c1b\u56fe:1792125423692247566"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 1992976385}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/概念气氛图.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*

### 设定卡 ✅
# qi21-道劫-t2i · 型「设定卡」turbo 档发车收据(十型收官)

## 基本事实

| 项 | 值 | 来源 |
|---|---|---|
| 产物图(绝对路径) | `/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/设定卡-turbo1016.png` | fire DONE 行;文件在场 1,604,221 B |
| 旧件保全 | 1015 役 `设定卡.png`(11,639,931 B,10-16 04:08)未触碰——本次走专用名,零覆盖 | ls 实测两件并存 |
| 引擎侧产物名 | `QI21_t2i_wf_00015_.png` | fire stdout |
| prompt_id | `1ad0564c-558c-4157-af30-20d1d7157168` | fire stdout `queued` |
| 宽×高 | **1664 × 944**(8-bit,彩色型 6=RGBA) | PNG IHDR 直读 |
| 型档分辨率对账 | **对上**:设定卡型档=16:9@1.5MP、rgba_default=True、无 override(types[9] 两副本同值)→节点公式直出 1672×944→产线 16 量化→**1664×944 精确一致**(预测即中);比例 1.763≈16/9、面积≈1.57MP≈1.5MP 档 | 本会话实读+实跑比对 |
| 耗时 | 96 秒(POST /prompt→产物下载完毕;引擎模型已热) | fire stdout `DONE ... (96s)` |
| 本次种子 | **2029161562**(随机,未传 --seed) | fire stdout + prompt 块 7:7017 noise_seed |
| 发车命令 | `python3 .../qi21_t2i_workflow_fire.py --type 设定卡 --turbo --out .../设定卡-turbo1016.png` | 父端实跑,exit 0 |

## 型选择与 turbo 档实证(prompt 块内)

- 首 500 字内:`6:4010` base=`设定卡`、透明覆盖=false;`6:4013` MyQi21ApiPE 双端点故障转移表在场
- 尾 500 字内:`7:7017` RandomNoise noise_seed=2029161562、`7:7018` euler、`7:7031` SamplerCustomAdvanced(noise←7017/guider←7029/sampler←7018/sigmas←7030/latent←`[4,0]`)、`5` VAEDecode.samples←`[7:7031,0]`、`8` SaveImage
- 档位判定:执行图含 7:7028(turbo LoRA)、无 7:7010(直出)——turbo 官方臂独占 ✓

## PNG 元数据 prompt 块首尾各 500 字(逐字)

> 块总长 34,629 字节,sha256=`9c9ee1fbdfa7f4d99fbfc020bddb0b46a9bef55246e160a7d179c5c1031ce2e0`;本次首段 500 字边界恰落在键名后(无转义截断)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\u8bbe\u5b9a\u5361", "\u900f\u660e\u8986\u76d6": false}, "is_changed": ["\u8bbe\u5b9a\u5361:1792125423692247566"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\u5173\u95ed", "\u6b63\u5411\u63d0\u793a\u8bcd":
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 2029161562}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/设定卡-turbo1016.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16;至此十型 turbo 档全部实弹完毕)。*

## 九、遗留(notCovered)

- 实弹闸余量(落账时点 10-16):t2i 首发实弹+十型逐型批**已跑**(§七/§八收据在档,引擎经 App 重启后由引擎管家发车);余=i2i×turbo 闸发(--tier)/edit GUI 档0 默认+切档实弹;引擎 /global_subgraphs 蓝图注册行为未验;i2i 宿主 [402] 显示槽位定音(P1⑤:画布开件看 Note 显示哪份文本,供 §O 方案① 代价一锤定音)未随批执行。
- 提交后须 workflow_gate.py --rebuild-baseline 重立布局棘轮记账(三 JSON 工作树脏在段3 显式 SKIP 不计,先例 Fix7027 记账行)。
- api 桥临时件再生 diff 闸=**中止零写入**:桥 build_graph 炸在装配子图 [4032] wv 形变(IndexError,并行役 i2i 口径役在途域,非本役手术面);api.json 现状仍合术后 viggle 形(桥零 7013 依赖+latent_viggle 槽名未动)。
- 装机 Resources↔引擎家字节对账未跑(canvas_deploy --audit 域;--sync-home 已各写 15 件+预备份)。
- 契约测试全量以三件合跑为准(静态读+本域实跑);11 基线红归并行役(i2i Note 短卡+qi21_bases 十型),候并行役收口自愈。
- 知会不强制清单未动:pose-edit Note 1 处/taxency T8 三处/05库历史账段落/清单历史沿革句。
- t2i viggle 正源(positive)与 turbo 同源——1014 定谳 viggle 多参考在 t2i 域的既有口径未随本役复核(t2i viggle 正源=主编码,历史实弹绿,零触碰)。

## 十、回滚路径(.bak-1016turbo 全表+步骤)

资产→备份→回滚动作:

1. **非工作流 14 件=fire 两件/py 五件/契约测试/docs 四件(台账/速查/05库/工程契约)/machine.md/bridge 生成器**:`cp <file>.bak-1016turbo <file>` 整件还原(speed_select.py 的 .bak=git HEAD 直出,件役前 git 干净;test_my_qi21_rgba_select 件本体零净改,其 .bak 回拷=noop);契约测试还原前三方目检(热区禁 git checkout)。
2. **三工作流**:`cp qi21-道劫-{t2i,i2i}.json.bak-1016turbo`/`cp qi21-edit.json.bak-1016turbo` 整件还原。
3. **三蓝图+手术脚本**:rm 即净(新文件);`python3 apps/build/scripts/qi21_accel_turbo_1016.py --check`(若脚本保留)证撤净——或脚本一并 rm 后以 git 工作区态目检。
4. **引擎家/装机同步副本**:cp 回 `.bak-1016turbo` 预备份或重跑 `--sync-home`(若 repo 已回滚,自真源还原;范围不含用户区)。
5. **turbo LoRA**:无需回滚(新落位件);如需清位则 mv 回收目录(禁 rm)。
6. 总回滚序:fire→测试→工作流→py→蓝图 rm→docs/skills/桥生成器→引擎家;回滚后三命令对 T0 应回原红集合(my_nodes 3/契约 11/audit 9-10)。
7. FunAcc 臂复活路径(若实弹判 turbo 不敌):py 档串回 Fun-Acc+三工作流 .bak 还原+引擎重启——文件/插件层全程留盘即为此杠杆。
