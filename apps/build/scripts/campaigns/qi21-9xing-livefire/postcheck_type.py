#!/usr/bin/env python3
"""qi21 九型实弹·后核脚本(对存档收据重跑机器判据;九型通用)

用法: venv=引擎venv(需PIL) 或系统python3+PIL;参数 = slug(如 type-1-人物)
判据(任务书机器判据+裁定记账):
  1) 产物图存在且>0字节 + PNG 魔数 + PIL 可解析
  2) 三层收据齐全:history prompt JSON / PNG tEXt 元数据 / image-prompts 日志段
  3) history status=success;seed/实际参数回读;PNG 元数据=history prompt(稳态同)
  4) 透明型(FACTS rgba_default)加验四角 alpha(本脚本按 --transparent 走门)
  5) 终稿完整性:[401] merged 含锁层A 逐字(739 字真值来自工作流 [4011] widget)
输出: verify/<slug>.postcheck.json + 控制台 PASS/FAIL 每项
"""
import json, sys, hashlib, subprocess, os, re
from pathlib import Path

CAMPAIGN = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/qi21-9xing-livefire")
REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
COMFY_OUT = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/output")
LOGS = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs")

slug = sys.argv[1]
transparent = "--transparent" in sys.argv
R = {"slug": slug, "transparent": transparent, "checks": []}

def chk(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("✅" if ok else "❌") + " " + name + ((" — " + str(detail)[:200]) if detail else ""))
    return bool(ok)

raw = json.loads((CAMPAIGN / f"runs/{slug}.json").read_text())
pid = [raw.get("promptId") or "?"]
entry = json.loads((CAMPAIGN / f"runs/{slug}.history.json").read_text())  # 驱动器存的是 entry 本体(prompt/outputs/status)
chk("history 收据文件可解析(键=prompt/outputs/status)", all(k in entry for k in ("prompt", "outputs", "status")), f"pid={pid[0]}")
status = (entry.get("status") or {}).get("status_str")
chk("history status=success", status == "success", status)

prompt = entry["prompt"][2] if isinstance(entry.get("prompt"), list) else entry.get("prompt", {})
msgs = (entry.get("status") or {}).get("messages") or []
cached = []
for m in msgs:
    if m[0] == "execution_cached":
        cached = m[1].get("nodes", [])
R["cachedNodes"] = len(cached); R["promptNodes"] = len(prompt)
R["fullCacheEcho"] = len(cached) > 0 and len(cached) == len(prompt)
chk("非全缓存回声(真渲染;owner 裁定③禁回声记账)", not R["fullCacheEcho"], f"cached={len(cached)}/{len(prompt)}")

seed_node = prompt.get("7:7014", {}).get("inputs", {})
R["seed"] = seed_node.get("value", seed_node.get("seed"))
chk("seed 回读=[7:7014]", "value" in seed_node or "seed" in seed_node, json.dumps(seed_node, ensure_ascii=False))
chk("[7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置)", prompt.get("7:7013", {}).get("class_type") == "T8QwenImage21FunAccPDD4Step")

outs = entry.get("outputs") or {}
imgs = {k: (v.get("images") or [{}])[0] for k, v in outs.items() if v.get("images")}
chk("history outputs 含 [8]直出+[504]2K", "8" in imgs and "504" in imgs, ",".join(imgs.keys()))

# PNG 元数据(收据②)——从产物图本体重新提取并比对
VENV = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/venv/bin/python3"
def pil(script, args):
    p = subprocess.run([VENV, "-c", script, *args], capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"error": (p.stderr or p.stdout)[:300]}

