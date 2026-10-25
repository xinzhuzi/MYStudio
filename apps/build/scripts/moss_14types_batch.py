#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moss_14types_batch.py -- MOSS-Image 跑批器 v3（moss-win-campaign-1025 PLAN-2 §⑧）。

真源链：型文/底座/画幅/透明归属=apps/frontend/assets/studio-manuals/
art_skills/daojie_ink_guofeng/json/qi21_bases.json；晏燎十境海报指令逐字=
同目录 晏燎.json（stages.境界.<境>.海报指令）；硬锁包五段=PLAN-2 §⑦.5（ask 权威
版，禁改一字）；发车=Windows E:\\IP\\tools\\moss-1025\\moss_fire_win.py（v3 起
支持 --lora-pre/--lora-post 动态插链）；验收=引擎 venv python + PIL。

v3 增量（PLAN-2.md §⑧ 优化清单，逐条对应）：
  1. --only 型子集 / --arms 臂选择（A/B/B+/C）；矩阵账硬门=§③ 型×臂，越账 ABORT
  2. per-type 种子台账 receipts/matrix/seed_ledger.json（首调抽取写入、跨调用/
     跨进程复用；重掷更新写 reason=hand-reroll；晏燎=seed_ledger_yanliao.json）
  3. launcher 连续 2 次非耗时失败熔断（退出码≠0 或 no_output_image）→ ABORT；
     重掷失败单列不计熔断（§⑤）
  4. LoRA 预检 sha256 身份判据（§②.1 三件；件1/件4 同字节数，sha256 为唯一
     身份判据）缺件/不符=SKIPPED-ARM 显式跳账，不烧 GPU
  5. （launcher --lora-pre/--lora-post 注入，见 moss_fire_win.py v3 §④）
  6. 硬锁包五段（§⑦.5 逐字：型1 全段替换 v2 SWORD_LOCK——v2 缺「前臂等长」
     「仅此一柄」两句；型3/4/7/10 增补；型2/12 空串不加）
  7. （moss_hand_crop.py 独立新脚本，§⑦.2 两段判读命令面）
  8. summary 扩键：arm/lora_chain/hand_verdict/seed_changed_reason/identity_risk/
     vision_pending
  9. SEEN_SIZES 增补 (1088,1456)：t2i 对拍实弹已过数值门（commit e471496a
     重掷样张 1088x1456/lapvar149.36）；引擎平铺定位沿用 034e792c 三修
 10. 晏燎模式 --yanliao：十境海报指令逐字 t2i（§⑥：不加型文/底座/锁段；臂=B；
     画幅统一 1328×1776；test id yl-<NN>；prefix moss/yanliao；receipt 显式
     identity_risk 键=严格口径悬空指称句数+字数）

矩阵模式（Windows）：
  D:\\Python312\\python.exe E:\\IP\\MYStudio\\apps\\build\\scripts\\moss_14types_batch.py --only 1 --arms B
晏燎模式：
  D:\\Python312\\python.exe E:\\IP\\MYStudio\\apps\\build\\scripts\\moss_14types_batch.py --yanliao
输出：进度行 -> E:\\IP\\tmp\\logs\\moss_14types_batch.log（stdout 亦同）
汇总：E:\\IP\\tools\\moss-1025\\receipts\\matrix\\summary_matrix.json（晏燎同夹）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"E:\IP\MYStudio")
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
YANLIAO_JSON = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json"
LAUNCHER_DIR = Path(r"E:\IP\tools\moss-1025")
LAUNCHER = LAUNCHER_DIR / "moss_fire_win.py"
VENV_PY = Path(r"E:\IP\漫影工作室\comfyui\venv\Scripts\python.exe")
PY312 = Path(r"D:\Python312\python.exe")
LOG = Path(r"E:\IP\tmp\logs\moss_14types_batch.log")
ENGINE_LORAS = Path(r"E:\IP\漫影工作室\comfyui\models\loras")
MATRIX_DIR = LAUNCHER_DIR / "receipts" / "matrix"
SUMMARY_PATH = MATRIX_DIR / "summary_matrix.json"
SEED_LEDGER = MATRIX_DIR / "seed_ledger.json"
SEED_LEDGER_YL = MATRIX_DIR / "seed_ledger_yanliao.json"
# 引擎落盘实况（1025 跑批取证）：filename_prefix "moss/mtx" → ComfyUI 以 moss
# 为子目录、mtx_ 为文件名前缀 → output/moss/ 平铺 mtx_*.png（034e792c 口径沿用）
ENGINE_OUT_FLAT = Path(r"E:\IP\漫影工作室\comfyui\output\moss")
STABLE_LOW, STABLE_HIGH = 93.8, 108.3  # s/MP 前役 t2i 8 发稳定带
EXC_LIMIT = 2 * STABLE_HIGH  # 216 s/MP
# 历史已跑尺寸（新尺寸首发豁免，implement.md §T6.3）。v3 增补 (1088,1456)：
# t2i 对拍实弹已过数值门（commit e471496a，1088x1456/lapvar149.36）。
SEEN_SIZES = {(1024, 1280), (1024, 1536), (1680, 1248), (1536, 1024), (1024, 1248),
              (1088, 1456)}
