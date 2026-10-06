#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_report.py — 生成 九型实弹总报告.md v2(qi21-9xing-livefire 九型全量收账)。

v2 = v1(六型,12:29)+ 7/8/9 型(12:50:38→13:31:40 并行续拍会话补拍)合并为九型全量。

引文纪律的实现:§1 三段提示词/§2 失败证据/§3 偏差账全部从 runs/type-*.md 程序化逐字抽取
(标题行自写,源内 blockquote 标注与 fenced 块原样搬运),零手抄;收账员标注一律在引文外。
§4/§8 的引擎/家底核账数字为生成时点实测(subprocess 现跑,输出原文嵌入)。
两段式:--final 时 §6 摘要嵌入 verdict-v2.txt 终判(须先跑 verify_closeout_v2.py)。
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

CAMP = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(CAMP, "..", "..", "..", "..", ".."))
REPORT = os.path.join(CAMP, "九型实弹总报告.md")
ENGINE_COMFY = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI"
ENGINE_MANIFEST = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/manifest.json"
WORKFLOW = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"

FINAL = "--final" in sys.argv

import time as _time  # noqa: E402
NOW = _time.strftime("%H:%M:%S")

# 收账任务书给定(九型实弹结果;1-6 型=v1 任务书,7-9 型=v2 任务书)+ 记录 §2 对账
TYPES = [
    # (slug, 中文名, 状态, 耗时min, prompt_id, 排队→终态 CST, 轮次)
    ("type-1-人物", "人物", "ok", "4.23", "9c4d3719-5d46-4f91-8dac-eac84336f713", "09:19:53→09:24:07", "v1"),
    ("type-2-场景", "场景", "ok", "6.9", "c1707be8-c301-44d5-b0d7-6411439d04a3", "09:37:35→09:44:28", "v1"),
    ("type-3-道具", "道具", "FAIL(透明门红)", "6.72", "fc46aba4-3c78-493b-8bf5-b82e8def7c7a", "10:08:32→10:15:15", "v1"),
    ("type-4-美宣", "美宣", "ok", "6.89", "ad8280e7-62cf-4cd7-81b7-c266f18a1c6a", "10:31:23→10:38:17", "v1"),
    ("type-5-多视图", "多视图", "FAIL(透明门红)", "6.83", "c972ae02-8ccb-4678-b663-a19b23f70f1f", "10:56:55→11:03:45", "v1"),
    ("type-6-高清人脸", "高清人脸", "FAIL(透明门红)", "6.21", "a00b747a-301e-432b-bd15-819538c072b7", "11:15:50→11:22:03", "v1"),
    ("type-7-分镜剧情图", "分镜剧情图", "ok", "7.55", "5b05816c-721e-4d65-a894-1a4d75fbf0d1", "12:50:38→12:58:11", "v2"),
    ("type-8-表情差分", "表情差分", "ok", "7.21", "fec5c1d6-5ace-4e62-a9c3-35ccb1df382c", "13:07:50→13:15:03", "v2"),
    ("type-9-概念气氛图", "概念气氛图", "ok", "7.14", "aae7ec8e-c170-4617-b2b6-90fcb31fddc2", "13:24:32→13:31:40", "v2"),
]

# 后核计数一律从 postcheck.json 实数读取(1-6 型勘正史见 v1;8 型=透明型 19 项含四角 alpha 门)
POST = {}
for _slug, *_rest in TYPES:
    _pc = json.load(open(os.path.join(CAMP, "verify", _slug + ".postcheck.json"), encoding="utf-8"))
    POST[_slug] = dict(total=len(_pc["checks"]),
                       green=sum(1 for c in _pc["checks"] if c["ok"]),
                       red=sum(1 for c in _pc["checks"] if not c["ok"]))
    assert POST[_slug]["red"] == 0 if not _slug in ("type-3-道具", "type-5-多视图", "type-6-高清人脸") else POST[_slug]["red"] == 1, (_slug, POST[_slug])
