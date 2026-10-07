# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 API版扩写 PE(MyQi21ApiPE,1006 LM Studio 27B 役)。

[4013] 换装件:上游 QwenImage21_T2IPromptRewrite(蒸馏 pe_t2i,英文锁死+
漂移不可训)的管线级替代——扩写大脑=本机 LM Studio OpenAI 兼容服务(默认
qwen3.8-27b-uncensored-mlx:qwen3.5 族与 Qwen-Image 同源、中文母语、指令真
听话;1006 实测:身份段/四部件/动作/全部色锚零丢失+一段式中文长文+JSON
格式全对+负面清单自动收「剑出鞘」)。

槽口(上游逐口同名,换 type 即接、出线零动):
  入 prompt        ← [4012] PE开关 口0(纯连线槽 forceInput)
  出 positive_prompt/negative_prompt/wh_ratio/thinking/parse_ok

系统指令真源=qi21_bases.json#expand_instruction.system_prompt_zh(热读+mtime
失效缓存,同 my_qi21_base 模式:改 json 即时生效免重启)。历史补丁两则中
/no_think 已于 1007 退役(五探实弹:文本软开关被 aggressive finetune 无视,
与 chat_template_kwargs 一样无效,「低」档两测无衰减同废);思考控制=
thinking_effort 档位 → 顶层 reasoning_effort 参数(none=硬关,不发=模板默认 xhigh)。

容错(design 同 MyQi21ChinesePE:PE 关同效,不炸产线):
  - 发前 3s 探活(_alive)快跳死主机(黑洞 ~75s→3s)+ 全程无代理 opener
    (_LAN_OPENER,防 Clash 系统代理截流局域网——1007);
  - 服务不可达/超时/HTTP 错/JSON 解析失败 → 透传 (prompt,"","","",False)
    +中文 print 警告 +ui.api_pe_status 状态字段(JS 上画布标红警示,1007);
  - LM Studio 须常驻(单飞资源,+16GB);本节点同步阻塞引擎队列(实测
    ~70s/发,冷首发与长思考更慢——耐心或加 timeout_sec)。
  - api_url 亦可列 https 云端端点(bigmodel v4 = https://open.bigmodel.cn/api/paas/v4,
    model 填 glm-5.3 系):鉴权走 env MYSTUDIO_QI21_PE_KEY 或 macOS 钥匙串
    MYStudio/qi21-pe-key(1007 用户令:key 勿明文落代码/文档/工作流);
    云端档位映射 关闭→low/思考→max(1210 值域,始终思考关不掉)。

全上下文三轮(1006 用户令「五样上下文在子图里必须是节点,全连进本件,
输出两口=正向/负向」)+ 批C 七路直连(1006 问题2,Q1=甲):
  - 九入(全连线,未连=真源热读兜底):装配全文←[4011].0/负面词←[4011].1/
    系统提示词←[4030] MyQi21BasesText/色卡←[4031]/美术风格底座←[4032]/
    型底座←[4010].0(随型选择变)/正向提示词←边界 -10.0(外部手写原文)/
    负向提示词←边界 -10.2(外部手写原文)/透明模式←[4010].3(开=透明素材图
    勿虚构背景)——三路原文(型底座/正/负)只并入「画面上下文」参考块,
    改写对象仍是装配全文,装配链不动;
  - 双口出:(正向提示词,负向提示词)——wh_ratio/thinking/parse_ok 三口退役
    (画幅走九型直通,思考链不再上画布);
  - 输出仍=主体句层(身份/动作/环境/光位/落色锚),三层装配架构不动;
    上下文纪律(底座/风格/色卡严禁复述进 rewritten_prompt)由本件补进系统提示。

注册(import+NODE_CLASS_MAPPINGS+DISPLAY「漫影 API扩写PE」)在
my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# 局域网恒直连 opener:macOS 的 urllib 会自动吃系统代理(Clash 系统代理=
# 127.0.0.1:7897),局域网通否取决于代理对私网的放行规则——隐性依赖,恒绕过
# (1007 实测定谳:探活走代理转发成功,但代理一退/改规则即断,勿赌)
_LAN_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _chat_url(base: str) -> str:
    """OpenAI 兼容端点拼接:LM Studio(局域网)基址补 /v1/chat/completions;
    以 /v数字 结尾的云端基址(bigmodel v4)只补 /chat/completions(1007)。"""
    if base.endswith("/chat/completions"):
        return base
    tail = base.rsplit("/", 1)[-1]
    if tail.startswith("v") and tail[1:].isdigit():
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


_CLOUD_KEY_CACHE: str | None = None
_RUNTIME_KEY: str | None = None  # UI 控件通道(引擎进程内存,重启即失;1007)