BREAKER_LIMIT = 2  # 连续 2 次非耗时失败熔断（PLAN-2 §⑤/§⑧#3）

# LoRA 供应清单（PLAN-2 §②.1；sha256 为唯一身份判据——件1 与件4 字节数完全相同）
LORA_SUPPLY = {
    "moss_image_sft_banding_fix_L37-41_bf16.safetensors":
        "01329abd340dd9cf55677381a11558fe5307c7fd648f1988b441172fbbd86fd5",
    "moss_image_sft_banding_fix_L32-36_extra_bf16.safetensors":
        "7f6e43c7566b0c04ad9772cf3efdf9da973b65e242d1a384b17e8db91a6337cd",
    "moss_base_background_tweaker.safetensors":
        "e85fb5a319ffb14aef62d56746a23833ffe0c7860e44355aad9d92ab8423808b",
}
# 臂→(lora_pre, lora_post) 参数（PLAN-2 §③；DeBand 1.0 固定=README 指令位；
# Tweaker 0.5 起步（卡面域建议非卡面数据）；B+ 恒=B 链叠 extra 不叠 Tweaker（r5 定谳））
ARMS = {
    "A": ([], []),
    "B": ([("moss_image_sft_banding_fix_L37-41_bf16.safetensors", 1.0)], []),
    "C": ([("moss_image_sft_banding_fix_L37-41_bf16.safetensors", 1.0)],
          [("moss_base_background_tweaker.safetensors", 0.5)]),
    "B+": ([("moss_image_sft_banding_fix_L37-41_bf16.safetensors", 1.0),
            ("moss_image_sft_banding_fix_L32-36_extra_bf16.safetensors", 1.0)], []),
}
# 矩阵账（PLAN-2 §③ 型×臂主臂 21 发；D 臂 gated-by-EA 摘出；越账=ABORT 不烧 GPU）
MATRIX = {
    1: ("A", "B", "C"),
    2: ("A", "B", "C"),
    4: ("A", "B", "C"),
    3: ("A", "B"),
    7: ("A", "B"),
    10: ("A", "B"),
    12: ("A", "B"),
    5: ("B",),
    6: ("B",),
    8: ("B",),
    13: ("B",),
}
BPLUS_TYPES = (2, 4)  # B+ 触发承接面=型 2/4（§③/§⑦.3 判据④色带条款）
YL_W, YL_H = 1328, 1776  # 晏燎画幅 3:4@2.25MP（§⑥；OOM 降 1088×1456 由操作手改参）

# ---- 硬锁包五段（PLAN-2 §⑦.5 逐字，ask 权威版，禁改一字）----
# 出处注记（PLAN-2 §⑦.5 实核）：①「右手为」系真源「握剑手为」替换，v2 SWORD_LOCK
# 即此替换体；②「全身仅此一柄长剑」晏燎.json 0 命中，出处=本役 ask 硬锁包权威版。
LOCK_T1 = ("他右手垂持一柄笔直长剑：右手为五指实握剑柄的稳固握拳，掌心贴直柄，指节清晰可数，手指无张开悬空与错位；"
           "剑首、剑柄、剑格、剑刃至剑尖一线贯通，剑身笔直如铸，通体无一丝弧度；"
           "剑格至剑尖的剑身长度恰与他前臂至肩的距离等长；手臂与衣袖自然避让以保持剑身笔直；"
           "剑尖指向握剑手一侧的屏幕左下方；手腕与手背结构自然；全身仅此一柄长剑。")
LOCK_T3 = ("剑身自剑格至剑尖为一条完整直线，剑首、剑格、剑身与剑尖一线贯通，通体无一丝弧度；"
           "铭文沿笔直剑身排布、不使剑身弯曲；剑身两端完整入画。")
LOCK_T4 = ("他御乘的长剑剑身自剑格至剑尖为一条完整直线，任何一段无弧度，即使处于高速冲势中依然笔直；"
           "剑首、剑柄、剑格、剑刃至剑尖一线贯通；金色灵气为独立的悬浮光痕，与笔直的剑身明确分开、不使剑身弯曲；"
           "人物双手自然垂于身侧，每只手恰好五根手指，五指数量准确、指节清晰分明，手指无张开悬空与错位，手腕与手背结构自然。")
LOCK_T7 = ("剑修双手自然垂于身侧，每只手恰好五根手指，五指数量准确、指节清晰分明；"
           "长者伸出扶起的手恰好五根手指，五指数量准确、指节清晰分明，手指无张开悬空与错位，手腕与手背结构自然。")