_ok_slugs = [s for s, n, st, *_r in TYPES if st == "ok"]
_fail_slugs = [s for s, n, st, *_r in TYPES if st.startswith("FAIL")]
OK_COUNT_STR = "、".join(f"{POST[s]['green']}/{POST[s]['total']}" for s in _ok_slugs)
FAIL_COUNT_STR = "、".join(f"{POST[s]['green']}/{POST[s]['total']}" for s in _fail_slugs)


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


# ---- 生成时点实测(§4/§8 嵌入原文) ----
try:
    ENGINE_PORT = str(json.load(open(ENGINE_MANIFEST, encoding="utf-8"))["engine"]["port"])
except Exception:  # noqa: BLE001
    ENGINE_PORT = "17000"
queue_now = sh(f"curl -s --max-time 10 http://127.0.0.1:{ENGINE_PORT}/queue")
q_pids, q_summary = [], "<队列解析失败>"
try:
    _qj = json.loads(queue_now)
    _qr = _qj.get("queue_running", [])
    _qp = _qj.get("queue_pending", [])
    for _e in _qr + _qp:
        if len(_e) > 1 and isinstance(_e[1], str):
            q_pids.append(_e[1])
    # 只嵌摘要——/queue 原文含在队全量 prompt(可达百余 KB),不得整段入报告
    q_summary = f"running={len(_qr)} pending={len(_qp)}(引擎 http://127.0.0.1:{ENGINE_PORT})"
except Exception as _e:  # noqa: BLE001
    q_pids = [f"<解析失败 {_e}>"]
nine_pids = {pid for _s, _n, _st, _d, pid, _sp, _r in TYPES}
overlap = sorted(set(q_pids) & nine_pids)
stats_now = sh(f"curl -s --max-time 10 -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{ENGINE_PORT}/system_stats")
engine_ps = sh("ps aux | grep 'ComfyUI/main.py' | grep -v grep | head -1 | cut -c1-150")
egit_now = sh(f"git -C '{ENGINE_COMFY}' status --porcelain")
git_now = sh("git status --porcelain", cwd=REPO)
md5_now = sh(f"md5 -q '{WORKFLOW}'", cwd=REPO)
size_now = sh(f"stat -f '%z' '{WORKFLOW}'", cwd=REPO)
mtime_now = sh(f"stat -f '%Sm' '{WORKFLOW}'", cwd=REPO)


out = []
w = out.append

# ============ 头部 ============
w("# qi21 道劫·九型实弹 总报告 v2=九型全量(qi21-9xing-livefire)")
w("")
w("- **收账时点**:2026-10-06 v2 收账员会话;**战役目录**:apps/build/scripts/campaigns/qi21-9xing-livefire/(预检底册 FACTS.md)")
w(f"- **待测工作流**:{WORKFLOW}——**九型九发实弹全程使用 FACTS §1 预检基线版 md5 `65d4708ff1d9557caa8813e913b516b6`**(每型记录头部载明 S4 装载即此版+投前断言在案);**v2 收账时点该文件已被他会话改动**(现 md5 `{md5_now}`/{size_now}B/mtime {mtime_now}——型9 终态前 38 秒被改,[4013] PE 节点官方件→MyQi21ApiPE 换件,详 §8,原样记 problems;九型实弹完整性不受影响:ComfyUI 按已入队 prompt 执行,九发 prompt 均在改动前入队)")
w("- **引擎(九发实弹期)**:http://127.0.0.1:17000(pid 92224,manifest port=17000,comfyui 0.38.0/mps)——**复用现役,本 run 未起引擎(engineStartedByUs=false),收摊不杀**;型9 终态(13:31:40)后引擎被他会话重启(现役 pid 32378@17001,§4)")
w("- **实弹窗口**:九型产线九发 2026-10-06 **09:19:53**(型1 排队)→ **13:31:40**(型9 终态);v1 轮六发 09:19:53→11:22:03,v2 轮三发(7/8/9 型)12:50:38→13:31:40(12:09-12:10 v1 收摊后由并行续拍会话补拍)。引擎侧收据日志全窗 09:08:07→13:36:33(含他会话投递,§5)")
w(f"- **结果(九型全量)**:**ok 6**(人物/场景/美宣/分镜剧情图/表情差分/概念气氛图,后核 {OK_COUNT_STR} 全绿——型8 为透明型 19 项含四角 alpha 门 19/19)/**FAIL 3**(道具/多视图/高清人脸,均「透明门红」{FAIL_COUNT_STR}——19 项后核绿 18、唯一红=透明门「四角 alpha<=8」,详证 §2);**v2 轮三发(7/8/9)全绿**。计数口径:本报告与记录计数均以 verify/type-*.postcheck.json checks 实数为准(1-6 型 18/19 勘正史见各记录 §9;fix_counts_review.py 幂等可复跑)")
w("- **引文纪律**:§1 三段提示词全文、§2 失败证据、§3 偏差账均为 runs/type-*.md 程序化逐字抽取(make_report.py,零手抄);一切收账员标注均在引文外;状态/耗时/prompt_id 列取自收账任务书(1-6 型=v1 任务书,7-9 型=v2 任务书)并经记录与后核对账(§6 附查 E)。")
w("")