def _cloud_key() -> str:
    """云端端点(https 条目)鉴权三级:UI 控件(运行时内存)>env MYSTUDIO_QI21_PE_KEY
    >macOS 钥匙串(MYStudio/qi21-pe-key)——key 永不落代码/文档/工作流/PNG(1007 用户令)。"""
    global _CLOUD_KEY_CACHE
    if _RUNTIME_KEY:
        return _RUNTIME_KEY
    env = os.environ.get("MYSTUDIO_QI21_PE_KEY", "")
    if env:
        return env
    if _CLOUD_KEY_CACHE is not None:
        return _CLOUD_KEY_CACHE
    try:
        key = subprocess.run(
            ["security", "find-generic-password", "-s", "MYStudio",
             "-a", "qi21-pe-key", "-w"],
            capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        key = ""
    _CLOUD_KEY_CACHE = key
    return key


def _register_key_route() -> None:
    """引擎侧临时 key 通道(1007):前端密码控件 onChange POST 到此,存引擎进程
    内存(_RUNTIME_KEY)——不进 /prompt JSON(→不进 PNG 元数据)、不进工作流文件、
    不进仓库;引擎重启即失,钥匙串兜底仍在。GET 查当前来源(不回传 key 本体)。"""
    try:
        from server import PromptServer  # 引擎环境才有;单测 spec 直载无此模块即跳过
        from aiohttp import web as _web
    except Exception:
        return
    routes = PromptServer.instance.routes

    async def _set_key(request):
        global _RUNTIME_KEY
        try:
            body = await request.json()
        except Exception:
            body = {}
        _RUNTIME_KEY = str((body or {}).get("key") or "").strip()
        return web.json_response({"ok": True, "set": bool(_RUNTIME_KEY)})

    async def _get_key(_request):
        if _RUNTIME_KEY:
            src = "runtime"
        elif os.environ.get("MYSTUDIO_QI21_PE_KEY"):
            src = "env"
        else:
            src = "keychain" if _CLOUD_KEY_CACHE or _keychain_probe() else "none"
        return web.json_response({"ok": True, "source": src})

    def _keychain_probe() -> bool:
        return bool(_cloud_key()) if not os.environ.get("MYSTUDIO_QI21_PE_KEY") else False

    routes.post("/my-nodes/qi21-pe-key")(_set_key)
    routes.get("/my-nodes/qi21-pe-key")(_get_key)

    # 扩展 JS 恒新鲜(1007 根治「改 JS 后 webview 吃旧缓存」复发类):/extensions/*
    # 响应补 no-cache——aiohttp 静态文件默认只给 Last-Modified,浏览器启发式缓存
    # 会拿旧 JS;no-cache=每次重载都回源校验(304 命中零成本)。app 未冻结期挂入。
    @_web.middleware
    async def _no_cache_extensions(request, handler):
        resp = await handler(request)
        if request.path.startswith("/extensions/"):
            resp.headers.setdefault("Cache-Control", "no-cache")
        return resp

    try:
        PromptServer.instance.app.middlewares.append(_no_cache_extensions)
    except Exception:
        pass


def _alive(base: str, timeout: float = 3.0) -> bool:
    """发前轻量探活(GET /v1/models)——主机黑洞/防火墙 drop 时把死等从 OS 级
    ~75s(SYN 重试耗尽)降到 3s;HTTP 任何应答(含错误码)=服务在。"""
    try:
        with _LAN_OPENER.open(base + "/v1/models", timeout=timeout) as _r:
            _r.read(1)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False

# ── 数据真源(与 my_qi21_base 同款四层候选链,零 import——勿 import 化禁令) ──
def _daojie_data(fn: str) -> Path:
    _env = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    _here = Path(__file__).resolve()
    if _env:
        _p = Path(_env) / fn
        if not _p.is_file():
            print(f"[漫影 道劫数据] MYSTUDIO_DAOJIE_DATA 已设但缺 {_p}:"
                  "响亮降级不兜底其它层(显式覆盖失效须排查,防静默读别家库)")
        return _p
    _cands = [
        _here.parents[5] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",
        _here.parents[4] / "daojie-data",
        Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json"),
        Path.home() / "Applications" / "漫影工作室.app" / "Contents" / "Resources"
        / "studio-manuals/art_skills/daojie_ink_guofeng/json",
    ]
    for _base in _cands:
        _p = _base / fn
        if _p.is_file():
            return _p
    return _here.parent / fn


_BASES_JSON = _daojie_data("qi21_bases.json")

_sys_cache: dict = {"mtime": None, "text": None}
_ctx_cache: dict = {"mtime": None, "style": None, "colors": None}


def _load_bases_node() -> dict:
    """qi21_bases.json 整文件现读(失败=空 dict,上下文块降级缺席不炸)。"""
    try:
        data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _context_materials() -> tuple[str, str]:
    """风格底座全文+色卡块(同 json mtime 缓存;真源=lock_layer/color_lexicon)。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    if mtime is not None and _ctx_cache["mtime"] == mtime and _ctx_cache["style"] is not None:
        return _ctx_cache["style"], _ctx_cache["colors"]
    data = _load_bases_node()
    style = str((data.get("lock_layer") or {}).get("positive_text") or "").strip()
    # 1007 v9:色库数据出教材归[4031]——兜底升级为[4031]同款全量
    # (在用词详表+canon42全库;教材只剩选题逻辑,不接线不得缺42色)
    cl = data.get("color_lexicon") or {}
    IN_USE = set((cl.get("entries") or {}).keys())
    lines = ["【项目色卡选项清单】(从中选 2-5 个,用且仅用选中色词写终稿;禁止全选)",
             "选法:大面积基底(stable)选1 | 主体色(mid)选1-3 | 点睛(accent)选0-1",
             "色词必须落到实物载体(部件/材质/布面),禁落光效;禁裸色词(色+材质)",
             "冲突裁决序(高>低): " + " > ".join(cl.get("conflict_order", []))]
    for i, (word, ent) in enumerate(sorted((cl.get("entries") or {}).items()), 1):
            lines.append(f"  ★在用{i}. {word}({ent.get('ma_id','')}):{ent.get('usage_hint','')}")
    try:
        canon = json.loads((_BASES_JSON.parent.parent / "ma_sync" / "palette-canon.json")
                           .read_text(encoding="utf-8"))
        groups = {g["groupId"]: g["name"] for g in canon.get("colorGroups", [])}
        by_group = {}
        for c in canon.get("colors", []):
            by_group.setdefault(c.get("groupId", "?"), []).append(c)
        lines.append(f"备选色卡全库({len(canon.get('colors', []))}色,含在用):")
        for gid in sorted(by_group):
            lines.append(f"【{groups.get(gid, gid)}系】 " + " | ".join(
                f"{c['name']}" for c in by_group[gid]))
    except Exception as exc:
        lines.append(f"(备选全库读取失败:{exc})")
    colors = "\n".join(lines) if len(lines) > 4 else ""
    _ctx_cache.update(mtime=mtime, style=style, colors=colors)
    return style, colors


def _hot_fallbacks() -> tuple[str, str, str]:
    """(教材, 色卡, 风格底座) 真源热读兜底(连线缺位时用;mtime 缓存)。"""
    style, colors = _context_materials()
    data = _load_bases_node()
    raw = (data.get("expand_instruction") or {}).get("system_prompt_zh")
    textbook = str(raw).strip() if isinstance(raw, str) else ""
    if not textbook:
        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"
                    "画面描述长文(300-800字),观察者口吻;用户固定的名词/数量/颜色/"
                    "位置逐字保留。输出单行 JSON:"
                    '{"rewritten_prompt": "<中文长文>", "negative_prompt": "<中文负面清单>", '
                    '"wh_ratio": "<如 3:4>"}')
    return textbook, colors, style


def _build_system(wired_sys: str | None, wired_colors: str | None) -> str:
    """终版系统提示 = (连线教材||热读教材) + (连线色卡||热读色卡节)。

    2006 九轮:教材全面重写(qi21_bases.json system_prompt_zh 1557字)——
    色卡全量嵌入(10词+冲突裁决序+选题纪律)、透明模式完整逻辑(开=禁虚构
    背景/禁环境光/收束句)、全文润炼铁律、肯定式、JSON输出铁律全在教材内。
    代码不再补丁——真源即全量,改 json 即时生效。
    (1007 起 /no_think 尾巴退役:五探实弹证明 aggressive finetune 无视文本
    软开关,思考控制改走顶层 reasoning_effort 参数,接线在 rewrite 内)
    (1007 B案用户令:色卡输入槽真通——[4031] 连线值拼进系统消息尾部,
    没连线=热读色卡节兜底;教材内嵌色库块保留(同源双份,数据非规则,
    不增思考负担;瘦身指针化=另案候令))
    """
    textbook, hot_colors, _ = _hot_fallbacks()
    sys_text = (wired_sys or "").strip() or textbook
    colors = (wired_colors or "").strip() or hot_colors
    return sys_text + ("\n\n" + colors if colors else "")

def _env_spans(subj: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for tok in _ENV_TOKENS:
        start = subj.find(tok)
        while start >= 0:
            out.append((start, start + len(tok)))
            start = subj.find(tok, start + 1)
    return out


_PUNCT = "，。；、,.;:!！？？"


def _subject_colors(subj: str, transparent: bool = False) -> list[str]:
    """从主体句提取色词候选(确定性三源):
    ①color_lexicon 在用词 ②palette-canon 42 色名 ③模式提取(X色/X+色字)。
    只取在主体句中实际出现的——这些是核心规则4的逐字禁换对象。
    跨度贪心去重叠:长词优先("阶下青灰"取"青灰"弃"下青",防边界误报)。"""
    import re as _re
    _cs = set("白红青金墨灰绿蓝褐黑黄紫银玉")
    # (start, end, word, prio):词典源=0 优先于 模式源=1
    spans: list[tuple[int, int, str, int]] = []
    try:
        data = _load_bases_node()
        lex = set(((data.get("color_lexicon") or {}).get("entries") or {}).keys())
        canon_p = _daojie_data("qi21_bases.json").parent.parent / "ma_sync" / "palette-canon.json"
        canon = json.loads(canon_p.read_text(encoding="utf-8"))
        lex |= {str(c.get("name", "")) for c in canon.get("colors", [])}
        lex |= {"青灰"}  # 风格底座多色相基底标配词,canon未收(蓝灰组名不同)
    except Exception:
        lex = {"青灰"}
    for w in lex:
        if not w:
            continue
        start = subj.find(w)
        while start >= 0:
            spans.append((start, start + len(w), w, 0))
            start = subj.find(w, start + 1)
    # 前瞻扫描取全重叠候选(finditer 非重叠会吞字:"缠灰"会吃掉"灰银"的"灰")
    for m2 in _re.finditer(r"(?=([一-龥]{1,2}色))", subj):
        g = m2.group(1)
        spans.append((m2.start(), m2.start() + len(g), g, 1))
    for m2 in _re.finditer(r"(?=([一-龥][白红青金墨灰绿蓝褐黑黄紫银玉]))", subj):
        g = m2.group(1)
        spans.append((m2.start(), m2.start() + len(g), g, 1))
    kept: list[tuple[int, int, str, int]] = []
    for s, e, w, pr in sorted(spans, key=lambda x: (-(x[1] - x[0]),
                                                    sum(c not in _cs for c in x[2]),
                                                    x[3], x[0])):
        if any(s < ke and e > ks for ks, ke, _, _ in kept):
            continue
        # 透明开:与环境词同小句紧邻(间隔≤4字且无标点)的色词随环境合法删,不检
        if transparent and any(
                max(s - ee, es - e, 0) <= 4
                and not any(ch in _PUNCT
                            for ch in subj[min(e, es):max(s, ee)])
                for es, ee in _env_spans(subj)):
            continue
        kept.append((s, e, w, pr))
    return [w for _, _, w, _ in sorted(kept)]


def _subject_stages(subj: str) -> list[str]:
    """境界词提取(道劫域确定性):筑基后期/金丹中期/元婴大圆满类——
    身份锚点里唯一可模式化的家族,丢了=身份漂移,机检兜底。"""
    import re as _re
    realms = "炼气|筑基|金丹|元婴|化神|炼虚|合体|大乘|渡劫|仙人|真仙"
    return [m.group() for m in _re.finditer(
        rf"(?:{realms})(?:初期|中期|后期|大圆满|圆满|期)", subj)]


def _strip_env_parens(pos: str) -> str:
    """透明开括号剥离(1007 v9实弹案):环境词被塞进括号补注
    ("(虽背景透明,但姿态暗示其原立于山门石阶…)")——含黑名单词的
    全/半角括号段整段删,括号外的正文保留。"""
    import re as _re
    def _drop(m):
        inner = m.group(0)
        return "" if any(t in inner for t in _META_TOKENS + _ENV_TOKENS) else inner
    return _re.sub(r"（[^（）]*）|\([^()]*\)", _drop, pos)


def _strip_env_sentences(pos: str, subj: str) -> str:
    """透明开纯环境句删除(1006 B案收口):含黑名单词且不含主体锚
    (主体句色词/境界词)的整句直接删——风格底座的"背景是…山水基底"类
    整句环境描写不再依赖模型自觉。主体+环境混句(句子带主体锚)保留,
    交给补发重试治。"""
    import re as _re
    anchors = _subject_colors(subj, False) + _subject_stages(subj)
    parts = [x for x in _re.split(r"(?<=[。！？；;\n])", pos) if x.strip()]
    kept = []
    for sent in parts:
        hit = any(t in sent for t in _META_TOKENS + _ENV_TOKENS)
        has_anchor = any(a in sent for a in anchors)
        if hit and not has_anchor:
            continue
        kept.append(sent)
    out = "".join(kept)
    floor = max(40, int(len(pos) * 0.25))
    return out if len(out) >= floor else pos  # 删过头保护(<25%或40字=误删,回退原文)


def _squash(text: str) -> str:
    """空白归一(半角/全角空格)——"软 3D体积塑形"与"软3D体积塑形"判同。"""
    return text.replace(" ", "").replace("\u3000", "")


# 1006 十型实弹定谳的确定性黑名单(系统提示词 v5+ 同款口径)
_META_TOKENS = ("背景", "仅写", "已移除", "透明模式", "锚点", "豁免", "色卡")
_ENV_TOKENS = ("远山", "云海", "云雾", "远景", "天空", "远处", "山门石阶")
# 部件名词表(核心规则5例举域+道劫常用配件;与色词同法:主体句出现即须终稿在场)
_PART_TOKENS = ("剑鞘", "剑格", "剑穗", "剑柄", "剑绦", "剑身", "腰带", "发簪",
                "耳坠", "袖口", "下摆", "衣袂", "丝绦", "木塞", "灯笼", "匾额",
                "山门", "残碑", "衣角", "发际线")


def _self_check(pos: str, neg: str, neg_tokens: list[str],
                transparent: bool, subj: str) -> list[str]:
    """出稿机器自检(1006 B案:节点自检+有界重试)。
    三检全确定性:①负向三源逐条在场 ②透明开禁指令词/环境词 ③主体句色词逐字在场。
    违例清单非空=可补发;锚点类(云海/匾额等名词)无法确定性判定,不在此检。"""
    v: list[str] = []
    pos_c, neg_c = _squash(pos), _squash(neg)  # 空白归一:"软 3D"与"软3D"判同
    for tok in neg_tokens:
        if _squash(tok) not in neg_c:
            v.append(f"负向缺:{tok}")
    if transparent:
        for tok in _META_TOKENS + _ENV_TOKENS:
            if tok in pos:
                v.append(f"透明残留:{tok}")
    else:
        # 关模式对称检:主体句里的环境词须保留(美宣案:云海被误删)
        for tok in _ENV_TOKENS:
            if tok in subj and tok not in pos_c:
                v.append(f"环境丢:{tok}")
    for c in _subject_colors(subj, bool(transparent)):
        if c not in pos_c:
            v.append(f"色词丢:{c}")
    for st in _subject_stages(subj):
        if st not in pos_c:
            v.append(f"境界丢:{st}")
    for pt in _PART_TOKENS:
        if pt in subj and pt not in pos_c:
            v.append(f"部件丢:{pt}")
    return v


def _balanced_json(text: str) -> dict | None:
    """从模型答文里剥出第一个深度归零的 JSON 对象(容忍前后噪声/空白)。"""
    try:
        whole = json.loads(text)
        return whole if isinstance(whole, dict) else None
    except (ValueError, TypeError):
        pass
    start = text.find("{")
    while start >= 0:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                        return obj if isinstance(obj, dict) else None
                    except (ValueError, TypeError):
                        break
        start = text.find("{", start + 1)
    return None


class MyQi21ApiPE:
    """漫影 API扩写PE:LM Studio 本地大模型按真源教材终炼装配全文(批C 九入全上下文)。"""

    CATEGORY = "漫影"
    DESCRIPTION = ("API扩写PE:本机 LM Studio(OpenAI 兼容)按 qi21_bases.json "
                   "中文教材扩写主体句;锚点保全实测优于蒸馏 pe_t2i;服务不在="
                   "透传不炸")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        ctx = {
                "系统提示词": ("STRING", {"forceInput": True, "tooltip": "连 [4030] 真源文本·系统提示词;不连=真源热读兜底"}),
                "色卡": ("STRING", {"forceInput": True, "tooltip": "连 [4031] 真源文本·色卡;不连=真源热读兜底"}),
                "美术风格底座": ("STRING", {"forceInput": True, "tooltip": "连 [4032] 真源文本·美术风格底座;不连=热读兜底"}),
                "正向提示词": ("STRING", {"forceInput": True, "tooltip": "外部手写正向原文;锚点权重最高,润炼逐字保留其实体"}),
                "负向提示词": ("STRING", {"forceInput": True, "tooltip": "外部手写负向原文;逐条并入 negative_prompt 不丢条目"}),
                "类型句正向": ("STRING", {"forceInput": True, "tooltip": "连 [4010].0 类型句(BASE 正文)"}),
                "类型句负向": ("STRING", {"forceInput": True, "tooltip": "连 [4010].4 类型句负面词(负面精炼原料)"}),
                "画幅宽": ("INT", {"forceInput": True, "tooltip": "连 [4010].1 九型WIDTH(画幅语境)"}),
                "画幅高": ("INT", {"forceInput": True, "tooltip": "连 [4010].2 九型HEIGHT(画幅语境)"}),
                "透明模式": ("BOOLEAN", {"forceInput": True, "tooltip": "连 [4010].3 透明值:开=透明素材图,勿虚构背景"}),
        }
        return {
            "required": {
                "api_url": ("STRING", {"default": "http://192.168.0.101:1234,http://127.0.0.1:1234",
                                       "tooltip": "LM Studio 服务地址,多个逗号分隔依次尝试(远程优先,本地兜底)"}),
                "model": ("STRING", {"default": "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx",
                                     "tooltip": "模型 id,逗号分隔与 api_url 逐一配对(远程9B,本地27B兜底)"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0,
                                          "step": 0.05,
                                          "tooltip": "低温更听话;0.7=实测扩写质量档"}),
                "max_tokens": ("INT", {"default": 12000, "min": 256, "max": 13000,
                                       "tooltip": "生成预算:思考(xhigh)档思考链吃 ~7k 字+正文 ~1k;思考档位=关闭 时只需 ~2k 即够"}),
                "timeout_sec": ("INT", {"default": 600, "min": 10, "max": 3600,
                                        "tooltip": "整发预算(冷首发+长文要留足;超时=透传不炸)"}),
                "thinking_effort": (["关闭", "思考(xhigh)"], {"default": "关闭",
                                    "tooltip": "思考档位(1007 实弹):关闭=reasoning_effort none 硬关,确定性零思考 token,全链 ~40s 内含自检补发;思考(xhigh)=模型模板原生档(=不发参数,思考量随机 ~1200-4600 tok/发,全链 21s~300s+ 波动,1006 全程即此档);「低」档实测无衰减已移除"}),
            },
            "optional": ctx,
        }

    RETURN_TYPES = ("STRING", "STRING", "BOOLEAN", "INT", "INT")
    RETURN_NAMES = ("正向提示词", "负向提示词", "透明模式", "画幅宽", "画幅高")
    FUNCTION = "rewrite"
    # 1006 四轮(用户令:UI 展示提示词,多行输入框):OUTPUT_NODE+ui 双载荷,
    # JS(my-qi21-prompt-preview.js 同款)把 api_pe_pos/api_pe_neg 落到下方
    # 两只只读多行展示框——画布上直接看 AI 扩写的正向/负向全文;
    # 批C 后正/负向槽兼外部手写原文入口:连线时 widget 转输入(展示框隐),
    # 未连线时仍为展示框(JS 回填)——双态同一槽
    OUTPUT_NODE = True

    def rewrite(self, 正向提示词: str | None = None, 负向提示词: str | None = None,
                类型句正向: str | None = None, 类型句负向: str | None = None,
                画幅宽: int | None = None, 画幅高: int | None = None,
                透明模式: bool = False,
                系统提示词: str | None = None, 色卡: str | None = None,
                美术风格底座: str | None = None,
                api_url: str = "http://127.0.0.1:1234",
                model: str = "qwen3.8-27b-uncensored-mlx", temperature: float = 0.7,
                max_tokens: int = 12000, timeout_sec: int = 600,
                thinking_effort: str = "关闭",
                正向扩写全文: str = "", 负向扩写清单: str = ""
                ) -> dict:
        """九入全上下文→LM Studio 扩写→(正向提示词, 负向提示词) 双口。

        三路外部原文(型底座/正/负向提示词)并入「画面上下文」参考块(有则加,
        无则跳),改写对象仍是装配全文;服务不在/超时/解析失败=透传
        (prompt原文, "")——PE关同效,不炸产线。
        """
        # 2006 七轮(用户令「AI挂了也从本节点做,恒有输出」):三层装配内置,
        # 逐字复刻 [4011] 格式(主体句\nBASE\n锁层A;BASE 空=两段)——AI 输入
        # 基底与降级正稿同源;AI 挂=本正稿直出,节点任何情况都有输出
        subj = (正向提示词 or "").strip()
        base = (类型句正向 or "").strip()
        _, _, hot_style = _hot_fallbacks()
        style = (美术风格底座 or "").strip() or hot_style
        direct = f"{subj}\n{base}\n{style}".strip() if base else f"{subj}\n{style}".strip()
        if not subj:
            print("[漫影 API扩写PE] 正向提示词未接线:主体句层缺席,装配=底座+风格两段")
        # 负面三源(型负面+锁层负面热读+外部负向)去重合并——AI 精炼,挂=直出
        try:
            lock_neg = str((_load_bases_node().get("lock_layer") or {})
                           .get("negative_text") or "").strip()
        except Exception:
            lock_neg = ""
        neg_tokens, seen = [], set()
        for src in (类型句负向, lock_neg, 负向提示词):
            for tok in (x.strip() for x in re.split(r"[,，\n]", (src or "")) if x.strip()):
                if tok not in seen:
                    seen.add(tok)
                    neg_tokens.append(tok)
        neg_fallback = ", ".join(neg_tokens)
        ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---"]
        if style:
            ctx.append("[正稿结构] 主体句\n型底座\n美术风格底座 三层(基底即上文)")
        if neg_fallback:
            ctx.append("[负面词清单] " + neg_fallback +
                       "(逐条精炼合并去重后写进 negative_prompt,可补通用负面,不丢条目)")
        if 画幅宽 and 画幅高:
            ctx.append(f"[画幅] {画幅宽}×{画幅高}(按此纵横比组织画面描述)")
        ctx.append(f"[透明] {'开:本图为透明素材图,勿虚构繁杂背景' if 透明模式 else '关:常规成图'}")
        user_with_ctx = direct + "\n\n" + "\n".join(ctx)
        urls = [u.strip().rstrip("/") for u in (api_url or "http://192.168.0.101:1234,http://127.0.0.1:1234").split(",") if u.strip()]
        models = [m.strip() for m in (model or "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx").split(",") if m.strip()]
        # URL+model 按索引配对;model 不够时用末位
        pair = lambda i: (urls[i], models[i] if i < len(models) else models[-1] if models else "qwen3.5-9b")
        payload = {
            "model": model or "qwen3.8-27b-uncensored-mlx",
            "messages": [
                {"role": "system", "content": _build_system(系统提示词, 色卡)},
                {"role": "user", "content": user_with_ctx},
            ],
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
        # 1007 实测(1234 实弹两轮):chat_template_kwargs 被 LM Studio 层丢弃
        # (enable_thinking:false 52/52 无视)、/no_think 文本尾被 aggressive
        # finetune 无视、「低」档无衰减(1565/1696 tok,两测);顶层 reasoning_effort
        # 转发生效——none=模板预填空 <think> 块硬关思考(确定性零思考 token),
        # 不发=模板默认 xhigh(思考量随机 ~1200-4600 tok/发)。本地 27B 同层待首用复验
        if thinking_effort == "关闭":
            payload["reasoning_effort"] = "none"
        def _post(pl: dict) -> dict:
            headers = {"Content-Type": "application/json"}
            if url.startswith("https://"):
                headers["Authorization"] = f"Bearer {_cloud_key()}"
            req = urllib.request.Request(
                url, data=json.dumps(pl).encode("utf-8"),
                headers=headers, method="POST")
            return json.loads(_LAN_OPENER.open(
                req, timeout=max(10, int(timeout_sec))).read())

        t0 = time.time()
        resp = None
        served = ""
        for _i in range(len(urls)):
            _u, _m = pair(_i)
            if not _alive(_u):
                print(f"[漫影 API扩写PE] {_u} 探活不通(3s)——跳过"
                      "(服务不在或防火墙拦;排查:docs/comfyui-kb/LMStudio-Windows远程排查-1007.md)")
                continue
            url = _chat_url(_u)
            payload["model"] = _m
            try:
                _r = _post(payload)
                # 空正文(思考吃光)也视为不可用,切下一 URL(1006:远程9B 上下文不足案)
                _msg0 = (_r.get("choices") or [{}])[0].get("message", {})
                if not (_msg0.get("content") or "").strip() and not (_msg0.get("reasoning_content") or "").strip():
                    print(f"[漫影 API扩写PE] {_u}({_m}) 返回空,试下一个…")
                    continue
                resp = _r
                served = _m
                if _u.startswith("https://"):
                    # 云端档位映射(1210 实测:该族始终思考,值域 low/high/max,
                    # 不认 none/xhigh);预算重试与自检补发共用 payload,在此定型。
                    # 用户令(1007):云端开最高思考→max
                    payload["reasoning_effort"] = "low" if thinking_effort == "关闭" else "max"
                break  # 首个有内容的用
            except Exception as exc:
                print(f"[漫影 API扩写PE] {_u}({_m}) 不可达({exc}),试下一个…")
                continue
        if resp is None:
            print(f"[漫影 API扩写PE] 全部 {len(urls)} 个 LM Studio 均不可达——"
                  f"本发透传自装配三层(恒有输出);请检查 LM Studio 服务")
            return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_fallback],
                           "api_pe_status": ["透传:LM Studio 均不可达"]},
                    "result": (direct, neg_fallback, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
        try:
            msg = (resp.get("choices") or [{}])[0].get("message", {})
        except (AttributeError, IndexError):
            msg = {}
        content = msg.get("content") or ""
        reasoning = str(msg.get("reasoning_content") or "")
        # 1006 三轮实弹:上下文变大后思考链可吃光预算致正文空——空正文且
        # 有思考=重试一次(预算翻倍+硬指令直接出 JSON);再空=从思考尾剥 JSON 兜底
        if not content.strip() and reasoning:
            print(f"[漫影 API扩写PE] 正文空(思考链吃了 {len(reasoning)} 字)——加预算重试一次")
            payload2 = dict(payload)
            payload2["max_tokens"] = min(int(max_tokens) * 2, 24000)  # 32k窗固化后旧帽13000过时;云端思考另吃预算须放宽
            payload2["messages"] = payload["messages"][:-1] + [
                {"role": "user",
                 "content": payload["messages"][-1]["content"] + "\n直接输出最终 JSON 结果,不要再思考。"}]
            try:
                resp2 = _post(payload2)
                msg2 = (resp2.get("choices") or [{}])[0].get("message", {})
                if (msg2.get("content") or "").strip():
                    content, msg = msg2["content"], msg2
            except Exception as exc:
                print(f"[漫影 API扩写PE] 重试失败({exc})——走思考链剥离兜底")
        obj = _balanced_json(content) or _balanced_json(reasoning[-4000:])
        pos = obj.get("rewritten_prompt") if obj else None
        if isinstance(pos, str) and pos.strip():
            neg = obj.get("negative_prompt")
            pos_s, neg_s = pos.strip(), (neg.strip() if isinstance(neg, str) else "")
            neg_s = neg_s or neg_fallback
            if 透明模式:
                pos_s = _strip_env_parens(_strip_env_sentences(pos_s, subj))
            # 1006 B案(用户拍板):出稿机器自检——①负向三源逐条 ②透明开黑名单
            # ③色词逐字;不过=同模型补发一次(缺什么点什么),两稿取违例更少者。
            v1 = _self_check(pos_s, neg_s, neg_tokens, bool(透明模式), subj)
            if v1:
                print(f"[漫影 API扩写PE] 机器自检 {len(v1)} 项不过({';'.join(v1[:6])}"
                      f"{'…' if len(v1) > 6 else ''})——同模型补发一次")
                try:
                    pl = dict(payload)
                    pl["messages"] = payload["messages"][:-1] + [
                        {"role": "user",
                         "content": payload["messages"][-1]["content"]
                         + "\n你上一稿机器自检未过,逐项修正后重出完整 JSON(单行,只输出 JSON):"
                         + ";".join(v1[:12])
                         + "。以上缺失词逐字补进对应字段,违禁词从正文删除,"
                           "其余内容与上一稿保持一致,只做最小修正。"}]
                    resp3 = _post(pl)
                    _m3 = (resp3.get("choices") or [{}])[0].get("message", {})
                    _c3 = (_m3.get("content") or "").strip()
                    _r3 = str(_m3.get("reasoning_content") or "")
                    _o3 = _balanced_json(_c3) or _balanced_json(_r3[-4000:])
                    _p3 = _o3.get("rewritten_prompt") if _o3 else None
                    if isinstance(_p3, str) and _p3.strip():
                        _n3 = (_o3.get("negative_prompt")
                               if isinstance(_o3.get("negative_prompt"), str) else "")
                        _n3 = _n3.strip() or neg_fallback
                        _p3s = _strip_env_parens(_strip_env_sentences(
                            _p3.strip(), subj)) if 透明模式 else _p3.strip()
                        v2 = _self_check(_p3s, _n3, neg_tokens,
                                         bool(透明模式), subj)
                        if len(v2) < len(v1):
                            print(f"[漫影 API扩写PE] 自检重奏效:{len(v1)}→{len(v2)} 项"
                                  f"{('(余:' + ';'.join(v2[:4]) + ')') if v2 else '(全过)'}——取第二稿")
                            pos_s, neg_s, v1 = _p3s, _n3, v2
                        else:
                            print(f"[漫影 API扩写PE] 自检重试未更优({len(v2)}≥{len(v1)})——保留第一稿")
                except Exception as exc:
                    print(f"[漫影 API扩写PE] 自检补发失败({exc})——保留第一稿")
            print(f"[漫影 API扩写PE] 扩写完成:{len(pos_s)}字,"
                  f"耗时 {time.time() - t0:.0f}s(全上下文:系统提示词/色卡/"
                  f"风格/型底座/外部原文/透明)")
            return {"ui": {"api_pe_pos": [pos_s], "api_pe_neg": [neg_s],
                           "api_pe_status": [f"AI扩写OK:{served}"]},
                    "result": (pos_s, neg_s, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
        print(f"[漫影 API扩写PE] 答文无 rewritten_prompt(解析失败)——透传原文;"
              f"正文{len(content)}字/思考{len(reasoning)}字,正文头200:{content[:200]!r}")
        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_fallback],
                       "api_pe_status": ["透传:答文解析失败"]},
                "result": (direct, neg_fallback, 透明模式, 画幅宽 or 0, 画幅高 or 0)}


_register_key_route()
