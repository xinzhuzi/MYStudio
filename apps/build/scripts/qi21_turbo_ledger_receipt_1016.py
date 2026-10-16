#!/usr/bin/env python3
"""1016turbo 落账脚本(r5):台账头部核账段前插 + 战役收据贴入首发/十型实弹材料。

幂等:已落账标记在场→noop 退出;fail-closed:锚唯一性+行内标记+JSON sha 门全断言。
改动面:
  1) docs/comfyui-kb/LoRA库存台账.md —— 头部「最后核账」行与「最近核账日」段
     前插 1016turbo 条目(仿 1015 H3 先例链式;#26/#30 两行役内已落账,脚本只验在册)。
  2) docs/comfyui-kb/档案/qi21-turbo换档加速子图抽离-1016.md —— §七 stub→首发实弹
     收据全文(PNG 元数据 JSON 自字节级副本件读入,sha 门=材料声明值);§八 stub→
     十型逐型收据全文;§九遗留首条按实弹已跑改写+补 P4 提交后基线条。
"""
import hashlib
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
LEDGER = REPO / "docs/comfyui-kb/LoRA库存台账.md"
RECEIPT = REPO / "docs/comfyui-kb/档案/qi21-turbo换档加速子图抽离-1016.md"
PROMPT_JSON = (REPO / "apps/output/bgscope-r3-9types/"
               "道具-turbo1016首发.prompt元数据.json")
CAMPAIGN = "1016turbo"

JSON_SHA = "128b95efae8d3ae263f877d5b0699d0b83b1a2cf07e7286052c4f14dd4b23e16"

LEDGER_HEAD_OLD = "最后核账:2026-10-15(1015 H3 v1.2 升级役落账"
LEDGER_HEAD_NEW = ("最后核账:2026-10-16(1016turbo 换臂落账——#26 Fun-Acc T8 退役收口"
                   "(道劫三件 [7013] 臂随档0 换官方 Turbo 出册,节点级引用 3→0;LoRA 文件+"
                   "T8 插件留盘不删=回滚杠杆,md5=894c3b79…;存量件自救三层见行内)"
                   "+#30 qwen_image_2.1_turbo_lora_avg_rank_178_bf16 补登(官方 Turbo LoRA,"
                   "913,314,512 B/sha256=208dd432…=HF lfs.oid 双验;引用=3=道劫三件 [7] "
                   "加速子图 [7028] 挂点;红字注现测禁抄表);零删除(留盘=回滚杠杆);"
                   "前账 2026-10-15(1015 H3 v1.2 升级役落账")
LEDGER_RECENT_OLD = "**最近核账日:2026-10-15**(10-15 H3 v1.2 升级役落账:"
LEDGER_RECENT_NEW = ("**最近核账日:2026-10-16**(10-16 1016turbo 换臂落账:#26 退役收口"
                     "+#30 补登(明细见最后核账行与两行内);前账 2026-10-15"
                     "(10-15 H3 v1.2 升级役落账:")

STUB7 = '''> (贴入·主役侧材料:turbo LoRA 下装未就绪(curl 退出码 92: `curl: (92) HTTP/2 stream 1 was not closed cleanly: CANCEL (err 8)`),实弹未跑)

本役实跑更正与补充:**turbo LoRA 已于役内下装落位**——疑件两采样(31s 间隔)证停滞(145,836,721 B/mtime 05:41:53 冻结/sha256=`091af2b0…`≠官方)后,后台 curl 下载官方件到临时名(exit 0,无 curl 92)→sha256==`208dd43250e1e01467ba190572ae2e7107a7870ec1ff026bc65f791fa1e80e95`+913,314,512 B 双验→原子 mv;落位终态 `stat`=913,314,512 B/10-16 07:00:03,落位后 shasum 复验一致。主役侧 curl 92 记录系另一尝试(ask 材料),与本役成功收据并存如实记。

**实弹未跑**(与主役结论一致):真实闸点=py 三件+蓝图生效须**重启引擎**(App 托管,禁手动 spawn=定制代码地图.md:134①),本役未动引擎进程;t2i 必发+edit 闸发+哈希门+/global_subgraphs 注册验归后续实弹员。'''