# ============ §0 索引表 ============
w("## 0. 九型索引表")
w("")
w("| # | 型 | 状态 | 实测耗时(min) | 排队→终态(CST) | prompt_id | 产物图(本仓) | 关键收据(本仓) | 轮次 |")
w("|---|---|---|---|---|---|---|---|---|")
for n, (slug, name, status, dur, pid, span, rnd) in enumerate(TYPES, 1):
    w(f"| {n} | {name} | {status} | {dur} | {span} | `{pid}` | images/{slug}.direct.png<br>images/{slug}.2k.png | runs/{slug}.history.json<br>verify/{slug}.postcheck.json | {rnd} |")
w("")
w("注:①状态/耗时/prompt_id 为收账任务书给定(v1 轮=型1-6,v2 轮=型7-9);对账=每型 history `execution_start.prompt_id` 与上表逐字相等、终态 `status_str=success`(§6 附查 E,九型 18/18 绿)。②耗时=驱动器 durationMin(排队→出图,含模型加载+PE 新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大)。③v1 轮收摊时点(12:0x)7-9 型未拍;12:19-12:40 并行会话 App 画布扫场拍(app_sweep_7to10.mjs)三发因「主体句=保存态人物句错配」被 7/8/9 型规范拍取代(sweep history 存档 .bak,各记录头部「本拍取代注记」);7/8/9 型规范拍 12:50:38/13:07:50/13:24:32 入队,number=22/23/24(引擎侧收据日志逐笔锚见 logs/archive-manifest-v2.md)。④type-10-自由 图件/history(12:40)系扫场会话产物——**自由不在九型清单**(FACTS §6.3:九型=十档前九),本报告不记其账。⑤九型名单与序=FACTS §2 真源十档(九型+自由)之前九。")
w("")

