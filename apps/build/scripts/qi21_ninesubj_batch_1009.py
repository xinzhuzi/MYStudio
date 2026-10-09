#!/usr/bin/env python3
"""九型新主体句 9 发实弹批驱动(1009)。

薄壳批编排——发车一律走唯一正器 qi21_t2i_workflow_fire.py(工作流本体直跑+每发随机种子),
本件只做串行调度/计时/熔断/日志,不碰工作流结构,非第二发车路。

用法:python3 qi21_ninesubj_batch_1009.py <subjects.json> [--out-dir DIR] [--only 型1 型2 ...]
subjects.json = {"人物": "...", "多视图": "...", ...}(键=示例库节名;4010 正名映射内置)
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
FIRE = REPO / "apps/build/scripts/qi21_t2i_workflow_fire.py"


def engine_up() -> bool:
    try:
        urllib.request.urlopen("http://127.0.0.1:17001/system_stats", timeout=5)
        return True
    except Exception:
        return False


def wait_engine(log, timeout=420):
    """等引擎在线(并行会话重启窗口防撞;fire.py 口从 manifest 现查,此处双探 17001 与 manifest 口)。"""
    port = None
    try:
        m = json.loads((Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json").read_text())
        port = m.get("engine", {}).get("port")
    except Exception:
        pass
    urls = [f"http://127.0.0.1:{p}/system_stats" for p in {17001, port} if p]
    t0 = time.time()
    while time.time() - t0 < timeout:
        for u in urls:
            try:
                urllib.request.urlopen(u, timeout=5)
                return True
            except Exception:
                continue
        time.sleep(15)
    return False

# 示例库键 → 4010 base 正名
ALIAS = {"多视图": "人物多视图"}
ORDER = ["人物", "场景", "道具", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("subjects")
    ap.add_argument("--out-dir", default=str(REPO / "apps/output/daojie-nine-subjects-1009"))
    ap.add_argument("--only", nargs="+", default=None, help="只发这些型(示例库键名)")
    args = ap.parse_args()

    subs = json.loads(Path(args.subjects).read_text(encoding="utf-8"))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "batch.log"

    def log(msg):
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    order = [k for k in ORDER if not args.only or k in args.only]
    fail_streak = 0
    results = {}

    def fire_once(key, t4010, subject, out_png):
        t0 = time.time()
        r = subprocess.run(
            [sys.executable, str(FIRE), "--type", t4010, "--subject", subject,
             "--out", str(out_png)],
            capture_output=True, text=True, timeout=1000)
        dt = time.time() - t0
        out = (r.stdout + r.stderr).strip()
        for ln in out.splitlines():
            log(f"  {ln}")
        return r.returncode == 0 and out_png.exists(), round(dt), r.returncode

    for key in order:
        t4010 = ALIAS.get(key, key)
        subject = subs[key]
        out_png = out_dir / f"{t4010}.png"
        if not wait_engine(log):
            log("引擎超时离线,熔断停批")
            break
        log(f"════ 发车 {key} (4010={t4010}) → {out_png.name} ════")
        ok, dt, rc = fire_once(key, t4010, subject, out_png)
        if not ok and not engine_up() and wait_engine(log):
            log(f"  {key} 撞引擎重启,恢复后补试(新随机种子)")
            ok, dt, rc = fire_once(key, t4010, subject, out_png)
        results[key] = {"ok": ok, "secs": dt, "returncode": rc, "out": str(out_png)}
        log(f"════ {key} {'绿' if ok else '红'} ({dt:.0f}s) ════")
        if ok:
            fail_streak = 0
        else:
            fail_streak += 1
            if fail_streak >= 2:
                log("两连败熔断:停批(执行保障协议)")
                break

    (out_dir / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    n_ok = sum(1 for v in results.values() if v["ok"])
    log(f"批完:{n_ok}/{len(results)} 绿;results.json 已落 {out_dir}")
    sys.exit(0 if n_ok == len(order) else 1)


if __name__ == "__main__":
    main()
