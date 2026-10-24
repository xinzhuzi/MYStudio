#!/usr/bin/env python3
"""三国望神州·空气句 A/B/C 多轮对照实验驱动件(1018 用户双令:
「不能直接改提示词,必须做多轮对照实验」+「做实验时,必须记录提示词」)。

实验设计(方案=1018 会话定稿,用户批准):
  假设:道劫底座加一句「工笔版空气句」(罩染/渐次转淡/留白透气,色面边界仍
  清晰)能引入三国望神州式氤氲感而不破「平整分层色面」教义;负向松绑
  (移除「空气透视/柔光晕染」)进一步放开或翻车成网文封面。
  三臂:
    A=现行底座(对照) | B=A+空气句 | C=B+负向摘除「空气透视,柔光晕染」
  档位:native 40步(cfg4,负向参与采样→C 臂有效义)三臂×2轮交错;
       turbo 8步(无CFG,C≡B)只测 B×2 轮=空气句蒸馏存活率。
  主体句:全程同句(道人石桥句,1018 会话预检零重复)。

真源纪律(用户令「不能直接改提示词」):
  仓库真源零触碰;引擎侧 daojie-data/qi21_bases.json 为唯一热读源(mtime
  失效缓存,换文件即生效)——每发协议=等队列静默→写变体→fire→验装配文
  标记→立即还原原字节→md5 断言;任何异常 finally 还原。

提示词记录(用户令):
  每发 fire.py 自带 .装配文.txt(主体句+[401]正/负终稿真值)+本件
  manifest.json 逐发登记(arm/round/seed/时长/三变体全文)+README.md
  实验设计书;三变体 bases JSON 原件存 EXP_DIR/bases-variant-*.json。

用法:python3 qi21_sgzs_air_ab_1018.py [--smoke](单发 turbo B 臂验证管线)
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
ENGINE_HOME = Path.home() / "Library/Application Support/漫影工作室/comfyui"
BASES = ENGINE_HOME / "daojie-data" / "qi21_bases.json"
FIRE = REPO / "apps/build/scripts" / "qi21_t2i_workflow_fire.py"
EXP = REPO / "apps/output" / "qi21-sgzs-air-ab-1018"

# 空气句(工笔语言:罩染/渐次转淡/留白透气——非喷枪渐变;句尾锁边界守教义)
AIR_SENTENCE = ("云雾烟霭以淡色罩染层层推开，远景以数重色面渐次转淡、叠出深远；"
                "画中留白以宣纸白透气，通幅有雾气流动，而色面边界仍清晰分明。")
AIR_MARKER = "罩染层层推开"          # 装配文验活标记(终稿正文明文)
NEG_UNBAN = {"空气透视", "柔光晕染"}  # C 臂摘除词(仅此二词)

SUBJECT = ("一位金丹后期的中年道人，玄色（近黑）大袖道袍、立领与袖缘滚青绿色边，"
           "腰束赭石丝绦、绦扣旧金，乌发挽成高耸道髻、簪一支旧金木簪，颊下三绺长须、"
           "眉目清正沉和；他立于雨后山涧的青灰石桥中央，身体正面朝向观者、微向右转约"
           "四分之一侧，重心落于左腿，右脚虚点前方半步桥面；长剑以石青剑绦系于画面右侧"
           "腰间，剑鞘斜垂、与地面约呈四十五度，鞘尾朝画面右下方、剑柄朝画面左上方，"
           "黑鲨皮剑鞘、黄铜剑格、乌木剑柄缠灰银丝、鞘口垂朱红剑穗，剑身完整收在鞘中，"
           "全身仅此一柄长剑、始终挂定腰间；左臂自然垂落、左肘微屈，左手自然握住挂定的剑鞘"
           "上端三分之一处，五指环拢鞘身、指腹贴实鞘面；右手五指轻捻胸前长须一缕；桥下涧水"
           "石青、水面平静，桥两端古松各一株、松针青绿、树干赭石，远处群峰三重青绿叠影、"
           "山脚青灰雾带横陈；旧金色夕光自画面左上方斜照，道袍缘边与松针皆染暖意，暮色渐起。")

TYPE = "人物海报"
NATIVE_ROUNDS = 2   # 三臂×2轮(用户令:必须多轮)
TURBO_ROUNDS = 2    # 仅 B 臂(无 CFG 下 C≡B)

# 场景型延伸(1018 用户令「场景,用turbo加速」):示例库 §2 官方稳定例句原样
# 搬运(预检零重复)——自带谷口暮雾/远山三重渐淡=空气句最佳考场
SCENE_SUBJECT = ("暮春时节的黄昏，天际晕着旧金色暮霭，废弃的上古祭坛深藏在群山环抱的谷底；"
                 "画面中央九根断裂的赭石色石柱围成半圆，坛心一泓浅潭，水色旧金；前景坛基青灰"
                 "石阶残缺，阶缝生着零星苔绿；左下角一只倾倒的铜鼎半埋在枯叶里，鼎身覆着青绿"
                 "铜锈；右下角几块碎裂的石碑斜插在土中，碑面刻纹被苔藓掩去大半；左侧一道赭石色"
                 "崖壁垂下几缕枯藤；右侧一株老松斜伸出崖缝，松针青绿；中景石柱之间散落断裂的"
                 "石梁与倾颓的石兽；左上角崖顶残存半截石阙；右上角一线淡朱晚霞横过天际；谷口"
                 "青灰暮雾正缓缓漫入，远山三重青灰叠影渐次淡去。残阳从画面右上方斜照下来，"
                 "旧金色光落在石柱顶端，潭面水色与之同一冷暖倾向。整体构图以半圆石柱群居中，"
                 "四周崖壁与暮雾层层围合。")


def engine_base() -> str:
    port = json.loads((ENGINE_HOME / "manifest.json").read_text(encoding="utf-8"))["engine"]["port"]
    return f"http://127.0.0.1:{port}"


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def queue_idle(ENGINE: str, timeout_s: int = 3600) -> bool:
    """等队列静默(running+pending 双零);超时 False=放弃本发(真源不动)。
    默认 3600s:并行原生 40 步一发可达 ~40min,900s 会误等不到。"""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        with urllib.request.urlopen(f"{ENGINE}/queue", timeout=10) as r:
            q = json.load(r)
        if not q["queue_running"] and not q["queue_pending"]:
            return True
        time.sleep(10)
    return False


def build_variants(orig_bytes: bytes) -> dict:
    """A=原样 | B=+空气句 | C=B+负向摘除;返回 {arm: (bases_json_bytes, 说明)}。"""
    data = json.loads(orig_bytes.decode("utf-8"))
    asb = data["art_style_base"]
    pos_a, neg_a = asb["positive_text"], asb["negative_text"]

    def dump(d: dict) -> bytes:
        return (json.dumps(d, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    out = {"A": (orig_bytes, "现行底座(对照,原字节不动)")}
    b = json.loads(orig_bytes.decode("utf-8"))
    b["art_style_base"]["positive_text"] = pos_a + AIR_SENTENCE
    out["B"] = (dump(b), f"A 正向句尾追加空气句({len(AIR_SENTENCE)}字),负向不动")
    segs = [s.strip() for s in neg_a.split("，")]
    missing = NEG_UNBAN - set(segs)
    assert not missing, f"负向词缺席,变体定义失效:{missing}"
    c = json.loads(orig_bytes.decode("utf-8"))
    c["art_style_base"]["positive_text"] = pos_a + AIR_SENTENCE
    c["art_style_base"]["negative_text"] = "，".join(s for s in segs if s not in NEG_UNBAN)
    out["C"] = (dump(c), f"B 基础上负向摘除「{'/'.join(sorted(NEG_UNBAN))}」两词,"
                         f"{len(segs)}→{len(segs) - 2}段")
    return out


def parse_snapshot(snap: Path):
    """装配文三段(主体句/正向终稿/负向终稿)——记录与验活共用。"""
    txt = snap.read_text(encoding="utf-8")
    parts = {}
    for seg in txt.split("═══ "):
        if " ═══" in seg:
            head, _, body = seg.partition(" ═══")
            parts[head] = body.strip()
    return parts


def one_fire(tag: str, arm: str, variant_bytes: bytes, turbo: bool,
             manifest: list, originals_md5: str) -> bool:
    """单发协议:等静默→换变体→fire→验装配文→还原→登记。True=成功。"""
    ENGINE = engine_base()
    print(f"[{tag}] 等 queue 静默…", flush=True)
    if not queue_idle(ENGINE):
        print(f"[{tag}] 队列 900s 不静默,跳过(真源未动)", flush=True)
        manifest.append({"tag": tag, "arm": arm, "status": "skipped_busy"})
        return False
    BASES.write_bytes(variant_bytes)  # 变体上场(mtime 即刷,热读下一发生效)
    # 缓存破解(1018 冒烟破案):[4032] 输入 widget 不变→ComfyUI 复用缓存输出,
    # output() 热读不执行——B/C 须以 --base-file 换 widget 文本逼其重执行
    # (widget 值不进终稿,终稿仍走热读;A 臂=工作流原 widget 与缓存天然同值免破)
    basefile = None
    if arm != "A":
        # 尾标=逐发唯一缓存破解(B/C 正向 widget 同文会让 C 命中 B 的节点缓存,
        # 负向变体永远不热读——1018 C 臂首轮翻车根因);widget 纯展示不进计算
        basefile = EXP / f"_basefile_{arm}.txt"
        basefile.write_text(
            json.loads(variant_bytes.decode("utf-8"))["art_style_base"]["positive_text"]
            + f"\n[cache-break:{tag}]",
            encoding="utf-8")
    t0 = time.time()
    out_png = EXP / f"{tag}.png"
    cmd = [sys.executable, str(FIRE), "--type", TYPE, "--subject", SUBJECT,
           "--out", str(out_png), "--turbo" if turbo else "--native"]
    if basefile:
        cmd += ["--base-file", str(basefile)]
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True,
                            timeout=3300 if not turbo else 1200)
        print(cp.stdout[-600:] if len(cp.stdout) > 600 else cp.stdout, flush=True)
        if cp.returncode != 0:
            print(f"[{tag}] fire 失败:\n{cp.stderr[-800:]}", flush=True)
            manifest.append({"tag": tag, "arm": arm, "status": "fire_fail",
                             "stderr_tail": cp.stderr[-400:]})
            return False
        snap = out_png.with_suffix(".装配文.txt")
        if not snap.exists():
            manifest.append({"tag": tag, "arm": arm, "status": "no_snapshot"})
            return False
        parts = parse_snapshot(snap)
        pos, neg = parts.get("[401] 正向终稿", ""), parts.get("[401] 负向终稿", "")
        # 验活:B/C 终稿必须含空气句标记(证明热读吃进变体);A 必须不含(防串染)
        has = AIR_MARKER in pos
        if arm in ("B", "C") and not has:
            manifest.append({"tag": tag, "arm": arm, "status": "MARKER_MISS(热读未吃,图作废)"})
            print(f"[{tag}] 标记缺失!热读未生效,图作废", flush=True)
            return False
        if arm == "A" and has:
            manifest.append({"tag": tag, "arm": arm, "status": "CONTAMINATED(A 臂出现空气句)"})
            return False
        if arm == "C":
            # 子串级断言(半角", "分隔的终稿负向被全角切分骗过=1018 首轮空过教训)
            leaked = [t for t in NEG_UNBAN if t in neg]
            assert not leaked, f"[{tag}] C 臂负向摘除词回潮:{leaked}"
        seed = next((w for w in cp.stdout.split() if w.isdigit() and len(w) >= 6), "?")
        manifest.append({
            "tag": tag, "arm": arm, "speed": "turbo" if turbo else "native",
            "seed": seed, "duration_s": round(time.time() - t0),
            "png": out_png.name, "snapshot": snap.name,
            "positive_final_chars": len(pos), "negative_final_chars": len(neg),
            "status": "ok"})
        print(f"[{tag}] OK {time.time()-t0:.0f}s → {out_png.name}", flush=True)
        return True
    finally:
        BASES.write_bytes(backup_bytes)  # 立即还原原字节
        assert md5(BASES) == originals_md5, "还原失败!真源 md5 漂移——人工介入"


def main():
    global backup_bytes
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="单发 turbo B 臂管线验证")
    ap.add_argument("--scene-ab-turbo", dest="scene_ab_turbo", action="store_true",
                    help="场景型延伸:A/B×2轮 turbo(1018 用户令「场景,用turbo加速」;"
                         "主体句=示例库§2官方稳定例句,预检零重复)")
    args = ap.parse_args()

    global TYPE, SUBJECT
    if args.scene_ab_turbo:
        TYPE, SUBJECT = "场景", SCENE_SUBJECT

    EXP.mkdir(parents=True, exist_ok=True)
    backup_bytes = BASES.read_bytes()
    orig_md5 = md5(BASES)
    (EXP / "bases-original-backup.json").write_bytes(backup_bytes)
    variants = build_variants(backup_bytes)
    for arm, (vb, _) in variants.items():
        if arm != "A":
            (EXP / f"bases-variant-{arm}.json").write_bytes(vb)

    manifest_path = EXP / "manifest.json"
    manifest = [] if args.smoke or not manifest_path.exists() else \
        json.loads(manifest_path.read_text(encoding="utf-8"))

    # 实验设计书+三变体全文(用户令:必须记录提示词;variant 全文逐字入档)
    # 场景模式只追加不覆盖(防抹掉人物轮结果区)
    data = json.loads(backup_bytes.decode("utf-8"))
    asb = data["art_style_base"]
    readme = EXP / "README.md"
    if args.scene_ab_turbo:
        readme.open("a", encoding="utf-8").write(
            f"\n\n# 延伸实验:场景型×turbo×A/B(1018 用户令「场景,用turbo加速」)\n\n"
            f"- 型=场景(16:9);A/B×{TURBO_ROUNDS}轮 turbo 8步;底座变体同上(原文/+空气句)。\n"
            f"- 场景主体句(示例库§2官方稳定例句原样搬运,{len(SCENE_SUBJECT)}字,预检零重复):\n\n"
            f"```text\n{SCENE_SUBJECT}\n```\n\n## 场景逐发台账\n(见 manifest.json S_* 条目;装配文=S_*.装配文.txt)\n")
    else:
        readme.write_text(
        "# 三国望神州·空气句 A/B/C 多轮对照实验(1018)\n\n"
        "## 设计\n"
        f"- 主体句(全程同句,{len(SUBJECT)}字,1018 预检零重复):\n\n```text\n{SUBJECT}\n```\n\n"
        f"- 型={TYPE};native 40步 cfg4(负向参与采样,C 臂有效义)×三臂×{NATIVE_ROUNDS}轮交错;"
        f"turbo 8步(无CFG,C≡B)×B臂×{TURBO_ROUNDS}轮。\n"
        f"- 每发独立随机种子(生图铁令);每发前等队列静默,发完立即还原真源字节+md5 断言。\n\n"
        "## 三臂底座变体全文\n\n"
        f"### A 现行底座·正向(原文,md5={orig_md5})\n\n```text\n{asb['positive_text']}\n```\n\n"
        f"### A 现行底座·负向(原文)\n\n```text\n{asb['negative_text']}\n```\n\n"
        f"### B=A+空气句(句尾追加)\n\n```text\n{asb['positive_text'] + AIR_SENTENCE}\n```\n\n"
        "### C=B+负向摘除「空气透视/柔光晕染」\n\n"
        f"正向同 B;负向={ '，'.join(s.strip() for s in asb['negative_text'].split('，') if s.strip() not in NEG_UNBAN) }\n\n"
        "## 逐发台账\n(见 manifest.json;装配文逐发全文=同名录 .装配文.txt)\n",
        encoding="utf-8")

    if args.smoke:
        ok = one_fire("B_smoke_turbo", "B", variants["B"][0], True, manifest, orig_md5)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print("SMOKE", "PASS" if ok else "FAIL", flush=True)
        return 0 if ok else 1

    if args.scene_ab_turbo:
        plan = []
        for r in range(1, TURBO_ROUNDS + 1):
            plan += [(f"S_A_turbo_r{r}", "A", True), (f"S_B_turbo_r{r}", "B", True)]
        for tag, arm, turbo in plan:
            if any(m.get("tag") == tag and m.get("status") == "ok" for m in manifest):
                print(f"[{tag}] 已完成,跳过", flush=True)
                continue
            one_fire(tag, arm, variants[arm][0], turbo, manifest, orig_md5)
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        assert md5(BASES) == orig_md5, "终态还原失败"
        ok = [m for m in manifest if m.get("status") == "ok" and m.get("tag", "").startswith("S_")]
        print(f"SCENE DONE ok={len(ok)}/4 真源md5={md5(BASES)}", flush=True)
        return 0

    plan = []
    for r in range(1, NATIVE_ROUNDS + 1):
        plan += [(f"A_native_r{r}", "A", False), (f"B_native_r{r}", "B", False),
                 (f"C_native_r{r}", "C", False)]
    for r in range(1, TURBO_ROUNDS + 1):
        plan.append((f"B_turbo_r{r}", "B", True))
    for tag, arm, turbo in plan:
        if any(m.get("tag") == tag and m.get("status") == "ok" for m in manifest):
            print(f"[{tag}] 已完成,跳过", flush=True)
            continue
        one_fire(tag, arm, variants[arm][0], turbo, manifest, orig_md5)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    assert md5(BASES) == orig_md5, "终态还原失败"
    ok = [m for m in manifest if m.get("status") == "ok"]
    print(f"ALL DONE ok={len(ok)}/{len(manifest)} 真源md5={md5(BASES)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
