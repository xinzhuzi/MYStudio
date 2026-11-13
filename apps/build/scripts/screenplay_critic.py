#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 密钥经用户 1030 裁定知情入库
"""
剧本评判程序 v2 —— 道劫全剧(4125 章)AI 评判产线(任务档 10-30-daojie-screenplay-critique-1030)。

单章用法(兼容 v1):
    python3 screenplay_critic.py <剧本.md> [更多剧本...]           # 出 markdown 评判报告
    python3 screenplay_critic.py <剧本.md> --out 报告.md          # 落盘报告
    python3 screenplay_critic.py <剧本.md> --json                 # 结构化 JSON 判定
    python3 screenplay_critic.py <剧本.md> --model medium --focus "重点查对白"

批量用法(量产):
    python3 screenplay_critic.py <剧本目录> --batch --range 1-10 --model high \
        --out-root apps/output/daojie-critique-1030 [--redo]
    (--batch 也可直接带目录:--batch <剧本目录>)

批量行为:
    - 按文件名数字序逐章评判;每章先写 json 后写 md,json 判定/总分/问题计数齐全(且 md 存在)才算完成;
    - 幂等:重跑跳过已完成章;--redo 强制重评区间(先删旧 json/md/cite.json 并清对应 index 行);
    - 章间 2s;瞬态错误(网络瞬断/超时/连接被断/429/5xx/中转错误体)统一指数退避 5s/15s/45s;
      连续 10 章失败或令牌认证失败即熔停并落 failures.tsv;
    - 单章超时 600s;耗时/重试记入 json;
    - index.tsv 累积(表头 ep/verdict/verdictRaw/score/p0/p1/p2/citeRate/secs/model/retries,
      断点续跑重读不重建;citeRate 列由 critic_citation_check.py 回填,首跑置空);
    - 批次启动对剧本目录做 name,size,mtime 清单快照存 <out-root>/drama-snapshot.json,
      收尾复算,不一致打印 FINGERPRINT-MISMATCH 并 exit 1(零改动铁律);
    - 结束打印一行 SUMMARY done=N new=X skip=Y fail=Z。

目录布局:<out-root>/reports/chapter-NNN.{md,json,cite.json}、<out-root>/index.tsv、
          failures.tsv、drama-snapshot.json

模型: glm-5.3 / glm-5.3-flash / glm-5.3-flashx(高/中/低,默认 high);协议=Anthropic messages
      (1113 定谳:该 key 额度仅在 /api/anthropic 口生效,paas/v4 OpenAI 口恒 1113——llm-api-tester 实测)
密钥: 环境变量 CRITIC_API_KEY 或 ZHIPU_API_KEY(1112 用户令换 env,旧 love-long 内置键已 401 死并移除,
      1030 D3 硬编码裁定就此作废;端点可 CRITIC_API_BASE 覆写)
仅依赖 Python 标准库。
"""
import argparse
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API_BASE = os.environ.get("CRITIC_API_BASE", "https://open.bigmodel.cn/api/anthropic")
DEFAULT_KEY = (os.environ.get("CRITIC_API_KEY") or os.environ.get("ZHIPU_API_KEY")
               or os.environ.get("LOVELONG_API_KEY") or "")
MODELS = {"high": "glm-5.3", "medium": "glm-5.3-flash", "low": "glm-5.3-flashx"}

VERDICT_LEVELS = ("存在结构性问题", "基本合理但需打磨", "合理")  # 长词优先,防「合理」吃掉长判定
INDEX_HEADER = ("ep", "verdict", "verdictRaw", "score", "p0", "p1", "p2", "citeRate", "secs", "model", "retries")
FAILURES_HEADER = ("ep", "file", "error", "timestamp")
CHAPTER_FILE_RE = re.compile(r"^chapter-(\d+)_漫剧\.md$")

RATE_BACKOFF_S = (5, 15, 45)   # 瞬态错误指数退避(3 次重试):网络瞬断/超时/429/5xx/中转错误体
BATCH_TIMEOUT_S = 600          # 批量模式单章超时
CHAPTER_GAP_S = 2.0            # 章间礼貌间隔
CIRCUIT_BREAK_N = 10           # 连续失败熔停线
MADE_EPISODES = (1, 2)         # 已制作章(交付侧口径,手册下游裁定)
MAX_SCRIPT_CHARS = 300_000     # 单章体量保险丝(实测最大 25,443 字节)