LOCK_T10 = ("各视图人物双手空空，双臂自然垂于身侧，每只手恰好五根手指，五指数量准确、指节清晰分明；"
            "底部武器区完整武器剑身自剑格至剑尖为一条完整直线，剑首、剑格、剑身与剑尖一线贯通，通体无一丝弧度，两端完整入画；"
            "主视觉立绘腰间佩剑连鞘明显长过前臂，佩挂重量由腰间连接件承担，手部至多轻搭。")
# 锁段入 prompt（§⑦.1）：型1←人物海报；型3←道具；型4←美宣；型7←分镜剧情图；
# 型10←设定卡；型2/12 空串不加；晏燎不追加（§⑥）。
LOCK_PACKS = {1: LOCK_T1, 3: LOCK_T3, 4: LOCK_T4, 7: LOCK_T7, 10: LOCK_T10}

# 主体句（v2 grill 定稿保留；型1 仅环境句——引导语「他右手垂持一柄笔直长剑：」归
# 锁段首，拼接防重不重复（PLAN-2 §⑦.5））。序号=qi21_bases.json types 下标+1。
SUBJECTS = {
    1: "青年剑修全身立绘，玄青道袍束发戴冠，站姿挺拔，全身完整入画，纯白简洁底色。",
    2: "云海之上的上古剑冢，万千断剑插满黑色山岩，雾气缭绕，雪后清晨冷色调，人眼平视广角空镜",
    3: "一柄青铜古剑水平居中平放，剑身铭文泛幽蓝灵光，正侧面平视单件器物，纯白简洁底色",
    4: "修仙大战史诗场面，青年剑修御剑冲向天际巨影，金色灵气撕裂乌云，电影级横向构图",
    5: "同一青年剑修设定图，左侧一幅较大头肩特写，右侧正面、正九十度侧面、背面三幅全身像并排等宽等高，服装结构逐项一致，纯白简洁底色",
    6: "青年剑修面部特写，剑眉星目面容坚毅，皮肤质感细腻，柔和正面光，纯白简洁底色",
    7: "雨夜山门前青年剑修单膝跪地，长者伸手扶起，雨水沿屋檐滴落，单格叙事电影感",
    8: ("青年剑修面部九宫格表情差分，三行三列，自左上至右下依次为平静（眉平唇闭）、怒目（眉竖目睁嘴角下压）、"
        "咧笑（眉展眼弯嘴角上扬）、蹙眉（眉心聚拢唇抿）、垂泪（眼睑低垂眼角湿润）、咬牙（唇紧齿咬颊紧）、"
        "惊愕（眉扬目圆唇张）、睥睨（眼睑半掩目光斜上）、失神（目光涣散唇微启），九格取景一致，纯白简洁底色"),
    9: "夜半时分幽暗洞窟深处一盏青灯，孤独寂静情绪，暗部留白，焦点色仅灯火青蓝与暖橙",
    10: "炼气期青年剑修完整角色设定板，主视觉立绘加正侧背三视图，横排五枚圆形色样与来源资料栏，横向排版，纯白简洁底色",
    11: "修仙者洞府室内立体剖面，等距微缩，整石凿成的修炼室，丹炉蒲团灵泉布局清晰",
    12: "青年剑修统一人脸基准底版，剑眉星目面容坚毅（与高清人脸同锚保跨图同脸），光洁的头颅，取景止颈根，严格正面对称，纯白简洁底色",
    13: "青年剑修全身素体定妆底版，零衣物零配饰零鞋履，发型依型文（草绳高束成髻），标准直立站姿，纯白简洁底色",
    14: "一株发光灵草生长在悬浮石台上，夜色，萤光点点",
}
FREE_INDEX = 14  # types[13] zh=自由：仅主体句，无型文无底座

_transparent_re = re.compile(r"[^。；\n]*透明[^。；\n]*[。；]?")
# 严格口径悬空指称句（PLAN-2 §⑥：句含「画中人物」=t2i 无参考图时真正无操作的指称）


def log(msg: str) -> None:
    safe = msg.encode("ascii", "backslashreplace").decode("ascii")
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), safe)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def parse_ratio(text: str) -> float:
    m = re.search(r"(\d+)\s*:\s*(\d+)", text or "")
    if not m:
        raise ValueError("bad aspect_ratio: %r" % (text,))
    return int(m.group(1)) / int(m.group(2))


def size_for(mp: float, ratio: float) -> tuple[int, int]:
    area = mp * 1024 * 1024
    w = max(16, int(round(math.sqrt(area * ratio) / 16)) * 16)
    h = max(16, int(round(math.sqrt(area / ratio) / 16)) * 16)
    return w, h


