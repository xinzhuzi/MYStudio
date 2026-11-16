#!/usr/bin/env python3
"""J5 试点重打(1116 用户令「重打」):走 qi21 道劫产线真身工作流(6 LoRA 含 mikkoani@0.6 原样在场)。

与 1115 首打的差别:首打走 H3-Image 33B 裸模直弹(参照系错);本次走
qwen21-道劫-t2i-api.json(档4 PrunaAI 臂,mikkoani+p_q 6step 挂载),
基线=HEAD 版 qi21_bases.json(无 J5 句),变体=工作树版(含 J5 因果句),
同 seed=2101、同主体句、同一切参数,只有型文一处差。

流程:scp 两版 JSON 到 E:/IP/tmp → PS 备份引擎真身 → 换基线版(hash 验)→
发弹取图 → 换变体版(hash 验)→ 发弹取图 → 还原引擎备份 → 门禁
(history 断言 J5 句存活/缺席 + mikkoani 在模型链 + alpha + 色彩量化)。
产物恒落 apps/output/superi_j5pilot_1115/(基线-产线.png / 变体-产线.png)。
"""
import hashlib
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENGINE = "http://192.168.0.101:17000"
API_GRAPH = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
JSON_REPO = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
WIN_TMP = "E:/IP/tmp"
ENGINE_JSON_PS = r"C:\Users\zbj\AppData\Roaming\漫影工作室\comfyui\daojie-data\qi21_bases.json"
OUT_DIR = REPO / "apps/output/superi_j5pilot_1115"
SEED = 2101
SUBJECT = "修仙宗门山门前的石阶与殿宇正面，无人。"
J5_MARK = "雨后石阶因水气浸养而色层加深"  # 变体判据锚句(逐字)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ps(cmd: str) -> str:
    r = subprocess.run(
        ["ssh", "zbj@192.168.0.101", f'powershell -NoProfile -Command "{cmd}"'],
        capture_output=True, timeout=120)
    out = r.stdout.decode("gbk", errors="replace")  # Win 侧回显恒 GBK(中文路径/certutil 头)
    if r.returncode != 0:
        raise RuntimeError(f"PS 失败: {r.stderr.decode('gbk', errors='replace')[:300]}")
    return out.strip()


def push_json_to_engine(src: Path, tag: str):
    """scp 到 ASCII 中转 → PS Copy-Item 到中文引擎路径 → certutil 双侧 hash 对账。"""
    tmp_win = f"{WIN_TMP}/q21b_{tag}.json"
    r = subprocess.run(["scp", str(src), f"zbj@192.168.0.101:{tmp_win}"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"scp 失败: {r.stderr[:200]}")
    local_h = sha256(src)
    out = ps(f"Copy-Item '{tmp_win}' '{ENGINE_JSON_PS}' -Force; (certutil -hashfile '{ENGINE_JSON_PS}' SHA256)" )
    win_h = "".join(out.splitlines()[1:3]).strip()
    if local_h.lower() not in out.lower():
        raise RuntimeError(f"引擎侧 hash 不符({tag}): local={local_h[:16]} win_out={out[:120]}")


def fire(tag: str) -> tuple[str, Path]:
    """发一发并取直出图(node 8 SaveImage),返回 (prompt_id, 本地图路径)。"""
    g = json.loads(API_GRAPH.read_text())["graph"]
    g["6:4010"]["inputs"]["base"] = "场景"
    g["7:7014"]["inputs"]["value"] = SEED
    g["400"]["inputs"]["value"] = SUBJECT
    g["8"]["inputs"]["filename_prefix"] = f"superi_j5refire_{tag}_"
    body = json.dumps({"prompt": g, "client_id": "superi-j5-refire"}).encode()
    q = json.loads(urllib.request.urlopen(f"{ENGINE}/queue", timeout=10).read())
    if q.get("queue_running") or q.get("queue_pending"):
        raise RuntimeError("引擎队列非空,发弹前的队列双空门未过")
    req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        pid = json.load(r)["prompt_id"]
    print(f"[{tag}] prompt_id={pid}")
    deadline = time.time() + 900
    img_info = None
    while time.time() < deadline:
        time.sleep(5)
        hh = json.loads(urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=15).read())
        if pid not in hh:
            continue
        node8 = hh[pid].get("outputs", {}).get("8", {})
        imgs = node8.get("images") or []
        if imgs:
            img_info = imgs[0]
            break
        status = hh[pid].get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"[{tag}] 引擎报错: {json.dumps(status.get('messages', []), ensure_ascii=False)[:400]}")
    if not img_info:
        raise RuntimeError(f"[{tag}] 900s 未出图")
    q2 = urllib.parse.urlencode({"filename": img_info["filename"],
                                 "subfolder": img_info.get("subfolder", ""),
                                 "type": img_info.get("type", "output")})
    b = urllib.request.urlopen(f"{ENGINE}/view?{q2}", timeout=120).read()
    out = OUT_DIR / f"{tag}.png"
    out.write_bytes(b)
    return pid, out


