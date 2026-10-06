#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_report.py — 生成 九型实弹总报告.md(qi21-9xing-livefire 收账)。

引文纪律的实现:§1 三段提示词/§2 失败证据/§3 偏差账全部从 runs/type-*.md 程序化逐字抽取
(标题行自写,源内 blockquote 标注与 fenced 块原样搬运),零手抄;收账员标注一律在引文外。
§4/§8 的引擎/家底核账数字为生成时点实测(subprocess 现跑,输出原文嵌入)。
两段式:--final 时 §6 摘要嵌入 verdict.txt 终判(须先跑 verify_closeout.py)。
"""
import hashlib
import json
import os
import subprocess
import sys

CAMP = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(CAMP, "..", "..", "..", "..", ".."))
REPORT = os.path.join(CAMP, "九型实弹总报告.md")
ENGINE_COMFY = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI"
WORKFLOW = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"

FINAL = "--final" in sys.argv

# 收账任务书给定(九型实弹结果)+ 记录 §2 对账
TYPES = [
    # (slug, 中文名, 状态, 耗时min, prompt_id, 排队→终态 CST)
    ("type-1-人物", "人物", "ok", "4.23", "9c4d3719-5d46-4f91-8dac-eac84336f713", "09:19:53→09:24:07"),
    ("type-2-场景", "场景", "ok", "6.9", "c1707be8-c301-44d5-b0d7-6411439d04a3", "09:37:35→09:44:28"),
    ("type-3-道具", "道具", "FAIL(透明门红)", "6.72", "fc46aba4-3c78-493b-8bf5-b82e8def7c7a", "10:08:32→10:15:15"),
    ("type-4-美宣", "美宣", "ok", "6.89", "ad8280e7-62cf-4cd7-81b7-c266f18a1c6a", "10:31:23→10:38:17"),
    ("type-5-多视图", "多视图", "FAIL(透明门红)", "6.83", "c972ae02-8ccb-4678-b663-a19b23f70f1f", "10:56:55→11:03:45"),
    ("type-6-高清人脸", "高清人脸", "FAIL(透明门红)", "6.21", "a00b747a-301e-432b-bd15-819538c072b7", "11:15:50→11:22:03"),
]
NOT_RUN = [("type-7-分镜剧情图", "分镜剧情图"), ("type-8-表情差分", "表情差分"), ("type-9-概念气氛图", "概念气氛图")]

# 后核计数一律从 postcheck.json 实数读取(复核勘正:失败型实为 19 项/绿 18/红 1,旧报告硬编码 17/18 有误)
POST = {}
for _slug, *_rest in TYPES:
    _pc = json.load(open(os.path.join(CAMP, "verify", _slug + ".postcheck.json"), encoding="utf-8"))
    POST[_slug] = dict(total=len(_pc["checks"]),
                       green=sum(1 for c in _pc["checks"] if c["ok"]),
                       red=sum(1 for c in _pc["checks"] if not c["ok"]))
_ok_t = {POST[s]["total"] for s, n, st, *_r in TYPES if st == "ok"}
_ok_g = {POST[s]["green"] for s, n, st, *_r in TYPES if st == "ok"}
_fail_t = {POST[s]["total"] for s, n, st, *_r in TYPES if st.startswith("FAIL")}
_fail_g = {POST[s]["green"] for s, n, st, *_r in TYPES if st.startswith("FAIL")}
assert len(_ok_t) == len(_ok_g) == len(_fail_t) == len(_fail_g) == 1, POST  # 六型两类口径各自一致
OK_COUNT = f"{_ok_g.pop()}/{_ok_t.pop()}"      # ok 型:18/18
FAIL_COUNT = f"{_fail_g.pop()}/{_fail_t.pop()}"  # 失败型:18/19


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    return r.stdout.strip() if r.returncode == 0 else f"<rc={r.returncode}> {r.stdout.strip()} {r.stderr.strip()}"


def md_lines(slug):
    with open(os.path.join(CAMP, "runs", slug + ".md"), encoding="utf-8") as f:
        return f.read().split("\n")


def find_heading(lines, prefixes):
    for i, l in enumerate(lines):
        if any(l.startswith(p) for p in prefixes):
            return i
    raise SystemExit(f"heading not found: {prefixes}")


def extract_section(lines, start_prefixes, skip_heading=True):
    """从命中标题行起到下一个 '## ' 标题行止(不含),逐字返回;默认跳过源标题行本身
    (避免源 '## 6.'/'## 7.' 打乱本报告大纲;节内一切正文行含表格逐字不动)。"""
    i = find_heading(lines, start_prefixes)
    out = [] if skip_heading else [lines[i]]
    for l in lines[i + 1:]:
        if l.startswith("## "):
            break
        out.append(l)
    while out and out[-1].strip() == "":
        out.pop()
    return out


def extract_prompt(lines, heading_prefixes):
    """标题后:收集源 blockquote 标注行 + 首 fenced 块内容(逐字)。"""
    i = find_heading(lines, heading_prefixes)
    ann, j = [], i + 1
    while j < len(lines):
        l = lines[j]
        if l.startswith("```"):
            marker = len(l) - len(l.lstrip("`"))
            k = j + 1
            while k < len(lines):
                s = lines[k].strip()
                if s and set(s) == {"`"} and len(s) >= marker:
                    return ann, lines[j + 1:k]
                k += 1
            raise SystemExit(f"unclosed fence after {heading_prefixes}")
        if l.startswith(">"):
            ann.append(l)
        j += 1
    raise SystemExit(f"no fence after {heading_prefixes}")


out = []
w = out.append

# ============ 头部 ============
md5_now = sh(f"md5 -q '{WORKFLOW}'", cwd=REPO)
size_now = sh(f"stat -f '%z' '{WORKFLOW}'", cwd=REPO)
w("# qi21 道劫·九型实弹 总报告(qi21-9xing-livefire)")
w("")
w("- **收账时点**:2026-10-06(收账员会话);**战役目录**:apps/build/scripts/campaigns/qi21-9xing-livefire/(预检底册 FACTS.md)")
w(f"- **待测工作流**:{WORKFLOW}(md5 `{md5_now}`,{size_now}B——与 FACTS §1 预检基线 `65d4708ff1d9557caa8813e913b516b6` 同值,实弹全程未改;各型记录亦逐型复核同版)")
w("- **引擎**:http://127.0.0.1:17000(pid 92224,manifest port=17000,comfyui 0.38.0/mps)——**复用现役,本 run 未起引擎(engineStartedByUs=false),收摊不杀**(§4)")
w("- **实弹窗口**(引擎侧收据日志锚,logs/archive-manifest.md):2026-10-06 **09:08:07**(型1 首拍=缓存回声拍 `f3539410` 入队)→ **11:37:23**(型6 wh探针2 `d53b7e88` 入队,当日日志末笔);六发产线拍 09:19:53(型1)→ 11:22:03(型6 终态)")
w(f"- **结果**:6 型已实弹——**ok 3**(人物/场景/美宣,后核 {OK_COUNT} 全绿)/**FAIL 3**(道具/多视图/高清人脸,均「透明门红」{FAIL_COUNT}——19 项后核绿 18、唯一红=透明门「四角 alpha<=8」,详证 §2);九型中 **7-9 型(分镜剧情图/表情差分/概念气氛图)本 run 未拍**,runs/ 无记录文件(§0 注)。计数口径:本报告与记录计数均以 verify/type-*.postcheck.json checks 实数为准(2026-10-06 12:1x 复核勘正——失败型旧记「17/18」系笔误,已三处就地勘正并录勘正条于各记录 §9,fix_counts_review.py 幂等可复跑)")
w("- **引文纪律**:§1 三段提示词全文、§2 失败证据、§3 偏差账均为 runs/type-*.md 程序化逐字抽取(make_report.py,零手抄);一切收账员标注均在引文外;状态/耗时/prompt_id 列取自收账任务书并经记录与后核对账(§6 附查 E)。")
w("")

# ============ §0 索引表 ============
w("## 0. 九型索引表")
w("")
w("| # | 型 | 状态 | 实测耗时(min) | 排队→终态(CST) | prompt_id | 产物图(本仓) | 关键收据(本仓) |")
w("|---|---|---|---|---|---|---|---|")
for n, (slug, name, status, dur, pid, span) in enumerate(TYPES, 1):
    w(f"| {n} | {name} | {status} | {dur} | {span} | `{pid}` | images/{slug}.direct.png<br>images/{slug}.2k.png | runs/{slug}.history.json<br>verify/{slug}.postcheck.json |")
for n, (slug, name) in enumerate(NOT_RUN, 7):
    w(f"| {n} | {name} | 未拍 | — | — | — | — | —(runs/ 无该型记录文件) |")
w("")
w("注:①状态/耗时/prompt_id 为收账任务书给定;后核对账=每型 history `execution_start.prompt_id` 与上表逐字相等、终态 `status_str=success`(§6 附查 E 12/12 绿)。②耗时=驱动器 durationMin(排队→出图,含模型加载+Fun-Acc 4 步采样+SeedVR2 2K 放大)。③「未拍」三型经实测 runs/ 目录无 type-7/8/9 任何文件(find 实测);九型名单与序=FACTS §2 真源十档(九型+自由)之前九。")
w("")

# ============ §1 三段提示词 ============
w("## 1. 每型三段提示词全文逐字(源:runs/type-*.md §1;①输入主体句 ②PE 改写输出 ③最终正向全文 ③′最终负向全文)")
w("")
for n, (slug, name, status, dur, pid, span) in enumerate(TYPES, 1):
    lines = md_lines(slug)
    w(f"### 型{n} {name}——{status}(源:runs/{slug}.md §1;下述「>」标注与代码块引文均自该文件逐字抽取)")
    w("")
    # ①
    ann, block = extract_prompt(lines, ("### ①",))
    w("#### ① 输入主体句([400] 置值)")
    w("")
    for a in ann:
        w(a)
    if ann:
        w("")
    w("```text")
    out.extend(block)
    w("```")
    w("")
    # ②
    ann, block = extract_prompt(lines, ("### ②",))
    w("#### ② PE 改写输出([6:4013] QwenImage21_T2IPromptRewrite;PE启用?=true 保存态)")
    w("")
    for a in ann:
        w(a)
    if ann:
        w("")
    w("```text")
    out.extend(block)
    w("```")
    w("")
    # ③
    ann, block = extract_prompt(lines, ("### ③′", "### ③ "))
    if not block:  # 兜底:标题无尾随空格的写法
        ann, block = extract_prompt(lines, ("### ③",))
    w("#### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字)")
    w("")
    for a in ann:
        w(a)
    if ann:
        w("")
    w("```text")
    out.extend(block)
    w("```")
    w("")
    # ③′
    ann, block = extract_prompt(lines, ("### ③′",))
    w("#### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,文本在链生成并预览,采样端不消费)")
    w("")
    for a in ann:
        w(a)
    if ann:
        w("")
    w("```text")
    out.extend(block)
    w("```")
    w("")

# ============ §2 失败型证据 ============
w("## 2. 失败型证据(3/5/6 型——透明门红;整节为 runs/type-*.md §7 逐字引,含其自带表格;收账员标注仅本行与各小节首行)")
w("")
for n, slug, name in ((3, "type-3-道具", "道具"), (5, "type-5-多视图", "多视图"), (6, "type-6-高清人脸", "高清人脸")):
    lines = md_lines(slug)
    w(f"### 2.{[3,5,6].index(n)+1} 型{n} {name}——FAIL(透明门红;后核 verify/{slug}.postcheck.json exit=1,{POST[slug]['green']}/{POST[slug]['total']},唯一红=透明门「四角 alpha<=8」)")
    w("")
    w(f"以下逐字引 runs/{slug}.md §7 全节正文(仅不复制其「## 7.」标题行——标题已录于上;节内一切行含表格逐字不动):")
    w("")
    out.extend(extract_section(lines, ("## 7.",)))
    w("")
    w("")

# ============ §3 与保存态偏差 ============
w("## 3. 与保存态偏差(owner 2026-10-06 裁定记账;各型记录 §6 逐字引——型1 记录 §6 标题自带「总报告须列『与保存态偏差』节」令,本节即应令而立)")
w("")
for n, (slug, name, *_rest) in enumerate(TYPES, 1):
    lines = md_lines(slug)
    w(f"**型{n} {name}**(runs/{slug}.md §6 全节正文逐字引;仅不复制其「## 6.」标题行):")
    w("")
    out.extend(extract_section(lines, ("## 6.",)))
    w("")
    w("")

# ============ §4 引擎账 ============
import time as _time
NOW = _time.strftime("%H:%M:%S")
CLOSEOUT_QUEUE = '{"queue_running": [], "queue_pending": []}'  # 收摊时点(12:09-12:10)实测原文(报告/verdict 落盘 12:10 为证)
six_pids = {pid for _s, _n, _st, _d, pid, _sp in TYPES}
queue_now = sh("curl -s --max-time 10 http://127.0.0.1:17000/queue")
q_pids = []
q_summary = "<队列解析失败>"
try:
    _qj = json.loads(queue_now)
    _qr = _qj.get("queue_running", [])
    _qp = _qj.get("queue_pending", [])
    for _e in _qr + _qp:
        if len(_e) > 1 and isinstance(_e[1], str):
            q_pids.append(_e[1])
    # 只嵌摘要——/queue 原文含在队全量 prompt(可达百余 KB),不得整段入报告
    q_summary = f"running={len(_qr)} pending={len(_qp)}"
except Exception as _e:  # noqa: BLE001
    q_pids = [f"<解析失败 {_e}>"]
overlap = sorted(set(q_pids) & six_pids)
# 归档窗(行10-45)之后引擎侧日志的新入队(收摊后并行会话续拍记账)
IP_LOG = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/image-prompts-20261006.log"
ip_all = [l for l in open(IP_LOG, encoding="utf-8").read().split("\n") if l.strip()]
post_closeout = [l for l in ip_all[45:] if l.startswith("[MY出图][入队]")]
post_str = ";".join(p.split("] ", 1)[-1] for p in post_closeout) if post_closeout else "无"
post_overlap = [p for p in post_closeout if any(pid in p for pid in six_pids)]
stats_now = sh("curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:17000/system_stats")
ps_now = sh("ps -p 92224 -o pid,etime,command | tail -1 | cut -c1-120")
egit_now = sh(f"git -C '{ENGINE_COMFY}' status --porcelain")
w("## 4. 引擎账(谁起的/怎么收的)")
w("")
w("**谁起的**:现役引擎,MYStudio 托管(engine_manager 按需拉起;FACTS §4.3 预检实测+machine.md 口径)——pid 92224 = `<引擎家>/venv/bin/python <引擎家>/ComfyUI/main.py --listen 127.0.0.1 --port 17000 --enable-manager --gpu-only --reserve-vram 16 --use-pytorch-cross-attention …`(实体路径直跑)。本 run 六发产线拍+五发 wh 探针全部复用该现役进程,**未起、未重启引擎**;六型记录逐一载明「复用现役,非本 run 所起(engineStartedByUs=false)」(各型记录 §首,见 §7 索引)。")
w("")
w("**怎么收的**:非本 run 所起 ⇒ **不 pkill、引擎留着**;收摊仅做四笔核账(收账员实测,命令与输出原文):")
w("")
w("1. 队列核账(双时点):")
w("   - **收摊时点(2026-10-06 12:09-12:10,动任何收摊动作前先验)**:`curl -s http://127.0.0.1:17000/queue` → `" + CLOSEOUT_QUEUE + "`(running/pending 双空,==0)——收摊合格。")
w(f"   - **复核重写时点({NOW} 复测)**:`{q_summary}`(在队 prompt_id={q_pids or '无'};/queue 原文含在队全量 prompt,此处只录摘要),与本役六型 prompt_id 交集={'、'.join(overlap) if overlap else '空'}" + ("——**⚠️ 有本役 pid 在队,须查!**" if overlap else "(非本役任务)。"))
w(f"   - **收摊后新投记账**(引擎侧收据日志行46 起实测):{post_str or '无'}——经程序化对账{('**⚠️ 含本役 pid!**' if post_overlap else '均非本役六型任何 pid')};系收摊后并行会话续拍(引擎日志序号 number=14/15 续 13 之后),不构成本役收摊账失实(复核意见同口径)。")
w(f"2. 引擎健在:`curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:17000/system_stats` → HTTP {stats_now};`ps -p 92224` → `{ps_now}`")
w(f"3. 引擎家 git 零改动:`git -C {ENGINE_COMFY} status --porcelain` → {'(0 行输出=空,与 FACTS §4.2 预检基线「空基线」一致)' if egit_now == '' else '(输出:' + egit_now + ')'}")
w("4. 无人值守手拉=无:本役零手拉引擎(FACTS §4.3「不存在已验证的 headless 手拉」口径,未破例)。")
w("")
w("**队列/序号账**:引擎侧当日收据日志入队序号 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13——**缺 8**(服务端序号器口径,日志内无对应入队行;runs/type-5-多视图.md §9、runs/type-6-高清人脸.md §9 已记,如实不推测);本役 12 次入队逐笔锚表见 logs/archive-manifest.md。")
w("")

# ============ §5 日志归档 ============
w("## 5. 日志归档(引擎侧→本仓 logs/;切片只读源文件)")
w("")
w("| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片窗 | 字节/行数 | sha256 |")
w("|---|---|---|---|---|")
w("| logs/engine-side.image-prompts-20261006.lines10-45.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/image-prompts-20261006.log | 行10-45(2026-10-06 09:08:07→11:37:23,本役全部 12 次入队块) | 70,450B/36 行 | `71904c8b246d29eb4a544bcedd16dd19b0954810bea802deeeb772d8e986ca2c` |")
w("| logs/engine-side.engine.console.lines96875-end.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/engine.log | 行96875-97469(窗起=09:08:07 入队行,窗止=文件末行,mtime 11:37) | 623,403B/595 行 | `c6107be284785876bb5959dc5077bdbb20fd0c633ba7b39ea2cb4a3335998976` |")
w("")
w("另:六型逐拍收据段摘录(入队+摘要+全量JSON 三行)在本仓 logs/ 目录的各型 `*.image-prompts.excerpt.log`(§7 索引逐件列名);归档脚本 archive_engine_logs.py(行首锚断言+逐字节切片,幂等),明细与复取命令见 logs/archive-manifest.md。")
w(f"归档窗后新增记账(复核重写时点 {NOW} 实测):引擎侧源日志在归档窗(行10-45)后已增长至 {len(ip_all)} 行——行46 起为收摊后并行会话新投({post_str or '无'}),新投 pid 经程序化对账非本役六型,不入本役归档窗;窗锚(行10=09:08:07 入队/行43=11:37:23 末次入队/行45=末块全量JSON)不变。")
w("")

# ============ §6 verify 摘要 ============
w("## 6. verify 判定摘要")
w("")
w("机器校验脚本:verify/verify_closeout.py(引擎 venv python 跑,要 PIL);**判定清单落盘:verify/verdict.txt**。")
w("")
if FINAL:
    vtext = open(os.path.join(CAMP, "verify", "verdict.txt"), encoding="utf-8").read().split("\n")
    heads = [l for l in vtext if l.startswith("== ")]
    tail = [l for l in vtext if l.startswith("总判:")]
    w("verdict.txt 组级摘要(逐字引):")
    w("")
    for h in heads:
        w(f"> {h}")
    w(">")
    for t in tail:
        w(f"> {t}")
    w("")
else:
    w("判定(四查 A 记录齐全/B 图片 PNG 可解析/C raw JSON 可解析/D 本报告引用路径全部存在+附查 E prompt_id·终态对账):**终判以 verify/verdict.txt 为准**(本报告落盘后即跑;pass A 预跑:A/B/C/E 已全绿,唯 D 待本报告存在)。")
    w("")

# ============ §7 收据索引 ============
w("## 7. 三层收据存档索引(全型;均在本仓,存在性经 §6 [A] 查)")
w("")
w("| 型 | ① image-prompts 摘录 | ② PNG 元数据 | ③ history | 驱动 raw | 驱动控制台 | 后核(权威判) | 产物图 |")
w("|---|---|---|---|---|---|---|---|")
for slug, name, *_rest in TYPES:
    w(f"| {name} | logs/{slug}.image-prompts.excerpt.log | verify/{slug}.png-prompt-metadata.json | runs/{slug}.history.json | runs/{slug}.json | logs/{slug}.driver.console.log | verify/{slug}.postcheck.json | images/{slug}.direct.png<br>images/{slug}.2k.png |")
w("")
w("型1 另有首拍(缓存回声)存档四件:runs/type-1-人物.attempt1-cache-echo.json、runs/type-1-人物.history.attempt1-cache-echo.json、verify/type-1-人物.cache-collision-diff.json、logs/type-1-人物.driver.console.attempt1.log(§3 型1 偏差账证据)。")
w("")

# ============ §8 家底 ============
git_now = sh("git status --porcelain", cwd=REPO)
w("## 8. 本仓家底与收摊核账(收账时点实测)")
w("")
w("- **工作流真源**:" + WORKFLOW + f" → md5 `{md5_now}`/{size_now}B(=FACTS §1 基线,未改)。")
w("- **本仓 git**(`git status --porcelain`,于仓库根,输出原文):")
w("")
for l in git_now.split("\n"):
    w(f"    {l}")
w("")
mods = [l.strip()[2:] for l in git_now.split("\n") if l.strip().startswith("M")]
mods_str = "、".join(mods)
preexisting_note = (
    "其中 apps/frontend/components/Dashboard.tsx 与 apps/frontend/index.css 为收账会话起手首查(本会话第一条 git status,时点先于本会话首件产物 archive_engine_logs.py 落盘 11:58)已在的先存改动"
    if "apps/eslint.config.mjs" in mods else
    "均为收账会话起手首查(本会话第一条 git status)已在的先存改动"
)
midway_note = (
    ";apps/eslint.config.mjs(+5 行,git diff --stat 实测)系**收账会话中途出现**(首查无、终查有,终查 12:09;本 run 全部写操作均在战役目录内,收账员零写跟踪文件)——非本 run 产物"
    if "apps/eslint.config.mjs" in mods else ""
)
w(f"  判读:本 run 新增=apps/build/scripts/campaigns/qi21-9xing-livefire/(未跟踪目录,§0-§7 全部产物在内;收账员本会话新增=archive_engine_logs.py、verify/verify_closeout.py、make_report.py、logs/ 两切片+archive-manifest.md、verify/verdict.txt、本报告;战役目录另有驱动侧在档件 drive_type.mjs/postcheck_type.py/FACTS.md,及**收账会话中途(12:07)新增的 app_short_conn.mjs/probe_canvas.mjs——非收账员所写,疑似并行会话工具件,原样记账**);**跟踪文件改动 {len(mods)} 处({mods_str})非本 run 产物**——{preexisting_note}{midway_note};原样记入收账 problems,不在本役处置域。")
w(f"- **引擎家 git**:`git -C {ENGINE_COMFY} status --porcelain` → {'0 行输出(空)=与 FACTS §4.2 预检基线一致,零改动' if egit_now == '' else '输出:' + egit_now}。")
w("- **引擎队列**:收摊时点(12:09-12:10)实测 `" + CLOSEOUT_QUEUE + "`(==0;§4 第1笔);复核重写时点(" + NOW + ")复测 " + q_summary + "(在队 pid 与本役六型" + ("零交集" if not overlap else "**⚠️ 有交集**") + ",收摊后新投见 §4/§5 记账)。")
w("")

with open(REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("report written:", REPORT, os.path.getsize(REPORT), "bytes; FINAL=", FINAL)