STUB7_NEW_HEAD = '''> 贴入(主 agent 落账令材料,2026-10-16;引擎管家产出,只取证不判图)。役内前史(下装经过)如实保留于下段。

本役实跑更正与补充:**turbo LoRA 已于役内下装落位**——疑件两采样(31s 间隔)证停滞(145,836,721 B/mtime 05:41:53 冻结/sha256=`091af2b0…`≠官方)后,后台 curl 下载官方件到临时名(exit 0,无 curl 92)→sha256==`208dd43250e1e01467ba190572ae2e7107a7870ec1ff026bc65f791fa1e80e95`+913,314,512 B 双验→原子 mv;落位终态 `stat`=913,314,512 B/10-16 07:00:03,落位后 shasum 复验一致。主役侧 curl 92 记录(役前时点)系另一尝试,与本役成功收据并存如实记。**落账时点更新:引擎经 App 重启后由引擎管家完成 turbo 档首发实弹,收据全文如下。**

---

'''

FIRST_RECEIPT = '''# qi21-道劫-t2i · turbo 档首发实弹收据

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
__PROMPT_JSON__
```

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16)。*'''

STUB8 = "(未跑——同 §七:引擎重启归后续;首发未成则十型批不启)"

STUB8_NEW_HEAD = '''> 贴入(主 agent 落账令材料,2026-10-16;引擎管家产出,十型全出图;只取证不判图)。十型耗时带:道具首发 80s(冷)→热身后 56-168s(1:1 最快 56s/21:9 横幅最慢 168s/2.66MP 合板 160s),对照系=参数速查 FunAcc 28.8s(4步)/原生 130.7s——turbo 落 FunAcc 与原生之间,判图归用户。

'''

TEN_RECEIPTS = '''### 人物 ✅
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
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u4eba\\u7269", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u4eba\\u7269:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u793a\\u8bcd": ["400", 0],
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
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u573a\\u666f", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u573a\\u666f:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u793a\\u8bcd": ["400", 0],
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
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u9053\\u5177", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u9053\\u5177:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u793a\\u8bcd": ["400", 0],
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
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u7f8e\\u5ba3", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u7f8e\\u5ba3:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u793a\\u8bcd": ["400", 0],
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

> 块总长 34,508 字节,sha256=`43727f47793f3d122858d5a53e6790508b2cbcec674caf0f57eb8d52d2a82f21`;首段在 500 字边界截断于转义序列中属正常(\\u5411 被切为 \\u541)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u4eba\\u7269\\u591a\\u89c6\\u56fe", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u4eba\\u7269\\u591a\\u89c6\\u56fe:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u541
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

> 块总长 35,024 字节,sha256=`925753da799e5f3fa08b10c4b9e051b58176b3caebf57f3d04e43698fa977672`;首段在 500 字边界截断于转义序列中属正常(\\u63d0\\u7 s 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u9ad8\\u6e05\\u4eba\\u8138", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u9ad8\\u6e05\\u4eba\\u8138:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u7
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

> 块总长 34,934 字节,sha256=`6b3d20dbcf24b7352a17e30995729bce86754f0291c7280a8b8ae193ebba58fb`;首段在 500 字边界截断于转义序列中属正常(\\u6b63\\u5 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u5206\\u955c\\u5267\\u60c5\\u56fe", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u5206\\u955c\\u5267\\u60c5\\u56fe:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5
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

> 块总长 36,465 字节,sha256=`59545706aad863575afa61a3c952a107c163102e1ffe4e8277c5f1049c7323c1`;首段在 500 字边界截断于转义序列中属正常(\\u63d0\\u7 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u8868\\u60c5\\u5dee\\u5206", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u8868\\u60c5\\u5dee\\u5206:1792101166640229344"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u7
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

> 块总长 35,349 字节,sha256=`3617f54cb938d02419cc2367bb506f3e2631b706ae693dce0eeded4828938152`;首段在 500 字边界截断于转义序列中属正常(\\u6b63\\u5 被切)

**首 500 字:**

```
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u6982\\u5ff5\\u6c14\\u6c1b\\u56fe", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u6982\\u5ff5\\u6c14\\u6c1b\\u56fe:1792125423692247566"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5
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
{"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "\\u8bbe\\u5b9a\\u5361", "\\u900f\\u660e\\u8986\\u76d6": false}, "is_changed": ["\\u8bbe\\u5b9a\\u5361:1792125423692247566"]}, "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {"api_url": "http://192.168.0.101:1234,http://127.0.0.1:1234", "model": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-coder390", "temperature": 0.7, "max_tokens": 12000, "timeout_sec": 600, "thinking_effort": "\\u5173\\u95ed", "\\u6b63\\u5411\\u63d0\\u793a\\u8bcd":
```

**尾 500 字:**

```
", "inputs": {"noise_seed": 2029161562}}, "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}, "7:7031": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7:7017", 0], "guider": ["7:7029", 0], "sampler": ["7:7018", 0], "sigmas": ["7:7030", 0], "latent_image": ["4", 0]}}, "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7031", 0], "vae": ["3", 0]}}, "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}
```

## 附件

- 装配文快照:`/Users/zhengbingjin/Project/Github/MYStudio/apps/output/bgscope-r3-9types/设定卡-turbo1016.装配文.txt`(fire 取 history [401] 终稿真值)

---

*只取证不判图——判图归用户眼睛。收据生成:引擎管家(漫影工作流发车会话,2026-10-16;至此十型 turbo 档全部实弹完毕)。*'''

