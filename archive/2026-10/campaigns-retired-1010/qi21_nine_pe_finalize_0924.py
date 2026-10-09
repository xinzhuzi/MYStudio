#!/usr/bin/env python3
"""九型 PE 实拍收官(0924):
读驱动报告 nine-pe-driver-report.json,产两件:
  ① apps/out/q21-final-0924/nine-pe-results.json —— 汇总表(shots:type/image/peExcerpt/secs/size
     + 各拍引擎取证:PE 节点耗时/heretic·PE TE 加载行/摘要 LoRA/尺寸对账);
  ② apps/out/q21-final-0924/nine-pe-grid.png —— 3x3 并排九宫格(PIL;各型画幅不同,
     等比缩放进统一格,标签=idx-型名+尺寸;禁视觉读图——拼图仅为并排存档,判读权在用户)。
用法:引擎 venv python 执行(依赖 PIL)。退出码 0=九拍齐全;1=有缺。
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPORT = Path.home() / "Project/Github/MYStudio/apps/out/q21-final-0924/nine-pe-driver-report.json"
OUT_DIR = Path.home() / "Project/Github/MYStudio/apps/out/q21-final-0924"
IMG_DIR = Path.home() / "Downloads/q21-nine-pe-0924"
TYPES = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",  # 实测本机 PIL 可开(09-23 jiuxing grid 同款)
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

CELL = 512        # 格内图区边长(等比放入)
LABEL_H = 64      # 标签栏高
BORDER = 2
GAP = 24
MARGIN = 30
BG = (247, 245, 240)
INK = (34, 34, 38)
FG = (245, 243, 238)


def load_font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    raise SystemExit(f"无可用中文字体: {FONT_CANDIDATES}")


HERETIC_TE = "qwen3vl_8b_bf16_heretic.safetensors"
PE_TE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
ENGINE_LOG = Path("/tmp/qi21-ninepe-0924/engine.log")
WS_EVENTS = Path("/tmp/qi21-ninepe-0924/ws-events.jsonl")


def posthoc_engine_log():
    """引擎日志后验:按 [MY出图][入队]→Prompt executed 分窗,逐拍取证
    heretic/PE TE 加载行(Model storage policy)+摘要 LoRA(截断容错)+执行秒数。
    驱动内两项 FAIL 为系统性假阴性(谓词过严):①摘要行 LoRA 名被 prompt_log_server
    截断成「…r256.safetenso… ×1.0」;②「heretic 加载行」实配到摘要行(加载行=Model
    storage policy 行,同窗在场)。此处按截断容错口径复验。"""
    text = ENGINE_LOG.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")
    shots, cur = [], None
    for ln in lines:
        if "[MY出图][入队]" in ln:
            if cur:
                shots.append(cur)
            pid = (re.search(r"prompt_id=([0-9a-f-]+)", ln) or [None, None])[1]
            cur = {"pid": pid, "queue_line": ln.strip()[:160], "digest": "", "heretic_policy": [], "pe_policy": [],
                   "prompt_executed": None, "switch_true": False, "seed_head": ""}
        elif cur is not None:
            if "[MY出图][摘要]" in ln and not cur["digest"]:
                cur["digest"] = ln.strip()
            if "[MY出图][全量JSON]" in ln and '"switch":true' in ln.replace(" ", ""):
                cur["switch_true"] = True
                m = re.search(r'"40:140":\{"inputs":\{"prompt":"([^"]{0,60})', ln)
                if m:
                    cur["seed_head"] = m.group(1)[:40]
            if "Model storage policy" in ln and HERETIC_TE in ln:
                cur["heretic_policy"].append(ln.strip()[:200])
            if "Model storage policy" in ln and PE_TE in ln:
                cur["pe_policy"].append(ln.strip()[:200])
            m2 = re.search(r"Prompt executed in (\d+(?:\.\d+)?) seconds", ln)
            if m2:
                cur["prompt_executed"] = float(m2.group(1))
                shots.append(cur)
                cur = None
    if cur:
        shots.append(cur)
    # 仅留 PE 开路窗(switch true);截断容错 LoRA 判定
    pe_shots = [s for s in shots if s["switch_true"]]
    for s in pe_shots:
        d = s["digest"]
        s["digestLoraV021x10"] = ("LoRA:" in d and "v0.2.1-6step-lora-r256" in d and "×1.0" in d)
        s["digestHasSteps177Link"] = "steps=['177', 0]" in d
    return pe_shots


def posthoc_ws_durations():
    """WS 事件后验:按 prompt_id 分组,executing 事件相邻转移=节点耗时。
    仪表拍(clientId=nine-pe-wsmon-0924 直排)另取 KSampler progress max=步数。"""
    if not WS_EVENTS.exists():
        return {}, None
    out = {}
    events = []
    for ln in WS_EVENTS.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            events.append(json.loads(ln))
        except Exception:
            continue
    by_pid = {}
    prog = {}
    for e in events:
        if e.get("type") == "executing" and e.get("prompt_id"):
            by_pid.setdefault(e["prompt_id"], []).append(e)
        elif e.get("type") == "progress" and e.get("prompt_id"):
            prog.setdefault(e["prompt_id"], set()).add(e.get("max"))
    for pid, evs in by_pid.items():
        evs.sort(key=lambda x: x["ts"])
        dur = {}
        for i, e in enumerate(evs):
            nxt = evs[i + 1] if i + 1 < len(evs) else None
            if not nxt:
                continue
            node = str(e.get("node"))
            if node in ("None", "null"):
                continue
            dur.setdefault(node, (nxt["ts"] - e["ts"]) / 1000)
        out[pid] = {"durations": dur, "progressMaxes": sorted(x for x in (prog.get(pid) or []) if x is not None)}
    return out, None


def main():
    if not REPORT.exists():
        raise SystemExit(f"驱动报告缺失: {REPORT}")
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    cases = {(c["idx"]): c for c in report.get("cases", [])}
    pe_log_shots = posthoc_engine_log()
    ws_durs, _ = posthoc_ws_durations()
    # WS 耗时按引擎 pid 配到各拍(caseData.pid)
    def ws_of(pid):
        if not pid:
            return None
        entry = ws_durs.get(pid) or {}
        d = entry.get("durations", {}) if entry else {}
        return {
            "peNode(40:140)": round(d["40:140"], 1) if "40:140" in d else None,
            "encode(40:142)": round(d["40:142"], 1) if "40:142" in d else None,
            "sampler(7)": round(d["7"], 1) if "7" in d else None,
        }

    shots = []
    grid_items = []
    shots_done = 0  # 后验窗口对位计数(仅统计有图的拍)
    for idx, name in enumerate(TYPES, 1):
        c = cases.get(idx)
        if not c or not c.get("image"):
            print(f"缺第{idx}型({name})出图——如实计缺", file=sys.stderr)
            shots.append({"type": name, "image": None, "peExcerpt": None,
                          "secs": None, "size": None, "error": (c or {}).get("error", "case-missing")})
            continue
        p = Path(c["image"])
        with Image.open(p) as im:
            w, h = im.size
        # 后验窗口对位:按引擎 prompt_id 精确配对(窗口序含首跑中断队列入队,按序对位会偏一)
        logwin = next((w_ for w_ in pe_log_shots if w_.get("pid") == c.get("pid")), None)
        shot = {
            "type": name,
            "image": p.name,
            "imagePath": str(p),
            "peExcerpt": c.get("peTextHead80"),
            "peTextLen": c.get("peTextLen"),
            "secs": c.get("wallSecs"),
            "size": c.get("size"),
            "execSecs": c.get("execSecs"),
            "peNodeSecs": c.get("peNodeSecs"),
            "encodeSecs": c.get("encodeSecs"),
            "samplerSecs": c.get("samplerSecs"),
            "wsNodeSecs": ws_of(c.get("pid")),
            "engineLogPosthoc": logwin and {
                "queueLine": logwin["queue_line"],
                "promptExecutedSecs": logwin["prompt_executed"],
                "hereticLoadLine": (logwin["heretic_policy"] or [None])[0],
                "peTeLoadLine": (logwin["pe_policy"] or [None])[0],
                "digestLoraV021x1.0(截断容错)": logwin["digestLoraV021x10"],
                "digestHasSteps177Link": logwin["digestHasSteps177Link"],
            },
            "bytes": c.get("bytes"),
            "engineFile": c.get("engineFile"),
            "pid": c.get("pid"),
            "engineLog": c.get("engineLog"),
        }
        shots.append(shot)
        grid_items.append((idx, name, p, w, h))

    # 仪表拍分析(九拍后由 qi21_nine_pe_instrument_0924.mjs 排;WS 定向收 per-node 事件)
    instrument = None
    inst_json = OUT_DIR / "nine-pe-instrument.json"
    if inst_json.exists():
        try:
            inst = json.loads(inst_json.read_text(encoding="utf-8"))
            ws_inst = ws_durs.get(inst.get("pid")) or {}
            instrument = {
                "purpose": inst.get("purpose"),
                "base": inst.get("base"),
                "pid": inst.get("pid"),
                "status": inst.get("status"),
                "wallSecs": inst.get("wallSecs"),
                "nodeDurations": {k: round(v, 1) for k, v in (ws_inst.get("durations") or {}).items()},
                "samplerProgressMaxes(ws 直证步数)": ws_inst.get("progressMaxes"),
                "note": inst.get("note"),
            }
        except Exception as e:
            instrument = {"error": f"仪表拍结录不可读: {e}"}

    results = {
        "task": "九型 PE 实拍(用户令「必须要用提示词增强」)",
        "engine": report.get("engine"),
        "workflow": report.get("wf"),
        "startedAt": report.get("startedAt"),
        "finishedAt": report.get("finishedAt"),
        "mode": {
            "peSwitch": "40:141 switch=true(PE 链路开路,提示词经 PE 改写后才编码)",
            "fullpower": "[30]=true 一拨全配:steps 链=6 + LoRA v0.2.1-6step-r256 在链",
            "peSeed": "[40]子图内 [140] prompt widget=「水墨国风修仙:」前缀+该型库主体句"
                      "(docs/prompts/道劫_九型主体句示例.md §1-§9 原文;任务令未列种子,依 canon 自定并报备)",
            "resolution": "画幅联动关=九型随型分辨率(MyQi21DaojieBase WIDTH/HEIGHT 直驱)",
        },
        "shots": shots,
        "instrumentShot": instrument,
        "checkCounts": {
            "pass": sum(1 for r in report.get("results", []) if r["pass"]),
            "fail": sum(1 for r in report.get("results", []) if not r["pass"]),
        },
        "knownFalseNegatives": [
            "驱动内「引擎日志[摘要]含 LoRA v0.2.1 ×1.0」逐拍 FAIL=系统性假阴性:prompt_log_server 摘要行把 LoRA 名截断为「…v0.2.1-6step-lora-r256.safetenso… ×1.0」,全名谓词必不中;后验截断容错口径见各拍 engineLogPosthoc.digestLoraV021x1.0。",
            "驱动内「heretic 主 TE 加载行」命中的是摘要行(含 heretic 文件名);真加载行=同窗「Model storage policy … paths=[…heretic…]」,后验见各拍 engineLogPosthoc.hereticLoadLine。",
            "逐节点耗时(PE 改写/编码/采样):history 不持久化 executing 事件,九拍当时未取到(WS executing 事件定向到排队浏览器 socket,旁路监听收不到);九拍仅有执行段总秒数。仪表补拍(第 1 拍排队图原样复排,clientId 定向收事件)补齐直证:PE 节点 40:140 与 KSampler 步数(progress max)见 instrumentShot。",
        ],
        "note": "文件级取证(PNG 魔数/sips/引擎日志/排队图);禁视觉读图,画质判读权在用户。",
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    out_json = OUT_DIR / "nine-pe-results.json"
    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {out_json}")

    if len(grid_items) != 9:
        print(f"仅 {len(grid_items)}/9 型有图,拼图仍拼在场件", file=sys.stderr)

    cell_w, cell_h = CELL + 2 * BORDER, LABEL_H + CELL + 2 * BORDER
    W = MARGIN * 2 + cell_w * 3 + GAP * 2
    H = MARGIN * 2 + cell_h * 3 + GAP * 2
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    font = load_font(34)

    for slot, (idx, name, p, w, h) in enumerate(grid_items):
        r, c_ = divmod(slot, 3)
        x = MARGIN + c_ * (cell_w + GAP)
        y = MARGIN + r * (cell_h + GAP)
        draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=INK, width=BORDER)
        draw.rectangle([x + BORDER, y + BORDER, x + cell_w - 1 - BORDER, y + BORDER + LABEL_H - 1], fill=INK)
        label = f"{idx}-{name} {w}x{h}"
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((x + (cell_w - tw) / 2 - bbox[0], y + BORDER + (LABEL_H - th) / 2 - bbox[1]),
                  label, font=font, fill=FG)
        im = Image.open(p).convert("RGB")
        im.thumbnail((CELL, CELL))
        px = x + BORDER + (CELL - im.size[0]) // 2
        py = y + BORDER + LABEL_H + (CELL - im.size[1]) // 2
        canvas.paste(im, (px, py))

    out_grid = OUT_DIR / "nine-pe-grid.png"
    canvas.save(out_grid, "PNG")
    print(f"saved {out_grid} ({out_grid.stat().st_size} bytes, {W}x{H})")
    return 0 if len(grid_items) == 9 else 1


if __name__ == "__main__":
    sys.exit(main())