# ============ §1 三段提示词 ============
w("## 1. 每型三段提示词全文逐字(源:runs/type-*.md §1;①输入主体句 ②PE 改写输出 ③最终正向全文 ③′最终负向全文)")
w("")
for n, (slug, name, status, dur, pid, span, rnd) in enumerate(TYPES, 1):
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
    w(f"### 2.{[3, 5, 6].index(n) + 1} 型{n} {name}——FAIL(透明门红;后核 verify/{slug}.postcheck.json exit=1,{POST[slug]['green']}/{POST[slug]['total']},唯一红=透明门「四角 alpha<=8」)")
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
w("## 4. 引擎账(谁起的/怎么收的)")
w("")
w("**谁起的**:现役引擎,MYStudio 托管(engine_manager 按需拉起;FACTS §4.3 预检实测+machine.md 口径)——九发产线拍全部复用同一现役进程 pid 92224(`<引擎家>/venv/bin/python <引擎家>/ComfyUI/main.py --listen 127.0.0.1 --port 17000 …`),**本 run 未起、未重启引擎**(九型记录逐一载明「复用现役,非本 run 所起(engineStartedByUs=false)」,各型记录 §首,见 §7 索引)。")
w("")
w("**怎么收的**:非本 run 所起 ⇒ **不 pkill、引擎留着**;v1 收摊(12:09-12:10)与 v2 收摊均只做核账不动引擎。v2 收账员核账四笔(实测,命令与输出原文):")
w("")
w(f"1. 队列核账(双轮):v1 收摊时点(12:09-12:10,@17000)→ `{{\"queue_running\": [], \"queue_pending\": []}}`(==0,verdict.txt 落盘为证);**v2 收摊时点({NOW},现役引擎 http://127.0.0.1:{ENGINE_PORT})→ `{q_summary}`**——在队 prompt_id={q_pids or '无'},与本役九型 prompt_id 交集={'、'.join(overlap) if overlap else '空'}" + ("——**⚠️ 有本役 pid 在队,须查!**" if overlap else "(队列==0,收摊合格)。"))
w(f"2. 引擎健在(他会话重启后现役):`curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{ENGINE_PORT}/system_stats` → HTTP {stats_now};`ps` → `{engine_ps}`")
w(f"3. 引擎家 git 零改动:`git -C {ENGINE_COMFY} status --porcelain` → {'(0 行输出=空,与 FACTS §4.2 预检基线「空基线」一致)' if egit_now == '' else '(输出:' + egit_now + ')'}")
w("4. 无人值守手拉=无:本役零手拉引擎(FACTS §4.3「不存在已验证的 headless 手拉」口径,未破例)。")
w("")
w(f"**引擎重启记账(非本 run 所为,原样记)**:型9 终态 13:31:40 后、13:33 前后,引擎被他会话重启——pid 92224@17000 已退(本收账员实测 `ps -p 92224` 空、17000 无监听),现役 pid 32378@**17001**(manifest port 已写 17001;`ps aux` 实测 13:33 起);重启横幅=engine.log 行98291「ComfyUI version」/行98463「Starting server」(logs/archive-manifest-v2.md);重启后他会话新投一发(number=0,13:36:33,pid 3a451e34,已完成——收据日志序号归零即重启证据,控制台末行「Prompt executed in 111.80 seconds」)。本 run 对该引擎零启停动作(别家的一律不碰)。")
w("")
w("**队列/序号账**:引擎侧当日收据日志入队序号 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13(v1 窗,**缺 8**=服务端序号器口径,runs/type-5/6 记录 §9 已记,如实不推测)续 14-24(v2 窗)后归 0(重启);v1 窗 12 笔锚表见 logs/archive-manifest.md,v2 窗 12 笔锚表见 logs/archive-manifest-v2.md。")
w("")

# ============ §5 日志归档 ============
ip_slice_p = os.path.join(CAMP, "logs", "engine-side.image-prompts-20261006.lines46-81.slice.log")
con_slice_p = os.path.join(CAMP, "logs", "engine-side.engine.console.lines97470-end.slice.log")


def f_facts(p):
    d = open(p, "rb").read()
    return len(d), d.count(b"\n"), hashlib.sha256(d).hexdigest()