def strip_transparent_sentences(text: str) -> tuple[str, list[str]]:
    """剥离型文中的中文透明声明句（契约口径：透明开剔除；本批链路无 alpha）。"""
    kept, stripped = [], []
    for seg in re.split(r"(?<=[。；])", text or ""):
        seg = seg.strip()
        if not seg:
            continue
        if "透明" in seg and ("底图" in seg or "背景" in seg or "通道" in seg):
            stripped.append(seg)
        else:
            kept.append(seg)
    return "".join(kept), stripped


def strict_identity_risk(prompt: str) -> dict:
    """晏燎 identity_risk=严格口径（PLAN-2 §⑥）：句含「画中人物」的悬空指称
    句数+字数；r3 双口径的严格侧，宽松口径不入账。"""
    sents = [s for s in re.split(r"(?<=[。；])", prompt) if "画中人物" in s]
    return {"strict_sentences": len(sents),
            "strict_chars": sum(len(s) for s in sents)}


def assemble_subject(type_id: int) -> str:
    """主体句+锁段拼接（§⑦.1/§⑦.5）。型1=环境句+锁段（引导语在锁段首，防重）；
    型3/4/7/10=主体句+「。」接锁段（主体句无句末标点，「。」为装配连接符，
    锁段本身逐字未动）；型2/12 及其余=主体句原样。"""
    subject = SUBJECTS[type_id]
    lock = LOCK_PACKS.get(type_id, "")
    if not lock:
        return subject
    if subject.endswith("。") or subject.endswith("；"):
        return subject + lock
    return subject + "。" + lock


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def precheck_loras(names: set[str]) -> dict:
    """LoRA 预检（PLAN-2 §⑧#4）：引擎 loras 夹逐件 sha256 身份判据对拍 §②.1。"""
    state = {}
    for name in sorted(names):
        expect = LORA_SUPPLY.get(name)
        p = ENGINE_LORAS / name
        if expect is None:
            state[name] = {"ok": False, "detail": "not in supply table"}
        elif not p.exists():
            state[name] = {"ok": False, "detail": "missing in engine loras dir"}
        else:
            got = sha256_file(p)
            ok = got.lower() == expect.lower()
            state[name] = {"ok": ok,
                           "detail": ("sha256 match" if ok else
                                      "sha256 MISMATCH got=%s" % got)}
        log("lora precheck %s: %s" % (name, state[name]["detail"]))
    return state


def arm_ready(arm: str, lora_state: dict) -> bool:
    pre, post = ARMS[arm]
    return all(lora_state.get(n, {}).get("ok") for n, _s in pre + post)


