#!/usr/bin/env python3
"""单发实验 v2:pe_t2i + 透明禁景系统提示(TextGenerate 的 system_prompt 槽;零改码/零生图)。
v1 教训:sampling_mode 是 COMFY_DYNAMICCOMBO_V3,须传 {key,inputs{...}} 嵌套对象,传字符串=execute 缺参。
采样参数镜像 [4013] 保存态(temperature=1/top_p=0.95/top_k=20/presence_penalty=1.5),max_length=4096 防截断。
产物落 runs/exp-pe-sysprompt-transparent/(v2 后缀)。"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:17000"
CAMP = "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/qi21-9xing-livefire"
OUT = os.path.join(CAMP, "runs", "exp-pe-sysprompt-transparent")
OFFICIAL_PROMPT_PATH = (
    "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/"
    "ComfyUI-Qwen-Image-2.1-Prompt-Enhancer/prompts/system_prompt_t2i.txt"
)
SUBJECT = (
    "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，"
    "穗尾垂一枚带裂纹的灵玉；上引线旁以端正的墨色小字注“全长110厘米（三尺三寸）”，"
    "靠剑格一端的引线旁注“刃长88厘米（二尺六寸）”，柄端引线旁注“柄长22厘米（七寸）”，字迹清晰可辨。"
)
MARKER = (
    "[TRANSPARENT-BACKGROUND DELIVERABLE / 透明底交付] "
    "subject isolated on a fully transparent background (alpha empty everywhere outside the subject)."
)
OVERRIDE = """

## Transparent-background deliverables (hard override; applies when the brief is marked [TRANSPARENT-BACKGROUND DELIVERABLE])