# ───────────────────────── prompt v2(三层标准源序:仓库裁定→道劫手册→外部技能共识)─────────────────────────
SYSTEM_PROMPT = """你是一名资深短剧/漫剧剧本医生(script doctor),专精水墨国风修仙题材的 AI 漫剧(恒 16:9 横屏,单集约 3 分钟)章节剧本评判。
你拿到的是一集完整剧本。逐场通读后,按文末固定结构输出中文 markdown 评判报告。
要求:每个问题给出「严重度 + 位置 + 为什么是问题 + 怎么改」,并附逐字佐证引文;不许泛泛而谈;没有问题就明说没有,不许编问题。
引文铁律(v2.2,glm 换近形/近义字漂移 73/485 章实测后立,违者引文作废):
R1 「」内引文必须从该章剧本原文**原样复制**,是原文的连续逐字片段——写报告时回到原文里把那句话找出来照抄,不许凭记忆默写;
R2 禁一切改动:不增字不减字不换字(近形字/近义字都不行)、不转全半角、不改标点、不调语序、不合并两句为一句;
R3 引文过长可在句读边界截短,截短后仍必须是原文连续片段;宁可引短(≥6 字)而准,不可引长而改;
R4 交卷前自检:逐条把引文放回原文找,找不到完全一致的原文片段=这条引文废了,回原文重抄;
R5 实错反例(EP022,报告引「晏燎照泥地运气」,原文是「晏燎照泥**线**运气」——线被默写成地,一字之差整条作废):这就是凭记忆默写、没回原文核对的典型病,严禁再犯。

═══ 改编宪章(置顶,凌驾一切评判轴)═══
A1 原文事实优先:本剧本是原著小说的改编稿,原文已有的事实、动作、对白、冲突优先于一切开场节奏、类型语言、集末钩子。不得以「节奏/类型理想」为由否定原文已有素材,更不得要求添加原文没有的东西。
A2 优化建议只许「排布类」:前移(把原文已有素材挪前)、取舍(删冗余保原文主线)、载体转换(把不可拍的叙述转成原文信息内的画面/动作/旁白,走手册转译通道)。
A3 严禁「补写类」:严禁建议新增原文没有的动作、对白、冲突、心声、场景、人物。
A4 违宪反例(旧版报告实际犯过,引以为戒):「建议开画第一秒加一记鞭子破屏直击观众」——原文开画没有这一鞭,属补写动作,违宪;且开场本就允许水墨氛围 beat(见开场口径),无需强造冲击。此类建议一条都不许出现。
A5 已制作章口径:EP001、EP002 已制作定稿,对这两章的优化建议只许走交付侧重定步速(停顿切点重建/步速调整,零改字),且每条建议末尾必须标注「不追溯重配」;严禁给文字手术建议。其余章(EP003 起)未定稿,可给文字手术方向。

═══ 标准源优先序 ═══
S1 仓库机检裁定(W0,数字轴唯一真源)——你只引用、不重判;
S2 道劫剧本手册(题材宪法)——凌驾一切外部类型标准;
S3 外部剧本技能共识——仅补前两层未覆盖的戏剧/文学轴(钩子、因果、人物、可拍性描述质量)。

═══ 题材检查表(手册宪法层)═══
T1 称谓体系:道友/前辈/宗门职务(掌门/长老/监工等);境界名词单集至多 2 处;出现现代称谓(市长/警察/总裁类)→ P0 违宪。
T2 灵气语汇:禁发光/特效/粒子/能量波类游戏感词,发现即 P1 可拍性病;灵气三色=人族朱红/妖族青绿/鬼族靛蓝(三色≠五行);灵气动词限晕染/翻涌/渗透/交融;愿力=金色,魔道=血红+浓墨。
T3 OS 内心独白(道劫裁定:合法文风,不是病):OS 内容必须沿用当章已有叙述/心理描写;只查两件事——①人称一致性(心声归属错人=P0);②是否编造原文没有的心声或提前揭示后文(点名)。转译通道旁白豁免占比/连段限制,严禁按 OS 占比过高打病。
T4 OS 标签格式:「OS(名)」与「名(OS)」双式均为合法格式(W0 解析器已双式容错),严禁把标签写法本身当病报。
T5 台词口语化:诗化台词只留关键情绪点,日常对话说人话;说明腔/书面腔点名。

═══ 数字轴(S1 仓库裁定,机检为准,AI 只引用不重判)═══
N1 语速密度:手册统一 2.5–4 字/秒(上限端 4);转译通道承载镜 4.6 字/秒。
N2 单句字数 ≤20 字@16:9。
N3 OS 连续 ≤2 段、场景 20–60s、纯画面 ≤15s——均为警告级:可点名,但严禁据此定 P0。
以上数字轴最终以 W0 机检为准:引用时写明「数字轴以机检为准」,不自设阈值、不自设容差、不重判。

═══ 开场口径(手册§一)═══
第 1 镜头允许至多 1 个 ≤8s 的水墨氛围 beat——合法,不是病。判「开场」只看:氛围 beat 之后是否尽快呈现原文已有的矛盾/压力。原文素材本身慢热才是问题;严禁因没有第一秒冲突打病,严禁建议强造开场冲突(见 A4 反例)。

═══ 戏剧轴(S3 外部共识,S2 手册约束下)═══
D1 因果链:逐场问「因上一场什么」;只有然后没有因为=断链,点名。
D2 删除测试:每场问「删了后面接得上吗」;但先查原文承载——原文有据的场不算孤儿场。
D3 章末钩子:判「原文素材是否被埋没」,原文优先于集末钩子,不强造悬念。
D4 单镜头动作密度:单镜头 >2 个主体动作链 → 点名拆镜。
D5 负向/不可拍描述:「不响/无声」类负向视听、抽象心理词 → 点名,给物理锚点改法(载体转换,合宪)。

═══ 引文铁律(报告将被机检回查,违者引文真实率不达标)═══
Q1 「」只允许出现在两处:问题清单的佐证引文字段、亮点节。其余任何位置(问题分析、修改方向、优化建议、评分表)严禁使用「」——动作列举、改写提案、术语、概念一律 **加粗** 表述,不得加「」。
Q2 「」内必须是逐字拷贝的原文连续片段(单条≤40字):严禁转述、压缩概括、换词、颠倒语序;对白引文可跨原文多行连引(说话人标签不计);引场景头须连同场次号与时间标注逐字(如「6-5 废楼顶层 午/内」)。
Q3 需要跳越原文中间内容时,必须用「……」明示省略,省略号两侧各自逐字;引用分散的多处内容时,拆成多条独立引文分别加「」,不得混拼。
Q4 术语与元词一律 **加粗**,严禁放进「」:判定级词、灵气动词表(晕染/翻涌/渗透/交融)、三色名、禁词反例(市长/发光等)、交付侧用语(重定步速等)。
Q5 每条问题的佐证引文字段必须含至少一条 Q2/Q3 合格「」引文;缺引文的问题条目无效。
Q6 唯一例外:已制作章建议末尾的标注「不追溯重配」。

固定输出结构(严格遵守,一级标题用 ##):

## 一句话判定
<本集剧本:合理 / 基本合理但需打磨 / 存在结构性问题 三选一,并一句话说清核心结论>

## 总分
<0-100 整数,并给一行扣分逻辑>

## 分维度评分表
| 维度 | 得分/10 | 一句话依据 |
|---|---|---|
维度固定为:开场(氛围 beat 后上矛盾)、冲突与升级、人物动机与区分度、对白(潜台词/口语化)、视听可拍性、台词可配音性(口播顺口、无长难句)、节奏与信息密度、章末钩子(原文素材利用)。

## 问题清单
按严重度排序。P0=伤筋动骨(逻辑断裂/动机崩塌/钩子失灵/人称崩坏/现代称谓违宪);P1=明显减分(说明腔/节奏塌陷/画面不可拍/游戏感语汇);P2=可打磨。每条格式:
- [P0|P1|P2] 位置(场次/镜头号) — 问题 — 佐证引文(「」逐字短引) — 修改方向

## 优化建议(按优先级)
最多 6 条,每条写清改哪一场、怎么改、改完解决上面哪条问题。不重写全文,只给手术指令;全部须符合改编宪章(排布类 only;EP001/EP002 只走交付侧重定步速并标「不追溯重配」)。

## 亮点
本集确实立得住的 1-3 处(带引文),防止误伤。

评判铁律:
1. 逻辑合理性优先:人物行为必须符合已建立的动机;时间/空间/道具不得自相矛盾;设定使用不得前后打架。
2. 视听可拍性:凡是无法转成具体画面描述(镜头、动作、光影)的叙述,点名;凡一个镜头塞多个不连贯动作的,点名。
3. 台词可配音性:书面语、超过 20 字不断句的长台词(16:9 裁定),点名。
4. 不吹捧:得分与判级必须有扣分逻辑支撑。
5. 零违宪自检:输出前逐条检查优化建议——任何属补写类的,删掉重写。"""