def load_ledger(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            log("seed ledger parse error, starting fresh: %s" % path.name)
    return {}


def ledger_seed(ledger_path: Path, key: str, reroll: bool = False,
                reason: str | None = None, dry_run: bool = False) -> tuple[int, bool]:
    """种子台账（PLAN-2 §③/§⑧#2）：首调抽取写入、跨调用/跨进程复用；重掷更新
    写 reason（hand-reroll）。返回 (seed, fresh)；dry_run 只读不写。"""
    data = load_ledger(ledger_path)
    ent = data.get(key)
    if ent and not reroll:
        return int(ent["seed"]), False
    seed = int.from_bytes(os.urandom(4), "big") % 2**31
    if dry_run:
        log("dry-run: ledger seed for %s would be drawn+written (not persisted)" % key)
        return seed, True
    data[key] = {"seed": seed,
                 "updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                 "reason": reason or ("hand-reroll" if reroll else "first-draw")}
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(data, ensure_ascii=False, indent=1),
                           encoding="utf-8")
    return seed, True


def engine_health() -> dict:
    """Step 0 前置：queue 空 + SLG 节点在册（双实例并存时确认活实例健康）。"""
    import urllib.request
    out = {"queue_empty": None, "slg_node": None}
    try:
        with urllib.request.urlopen("http://127.0.0.1:17000/queue", timeout=15) as r:
            q = json.loads(r.read().decode("utf-8"))
        out["queue_empty"] = not (q.get("queue_running") or q.get("queue_pending"))
    except Exception as e:
        out["queue_error"] = str(e)[:150]
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:17000/object_info/SkipLayerGuidanceDiTSimple", timeout=15) as r:
            out["slg_node"] = bool(json.loads(r.read().decode("utf-8")))
    except Exception as e:
        out["slg_error"] = str(e)[:150]
    return out


def verify_image(path: Path) -> dict:
    """验收算法与前役 moss_verify_win.py 逐字同口径（numpy 全量 4 邻域拉普拉斯核
    方差 + alpha 全量占比），另补四角底色取样；venv python 含 numpy/PIL。"""
    code = (
        "import json,sys,os;import numpy as np;from PIL import Image;"
        "im=Image.open(sys.argv[1]);w,h=im.size;mode=im.mode;"
        "a=im.convert('RGBA');arr=np.asarray(a,dtype=np.uint8);"
        "alpha_ratio=float((arr[:,:,3]<255).mean());"
        "corners=[tuple(int(x) for x in arr[y,x,:3]) for y,x in ((3,3),(3,w-4),(h-4,3),(h-4,w-4))];"
        "g=np.asarray(im.convert('L'),dtype=np.float64);gp=np.pad(g,1,mode='edge');"
        "lap=(gp[:-2,1:-1]+gp[2:,1:-1]+gp[1:-1,:-2]+gp[1:-1,2:]-4.0*gp[1:-1,1:-1]);"
        "lapvar=float(lap.var());"
        "print(json.dumps({'w':w,'h':h,'mode':mode,'alpha_pct':round(alpha_ratio*100,2),"
        "'corners':corners,'lapvar':round(lapvar,2)}))"
    )
    out = subprocess.run([str(VENV_PY), "-c", code, str(path)],
                         capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        return {"error": (out.stderr or "")[-300:]}
    return json.loads(out.stdout.strip().splitlines()[-1])


def _looks_pseudo(img_path: Path, v: dict) -> bool:
    """伪透明 spot-check（启发式，如实记录供目检复核）：alpha≈0 且四角同色且
    lapvar 显著偏高（棋盘格/灰阶伪透明纹嫌疑）。"""
    try:
        corners = v.get("corners", [])
        same = len({tuple(c) for c in corners}) <= 2
        return bool(same and v.get("lapvar", 0) > 400)
    except Exception:
        return False


def _lora_cli_args(arm: str) -> list[str]:
    """臂→launcher --lora-pre/--lora-post 实参（§③/§④；'name@strength' 逗号串）。"""
    pre, post = ARMS[arm]
    args: list[str] = []
    if pre:
        args += ["--lora-pre", ",".join("%s@%s" % (n, s) for n, s in pre)]
    if post:
        args += ["--lora-post", ",".join("%s@%s" % (n, s) for n, s in post)]
    return args


def find_image_and_receipt(test_id: str, entry: dict) -> tuple[Path | None, dict | None]:
    """产物定位（034e792c 三修沿用）：receipt 实名键 files -> collect 位 ->
    引擎平铺兜底；并从 receipt 提取 lora_chain 键。"""
    img_path = None
    rcpt = None
    cands = sorted(LAUNCHER_DIR.glob("receipts/%s*.json" % test_id),
                   key=lambda p: p.stat().st_mtime)
    if cands:
        rcpt = cands[-1]
    rj: dict = {}
    if rcpt is not None:
        entry["receipt"] = rcpt.name
        try:
            rj = json.loads(rcpt.read_text(encoding="utf-8"))
            files = rj.get("files") or rj.get("outputs") or rj.get("images") or []
            if files and isinstance(files, list):
                fn = files[0].get("filename") if isinstance(files[0], dict) else files[0]
                if fn:
                    img_path = ENGINE_OUT_FLAT / str(fn)
        except Exception as e:
            entry["receipt_parse_error"] = str(e)[:200]
    if img_path is None or not img_path.exists():
        launcher_out = LAUNCHER_DIR / "out" / test_id
        cands = sorted(launcher_out.glob("*.png"), key=lambda p: p.stat().st_mtime) if launcher_out.exists() else []
        img_path = cands[-1] if cands else img_path
    if img_path is None or not img_path.exists():
        cands = sorted(ENGINE_OUT_FLAT.glob("%s_*.png" % test_id),
                       key=lambda p: p.stat().st_mtime) if ENGINE_OUT_FLAT.exists() else []
        img_path = cands[-1] if cands else None
    return img_path, rj


def fire_one(test_id: str, prompt_file: Path, w: int, h: int, seed: int,
             prefix: str, arm: str) -> tuple[bool, str, float, dict | None, Path | None]:
    """单发（launcher v3）。返回 (ok, fail_signature, wall_s, receipt_json|None,
    image_path|None)。"""
    cmd = [str(PY312), str(LAUNCHER), "--workflow", "moss-t2i.json", "--test", test_id,
           "--prompt-file", str(prompt_file), "--width", str(w), "--height", str(h),
           "--seed", str(seed), "--lora", "on", "--prefix", prefix] + _lora_cli_args(arm)
    log("fire %s %dx%d seed=%d arm=%s lora_args=%s" %
        (test_id, w, h, seed, arm, _lora_cli_args(arm) or "-"))
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(LAUNCHER_DIR), capture_output=True,
                       text=True, timeout=2400)
    wall = time.time() - t0
    if r.returncode != 0:
        return False, ("launcher_exit_%d: " % r.returncode) + (r.stdout or "")[-200:] + (r.stderr or "")[-200:], wall, None, None
    entry_probe: dict = {}
    img_path, rj = find_image_and_receipt(test_id, entry_probe)
    if img_path is None or not img_path.exists():
        return False, "no_output_image", wall, (rj or None), None
    return True, "", wall, (rj or {}), img_path


def post_verify(img_path: Path, test_id: str, w: int, h: int, wall: float,
                entry: dict) -> bool:
    """验收+记账（alpha 三态/lapvar）。返回 time_exc；STOP-LINE 计数归调用方。"""
    entry["image"] = img_path.name
    entry["bytes"] = img_path.stat().st_size
    v = verify_image(img_path)
    entry["verify"] = v
    if "error" in v:
        log("verify %s error: %s" % (test_id, v["error"][:120]))
        entry["status"] = "verify-error"
        return False
    mp = (w * h) / (1024 * 1024)
    s_per_mp = wall / mp
    entry["s_per_mp"] = round(s_per_mp, 1)
    exc = s_per_mp > EXC_LIMIT
    entry["time_exc"] = exc
    lap = v.get("lapvar", 0)
    alpha_pct = v.get("alpha_pct", 0.0)
    if entry.get("rgba") and alpha_pct > 1.0:
        entry["alpha_state"] = "transparent-pass"
    elif _looks_pseudo(img_path, v):
        entry["alpha_state"] = "pseudo-transparency-artifact"
    else:
        entry["alpha_state"] = "alpha-missing"
        entry["corners"] = v.get("corners")
    if lap < 30:
        entry["low_detail"] = True
    # PLAN-2 §⑨ 门2 r3 注记：B/C 臂含 DeBand=平滑化，lapvar<100 告警不作劣化
    # 判据仅记录；<30 硬废命中附疑似过度平滑注记候目检复核，不自动判废。
    if lap < 30 and entry.get("arm") in ("B", "B+", "C"):
        entry["note"] = "suspected-over-smoothing (DeBand arm, lapvar<30) -- pending visual recheck"
    entry["status"] = "pass"
    entry["hand_verdict"] = None      # §⑦ 判读归审判员，本器不判
    entry["vision_pending"] = None
    log("done %s wall=%.0fs %.1f s/MP exc=%s lapvar=%s alpha=%s%% state=%s" % (
        test_id, wall, s_per_mp, exc, lap, alpha_pct, entry["alpha_state"]))
    return exc


def run_matrix(args) -> int:
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    types = bases["types"]
    style_base = (bases.get("art_style_base") or {}).get("positive_text", "")
    assert len(types) == 14, "expect 14 types, got %d" % len(types)
    arms = [a.strip() for a in (args.arms or "A").split(",") if a.strip()]
    for a in arms:
        if a not in ARMS:
            log("ABORT: unknown arm %r (valid: %s)" % (a, ",".join(ARMS)))
            return 2
    only = [int(x) for x in args.only.split(",")] if args.only else sorted(MATRIX)
    # 矩阵账硬门（PLAN-2 §③/§⑦.3：超账即停）
    jobs: list[tuple[int, str]] = []
    for t in only:
        if t not in MATRIX:
            log("ABORT: type %d not in matrix (PLAN-2 §③) -- 超账即停" % t)
            return 2
        for a in arms:
            if a == "B+":
                if t not in BPLUS_TYPES:
                    log("ABORT: arm B+ only allowed for types %s, got type %d"
                        % (BPLUS_TYPES, t))
                    return 2
            elif a not in MATRIX[t]:
                log("ABORT: (%d,%s) outside matrix (PLAN-2 §③) -- 超账即停" % (t, a))
                return 2
            jobs.append((t, a))
    if not jobs:
        log("ABORT: empty job list")
        return 2
    # LoRA 预检（sha256 身份判据；缺件 SKIPPED-ARM 显式跳账，不烧 GPU）
    need_files: set[str] = set()
    for a in arms:
        pre, post = ARMS[a]
        need_files.update(n for n, _ in pre + post)
    lora_state = precheck_loras(need_files)
    ok_arms = [a for a in arms if arm_ready(a, lora_state)]
    skipped_arms = [a for a in arms if a not in ok_arms]
    if skipped_arms:
        log("SKIPPED-ARMS: %s (lora precheck fail)" % ",".join(skipped_arms))
    summary = []
    log("batch start: %d jobs arms=%s style_base %d chars"
        % (len(jobs), ",".join(arms), len(style_base)))
    for i, t in enumerate(types, 1):
        if t not in only:
            continue
        w, h = size_for(float(t.get("megapixels", 1.0)), parse_ratio(t.get("aspect_ratio", "")))
        log("plan %02d %-6s %dx%d rgba=%s arms=%s" %
            (i, t.get("zh", "?"), w, h, bool(t.get("rgba_default")), MATRIX.get(i, ())))

    reroll = set(int(x) for x in args.reroll_types.split(",")) if args.reroll_types else set()
    consecutive_fail = 0
    consecutive_exc = 0
    stop_line = False
    for t, arm in jobs:
        if arm not in ok_arms:
            missing = [n for n, _ in ARMS[arm][0] + ARMS[arm][1] if not lora_state.get(n, {}).get("ok")]
            entry = {"id": t, "arm": arm, "status": "SKIPPED-ARM",
                     "detail": "lora precheck fail: %s" % missing}
            summary.append(entry)
            log("skip %02d arm=%s (lora %s)" % (t, arm, missing))
            continue
        zh = types[t - 1].get("zh", "?")
        w, h = size_for(float(types[t - 1].get("megapixels", 1.0)),
                        parse_ratio(types[t - 1].get("aspect_ratio", "")))
        body, stripped = strip_transparent_sentences(types[t - 1].get("positive_text", "") or "")
        if stripped:
            log("strip %02d: %d sentence(s) removed" % (t, len(stripped)))
        subject = assemble_subject(t)
        parts = [subject, body]
        if style_base:
            parts.append(style_base)
        prompt = "\n".join(p for p in parts if p)
        prompt_file = MATRIX_DIR / ("prompt_%d_%s.txt" % (t, arm))
        if not args.dry_run:
            MATRIX_DIR.mkdir(parents=True, exist_ok=True)
            prompt_file.write_text(prompt, encoding="utf-8")
        seed, fresh = ledger_seed(SEED_LEDGER, str(t), reroll=(t in reroll),
                                  dry_run=args.dry_run)
        test_id = "mtx-%d-%s" % (t, arm)
        new_size = (w, h) not in SEEN_SIZES
        entry = {"id": t, "zh": zh, "arm": arm, "w": w, "h": h, "seed": seed,
                 "seed_fresh": fresh, "seed_changed_reason": ("hand-reroll" if t in reroll else None),
                 "rgba": bool(types[t - 1].get("rgba_default")),
                 "stripped": len(stripped), "new_size": new_size,
                 "lora_pre": ARMS[arm][0], "lora_post": ARMS[arm][1],
                 "hand_verdict": None, "vision_pending": None}
        if args.dry_run:
            entry["status"] = "dry-run"
            summary.append(entry)
            log("dry-run %s assembled %d chars prompt (not fired, not persisted)"
                % (test_id, len(prompt)))
            continue

        ok, fail_sig, wall, rj, img_path = fire_one(test_id, prompt_file, w, h,
                                                    seed, "moss/mtx", arm)
        entry["wall_s"] = round(wall, 1)
        if rj and isinstance(rj, dict):
            entry["lora_chain"] = rj.get("lora_chain")
        if not ok:
            entry["fail_signature"] = fail_sig
            entry["status"] = "fail"
            if t in reroll:
                entry["status"] = "reroll-fail"  # §⑤：重掷失败不计熔断，单列
                log("fire %s FAILED (reroll, not counted in breaker)" % test_id)
            else:
                consecutive_fail += 1
                log("fire %s FAILED (%d/%d consecutive non-time failures)"
                    % (test_id, consecutive_fail, BREAKER_LIMIT))
            summary.append(entry)
            if consecutive_fail >= BREAKER_LIMIT:
                log("ABORT: launcher circuit breaker (%d consecutive non-time failures)"
                    % consecutive_fail)
                break
            continue
        consecutive_fail = 0
        exc = post_verify(img_path, test_id, w, h, wall, entry)  # type: ignore[arg-type]
        # 耗时门（implement.md §T6.3 沿用）：新尺寸首发豁免；非豁免连续 2 发=停线
        if exc and not new_size:
            consecutive_exc += 1
        else:
            consecutive_exc = 0
        summary.append(entry)
        if consecutive_exc >= 2:
            log("STOP-LINE: 2 consecutive non-exempt time exceptions")
            stop_line = True
            break
        _write_summary(summary)
    _write_summary(summary)
    npass = sum(1 for s in summary if s.get("status") == "pass")
    log("batch end: %d/%d pass%s" % (npass, len(summary),
                                     " (STOP-LINE)" if stop_line else ""))
    return 0


def run_yanliao(args) -> int:
    """晏燎十境海报批次（PLAN-2 §⑥）：真源原文逐字 t2i，不加型文/底座/锁段；
    臂=B（DeBand@1.0）；1328×1776；test id yl-<NN>；prefix moss/yanliao；
    种子台账 seed_ledger_yanliao.json；receipt 显式 identity_risk。"""
    rj = json.loads(YANLIAO_JSON.read_text(encoding="utf-8"))
    jing = rj["stages"]["境界"]
    realms = sorted(jing.keys(), key=lambda k: int(str(k).split(".")[0]))
    need = {"moss_image_sft_banding_fix_L37-41_bf16.safetensors"}
    lora_state = precheck_loras(need)
    if not all(v.get("ok") for v in lora_state.values()):
        log("ABORT: yanliao arm B requires DeBand L37-41 in place (precheck fail)")
        return 2
    summary = []
    log("yanliao start: %d realms, %dx%d, arm B, prompts verbatim (no base/lock)"
        % (len(realms), YL_W, YL_H))
    consecutive_fail = 0
    for idx, key in enumerate(realms, 1):
        prompt = jing[key].get("海报指令", "")
        if not prompt:
            log("ABORT: realm %s lacks 海报指令" % key)
            return 2
        identity_risk = strict_identity_risk(prompt)
        prompt_file = MATRIX_DIR / ("prompt_yl_%02d.txt" % idx)
        if not args.dry_run:
            MATRIX_DIR.mkdir(parents=True, exist_ok=True)
            prompt_file.write_text(prompt, encoding="utf-8")
        seed, fresh = ledger_seed(SEED_LEDGER_YL, key, dry_run=args.dry_run)
        test_id = "yl-%02d" % idx
        entry = {"id": idx, "realm": key, "arm": "B", "w": YL_W, "h": YL_H,
                 "seed": seed, "seed_fresh": fresh, "prompt_chars": len(prompt),
                 "identity_risk": identity_risk, "hand_verdict": None,
                 "vision_pending": None,
                 "lora_pre": ARMS["B"][0], "lora_post": ARMS["B"][1]}
        if args.dry_run:
            entry["status"] = "dry-run"
            summary.append(entry)
            log("dry-run %s realm=%s prompt %d chars strict_risk=%s (not fired)"
                % (test_id, key, len(prompt), identity_risk))
            continue
        ok, fail_sig, wall, rec, img_path = fire_one(test_id, prompt_file, YL_W, YL_H,
                                                     seed, "moss/yanliao", "B")
        entry["wall_s"] = round(wall, 1)
        if rec and isinstance(rec, dict):
            entry["lora_chain"] = rec.get("lora_chain")
        if not ok:
            entry["fail_signature"] = fail_sig
            entry["status"] = "fail"
            consecutive_fail += 1
            summary.append(entry)
            log("fire %s FAILED (%d/%d)" % (test_id, consecutive_fail, BREAKER_LIMIT))
            if consecutive_fail >= BREAKER_LIMIT:
                log("ABORT: launcher circuit breaker")
                break
            continue
        consecutive_fail = 0
        mp = (YL_W * YL_H) / (1024 * 1024)
        if img_path is None or not img_path.exists():
            entry["status"] = "fail"
            entry["fail_signature"] = "no_output_image"
            summary.append(entry)
            continue
        entry["image"] = img_path.name
        entry["bytes"] = img_path.stat().st_size
        v = verify_image(img_path)
        entry["verify"] = v
        if "error" in v:
            entry["status"] = "verify-error"
            summary.append(entry)
            continue
        entry["s_per_mp"] = round(wall / mp, 1)
        entry["time_exc"] = entry["s_per_mp"] > EXC_LIMIT
        lap = v.get("lapvar", 0)
        entry["alpha_state"] = ("transparent-pass" if v.get("alpha_pct", 0) > 1.0
                                else ("pseudo-transparency-artifact" if _looks_pseudo(img_path, v)
                                      else "alpha-missing"))
        if entry["alpha_state"] == "alpha-missing":
            entry["corners"] = v.get("corners")
        entry["status"] = "pass"
        # §⑥：晏燎 hand-fail 只判不掷（记 hand-fail-not-rerolled 由判读侧落键）
        log("done %s realm=%s wall=%.0fs %.1f s/MP lapvar=%s alpha=%s%%" % (
            test_id, key, wall, wall / mp, lap, v.get("alpha_pct", 0.0)))
        summary.append(entry)
        _write_summary(summary)
    _write_summary(summary)
    npass = sum(1 for s in summary if s.get("status") == "pass")
    log("yanliao end: %d/%d pass" % (npass, len(summary)))
    return 0


def _write_summary(summary: list) -> None:
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)


def main() -> int:
    ap = argparse.ArgumentParser(description="MOSS batch runner v3 (PLAN-2)")
    ap.add_argument("--only", default=None,
                    help="comma-separated type ids (e.g. 1,2,3); default=all matrix types")
    ap.add_argument("--arms", default="A",
                    help="comma-separated arms A,B,B+,C (default A)")
    ap.add_argument("--reroll-types", default=None,
                    help="comma-separated type ids to re-draw seeds (reason=hand-reroll)")
    ap.add_argument("--yanliao", action="store_true",
                    help="yanliao 10-realm poster batch (PLAN-2 §6)")
    ap.add_argument("--dry-run", action="store_true",
                    help="assemble+precheck only: no fire, no ledger/prompt writes")
    args = ap.parse_args()
    health = engine_health()
    log("engine health: %s" % json.dumps(health))
    if not health.get("queue_empty") or not health.get("slg_node"):
        log("ABORT: engine not healthy (queue_empty=%s slg=%s) -- resolve dual-instance/node state first"
            % (health.get("queue_empty"), health.get("slg_node")))
        return 2
    return run_yanliao(args) if args.yanliao else run_matrix(args)


if __name__ == "__main__":
    sys.exit(main())