LEGACY_OLD = ("- 实弹闸全套:t2i turbo 首发实弹/十型逐型批/edit×turbo 闸发(出图质量未知);"
              "引擎重启后 /global_subgraphs 蓝图注册行为未验。")
LEGACY_NEW = ("- 实弹闸余量(落账时点 10-16):t2i 首发实弹+十型逐型批**已跑**(§七/§八收据在档,"
              "引擎经 App 重启后由引擎管家发车);余=i2i×turbo 闸发(--tier)/edit GUI 档0 默认+"
              "切档实弹;引擎 /global_subgraphs 蓝图注册行为未验;i2i 宿主 [402] 显示槽位定音"
              "(P1⑤:画布开件看 Note 显示哪份文本,供 §O 方案① 代价一锤定音)未随批执行。\n"
              "- 提交后须 workflow_gate.py --rebuild-baseline 重立布局棘轮记账(三 JSON 工作树脏"
              "在段3 显式 SKIP 不计,先例 Fix7027 记账行)。")


def fail(msg: str) -> None:
    print(f"[{CAMPAIGN}-ledger] FAIL: {msg}")
    sys.exit(1)


def main() -> None:
    ledger_txt = LEDGER.read_text(encoding="utf-8")
    receipt_txt = RECEIPT.read_text(encoding="utf-8")

    already = ("1016turbo 换臂落账" in ledger_txt
               and "收据全文如下" in receipt_txt)
    if already and "--check" not in sys.argv:
        print(f"[{CAMPAIGN}-ledger] 已落账(noop):台账头部条目+收据材料均在场")
        return

    # ── 1) 台账:行内标记验在册 + 头部前插 ──
    for marker in ("已退役(1016turbo 收口)", "208dd43250e1e01467ba190572ae2e7107a7870ec1ff026bc65f791fa1e80e95"):
        if marker not in ledger_txt:
            fail(f"台账行内标记缺失:{marker[:40]}…")
    if ledger_txt.count(LEDGER_HEAD_OLD) != 1:
        fail(f"台账头部锚非唯一(count={ledger_txt.count(LEDGER_HEAD_OLD)})")
    if ledger_txt.count(LEDGER_RECENT_OLD) != 1:
        fail(f"台账最近核账日锚非唯一(count={ledger_txt.count(LEDGER_RECENT_OLD)})")
    ledger_new = ledger_txt.replace(LEDGER_HEAD_OLD, LEDGER_HEAD_NEW, 1)
    ledger_new = ledger_new.replace(LEDGER_RECENT_OLD, LEDGER_RECENT_NEW, 1)
    if ledger_new.count("1016turbo 换臂落账") != 2:
        fail("台账前插后标记计数≠2")
    tmp = LEDGER.with_name(LEDGER.name + ".tmp-" + CAMPAIGN)
    tmp.write_text(ledger_new, encoding="utf-8")
    tmp.replace(LEDGER)
    print(f"[{CAMPAIGN}-ledger] 台账头部:最后核账→2026-10-16 前插+最近核账日 bump(2 处)")

    # ── 2) 收据:JSON sha 门 + stub 替换 ──
    jb = PROMPT_JSON.read_bytes().rstrip(b"\n")
    if hashlib.sha256(jb).hexdigest() != JSON_SHA:
        fail(f"prompt 元数据字节级副本 sha 不符(得 {hashlib.sha256(jb).hexdigest()})")
    json_line = jb.decode("utf-8")
    first = STUB7_NEW_HEAD + FIRST_RECEIPT.replace("__PROMPT_JSON__", json_line)
    ten = STUB8_NEW_HEAD + TEN_RECEIPTS

    if receipt_txt.count(STUB7) != 1:
        fail(f"§七 stub 锚非唯一(count={receipt_txt.count(STUB7)})")
    if receipt_txt.count(STUB8) != 1:
        fail(f"§八 stub 锚非唯一(count={receipt_txt.count(STUB8)})")
    if receipt_txt.count(LEGACY_OLD) != 1:
        fail(f"§九 遗留首条锚非唯一(count={receipt_txt.count(LEGACY_OLD)})")
    receipt_new = receipt_txt.replace(STUB7, first, 1)
    receipt_new = receipt_new.replace(STUB8, ten, 1)
    receipt_new = receipt_new.replace(LEGACY_OLD, LEGACY_NEW, 1)

    tmp = RECEIPT.with_name(RECEIPT.name + ".tmp-" + CAMPAIGN)
    tmp.write_text(receipt_new, encoding="utf-8")
    tmp.replace(RECEIPT)

    # ── 3) 写后复验:重读抽 fenced JSON sha + 节构 + 幂等标记 ──
    back = RECEIPT.read_text(encoding="utf-8")
    fence = "\n```\n" + json_line + "\n```"
    if fence not in back:
        fail("写后复验:JSON fenced 块未逐字在档")
    if hashlib.sha256(json_line.encode("utf-8")).hexdigest() != JSON_SHA:
        fail("写后复验:JSON sha 门不过(逻辑不可达防线)")
    for h, n in (("## 七、首发实弹收据", 1), ("## 八、十型 turbo 实弹逐型收据", 1),
                 ("# qi21-道劫-t2i · turbo 档首发实弹收据", 1),
                 ("### 人物 ✅", 1), ("### 设定卡 ✅", 1),
                 ("实弹闸余量(落账时点 10-16)", 1), ("--rebuild-baseline", 1)):
        if back.count(h) != n:
            fail(f"写后复验:节构 {h!r} 计数={back.count(h)}≠{n}")
    print(f"[{CAMPAIGN}-ledger] 收据:§七首发材料贴入(JSON sha 门过={JSON_SHA[:12]}…)+"
          f"§八十型材料贴入+§九遗留改写;doc 现 {len(back)} 字符")
    print(f"[{CAMPAIGN}-ledger] 落账完成")


if __name__ == "__main__":
    main()