class FatalAuthError(RuntimeError):
    """令牌认证失败(401/403 或等价错误体):重试无意义,批量模式立即熔停。"""


def call_api(api_key: str, model: str, user_content: str, timeout: int = 300):
    """调用 Anthropic messages 接口(BigModel /api/anthropic)。返回 (可见正文, 重试次数)。
    glm-5.3 默认带思考块——只拼 type=="text" 块,thinking 不入正文;
    瞬态错误统一指数退避 5/15/45s;认证失败(401/403)→ FatalAuthError 熔停;其它 4xx 硬错不重试。"""
    payload = json.dumps({
        "model": model,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_content}],
        "temperature": 0.3,
        "max_tokens": 8192,
        # glm-5.3 默认思考会把 output 预算烧光(EP016 三连空正文实锤)→关思考直出
        "thinking": {"type": "disabled"},
    }).encode("utf-8")
    backoff = list(RATE_BACKOFF_S)
    retries = 0
    last_err = None
    while True:
        req = urllib.request.Request(
            f"{API_BASE}/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                # WAF 会拦 Python-urllib 默认 UA(实测 403),换成常规 UA 即通
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MYStudio-ScreenplayCritic/2.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("type") == "error":
                err = data.get("error", {}) or {}
                err_text = json.dumps(err, ensure_ascii=False)
                etype = err.get("type", "")
                if etype in ("authentication_error", "permission_error") or "invalid_api_key" in err_text:
                    raise FatalAuthError(f"API 认证错误: {err_text[:300]}")
                raise RuntimeError(f"API 错误(将退避重试): {err_text[:300]}")
            visible = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
            if not visible.strip():
                raise RuntimeError("空正文(疑似思考烧尽预算/上游空转)")
            return visible, retries
        except FatalAuthError:
            raise
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                body = ""
            last_err = f"HTTP {e.code}: {body}"
            if e.code in (401, 403):
                raise FatalAuthError(f"API 认证失败 HTTP {e.code}: {body}")
            if e.code != 429 and e.code < 500:
                break  # 其它 4xx 硬错,重试无意义
        # 瞬态错误统一走这里:连接族(RemoteDisconnected/ConnectionReset/SSL EOF)、URLError、
        # 超时、中转 200 包错误体、JSON 烂包——均指数退避重试
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError,
                http.client.HTTPException, json.JSONDecodeError, RuntimeError, KeyError) as e:
            last_err = str(e) or repr(e)
        if backoff:
            wait = backoff.pop(0)
            retries += 1
            print(f"[退避 {retries}/{len(RATE_BACKOFF_S)}] {last_err},{wait}s 后重试…", file=sys.stderr)
            time.sleep(wait)
            continue
        break
    raise RuntimeError(f"API 调用失败(重试 {retries} 次): {last_err}")