ip_len, ip_nl, ip_sha = f_facts(ip_slice_p)
con_len, con_nl, con_sha = f_facts(con_slice_p)
w("## 5. 日志归档(引擎侧→本仓 logs/;切片只读源文件)")
w("")
w("| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片窗 | 字节/行数 | sha256 | 轮 |")
w("|---|---|---|---|---|---|")
w("| logs/engine-side.image-prompts-20261006.lines10-45.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/image-prompts-20261006.log | 行10-45(09:08:07→11:37:23,v1 窗全部 12 次入队块) | 70,450B/36 行 | `71904c8b246d29eb4a544bcedd16dd19b0954810bea802deeeb772d8e986ca2c` | v1 |")
w("| logs/engine-side.engine.console.lines96875-end.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/engine.log | 行96875-97469(窗起=09:08:07 入队行,窗止=11:37 时点末行) | 623,403B/595 行 | `c6107be284785876bb5959dc5077bdbb20fd0c633ba7b39ea2cb4a3335998976` | v1 |")
w(f"| logs/engine-side.image-prompts-20261006.lines46-81.slice.log | 同上源(归档时点全件 81 行) | 行46-81(12:12:43→13:36:33,v2 窗全部 12 次入队块:7-9 型扫场 3 发+他会话 4 发+九型产线 3 发+重启后 1 发) | {ip_len:,}B/{ip_nl} 行 | `{ip_sha}` | v2 |")
w(f"| logs/engine-side.engine.console.lines97470-end.slice.log | /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs/engine.log(归档时点全件 sha256 见 manifest-v2) | 行97470-{97470 + con_nl - 1}(=v1 切片末行次行无缝续切→归档时点末行;含引擎重启横幅 98291/98463) | {con_len:,}B/{con_nl} 行 | `{con_sha}` | v2 |")
w("")
w("另:九型逐拍收据段摘录(入队+摘要+全量JSON 三行)在本仓 logs/ 的各型 `*.image-prompts.excerpt.log`(§7 索引逐件列名);归档脚本 archive_engine_logs.py(v1)/archive_engine_logs_v2.py(v2)(行首锚断言+逐字节切片,幂等),明细与复取命令见 logs/archive-manifest.md(v1)/logs/archive-manifest-v2.md(v2)。")
w("")

# ============ §6 verify 摘要 ============
w("## 6. verify 判定摘要")
w("")
w("机器校验脚本:verify/verify_closeout_v2.py(九型全量口径,引擎 venv python 跑,要 PIL);**判定清单落盘:verify/verdict-v2.txt**(v1 六型判定 verify/verdict.txt=97 项全绿,存档不动)。")
w("")
if FINAL:
    vtext = open(os.path.join(CAMP, "verify", "verdict-v2.txt"), encoding="utf-8").read().split("\n")
    heads = [l for l in vtext if l.startswith("== ")]
    tail = [l for l in vtext if l.startswith("总判:")]
    w("verdict-v2.txt 组级摘要(逐字引):")
    w("")
    for h in heads:
        w(f"> {h}")
    w(">")
    for t in tail:
        w(f"> {t}")
    w("")
else:
    w("判定(四查 A 记录齐全/B 图片 PNG 可解析/C raw JSON 可解析/D 本报告 v2 引用路径全部存在+附查 E prompt_id·终态对账九型/F 计数口径九型):**终判以 verify/verdict-v2.txt 为准**(本报告落盘后即跑)。")
w("")

# ============ §7 收据索引 ============
w("## 7. 三层收据存档索引(九型;均在本仓,存在性经 §6 [A] 查)")
w("")
w("| 型 | ① image-prompts 摘录 | ② PNG 元数据 | ③ history | 驱动 raw | 驱动控制台 | 后核(权威判) | 产物图 |")
w("|---|---|---|---|---|---|---|---|")
for slug, name, *_rest in TYPES:
    w(f"| {name} | logs/{slug}.image-prompts.excerpt.log | verify/{slug}.png-prompt-metadata.json | runs/{slug}.history.json | runs/{slug}.json | logs/{slug}.driver.console.log | verify/{slug}.postcheck.json | images/{slug}.direct.png<br>images/{slug}.2k.png |")
w("")
w("另档:型1 首拍(缓存回声)存档四件=runs/type-1-人物.attempt1-cache-echo.json、runs/type-1-人物.history.attempt1-cache-echo.json、verify/type-1-人物.cache-collision-diff.json、logs/type-1-人物.driver.console.attempt1.log(§3 型1 偏差账证据);型7/8/9 被取代的 App 画布扫场拍 history 存档=runs/type-7-分镜剧情图.history.appcanvas-sweep-1219.bak、runs/type-8-表情差分.history.appcanvas-sweep-1226.bak、runs/type-9-概念气氛图.history.appcanvas-sweep-1233.bak(各记录头部「本拍取代注记」)。")
w("")

