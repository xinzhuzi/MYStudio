#!/usr/bin/env python3
"""qi21-道劫-i2i 透明参考锚 A/B 配对复验探针(1014 役 T7;立项小探针,仿 sweep 骨架)。

设计(1014 定谳「运行间非确定性耦合」如实注):
- 同 seed A/B 交替发车:A=--enable-anchor(透明锚挂载)/B=无锚(mode4 旁路态),
  每对 fresh seed;guard 关=判黑结果即数据(重试会破坏配对语义);
- 每发前 curl /queue 校验空闲且深度记 meta;并行发射时窗检测(发前非空闲等待,
  发后队列残深>0=窗内被注入)的对子剔除重采,不计入对照表(引擎单实例,窗内
  耦合不可分);
- 判据单源=fire.judge_png(img_stat_1014 同式)+alpha 带透维度(1015 扩参:
  winner 带透优先于非黑率,tally 增 A_band/B_band,判读 pass 与带透并看);
  收据落 apps/output/i2i-fire-1014/anchor-probe/<型>/ 按型隔离
  (T7 旧根文件零触碰=历史台账不改写);
- 统计局限如实注:基线黑屏率~1/13(1014 定谳)下 8-10 对对黑屏差异区分度
  不足,结论以「未见劣化/方向性信号」为上限;三分支处置(A>B 回写数字/
  A=B 降措辞/A<B 升级用户裁定)由执行侧按 receipt.json 兑现,探针只测不裁。

用法:python3 qi21_i2i_anchor_probe_1014.py [--pairs 10]
       [--type 道具|人物多视图|高清人脸|表情差分] [--instruction "…"]
"""
import argparse
import datetime
import importlib.util
import json
import random
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
FIRE = REPO / "apps/build/scripts/qi21_i2i_workflow_fire.py"
OUT = REPO / "apps/output/i2i-fire-1014/anchor-probe"  # 根=历史台账(T7);写侧按型落 OUT/<型>/
ENGINE = "http://127.0.0.1:17001"
TIER = "2 · viggle"
# 1015 扩参:透明四型白名单(引擎侧 combo 真值=qi21_bases.json types[].zh 十值,
# 本役 live /object_info MyQi21DaojieBase 复核);「多视图」等缩写会在引擎侧
# my_qi21_base.py RuntimeError(未知 qi21 底座),白名单前移=本机 fail-fast 秒炸。
COMBO_TYPES = ("道具", "人物多视图", "高清人脸", "表情差分")
COMBO_TYPE = "道具"  # 1014 T7 基线型,降级为 --type 缺省值(无旗调用向后兼容)
# 缺省指令句(--instruction 省略时按型取):道具=T7 基线原句不动(保基线);
# 其余三型=执行侧起草句(1015,取景口径真源=qi21_bases.json types[].purpose/
# rgba_positive),首对实弹后可微调,改本表即可。
INSTR = "将主体道具换成一盏青瓷行灯,灯体完整清晰,独立悬浮展示"
TYPE_INSTR = {
    "道具": INSTR,
    "人物多视图": "把画布中的角色整理成同一角色的四视图设定图,两行两列网格:左上正面头肩特写(肩部以上),右上正面全身,左下正九十度纯侧面全身,右下背面全身,四格同一角色,发型服饰一致",
    "高清人脸": "把画布中的角色改为正面头肩特写:正面平视机位,视线直视镜头,取景为头部与肩部上缘,头顶发型外轮廓与下颌完整,面部是画面焦点",
    "表情差分": "把画布中的角色整理成九宫格脸部表情差分表,三行三列,每格均为头顶至下颌的正面脸部特写,依次呈现:平静、微笑、大笑、惊讶、生气、悲伤、闭眼、皱眉、张口",
}
SHOT_TIMEOUT = 2400
WAIT_IDLE_CAP = 600


def engine_up():
    try:
        urllib.request.urlopen(f"{ENGINE}/system_stats", timeout=3)
        return True
    except Exception:
        return False


def ensure_engine():
    """每发前守卫:引擎被并行看门狗回收时自愈拉起(1014 实弹在案)。"""
    ip = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui")
    for attempt in range(40):
        if engine_up():
            return True
        if attempt == 0:
            subprocess.Popen(
                [str(ip / "venv/bin/python"), str(ip / "ComfyUI/main.py"),
                 "--listen", "127.0.0.1", "--port", "17001", "--enable-manager",
                 "--gpu-only", "--reserve-vram", "16", "--use-pytorch-cross-attention",
                 "--input-directory", str(ip / "input"), "--output-directory", str(ip / "output")],
                stdout=open(ip / "logs/engine.log", "ab"), stderr=subprocess.STDOUT,
                start_new_session=True)
        time.sleep(6)
    return False