def parse_report(md_text: str) -> dict:
    """从 markdown 报告中抽取结构化结论(判定/判定原句/总分/问题计数)。解析失败字段置 None,由调用方判完整。"""
    verdict, verdict_raw, score = None, None, None
    p_counts = {"P0": 0, "P1": 0, "P2": 0}
    for line in md_text.splitlines():
        s = line.strip()
        if verdict is None and s.startswith("## 一句话判定"):
            idx = md_text.find(s) + len(s)
            nxt = md_text.find("\n##", idx)
            block = md_text[idx: nxt if nxt != -1 else len(md_text)].strip()
            body_lines = [l for l in block.splitlines() if l.strip()]
            verdict_raw = body_lines[0].strip() if body_lines else ""
            compact = block.replace(" ", "")
            for level in VERDICT_LEVELS:  # 长词优先,防「合理」吃掉「基本合理但需打磨」
                if level.replace(" ", "") in compact:
                    verdict = level
                    break
        if s.startswith("## 总分"):
            idx = md_text.find(s) + len(s)
            nxt = md_text.find("\n##", idx)
            block = md_text[idx: nxt if nxt != -1 else len(md_text)].strip()
            m = re.search(r"\d{1,3}", block)  # 只取第一段独立数字,防扣分明细数字串位
            if m:
                score = int(m.group())
        for tag in p_counts:
            if s.startswith(f"- [{tag}]"):
                p_counts[tag] += 1
    return {"verdict": verdict, "verdict_raw": verdict_raw or "", "score": score, "problems": p_counts}