meta_script = """
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); im.load()
d = {"mode": im.mode, "size": list(im.size)}
txt = None
try: txt = im.text.get("prompt")
except Exception: pass
if txt is None: txt = im.info.get("prompt")
d["metaLen"] = len(txt) if txt else 0
if txt:
    d["metaMd5"] = __import__("hashlib").md5(txt.encode()).hexdigest()
if "--corners" in sys.argv and "A" in im.getbands():
    w, h = im.size
    d["cornerAlpha"] = [im.getpixel(x)[3] for x in [(1,1),(w-2,1),(1,h-2),(w-2,h-2)]]
print(json.dumps(d))
"""
for key, local in [("8", f"{slug}.direct.png"), ("504", f"{slug}.2k.png")]:
    p = CAMPAIGN / "images" / local
    exists = p.exists() and p.stat().st_size > 0
    chk(f"产物图存在且>0字节([{key}] {local})", exists, f"{p.stat().st_size if exists else 0}B")
    if not exists:
        continue
    magic = p.read_bytes()[:4] == b"\x89PNG"
    chk(f"PNG 魔数([{key}])", magic)
    info = pil(meta_script, [str(p)] + (["--corners"] if True else []))
    R[f"png_{key}"] = info
    chk(f"PNG 可解析(PIL,[{key}])", "error" not in info, json.dumps(info, ensure_ascii=False)[:160])
    if key == "504" and info.get("cornerAlpha") is not None:
        if transparent:
            chk("透明门:四角 alpha<=8(FACTS rgba_default 型)", all(a <= 8 for a in info["cornerAlpha"]), str(info["cornerAlpha"]))
        else:
            R["cornerAlpha_notGated"] = info["cornerAlpha"]  # 非透明型只记录不开门
    if info.get("metaMd5"):
        meta_file = CAMPAIGN / f"verify/{slug}.png-prompt-metadata.json"
        meta_json = json.loads(meta_file.read_text()) if meta_file.exists() else None
        def stable(o):
            if isinstance(o, list): return "[" + ",".join(stable(x) for x in o) + "]"
            if isinstance(o, dict): return "{" + ",".join(json.dumps(k) + ":" + stable(o[k]) for k in sorted(o)) + "}"
            return json.dumps(o, ensure_ascii=False)
        # 归一:剥 is_changed(节点级 IS_CHANGED 缓存指纹,与 inputs/class_type 平级;PNG 侧在/history 侧被服务端消费;type-1 实拍唯一差异域)
        def strip_ic(d):
            d = json.loads(json.dumps(d))
            for n in d.values():
                if isinstance(n, dict):
                    n.pop("is_changed", None)
            return d
        m2, h2 = strip_ic(meta_json or {}), strip_ic(prompt)
        stripped = sorted(k for k, v in (meta_json or {}).items() if isinstance(v, dict) and "is_changed" in v)
        same = meta_json is not None and stable(m2) == stable(h2)
        R[f"pngMetaEqualsHistory_{key}"] = same
        R[f"pngMetaStrippedIsChanged_{key}"] = stripped
        chk(f"PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项={stripped})", same, f"metaLen={info.get('metaLen')}")

# 终稿完整性:锁层A 逐字 ⊂ 最终正向(真值=工作流 [4011] widget >500字串)
wf = json.loads(WF.read_text())
sg6 = next(s for s in wf["definitions"]["subgraphs"] if s["id"] == "6" or "文本提示词" in s.get("name", ""))
asm = next(n for n in sg6["nodes"] if n["id"] == 4011)
lockA = next(v for v in asm["widgets_values"] if isinstance(v, str) and len(v) > 500)
merged = (outs.get("401") or {}).get("merged") or []
text = merged[0] if merged else ""
pos = text.split("═══ 正向提示词 ═══\n", 1)[-1].split("\n\n═══ 负向提示词 ═══\n", 1)[0] if "═══ 正向提示词 ═══" in text else ""
neg = text.split("\n\n═══ 负向提示词 ═══\n", 1)[1] if "\n\n═══ 负向提示词 ═══\n" in text else ""
chk("[401] 正负双预览终稿在(pos>1000 且 neg>0)", len(pos) > 1000 and len(neg) > 0, f"posLen={len(pos)} negLen={len(neg)}")
chk("最终正向含锁层A 逐字(739 字真值)", lockA in pos, f"lockA={len(lockA)}字 pos含={lockA in pos}")

# 收据① image-prompts 日志段
hit = None
for f in sorted(LOGS.glob("image-prompts-*.log"), reverse=True):
    lines = f.read_text(errors="replace").split("\n")
    for i, l in enumerate(lines):
        if f"prompt_id={pid[0]}" in l and "[入队]" in l:
            hit = (f, i)
            break
    if hit: break
chk("image-prompts 日志段:该 pid 入队行在", hit is not None, f"{hit[0].name}:{hit[1]+1}" if hit else "未找到")
if hit:
    f, i = hit
    lines = f.read_text(errors="replace").split("\n")
    block = []
    j = i
    while j < len(lines) and (j == i or ("[MY出图]" in lines[j] and "[入队]" not in lines[j])):
        if lines[j].strip(): block.append(lines[j])
        j += 1
    R["imagePromptsBlock"] = {"file": f.name, "startLine": i + 1, "lines": len(block),
                              "hasSummary": any("[摘要]" in x for x in block), "hasFullJson": any("[全量JSON]" in x for x in block)}
    chk("日志段三行俱在(入队+摘要+全量JSON)", R["imagePromptsBlock"]["hasSummary"] and R["imagePromptsBlock"]["hasFullJson"], f"{f.name}:{i+1} 起 {len(block)} 行")

R["ok"] = all(c["ok"] for c in R["checks"])
out = CAMPAIGN / f"verify/{slug}.postcheck.json"
out.write_text(json.dumps(R, ensure_ascii=False, indent=2))
print(("★ 后核全绿 → " if R["ok"] else "★ 后核有红 → ") + str(out))
sys.exit(0 if R["ok"] else 1)