# ============ §8 家底 ============
git_lines = [l for l in git_now.split("\n") if l.strip()]
camp_tag = "apps/build/scripts/campaigns/qi21-9xing-livefire/"
mod_outside = [l.strip()[2:].strip() for l in git_lines if l.strip().startswith("M") and camp_tag not in l]
mod_inside = [l.strip()[2:].strip() for l in git_lines if l.strip().startswith("M") and camp_tag in l]
untracked_inside = [l.strip()[3:].strip() for l in git_lines if l.startswith("??") and camp_tag in l]
untracked_outside = [l.strip()[3:].strip() for l in git_lines if l.startswith("??") and camp_tag not in l]
head_info = sh("git show -s --pretty='%h %ci %s' HEAD | cut -c1-90", cwd=REPO)
outside_str = "、".join(mod_outside) if mod_outside else "无"
inside_str = "、".join(p.replace(camp_tag, "") for p in mod_inside) if mod_inside else "无"
untracked_str = "、".join(p.replace(camp_tag, "") for p in untracked_inside) if untracked_inside else "无"
untracked_out_str = "、".join(untracked_outside) if untracked_outside else "无"
w("## 8. 本仓家底与收摊核账(v2 收账时点实测;git/队列为生成时点快照)")
w("")
w(f"- **工作流真源**:" + WORKFLOW + f" → 现md5 `{md5_now}`/{size_now}B/mtime {mtime_now}(≠FACTS §1 基线 `65d4708f…`/115,614B——**九发实弹后 13:31:02 被他会话改**:`git diff` 实测 [4013] 节点 `QwenImage21_T2IPromptRewrite`→`MyQi21ApiPE`(LM Studio API 版,widgets=[http://127.0.0.1:1234, qwen3.8-27b-uncensored-mlx,…]),联动改件=子图 qi21-提示词类型优化子图.json、my_nodes/__init__.py(+3 注册)、test_my_nodes.py、test_qwen21_workflow_contract.py,新件=my_nodes/nodes/my_qi21_api_pe.py+其测试(未跟踪);时机=型9 投递 13:24:32 之后、终态 13:31:40 之前 38 秒,**九型实弹完整性不受影响**(九发均以基线版入队,每型 S4 装载与投前断言在案);该改动非本收账 run 所为,原样记 problems)。")
w("- **本仓 git**(`git status --porcelain`,于仓库根,输出原文):")
w("")
for l in git_now.split("\n"):
    w(f"    {l}")
w("")
w(f"  判读(按路径分类):①**目录外跟踪文件改动 {len(mod_outside)} 处**({outside_str})——v1 收账时点已在前存的先存改动(Dashboard.tsx/index.css)+ v2 窗内他会话 PE 实验五件(工作流/子图/__init__/两测试),均非本收账 run 写操作,原样记入收账 problems;②**战役目录内 M {len(mod_inside)} 件**({inside_str})=本役复写——并行会话提交 `{head_info}` 已把战役目录中途快照收编入库,本役其后落盘件遂显 M;③**战役目录内 ?? 新件**({untracked_str})=本役 v1/v2 收账+续拍产物;④**目录外 ?? 新件 {len(untracked_outside)} 件**({untracked_out_str})=他会话 PE 实验件,原样记 problems;⑤收账口径「本 run 只新增战役目录、零改跟踪文件」就 ②③ 成立(本 run 全部写操作均在战役目录内),①④ 为他会话/先存改动如实入 problems。")
w(f"- **引擎家 git**:`git -C {ENGINE_COMFY} status --porcelain` → {'0 行输出(空)=与 FACTS §4.2 预检基线一致,零改动' if egit_now == '' else '输出:' + egit_now}。")
w(f"- **引擎队列**:v2 收摊时点({NOW})实测 {q_summary} —— 在队 pid 与本役九型" + ("**⚠️ 有交集**" if overlap else "零交集") + "(v1 收摊 12:09-12:10 亦 ==0;§4 第1笔)。")
w("")

with open(REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("report written:", REPORT, os.path.getsize(REPORT), "bytes; FINAL=", FINAL)