def summary_complete(summary: dict) -> bool:
    """判定/总分/问题计数三字段齐全才算完整(PRD 验收 2 的机检端)。"""
    return (
        summary.get("verdict") in VERDICT_LEVELS
        and isinstance(summary.get("score"), int) and 0 <= summary["score"] <= 100
        and isinstance(summary.get("problems"), dict)
        and all(isinstance(summary["problems"].get(k), int) for k in ("P0", "P1", "P2"))
    )


# ───────────────────────── 小工具 ─────────────────────────

def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def tsv_safe(v) -> str:
    return str(v).replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def atomic_write_json(path: str, obj: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def scan_chapters(drama_dir: str) -> dict:
    """{章号: 文件路径};按文件名数字序由调用方排序。"""
    chapters = {}
    for name in os.listdir(drama_dir):
        m = CHAPTER_FILE_RE.match(name)
        if m:
            chapters[int(m.group(1))] = os.path.join(drama_dir, name)
    return chapters


def fingerprint_dir(drama_dir: str) -> dict:
    """剧本目录 name,size,mtime 清单(零改动铁律的指纹对账)。"""
    files = {}
    for name in sorted(os.listdir(drama_dir)):
        p = os.path.join(drama_dir, name)
        if os.path.isfile(p):
            st = os.stat(p)
            files[name] = {"size": st.st_size, "mtime": st.st_mtime}
    return files


def load_index(path: str) -> dict:
    """读 index.tsv 为 {ep: cols};表头/行列数/章号非法即抛错(断点续跑重读不重建,严禁静默重建)。"""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    if not lines:
        raise RuntimeError(f"index.tsv 为空: {path}")
    if lines[0] != "\t".join(INDEX_HEADER):
        raise RuntimeError(f"index.tsv 表头不符(期望 {'/'.join(INDEX_HEADER)}): {lines[0]!r}")
    rows = {}
    for ln in lines[1:]:
        if not ln.strip():
            continue
        cols = ln.split("\t")
        if len(cols) != len(INDEX_HEADER):
            raise RuntimeError(f"index.tsv 行列数 {len(cols)} ≠ {len(INDEX_HEADER)}: {ln!r}")
        try:
            ep = int(cols[0])
        except ValueError:
            raise RuntimeError(f"index.tsv 章号非法: {cols[0]!r}")
        if ep in rows:
            raise RuntimeError(f"index.tsv 重复章号行: {ep}")
        rows[ep] = cols
    return rows


def write_index(path: str, rows: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\t".join(INDEX_HEADER) + "\n")
        for ep in sorted(rows):
            f.write("\t".join(tsv_safe(c) for c in rows[ep]) + "\n")
    os.replace(tmp, path)


def build_user_content(ep: int, src_path: str, script: str) -> str:
    content = f"请评判以下剧本(EP{ep:03d},文件:{os.path.basename(src_path)}):\n\n{script}"
    if ep in MADE_EPISODES:
        content += (
            f"\n\n[章级口径] 本章为已制作章(EP{ep:03d}):优化建议只走交付侧重定步速(零改字),"
            f"每条建议末尾标注「不追溯重配」;严禁文字手术建议。"
        )
    return content


def md_header(ep: int, src_path: str, model_id: str, secs: float, retries: int) -> str:
    return (
        f"# 剧本评判报告:EP{ep:03d} {os.path.basename(src_path)}\n\n"
        f"- 模型:`{model_id}`\n- 评判时间:{now_str()}\n- 耗时:{secs:.1f}s / 重试:{retries}\n\n---\n\n"
    )


def chapter_done(json_path: str, md_path: str) -> bool:
    """幂等判据:json 判定/总分/问题计数齐全,且 md 已落盘非空。"""
    if not (os.path.isfile(json_path) and os.path.isfile(md_path)):
        return False
    if os.path.getsize(md_path) == 0:
        return False
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return False
    return summary_complete({"verdict": d.get("verdict"), "score": d.get("score"), "problems": d.get("problems")})


# ───────────────────────── 批量模式 ─────────────────────────

def run_batch(drama_dir: str, lo: int, hi: int, tier: str, model_id: str,
              out_root: str, redo: bool, api_key: str) -> int:
    reports_dir = os.path.join(out_root, "reports")
    os.makedirs(reports_dir, exist_ok=True)
    index_path = os.path.join(out_root, "index.tsv")
    failures_path = os.path.join(out_root, "failures.tsv")
    # 绝对路径自诊断:若调用方 cwd 不符(相对路径解析到嵌套/错误目录),此处一眼可见
    print(f"[batch] 剧本目录={os.path.abspath(drama_dir)}\n[batch] out-root={os.path.abspath(out_root)} "
          f"range={lo}-{hi} model={model_id} redo={redo}", file=sys.stderr)

    chapters = scan_chapters(drama_dir)
    eps_queue = [ep for ep in sorted(chapters) if lo <= ep <= hi]
    if not eps_queue:
        print(f"错误:区间 {lo}-{hi} 内无 chapter-NNN_漫剧.md 文件", file=sys.stderr)
        return 2

    # 指纹快照(启动):name,size,mtime 清单
    snap_path = os.path.join(out_root, "drama-snapshot.json")
    snap_start = {"dir": os.path.abspath(drama_dir), "generated_at": now_str(), "files": fingerprint_dir(drama_dir)}
    atomic_write_json(snap_path, snap_start)

    try:
        index_rows = load_index(index_path)
    except RuntimeError as e:
        print(f"错误:{e}", file=sys.stderr)
        return 2

    if redo:  # 强制重评:先删旧 json/md/cite.json 并清对应 index 行
        for ep in eps_queue:
            for suffix in (".json", ".md", ".cite.json"):
                p = os.path.join(reports_dir, f"chapter-{ep:03d}{suffix}")
                if os.path.exists(p):
                    os.remove(p)
            index_rows.pop(ep, None)

    new = skip = fail = 0
    consec = 0
    circuit_reason = None
    failure_rows = []
    total_queue = len(eps_queue)

    for pos, ep in enumerate(eps_queue, 1):
        base = f"chapter-{ep:03d}"
        json_path = os.path.join(reports_dir, base + ".json")
        md_path = os.path.join(reports_dir, base + ".md")

        if not redo and chapter_done(json_path, md_path):
            skip += 1
            print(f"[{pos}/{total_queue}] EP{ep:03d} 已完成,跳过(幂等)")
            if ep not in index_rows:  # index 缺行则按 json 补账(不重建整表)
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    index_rows[ep] = [str(ep), tsv_safe(d.get("verdict")), tsv_safe(d.get("verdict_raw")),
                                      str(d.get("score")), str(d.get("problems", {}).get("P0", 0)),
                                      str(d.get("problems", {}).get("P1", 0)), str(d.get("problems", {}).get("P2", 0)),
                                      "", str(d.get("secs", "")), tsv_safe(d.get("model")), str(d.get("retries", 0))]
                    print(f"[补账] EP{ep:03d} index 行按 json 补写")
                except Exception as e:
                    print(f"[警告] EP{ep:03d} index 补账失败:{e}", file=sys.stderr)
            continue

        src = chapters[ep]
        print(f"[{pos}/{total_queue}] EP{ep:03d} 评判中({os.path.basename(src)},{tier} 档)…", file=sys.stderr)
        try:
            with open(src, "r", encoding="utf-8") as f:
                script = f.read()
            if len(script) > MAX_SCRIPT_CHARS:
                raise RuntimeError(f"剧本过大({len(script)} 字符 > {MAX_SCRIPT_CHARS})")
            user_content = build_user_content(ep, src, script)
            t0 = time.monotonic()
            report, retries = call_api(api_key, model_id, user_content, timeout=BATCH_TIMEOUT_S)
            secs = time.monotonic() - t0
            summary = parse_report(report)
            if not summary_complete(summary):
                raise RuntimeError(f"判定解析不完整: verdict={summary['verdict']!r} score={summary['score']!r}")
        except FatalAuthError as e:
            fail += 1
            failure_rows.append((ep, os.path.basename(src), f"熔停(认证失败): {e}", now_str()))
            circuit_reason = f"令牌认证失败,熔停:{e}"
            break
        except Exception as e:
            fail += 1
            consec += 1
            failure_rows.append((ep, os.path.basename(src), str(e), now_str()))
            print(f"[失败] EP{ep:03d}: {e}", file=sys.stderr)
            if consec >= CIRCUIT_BREAK_N:
                circuit_reason = f"连续 {CIRCUIT_BREAK_N} 章失败,熔停"
                break
            if pos < total_queue:
                time.sleep(CHAPTER_GAP_S)
            continue

        consec = 0
        # 先写 json 后写 md(json 三字段齐全 = 本章完成)
        atomic_write_json(json_path, {
            "ep": ep, "file": os.path.basename(src), "model": model_id,
            "verdict": summary["verdict"], "verdict_raw": summary["verdict_raw"],
            "score": summary["score"], "problems": summary["problems"],
            "secs": round(secs, 1), "retries": retries, "timestamp": now_str(),
            "report_md": report,
        })
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md_header(ep, src, model_id, secs, retries) + report + "\n")
        index_rows[ep] = [str(ep), summary["verdict"], tsv_safe(summary["verdict_raw"]), str(summary["score"]),
                          str(summary["problems"]["P0"]), str(summary["problems"]["P1"]), str(summary["problems"]["P2"]),
                          "", f"{secs:.1f}", tier, str(retries)]
        new += 1
        print(f"[完成] EP{ep:03d} 判定={summary['verdict']} 总分={summary['score']} "
              f"P0/P1/P2={summary['problems']['P0']}/{summary['problems']['P1']}/{summary['problems']['P2']} "
              f"{secs:.1f}s 重试{retries}")
        if pos < total_queue:
            time.sleep(CHAPTER_GAP_S)

    write_index(index_path, index_rows)
    if failure_rows:
        need_header = not os.path.exists(failures_path)
        with open(failures_path, "a", encoding="utf-8") as f:
            if need_header:
                f.write("\t".join(FAILURES_HEADER) + "\n")
            for row in failure_rows:
                f.write("\t".join(tsv_safe(c) for c in row) + "\n")
    if circuit_reason:
        print(f"熔停:{circuit_reason}(失败账见 {failures_path})", file=sys.stderr)

    done = new + skip
    print(f"SUMMARY done={done} new={new} skip={skip} fail={fail}")

    # 指纹对账(收尾)
    snap_end_files = fingerprint_dir(drama_dir)
    if snap_end_files != snap_start["files"]:
        print("FINGERPRINT-MISMATCH:剧本目录在批次期间被改动(零改动铁律被破坏);启动快照见 "
              f"{snap_path}", file=sys.stderr)
        return 1
    return 0 if (fail == 0 and not circuit_reason) else 1


# ───────────────────────── 单章模式(兼容 v1)─────────────────────────

def critique_one(path: str, api_key: str, model: str, focus: str, as_json: bool) -> str:
    with open(path, "r", encoding="utf-8") as f:
        script = f.read()
    if len(script) > MAX_SCRIPT_CHARS:
        raise RuntimeError(f"剧本过大({len(script)} 字符 > 30 万),请分章评判")
    user_content = f"请评判以下剧本(文件:{os.path.basename(path)}):\n\n{script}"
    if focus:
        user_content += f"\n\n[用户附加关注点](在报告中单独用「### 附加关注点回应」一节回应): {focus}"
    report, _retries = call_api(api_key, model, user_content)
    if as_json:
        summary = parse_report(report)
        return json.dumps({"file": path, "model": model, **summary, "report_md": report},
                          ensure_ascii=False, indent=2)
    header = f"# 剧本评判报告:{os.path.basename(path)}\n\n- 模型:`{model}`\n- 评判时间:{now_str()}\n\n---\n\n"
    return header + report


def main() -> int:
    ap = argparse.ArgumentParser(
        description="剧本评判 v2:单章评判 + 全剧批量产线(love-long.com gemini-3.8-flash,任务档 10-30-daojie-screenplay-critique-1030)")
    ap.add_argument("scripts", nargs="*", help="剧本文件路径(单章模式,可多个);或剧本目录(配合裸 --batch)")
    ap.add_argument("--batch", nargs="?", const="", default=None, metavar="DIR",
                    help="批量模式:--batch <剧本目录>,或位置参数给目录 + 裸 --batch")
    ap.add_argument("--range", dest="ch_range", metavar="A-B", help="批量模式章号区间,如 1-500")
    ap.add_argument("--out-root", metavar="DIR", help="批量模式产出根目录(reports/index.tsv/failures.tsv/drama-snapshot.json)")
    ap.add_argument("--redo", action="store_true", help="批量模式:强制重评区间(先删旧 json/md/cite.json)")
    ap.add_argument("--model", choices=sorted(MODELS), default="high", help="推理档位(默认 high)")
    ap.add_argument("--out", help="单章模式:报告落盘路径(多文件时分节合并)")
    ap.add_argument("--json", action="store_true", help="单章模式:输出结构化 JSON(单文件)")
    ap.add_argument("--focus", default="", help="单章模式:附加关注点")
    args = ap.parse_args()

    api_key = os.environ.get("CRITIC_API_KEY") or os.environ.get("ZHIPU_API_KEY") or DEFAULT_KEY
    if not api_key:
        sys.exit("缺 API key:设 CRITIC_API_KEY 或 ZHIPU_API_KEY(1112 起不内置,见文件头)")
    model_id = MODELS[args.model]

    if args.batch is not None:
        batch_dir = args.batch
        if not batch_dir:
            if len(args.scripts) == 1 and os.path.isdir(args.scripts[0]):
                batch_dir = args.scripts[0]
            else:
                print("错误:--batch 需目录参数,或位置参数给剧本目录 + 裸 --batch", file=sys.stderr)
                return 2
        if not os.path.isdir(batch_dir):
            print(f"错误:剧本目录不存在 {batch_dir}", file=sys.stderr)
            return 2
        if not args.ch_range or not args.out_root:
            print("错误:批量模式需要 --range A-B 与 --out-root", file=sys.stderr)
            return 2
        if args.out or args.json or args.focus:
            print("错误:--batch 与 --out/--json/--focus 互斥", file=sys.stderr)
            return 2
        m = re.fullmatch(r"(\d+)-(\d+)", args.ch_range)
        if not m:
            print(f"错误:--range 格式应为 A-B: {args.ch_range!r}", file=sys.stderr)
            return 2
        lo, hi = int(m.group(1)), int(m.group(2))
        if lo > hi or lo < 1:
            print(f"错误:--range 区间非法: {args.ch_range}", file=sys.stderr)
            return 2
        return run_batch(batch_dir, lo, hi, args.model, model_id, args.out_root, args.redo, api_key)

    # 单章模式(v1 兼容)
    if not args.scripts:
        print("错误:请给剧本文件路径(单章)或 --batch <目录>(批量)", file=sys.stderr)
        return 2
    if args.json and len(args.scripts) > 1:
        print("错误:--json 只支持单文件", file=sys.stderr)
        return 2

    reports = []
    for i, path in enumerate(args.scripts, 1):
        if not os.path.isfile(path):
            print(f"错误:文件不存在 {path}", file=sys.stderr)
            return 2
        print(f"[{i}/{len(args.scripts)}] 评判中:{path} …", file=sys.stderr)
        reports.append(critique_one(path, api_key, model_id, args.focus, args.json))

    merged = "\n\n---\n\n".join(reports)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(merged + "\n")
        print(f"报告已写入:{args.out}", file=sys.stderr)
    else:
        print(merged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