When the brief carries the transparent-deliverable mark, this section OVERRIDES every background clause above:
- Do NOT describe any background, backdrop, surface, table, floor, ground, wall, room, landscape, sky, mist or environment. There is none: everywhere except the subject the frame is fully transparent (alpha channel empty).
- Step 3 opening sentence: end it with "isolated on a fully transparent background, no backdrop, no environment" instead of naming a background or palette.
- Step 5: do not walk a background and do not seat the subject on anything. Walk the subject itself only (pose/orientation, then parts, materials, details), using positions relative to the frame and the subject.
- Step 7 lighting: describe light falling on the subject only (for example, soft even studio light on the blade). No scene light sources, no surroundings, no shadows cast onto any surface (no contact shadow unless the brief asks for one).
- Step 8 closing sentence: state that the subject is isolated on a transparent background for compositing.
- Everything else (about twenty sentences, four to five hundred words, enumerate, materials with modifiers, user text strings verbatim in their own script, English description, single-line JSON output) unchanged.
"""

ENV_TERMS = [
    "surface", "table", "stone", "wood", "floor", "ground", "room", "landscape",
    "sky", "mist", "wall", "backdrop", "environment", "scenery", "pedestal",
    "rests on", "lies on", "sits on", "sits against", "against a dark",
]
ALLOWED_NEGATIONS = ["no backdrop", "no environment", "transparent background"]
SAVED_SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "presence_penalty": 1.5}


def http(path, payload=None, timeout=30):
    req = urllib.request.Request(BASE + path)
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, body, timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def build_sampling_mode():
    """V3 动态组合线格式=扁平点号前缀(comfy_api _io.py parse_class_inputs/finalize_prefix 实证):
    "sampling_mode": "<key>", "sampling_mode.<参数>": <值>。嵌套 {key,inputs} 对象是 schema 描述形状,线上不认。"""
    st, oi = http("/object_info/TextGenerate")
    if st != 200:
        raise SystemExit(f"object_info 失败 {st}")
    spec = oi["TextGenerate"]["input"]["required"]["sampling_mode"][1]["options"]
    opt = next((o for o in spec if o.get("key") == "on"), spec[0])
    combo = {}
    for k, v in opt.get("inputs", {}).get("required", {}).items():
        if isinstance(v[1], dict) and "default" in v[1]:
            combo[k] = v[1]["default"]
        elif isinstance(v[0], list) and v[0]:
            combo[k] = v[0][0]
    for k, val in SAVED_SAMPLING.items():
        if k in combo:
            combo[k] = val
    combo["seed"] = 42
    flat = {"sampling_mode": opt.get("key")}
    flat.update({f"sampling_mode.{k}": v for k, v in combo.items()})
    return flat


def main():
    os.makedirs(OUT, exist_ok=True)
    st, stats = http("/system_stats")
    if st != 200:
        print(f"FAIL: 引擎不在({st})")
        sys.exit(1)
    sampling_flat = build_sampling_mode()
    print("sampling_mode 扁平线格式:", json.dumps(sampling_flat, ensure_ascii=False)[:300])

    official = open(OFFICIAL_PROMPT_PATH, encoding="utf-8").read()
    system_prompt = official + OVERRIDE
    user_prompt = MARKER + "\n" + SUBJECT

    show = None
    st, oi = http("/object_info")
    if st == 200:
        show = next((k for k in oi if "showAnything" in k), None)
    if not show:
        print("FAIL: showAnything 不在册")
        sys.exit(1)

    graph = {
        "4019": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors", "type": "qwen_image", "device": "default"},
        },
        "4013": {
            "class_type": "TextGenerate",
            "inputs": {
                "clip": ["4019", 0],
                "prompt": user_prompt,
                "max_length": 16256,
                "system_prompt": system_prompt,
                **sampling_flat,
            },
        },
        "499": {"class_type": show, "inputs": {"anything": ["4013", 0]}},
    }
    with open(os.path.join(OUT, "input.api-prompt.v2.json"), "w", encoding="utf-8") as f:
        json.dump({"prompt": graph, "user_prompt": user_prompt}, f, ensure_ascii=False, indent=1)

    client = str(uuid.uuid4())
    st, resp = http("/prompt", {"prompt": graph, "client_id": client})
    if st != 200 or resp.get("node_errors"):
        print(f"FAIL: /prompt {st} {json.dumps(resp, ensure_ascii=False)[:600]}")
        sys.exit(1)
    pid = resp["prompt_id"]
    print("queued pid=", pid)

    deadline = time.time() + 540
    history = None
    while time.time() < deadline:
        st, h = http("/history/" + pid)
        if st == 200 and pid in h:
            entry = h[pid]
            if entry.get("outputs") or entry.get("status", {}).get("status_str") in ("error", "cancelled"):
                history = entry
                break
        time.sleep(6)
    if not history:
        print("TIMEOUT_AGAIN: 540s 未收;pid=", pid, "(可能排队在别拍之后;现场保留)")
        sys.exit(2)

    with open(os.path.join(OUT, "output.history.v2.json"), "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=1)
    if history.get("status", {}).get("status_str") != "success":
        for m in history.get("status", {}).get("messages", []):
            if m[0] == "execution_error":
                print("EXECUTION_ERROR:", json.dumps(m[1], ensure_ascii=False)[:500])
        sys.exit(1)

    texts = []
    for node_id, out in (history.get("outputs") or {}).items():
        for t in (out.get("ui", {}).get("text") or []):
            texts.append(t)
    raw = "\n".join(texts)
    with open(os.path.join(OUT, "output.v2.txt"), "w", encoding="utf-8") as f:
        f.write(raw)
    print("=== 输出全文(逐字) ===")
    print(raw)
    print("=== 判据扫描 ===")

    m = re.search(r"\{.*\}", raw, re.S)
    rewritten, wh = raw, ""
    if m:
        try:
            j = json.loads(m.group(0))
            rewritten = j.get("rewritten_prompt", "")
            wh = j.get("wh_ratio", "")
        except json.JSONDecodeError:
            pass
    low = rewritten.lower()
    hits = []
    for term in ENV_TERMS:
        for mt in re.finditer(re.escape(term), low):
            if any(neg in low[max(0, mt.start() - 30):mt.end() + 30] for neg in ALLOWED_NEGATIONS):
                continue
            ctx = rewritten[max(0, mt.start() - 45):mt.end() + 45].replace("\n", " ")
            hits.append(f"[{term}] …{ctx}…")
    cjk = len(re.findall(r"[\u4e00-\u9fff]", rewritten))
    needed = ["sword", "bronze", "jade", "110"]
    missing = [n for n in needed if n not in low]
    verdict = {
        "G1_无环境描写": not hits,
        "G1_hits": hits,
        "G2_透明隔离句": "transparent background" in low,
        "G3_主体要件存活": not missing,
        "G3_missing": missing,
        "G4_语言形状": {"cjk_chars": cjk, "wh_ratio": wh, "json_parsed": bool(m)},
        "params": {"sampling": sampling_flat, "max_length": 16256, "checkpoint": "pe_t2i", "harness": "TextGenerate.system_prompt", "pid": pid},
    }
    with open(os.path.join(OUT, "verdict.v2.json"), "w", encoding="utf-8") as f:
        json.dump(verdict, f, ensure_ascii=False, indent=1)
    print(json.dumps(verdict, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