def hist_text(pid: str) -> str:
    hh = json.loads(urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=15).read())
    return json.dumps(hh.get(pid, {}).get("prompt", []), ensure_ascii=False)


def gates(pids: dict, paths: dict):
    ok = True
    base_t = hist_text(pids["基线-产线"])
    var_t = hist_text(pids["变体-产线"])
    # ① history 断言:J5 句变体在场/基线缺席;mikkoani 两发都在模型链
    j5_in_var, j5_in_base = J5_MARK in var_t, J5_MARK in base_t
    mik_both = ("qi21-mikkoani" in base_t) and ("qi21-mikkoani" in var_t)
    p_q_both = ("p_q_image_2.1_6_steps" in base_t) and ("p_q_image_2.1_6_steps" in var_t)
    print(f"history: J5变体在场={j5_in_var} 基线缺席={not j5_in_base} mikkoani双侧={mik_both} p_q双侧={p_q_both}")
    ok &= j5_in_var and (not j5_in_base) and mik_both and p_q_both
    # ② alpha + ③ 色彩量化
    from PIL import Image
    import numpy as np
    stats = {}
    for tag, p in paths.items():
        im = Image.open(p)
        has_alpha = im.mode == "RGBA"
        arr = np.asarray(im.convert("RGBA")).astype(float)
        alpha_pct = (arr[:, :, 3] < 250).mean() * 100
        rgb = arr[:, :, :3]
        stats[tag] = {"mode": im.mode, "alpha_pct": round(alpha_pct, 2),
                      "mean": [round(float(rgb[:, :, i].mean()), 2) for i in range(3)],
                      "var": [round(float(rgb[:, :, i].var()), 2) for i in range(3)]}
        print(f"{tag}: mode={im.mode} alpha<250占比={stats[tag]['alpha_pct']}% "
              f"RGB均值={stats[tag]['mean']} 方差={stats[tag]['var']}")
        ok &= alpha_pct < 1.0
    return ok, stats


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 基线=HEAD 版,变体=工作树版
    head = subprocess.run(["git", "show", f"HEAD:{JSON_REPO.relative_to(REPO)}"],
                          capture_output=True, text=True, cwd=REPO)
    if head.returncode != 0:
        print("git show HEAD 版失败"); return 2
    base_local = Path("/tmp/q21b_HEAD.json"); base_local.write_text(head.stdout)
    if J5_MARK in head.stdout:
        print("HEAD 版竟含 J5 句——基线判据失效,停"); return 2
    if J5_MARK not in JSON_REPO.read_text():
        print("工作树版竟无 J5 句——变体判据失效,停"); return 2
    # 引擎真身备份
    ps(f"Copy-Item '{ENGINE_JSON_PS}' '{WIN_TMP}/q21b_engine.bak' -Force")
    print("引擎真身已备份")
    pids, paths = {}, {}
    try:
        push_json_to_engine(base_local, "HEAD")
        pids["基线-产线"], paths["基线-产线"] = fire("基线-产线")
        push_json_to_engine(JSON_REPO, "WT")
        pids["变体-产线"], paths["变体-产线"] = fire("变体-产线")
    finally:
        ps(f"Copy-Item '{WIN_TMP}/q21b_engine.bak' '{ENGINE_JSON_PS}' -Force")
        print("引擎真身已还原(保持原状,装机组态随 deploy-dual)")
    ok, stats = gates(pids, paths)
    json.dump({"pids": pids, "stats": stats, "ok": ok},
              open(OUT_DIR / "refire_result.json", "w"), ensure_ascii=False, indent=1)
    print("GATES", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