def queue_state():
    """/queue 深度:(running, pending);探活失败=(-1,-1)。"""
    try:
        q = json.load(urllib.request.urlopen(f"{ENGINE}/queue", timeout=5))
        return len(q.get("queue_running", [])), len(q.get("queue_pending", []))
    except Exception:
        return -1, -1


def wait_idle():
    """并行发射时窗检测第一道:发前必须空闲;等待上限内返回 (clean, depth 记录)。"""
    trace = []
    t0 = time.time()
    while time.time() - t0 < WAIT_IDLE_CAP:
        r, p = queue_state()
        trace.append(f"{int(time.time()-t0)}s:running={r},pending={p}")
        if r == 0 and p == 0:
            return True, trace
        time.sleep(15)
    return False, trace


def load_fire():
    spec = importlib.util.spec_from_file_location("i2i_fire_probe", str(FIRE))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def alpha_band(amin, amax):
    """img_stat_1014.py 四态同式(alpha 维度判读单源):返回带态名。"""
    if amax <= 5:
        return "全透明"
    if amin >= 250 and amax == 255:
        return "实体"
    if amin <= 5 and amax >= 250:
        return "带透"
    return "半透混态"


def fire_shot(fire, anchor, seed, d, instr, combo_type):
    """单发(guard 关保配对确定性):返回 (status, shot dict)。
    status 语义(依 fire meta_guard.final 判,不依退出码):pass→ok/black→black
    (判黑=配对数据照记)/其余(无 meta/timeout/无产物)→timeout=引擎级失效。"""
    d.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(FIRE), "--instruction", instr, "--type", combo_type,
           "--tier", TIER, "--no-pe", "--bypass-upscale", "--seed", str(seed),
           "--out", str(d)]
    if anchor:
        cmd.append("--enable-anchor")
    r, p = queue_state()
    pre = {"running": r, "pending": p}
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=SHOT_TIMEOUT)
    except subprocess.TimeoutExpired:
        return "timeout", {"pre_queue": pre}
    final = None
    mg = d / "meta_guard.json"
    if mg.exists():
        try:
            final = json.loads(mg.read_text(encoding="utf-8")).get("final")
        except Exception:
            final = None
    r2, p2 = queue_state()
    post = {"running": r2, "pending": p2}
    # 产物定位:pass=顶层原位;black=guard-rejected 内(seed 前缀);皆无=基建失效
    imgs = sorted(d.glob("*.png")) or sorted(d.rglob("*.png"))
    if final not in ("pass", "black") or not imgs:
        tail = ((proc.stdout or "") + (proc.stderr or "")).strip().replace("\n", " | ")[-160:]
        return "timeout", {"pre_queue": pre, "post_queue": post, "final": final, "error": tail}
    j = fire.judge_png(imgs[-1])
    status = "ok" if final == "pass" else "black"
    return status, {
        "pre_queue": pre, "post_queue": post, "final": final,
        "product": str(imgs[-1].relative_to(REPO)),
        "nonblack": round(j["nonblack"], 4), "alpha": [j["amin"], j["amax"]],
        "band": alpha_band(j["amin"], j["amax"]),
        "judge": j["verdict"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=10, help="A/B 配对数(计划口径 6/型=降格筛查;缺省 10)")
    ap.add_argument("--type", default=COMBO_TYPE, choices=COMBO_TYPES,
                    help="型(透明四型白名单,引擎 combo 真值;非法型引擎侧 RuntimeError,"
                         "白名单前移=本机 fail-fast)")
    ap.add_argument("--instruction", default=None,
                    help="指令句(缺省=各型内置句;道具=T7 基线原句)")
    args = ap.parse_args()
    instr = args.instruction or TYPE_INSTR[args.type]
    out = OUT / args.type
    out.mkdir(parents=True, exist_ok=True)
    fire = load_fire()
    pairs, discarded, used_seeds = [], [], set()
    attempts = 0
    while len(pairs) < args.pairs and attempts < args.pairs * 3:
        attempts += 1
        if not ensure_engine():
            print(f"[probe] 引擎不可用(拉起超时),中止于 {len(pairs)} 对", flush=True)
            break
        seed = random.randint(1, 2**31 - 1)
        while seed in used_seeds:
            seed = random.randint(1, 2**31 - 1)
        n = len(pairs) + len(discarded) + 1
        d = out / f"pair{n:02d}_seed{seed}"
        clean, trace = wait_idle()
        if not clean:
            discarded.append({"seed": seed, "reason": "发前队列非空闲超上限(并行发射时窗)", "queue_trace": trace})
            print(f"[probe] pair{n} seed={seed} 剔除:队列持续非空闲", flush=True)
            continue
        print(f"[probe] pair{n} seed={seed} A(锚)发车…", flush=True)
        sa, ja = fire_shot(fire, True, seed, d / "A", instr, args.type)
        _, rb = queue_state()
        print(f"[probe] pair{n} A={sa} {ja.get('judge','')}", flush=True)
        print(f"[probe] pair{n} seed={seed} B(无锚)发车…", flush=True)
        sb, jb = fire_shot(fire, False, seed, d / "B", instr, args.type)
        print(f"[probe] pair{n} B={sb} {jb.get('judge','')}", flush=True)
        if sa == "timeout" or sb == "timeout":
            discarded.append({"seed": seed, "reason": f"引擎级失效(A={sa}/B={sb})",
                              "shots": {"A": ja, "B": jb}})
            print(f"[probe] pair{n} 剔除:引擎级失效(A={sa}/B={sb}) "
                  f"{(ja.get('error') or jb.get('error') or '')[:120]}", flush=True)
            continue
        if rb > 0 or jb["post_queue"]["pending"] > 0 or ja["post_queue"]["pending"] > 0:
            discarded.append({"seed": seed, "reason": "并行发射时窗(发后队列残深,窗内耦合不可分)",
                              "shots": {"A": ja, "B": jb}})
            print(f"[probe] pair{n} 剔除:并行发射时窗", flush=True)
            continue
        used_seeds.add(seed)
        pairs.append({"seed": seed, "dir": str(d.relative_to(REPO)),
                      "A": {**ja, "status": sa}, "B": {**jb, "status": sb},
                      "winner": ("A" if (sa == "ok" and sb != "ok") else
                                 "B" if (sb == "ok" and sa != "ok") else
                                 # 1015 alpha 维度:带透优先于非黑率——透明底必然拉低非黑,
                                 # 实体图靠非黑占优属假读(ok 门放行实体图,A带透/B实体
                                 # 旧口径会被读成 tie)
                                 ("A" if ja["band"] == "带透" and jb["band"] != "带透" else
                                  "B" if jb["band"] == "带透" and ja["band"] != "带透" else
                                  ("A" if ja["nonblack"] > jb["nonblack"] else
                                   "B" if jb["nonblack"] > ja["nonblack"] else "tie")))})
        print(f"[probe] pair{n} 计入 winner={pairs[-1]['winner']} "
              f"(A非黑={ja['nonblack']}/B非黑={jb['nonblack']})", flush=True)
    a_pass = sum(1 for x in pairs if x["A"]["status"] == "ok")
    b_pass = sum(1 for x in pairs if x["B"]["status"] == "ok")
    a_win = sum(1 for x in pairs if x["winner"] == "A")
    b_win = sum(1 for x in pairs if x["winner"] == "B")
    a_band = sum(1 for x in pairs
                 if x["A"]["status"] == "ok" and x["A"].get("band") == "带透")
    b_band = sum(1 for x in pairs
                 if x["B"]["status"] == "ok" and x["B"].get("band") == "带透")
    branch = ("A>B" if a_pass > b_pass else "A<B" if a_pass < b_pass else "A=B")
    receipt = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "design": (f"{args.type}型 viggle 同种子 A/B 配对(A=--enable-anchor/B=旁路态),"
                   f"guard 关,每对 fresh seed;指令=「{instr}」;判据=fire.judge_png"
                   "(img_stat_1014 同式)+alpha 带透维度(winner 带透优先于非黑率,"
                   "tally 增 A_band/B_band,判读 pass 与带透并看)"),
        "stat_limit_note": "统计局限:基线黑屏率~1/13(1014 定谳)下小样本对黑屏差异"
                           "区分度不足,计划口径 6 对/型=降格筛查,结论以「未见劣化/"
                           "方向性信号」为上限;运行间非确定性耦合(1014 定谳)由并行"
                           "发射时窗剔除缓解但不可根除。",
        "pairs_count": len(pairs), "discarded": discarded,
        "tally": {"A_pass": a_pass, "B_pass": b_pass, "A_band": a_band,
                  "B_band": b_band, "A_win": a_win, "B_win": b_win, "branch": branch},
        "pairs": pairs,
    }
    (out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    print(f"[probe] 完成:{len(pairs)} 对(A过={a_pass}/B过={b_pass},"
          f"A带透={a_band}/B带透={b_band},A胜={a_win}/B胜={b_win})"
          f"→ 三分支={branch};剔除 {len(discarded)};收据 → {out}/receipt.json", flush=True)


if __name__ == "__main__":
    main()
