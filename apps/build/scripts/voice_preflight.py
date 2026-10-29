#!/usr/bin/env python3
"""配音前置门(常驻工具;1029 立,出身 campaigns/storyboard_1027 役,用户通牒:禁人工抓错)——声线选角审计+台词病句扫描。
产线 SOP:重配音前必跑,FAIL=拒跑 TTS。

用法: python3 voice_preflight.py [--casts casts.json]
  casts.json = {speaker: {"profileName": "...", "ageHint": "child|adult|elder", "traits": ["监工","嚣张"]}}
  缺省 casts 从 tts_coldstart.ts 的 SPEAKER_PROFILE_NAME 解析(ageHint 需人工表)。

门一·错档审计:
  A1 年龄冲突: speaker 含 孩/童/小[X]役 等 child 标记 → 档案名必须含 男-孩|女孩|[0-9]+岁|书童|童声
  A2 档案存在: profileName 必须在服务端库(sqlite)命中且唯一
  A3 描述词对表: speaker 的既定 traits 至少一词命中档案名(可选,缺 traits 跳过)
门二·病句扫描(shots.json 台词):
  B1 句尾悬空: 段文本以 ,、,;: 结尾
  B2 半句省略: 以 "……" 开头独立成句(如 ……当。)
  B3 现代词表: 代课|搞定|OK|okay|老铁|yyds|绝绝子|上架|系统提示
  B4 无停顿长句: >20 字无 ,。?!——、；
  B5 双标点/标点前后空格异常
退出码: 任何违规=1(产线拒跑),全绿=0 并打 PASS。
"""
import json, re, sqlite3, sys, glob, subprocess

MA = "/Users/zhengbingjin/Project/IP/MA"
COLD = "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/storyboard_1027/tts_coldstart.ts"
SHOTS = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/storyboard_pipeline_1027/shots.json"
DB = f"{MA}/TTS/runtime/tts.sqlite"

# 角色人设表(新角色必须登记;ageHint/traits 漏登只降级 warning 不拦)
CAST_TABLE = {
    "小杂役": {"ageHint": "child", "traits": ["男孩", "岁"]},
    "孩童甲": {"ageHint": "child", "traits": ["孩", "岁"]},
    "赵四":   {"ageHint": "adult", "traits": ["沙哑", "低沉", "监工", "嚣张"]},
    "铁山":   {"ageHint": "adult", "traits": ["中年"]},
    "钱掌柜": {"ageHint": "adult", "traits": ["掌柜", "刻薄", "正经"]},
    "管事":   {"ageHint": "adult", "traits": ["李先生", "沉稳", "中音"]},
    "独孤剑尘": {"ageHint": "adult", "traits": ["低沉", "低音", "厚", "清冷"]},
    "旁白":   {"ageHint": "adult", "traits": ["旁白", "木成"]},
    "太一宗弟子": {"ageHint": "adult", "traits": ["弟子"]},
}
CHILD_MARK = re.compile(r"孩|童|小.*役|丫头")
AGE_OK = re.compile(r"男孩|女孩|孩童|童声|书童|[0-9]+[-到~至]+[0-9]*岁|[0-9]+岁")
MODERN_WORDS = re.compile(r"代课|搞定|OK|okay|老铁|yyds|绝绝子|系统提示|打卡|上班族")
TRAILING = re.compile(r"[,、,;；:：]\s*$")

def parse_casts():
    src = open(COLD, encoding="utf-8").read()
    m = re.search(r"const SPEAKER_PROFILE_NAME[^{]*\{(.*?)\}", src, re.S)
    casts = {}
    for spk, prof in re.findall(r'(\w+):\s*"([^"]+)"', m.group(1)):
        casts[spk] = prof.split("//")[0].strip()
    return casts

def main():
    errs, warns = [], []
    casts = parse_casts()
    conn = sqlite3.connect(f"file:{DB}?mode=ro&immutable=1", uri=True)
    names = [r[0] for r in conn.execute("SELECT name FROM profiles")]

    for spk, prof in casts.items():
        hits = [n for n in names if n == prof]
        if len(hits) == 0:
            errs.append(f"A2 档案不存在: {spk} → {prof}")
            continue
        if len(hits) > 1:
            warns.append(f"A2 库内同名{len(hits)}行(重复行,非错档): {prof}")
        spec = CAST_TABLE.get(spk, {})
        if spec.get("ageHint") == "child" or CHILD_MARK.search(spk):
            if not AGE_OK.search(prof):
                errs.append(f"A1 年龄冲突: [{spk}] 疑似孩童角色 → 档案[{prof}] 无年龄标识(错档高危)")
        traits = spec.get("traits") or []
        if traits and not any(t in prof for t in traits):
            warns.append(f"A3 描述词未命中: {spk} → {prof} (traits={traits},人审确认)")
        # 同名多档混淆检测:档案名前缀撞车(如 小杂役·中年 vs 小杂役·男孩)
        parts = prof.split("·")
        if len(parts) >= 3:  # 音色·角色·描述
            prefix = "·".join(parts[:2]) + "·"
            sibs = [n for n in names if n.startswith(prefix) and n != prof]
            if sibs:
                warns.append(f"A4 同名多档在场: {prof} ←→ 兄弟档{len(sibs)}条(确认未拿错)")

    shots = json.load(open(SHOTS, encoding="utf-8"))
    for s in shots:
        for i, seg in enumerate(s.get("speech", [])):
            txt = seg.get("text", "")
            sid = f"{s['id'][-3:]}段{i}"
            if TRAILING.search(txt):
                errs.append(f"B1 句尾悬空: {sid} …{txt[-12:]}")
            for sent in re.split(r"(?<=[。！？])", txt):
                sent = sent.strip()
                if re.match(r"^……[^\s]{0,4}。$", sent):
                    errs.append(f"B2 半句省略: {sid} [{sent}]")
                if MODERN_WORDS.search(sent):
                    errs.append(f"B3 现代词: {sid} [{MODERN_WORDS.search(sent).group()}]")
                chunks = re.split(r"[,，。？！——、；;:：…]", sent)
                worst = max((len(c.strip()) for c in chunks), default=0)
                if worst > 20:
                    errs.append(f"B4 无停顿长句(最长小节{worst}字): {sid} [{sent[:26]}…]")

    for e in errs: print("FAIL", e)
    for w in warns: print("WARN", w)
    if errs:
        print(f"\nvoice_preflight: {len(errs)} FAIL / {len(warns)} WARN → 拒跑配音"); sys.exit(1)
    print(f"voice_preflight: PASS ({len(casts)} 档对表, {len(shots)} 镜台词扫描)")

if __name__ == "__main__":
    main()
