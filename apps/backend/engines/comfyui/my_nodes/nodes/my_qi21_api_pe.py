# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 API版扩写 PE(MyQi21ApiPE;1006 生,1007夜 终裁 Windows 远程 9B)。

[4013] 换装件:上游 QwenImage21_T2IPromptRewrite(蒸馏 pe_t2i,英文锁死+
漂移不可训)的管线级替代——扩写大脑=LM Studio OpenAI 兼容服务(默认
Windows 远程 9B http://192.168.0.101:1234/qwen3.5-9b-uncensored-
hauhaucs-aggressive:qwen3.5 族与 Qwen-Image 同源、中文母语、指令真
听话;1006 实测:身份段/四部件/动作/全部色锚零丢失+一段式中文长文+JSON
格式全对+负面清单自动收「剑出鞘」;Mac 本机 27B 于 1007夜出局)。

槽口(现役十入五出;连线槽全 forceInput,未连=真源热读兜底):
  入(十一) 系统提示词←[4030]/色卡←[4031]/美术风格底座-正向←[4032].0/美术风格底座-负向←[4032].1/
          正·负向提示词←宿主面板手写原文(边界两槽)/
          类型句正向←[4010].0(BASE)/类型句负向←[4010].3(负面词)/
          画幅宽←[4010].1(WIDTH)/画幅高←[4010].2(HEIGHT)/
          透明模式←[4010].4(透明值:开=透明素材图勿虚构背景)
  出(五) 正向提示词/负向提示词/透明模式/画幅宽/画幅高

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
  - 云端开关=api_key 控件(1007 用户令「填写apikey就是走云端,不填写走本地」):
    填→_CLOUD_URL/_CLOUD_MODEL 内置(bigmodel v4+glm-5.3-flash)key=填的值;
    留空→api_url/model 原样(本地),key 永不查。云端失败→回落本地列表逐个
    改写(1007晚用户令:云端挂≠弃改写),全挂才透传;api_pe_status 明示
    「云端失败:HTTP码+原因」(画布标红)。key 勿明文落
    代码/文档/工作流;档位映射逐目标:本地关闭→none/云端 low|max(1210 值域)。

全上下文三轮(1006 用户令「五样上下文在子图里必须是节点,全连进本件」)+
批C 七路直连(1006 问题2,Q1=甲;现役十入清单见上「槽口」):
  - 三路原文(型底座/正/负)只并入「画面上下文」参考块,改写对象仍是
    装配全文,装配链不动;
  - 五口出:(正向提示词,负向提示词,透明模式,画幅宽,画幅高)——
    wh_ratio/thinking/parse_ok 旧三口已退役(画幅走九型直通,思考链
    不再上画布);
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

# 1008 用户令「自定义节点不能打断吗?」:ComfyUI 官方打断机制接入
# (comfy.model_management.throw_exception_if_processing_interrupted)
def _check_interrupt():
    """用户按取消时立刻中断节点执行(阻塞 HTTP 调用前/后/重试前各查一次)"""
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
        throw_exception_if_processing_interrupted()
    except ImportError:
        pass  # 测试环境无 ComfyUI 本体时静默跳过
    except Exception:
        raise  # ComfyUI 环境下的 InterruptException 正常上抛
from pathlib import Path
from typing import Any

# 透明声明句级剔除单源(10-09-qi21-prompt-layer-conflict;装配器同款双路导入:
# 包上下文相对导入,sys.path 直载/importlib 直载形态回落同目录直载)
try:
    from ._qi21_rgba_text import strip_rgba_decl
except ImportError:  # pragma: no cover - 直载形态走此腿
    import importlib.util as _ilu
    _rgba_spec = _ilu.spec_from_file_location(
        "qi21_rgba_text_peer_load", Path(__file__).resolve().parent / "_qi21_rgba_text.py")
    _rgba_mod = _ilu.module_from_spec(_rgba_spec)
    _rgba_spec.loader.exec_module(_rgba_mod)
    strip_rgba_decl = _rgba_mod.strip_rgba_decl


# 1008 用户令「不能异步调用?」:urlopen 放后台线程,主线程每 5 秒查打断
import threading

def _interruptible_urlopen(req, timeout, poll_interval=5):
    """可打断的 urlopen:HTTP 调用在 daemon 线程跑,主线程轮询打断信号。
    用户按取消 → _check_interrupt() 抛 InterruptException → 立刻返回,
    不等 LLM 响应(最长可等 timeout 秒的旧方案就此退役)。"""
    result = {"resp": None, "error": None}
    done = threading.Event()

    def _worker():
        try:
            result["resp"] = urllib.request.urlopen(req, timeout=timeout)
        except Exception as exc:
            result["error"] = exc
        finally:
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    while not done.wait(timeout=poll_interval):
        _check_interrupt()  # 用户取消 → 立刻抛异常返回
    if result["error"] is not None:
        raise result["error"]
    return result["resp"]

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
# 云端档(1007 用户令:开关=api_key 控件,填=云端/留空=本地;URL+模型内置,
# 模型钉死 glm-5.3-flash 勿擅换——同 local-ocr 技能钉型令)
_CLOUD_URL = os.environ.get("MYSTUDIO_QI21_CLOUD_URL", "https://open.bigmodel.cn/api/paas/v4")
_CLOUD_MODEL = os.environ.get("MYSTUDIO_QI21_CLOUD_MODEL", "glm-5.3-flash")
# 内置本地兜底对(URL, model)——cloud_mode 强制在链尾,防 api_url 被填成
# 云端地址挤掉本地(1007夜 00011 实弹:云端429+本地不在链=透传=脏图)。
# 1007夜用户令「不用本地接,用 Windows 的那个 LM Studio 接」——兜底恒
# Windows 9B,Mac 本机 27B(127.0.0.1:1234)出局
_BUILTIN_LOCAL: tuple[tuple[str, str], ...] = (
    ("http://192.168.0.101:1234", "qwen3.5-9b-uncensored-hauhaucs-aggressive"),
)


def _cloud_targets(api_url: str | None, model: str | None) -> tuple[list[str], list[str]]:
    """云端模式目标链:云端在前 + api_url 本地列表 + 内置本地对强制追加去重。

    1007晚用户令「云端挂≠弃改写」:旧版云端挂直接透传(弃了本地9B);
    1007夜补强:api_url 填了云端地址时 local 列表全非本地,内置对保底。"""
    urls = [_CLOUD_URL.rstrip("/")] + [
        u.strip().rstrip("/") for u in (api_url or "").split(",") if u.strip()]
    models = [_CLOUD_MODEL] + [
        m.strip() for m in (model or "").split(",") if m.strip()]
    for _u, _m in _BUILTIN_LOCAL:
        if _u not in urls:
            urls.append(_u)
            models.append(_m)
    return urls, models


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
        return _web.json_response({"ok": True, "set": bool(_RUNTIME_KEY)})

    async def _get_key(_request):
        if _RUNTIME_KEY:
            src = "runtime"
        elif os.environ.get("MYSTUDIO_QI21_PE_KEY"):
            src = "env"
        else:
            src = "keychain" if _CLOUD_KEY_CACHE or _keychain_probe() else "none"
        return _web.json_response({"ok": True, "source": src})

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
    """风格底座全文+色卡块(同 json mtime 缓存;真源=art_style_base/color_lexicon)。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    if mtime is not None and _ctx_cache["mtime"] == mtime and _ctx_cache["style"] is not None:
        return _ctx_cache["style"], _ctx_cache["colors"]
    data = _load_bases_node()
    style = str((data.get("art_style_base") or {}).get("positive_text") or "").strip()
    # 1007 v9:色库数据出教材归[4031]——兜底升级为[4031]同款全量
    # (在用词详表+canon42全库;教材只剩选题逻辑,不接线不得缺42色)
    cl = data.get("color_lexicon") or {}
    IN_USE = set((cl.get("entries") or {}).keys())
    lines = ["【项目色卡选项清单】(从中选 2-5 个,用且仅用选中色词写终稿;禁止全选)",
             "选法:大面积基底(stable)选1 | 主体色(mid)选1-3 | 点睛(accent)选0-1",
             "色词必须落到实物载体(部件/材质/布面),禁落光效;禁裸色词(色+材质)",
             "冲突裁决序(高>低): " + " > ".join(cl.get("conflict_order", []))]
    for i, (word, ent) in enumerate(sorted((cl.get("entries") or {}).items()), 1):
            lines.append(f"  ★在用{i}. {word}:{ent.get('usage_hint','')}")
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


def _rgba_lean_pos(subj: str, type_pos: str | None = None) -> str:
    """透明路回退极简公式(1008 R3九型实弹定谳;1009晚修:零自带头尾+剥中文透明句)。

    依据:富装配17句画背景命令以6.7~8.3:1兵力比淹没透明指令(道具全透
    4.98%/多视图·高清人脸·表情差分0.00%,同seed四连逐字节复现;0927d
    剂量-响应同构)。配方=0927d探针实测定谳(英文公式短文直塞90.34%透明;
    专用件 qwen21-daotu-rgba-t2i 同款);
    rgba_positive=该型透明路格式锁(纯框架零绘画词),按型文逐字匹配取用;
    rgba_text=底座风格托底(1008 用户令拆分:画法工艺子集随行托风格,
    底色/平涂/背景语言仍排除——1008晚二轮实证纯主体句无托底=风格漂成普通渲染)。
    1009晚修(用户令「修」,实弹 A案补色首弹收据实证双头双尾+中文透明句残留):
    ①透明语义全英文承载(2008架构令)——rgba_positive 自带的中文透明声明句
    (「图为带透明通道…背景透明」)句级剥除,不再入正文;
    ②官方头尾(head_en/tail_en)由 [4014] FinalOutput 统一包裹各一次,
    本回退路零自带头尾(治 lean 自带+4014 再包=双头双尾叠加)。
    """
    bases = _load_bases_node()
    body = (subj or "").strip()
    extra = ""
    if (type_pos or "").strip():
        for t in (bases.get("types") or []):
            if isinstance(t, dict) and (t.get("positive_text") or "").strip() == type_pos.strip():
                extra = str(t.get("rgba_positive") or "").strip()
                break
    # 1009晚修①:句级剥除中文透明声明(rgba_positive 为单段多句,行级滤不够;
    # 10-09 层冲突治理:口径收归 _qi21_rgba_text 单源,单段时逐字节同旧式)
    extra = strip_rgba_decl(extra).strip()
    style_backing = str((bases.get("art_style_base") or {}).get("positive_style_text") or "").strip()
    carry = str((bases.get("art_style_base") or {}).get("rgba_text") or "").strip()
    parts = [p for p in (body, extra, style_backing, carry) if p]
    if not parts:
        parts = ["A single game asset, clean flat cutout, centered, isolated on a transparent background."]
    return " ".join(parts)


# ── 1009 单线四段协议(用户令「1条线分4段,透明与背景分开,[4013]拼装更方便」)──
# 线上唯一载体=[4032] 主口「文本」,格式逐字定死(四段各占一行,段内=真源字段现值):
#   【风格工艺件】{positive_style_text}
#   【底色背景件】{positive_ground_text}
#   【透明承载件】{rgba_text}
#   【负向词表】{negative_text}
# 以【风格工艺件】开头=协议模式;无标记(i2i 旧线传全文)=legacy 一字不变。
_PROTO_TAGS = ("【风格工艺件】", "【底色背景件】", "【透明承载件】", "【负向词表】")


def _parse_bases_protocol(text: str | None) -> dict | None:
    """四段协议解析:恰 4 段断言(每段去标记取正文)。

    返回 {"style","ground","rgba","neg"};无标记=None(legacy 全文直通);
    开头带标记但段数≠4(坏协议,现网唯一生产者 [4032] 不可能产)→响亮 print
    后按 None 走 legacy 全文(恒有输出不炸产线,与本件容错哲学同款)。"""
    t = (text or "").strip()
    if not t.startswith(_PROTO_TAGS[0]):
        return None
    segs = re.split("【风格工艺件】|【底色背景件】|【透明承载件】|【负向词表】", t)
    if len(segs) != 5 or segs[0].strip():
        print(f"[漫影 API扩写PE] 四段协议段数异常({len(segs) - 1}段,应恰4)——"
              "按旧全文直通处理,请检查 [4032] 出文")
        return None
    style, ground, rgba, neg = (s.strip() for s in segs[1:])
    return {"style": style, "ground": ground, "rgba": rgba, "neg": neg}


def _proto_base_segment(proto: dict, transparent: bool) -> str:
    """协议底座段(与装配器 _style_combo_transparent 同口径直接拼接)。

    1008 用户架构令:透明语义零入 PE——透明开=仅风格段(承载/头尾全由
    [4014] 程序化包裹,AI 改不坏);关=风格段+底色段。"""
    if transparent:
        return (proto["style"] or "")
    return (proto["style"] or "") + (proto["ground"] or "")


def _hot_fallbacks() -> tuple[str, str, str]:
    """(教材, 色卡, 风格底座) 真源热读兜底(连线缺位时用;mtime 缓存)。"""
    style, colors = _context_materials()
    data = _load_bases_node()
    raw = (data.get("expand_instruction") or {}).get("system_prompt_zh")
    textbook = str(raw).strip() if isinstance(raw, str) else ""
    if not textbook:
        # 注(1008 PE教材环境低频轮):本串=连线缺位且真源热读失败时的应急极简桩,非教材副本——
        # 教材正文(含 v11 环境低频纪律)恒热读 qi21_bases.json,桩不随教材版本走(A3 口径)。
        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"
                    "画面描述长文(篇幅软参考300-800字),观察者口吻;用户固定的名词/数量/"
                    "颜色/位置逐字保留。输出单行 JSON:"
                    '{"rewritten_prompt": "<中文长文>"}')
    return textbook, colors, style


def _build_system(wired_sys: str | None, wired_colors: str | None) -> str:
    """终版系统提示 = (连线教材||热读教材) + (连线色卡||热读色卡节)。

    1006 九轮:教材全面重写(qi21_bases.json system_prompt_zh,当时 1557 字,
    今 3118 字 v9)——
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


def _subject_color_clusters(subj: str, transparent: bool = False) -> list[list[str]]:
    """从主体句提取色词候选簇(确定性三源):
    ①color_lexicon 在用词 ②palette-canon 42 色名 ③模式提取(X色/X+色字/色字+X)。
    只取在主体句中实际出现的——这些是核心规则4的逐字禁换对象。
    重叠候选并簇(跨词边界两侧同簇);返回簇列表,簇内序=词典源优先→非色字最少
    →最长→最前(簇首=代表,展示/报违例名用)。"""
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
    # 前瞻扫描取全重叠候选(两侧都产真词也产垃圾:月白/暗红/鎏金=前随真词,
    # 灰绳/黑革/黄铜=后随真词;缠灰/侧黑/修玄色=前随垃圾,白腰/红剑=后随垃圾)。
    for m2 in _re.finditer(r"(?=([一-龥]{1,2}色))", subj):
        g = m2.group(1)
        spans.append((m2.start(), m2.start() + len(g), g, 1))
    for m2 in _re.finditer(r"(?=([一-龥][白红青金墨灰绿蓝褐黑黄紫银玉]))", subj):
        g = m2.group(1)
        spans.append((m2.start(), m2.start() + len(g), g, 1))
    for m2 in _re.finditer(r"(?=([白红青金墨灰绿蓝褐黑黄紫银玉][一-龥]))", subj):
        g = m2.group(1)
        spans.append((m2.start(), m2.start() + len(g), g, 1))
    # 1010 假红三犯停用(用户令「都做」):模式源候选的边字为 的/了/多/全/发/夜/景/物/彩
    # =非色词——「静坐**的**白发老僧」切出**的白**/「**发**色乌黑」切出**发色**/
    # 「**多**色相并陈」「**全**色相并陈」切出**多色/全色**(实弹三发假红拒收
    # →补发解析失败→全透传的元凶;C12 断言假红家族第三犯)。词典源(旧金/月白
    # 在册)不受此滤;真模式色(乌黑/暖金/暗红)边字不在停用集,照常存活。
    _junk_edge = set("的了多全发夜景物彩图与温调相")
    spans = [sp for sp in spans
             if sp[3] == 0 or not (sp[2][0] in _junk_edge or sp[2][-1] in _junk_edge)]
    # 1009 聚簇重写(9B探针定谳):旧「逐 span 逐字在场」检在跨词边界碎片上必散架
    # (修玄色/侧黑/缠灰——色词本体玄色/黑革/灰绳都在,合法改写把相邻字拆开,
    # 零违例门把好稿拒了=近期实弹全透传真凶)。重叠候选并簇;簇代表序=非色字
    # 最少(度量集含「色」:X色尾字是构词不是噪音,防「青玉」压「青玉色」;垃圾
    # 边字修/缠/侧全非色字,天然沉底)→最长→词典源→最前;在场检改**簇内任一
    # 命中即过**(月白簇={月白,白腰}改写保任一形态都过);独行簇(黑鲨)仍拦
    # 「黑色鲨鱼皮」类真色词改写=教材规则4本义,交补发治。
    _metric = _cs | {"色"}
    _key = lambda x: (sum(c not in _metric for c in x[2]), -(x[1] - x[0]), x[3], x[0])
    clusters: list[list[tuple[int, int, str, int]]] = []
    _max_e = -1
    for sp in sorted(spans, key=lambda x: (x[0], x[1])):
        if clusters and sp[0] < _max_e:
            clusters[-1].append(sp)
        else:
            clusters.append([sp])
        _max_e = max(_max_e, sp[1])
    out: list[list[str]] = []
    for cl in clusters:
        cl.sort(key=_key)
        s, e = cl[0][0], max(x[1] for x in cl)
        # 透明开:与环境词同小句紧邻(间隔≤4字且无标点)的色簇随环境合法删,不检
        if transparent and any(
                max(s - ee, es - e, 0) <= 4
                and not any(ch in _PUNCT
                            for ch in subj[min(e, es):max(s, ee)])
                for es, ee in _env_spans(subj)):
            continue
        out.append([x[2] for x in cl])
    return out


def _subject_colors(subj: str, transparent: bool = False) -> list[str]:
    """簇代表列表(展示/教学用);在场检请用 _subject_color_clusters(任一命中)。"""
    return [cl[0] for cl in _subject_color_clusters(subj, transparent)]


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


def _strip_artifacts(pos: str) -> str:
    """出文残渣保守剥除(1009晚修,修后首弹实弹收据实证):

    Windows 9B 偶把 JSON 皮与自我修补注释写进 rewritten_prompt 值内部
    (收据形态:「…技法。”}**}  <!-- 注意:JSON末尾多了一个 } ,需修正为 {」)
    ——全角引号 ” 骗过 _balanced_json 的字符串状态机,整体仍是合法 JSON,
    解析层无责;剥除归出文卫生层。中文画面正文零合法 <!-- 与尾随花括号,
    只剥 HTML 注释(闭合+尾部未闭合)与串尾 JSON 皮残渣块,保守不动中段。"""
    out = re.sub(r"<!--.*?-->", " ", pos, flags=re.S)
    out = re.sub(r"<!--.*$", " ", out, flags=re.S)
    if out.rstrip().endswith(("}", "*", "”", '"', "’", "'", "】")):
        out = re.sub(r"[\u201c\u201d\u2018\u2019\"'\]】]?\s*\}[\}\*\s\u201c\u201d\"'\]】]*$",
                      " ", out.rstrip())
    return out.strip()


_COLOR_CODE_PARENS = re.compile(r"\s*[（(]\s*[a-z]{3,8}\.\d{2}\s*[)）]")
_COLOR_CODE_BARE = re.compile(r"\b[a-z]{3,8}\.\d{2}\b")
_COLOR_HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")


def _strip_color_codes(pos: str) -> str:
    """词典编号(paper.01/blue.02 等 ma_id)与 hex 硬剥(1009 用户抓「这些词出图模型认吗」)。

    9B 改写会把色卡里的内部编号括注进终稿(收据实证「赭石(red.04)」「宣纸白系
    (paper.01 宣纸白)」)——文本编码器不识编号与色值,纯噪音;卡文侧已立禁令+
    渲染侧已剥展示,本滤=末路兜底,三重防线。中文正文零合法 ma_id/hex 形态。"""
    out = _COLOR_CODE_PARENS.sub("", pos)
    out = _COLOR_CODE_BARE.sub("", out)
    out = _COLOR_HEX.sub("", out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


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


# 正负撞词豁免表(语义分组声明,08§8 断言语义纪律):键=负向 token,值=正向
# 同域合法术语组——匹配前先从正向稿剥除豁免词组再检该 token,防假红误杀合法
# 正向稿。干跑三轮(2026-10-08,S1 批在档):A=十型装配正向直写文×三源负向零撞;
# B=教材指令词域,唯一命中=「透视」×「大气透视」(教材第六步关模式明令氛围词,
# 负向「透视」=多视图/表情差分型机位/形变缺陷义,非该氛围词)→立本豁免;
# C=实弹样例稿三件(27B 实弹/透明稿/八步产出长文)带豁免零撞。新豁免须先补干跑。
_CLASH_EXEMPT: dict[str, tuple[str, ...]] = {
    "透视": ("大气透视",),
}


def _pos_neg_clash(pos: str, neg_tokens: list[str]) -> list[str]:
    """正负撞词检(1008 用户令):模型正向稿含负向语料 token=违例拒收。

    负向已由三源程序构造(解耦终裁),正向稿再撞负向 token=同一画面既要求又
    禁画的正负冲突唯一残余面,零违例接收门在此拦死。空白归一两侧同规(同
    C14 配方);豁免词组先剥后检(见 _CLASH_EXEMPT 声明),拆写变体(透视变形/
    透视缩短/广角畸变等)仍被各自原词 token 命中,不因豁免漏网。"""
    pos_c = _squash(pos)
    v: list[str] = []
    for tok in neg_tokens:
        probe = pos_c
        for ex in _CLASH_EXEMPT.get(tok, ()):
            probe = probe.replace(_squash(ex), "")
        if _squash(tok) in probe:
            v.append(f"正负撞词:{tok}")
    return v


def _self_check(pos: str, neg_tokens: list[str],
                transparent: bool, subj: str) -> list[str]:
    """出稿机器自检(1006 B案立;1008 解耦终裁重构为零违例接收门清单)。
    六检全确定性:①透明开禁指令词/环境词残留 ②关模式环境词保留 ③主体句色词
    逐字在场 ④境界词 ⑤部件名词 ⑥正负撞词(_pos_neg_clash)。
    「负向三源在场」检随解耦退役(其对象=模型负向稿,输出侧已不采信,终稿负向
    恒由源词程序构造=结构性不缺词)。违例清单非空=不合格稿,零违例才收;
    锚点类(匾额等普通名词)无法确定性判定,仍不在此检。"""
    v: list[str] = []
    pos_c = _squash(pos)  # 空白归一:"软 3D"与"软3D"判同
    if transparent:
        for tok in _META_TOKENS + _ENV_TOKENS:
            if tok in pos:
                v.append(f"透明残留:{tok}")
    else:
        # 关模式对称检:主体句里的环境词须保留(美宣案:云海被误删)
        for tok in _ENV_TOKENS:
            if tok in subj and tok not in pos_c:
                v.append(f"环境丢:{tok}")
    # 1009 聚簇任一命中:跨词边界两侧同簇(月白/白腰),合法改写保任一形态都过;
    # 整簇缺席=真丢色,violation 名=簇代表。
    for cl in _subject_color_clusters(subj, bool(transparent)):
        if not any(m in pos_c for m in cl):
            v.append(f"色词丢:{cl[0]}")
    for st in _subject_stages(subj):
        if st not in pos_c:
            v.append(f"境界丢:{st}")
    for pt in _PART_TOKENS:
        if pt in subj and pt not in pos_c:
            v.append(f"部件丢:{pt}")
    v.extend(_pos_neg_clash(pos, neg_tokens))
    # 1008 用户令「为啥不在代码中加入日志」+「模型挂了不会拼接?」:
    # ⑦最短长度门(<300字=底座/型层被丢,拒收回退装配文保底)
    if len(pos.strip()) < 300:
        v.append(f"过短:{len(pos.strip())}字(<300,底座/型层疑似被丢)")
    return v


_NEG_DIRTY_WORDS = ("远处", "背景", "远景", "近景", "中景", "景深")


def _sanitize_negative(neg: str) -> str:
    """剥扩写自补的构图景深脏词(1007 用户令「解决脏问题」)。

    实弹档案:场景终稿负向末尾被 9B 自补「远处」、人物被自补「远处, 背景」
    ——型负面/美术风格底座负面/装配代码三处真源恒无(1007 复核六词零命中),且与
    正向内容词(远景淡墨云海等)直接打架=负向禁画远处/背景,正向又要画。
    剥除=确定性后处理,不依赖模型听话;按整词剥(逗号分词,非子串替换),
    真源负面若未来合法引入这些词须同步修订本表。
    1008 解耦终裁后本函数只清洗三源源词合并结果(模型负向键已不采信):
    全脏输入清洗后返回空串(旧=回传原文,脏词泄漏进负向编码器的缺陷就此根修),
    合法词项原样保留不改写。
    """
    if not neg:
        return neg
    parts = re.split(r"([,，])", neg)
    out: list[str] = []
    for idx, p in enumerate(parts):
        if p.strip() in _NEG_DIRTY_WORDS:
            if out and out[-1] in (",", "，"):
                out.pop()  # 词在中段/尾部:吃掉词前分隔符
            elif idx + 1 < len(parts) and parts[idx + 1] in (",", "，"):
                parts[idx + 1] = ""  # 词在首位:吃掉词后分隔符
            continue
        out.append(p)
    return "".join(out)


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


def _parse_envelope(content: str, reasoning: str) -> dict | None:
    """正文→rewritten_prompt 信封解析链(围栏/缺{/缺{"/平衡/思考剥/末路正则)。
    1010 拆函数(主链+救回目标+补发重试三路复用)+末路二阶:严格正则断在值内
    第一个未转义引号就弃稿——改贪心到全文末引号直取键值原文(仅 \" 与 \\
    反转义),治「前导空白+缺{+值内未转义引号」三合一形态(实弹:5436字完整
    改写稿被扔,正文头' "rewritten_prompt": …'即此形态)。"""
    _raw = content.strip()
    if _raw.startswith("```"):
        _raw = _raw.strip("`").strip()
        if _raw.startswith("json"):
            _raw = _raw[4:].strip()
    if '"rewritten_prompt"' in _raw and not _raw.lstrip().startswith("{"):
        _raw = "{" + _raw.lstrip()
    if re.match(r'rewritten_prompt"\s*:', _raw):
        _raw = '{"' + _raw
    obj = _balanced_json(_raw) or _envelope_from_reasoning(reasoning)
    if obj is None:
        m = re.search(r'"?rewritten_prompt"?\s*:\s*"((?:[^"\\]|\\.)*)"', _raw)
        if m:
            try:
                obj = {"rewritten_prompt": json.loads('"' + m.group(1) + '"')}
            except (ValueError, TypeError):
                obj = None
    if obj is None:
        m2 = re.search(r'"?rewritten_prompt"?\s*:\s*"(.*)"', _raw, re.S)
        if m2 is None:  # 值尾连闭合引号也丢——取到文末,剥尾杂(}"/空白)
            m2 = re.search(r'"?rewritten_prompt"?\s*:\s*"(.*)\s*$', _raw, re.S)
        if m2:
            _v = m2.group(1).rstrip('"}` ').strip()
            _v = _v.replace('\\"', '"').replace("\\\\", "\\")
            if _v.strip():
                obj = {"rewritten_prompt": _v}
    return obj


def _envelope_from_reasoning(reasoning: str) -> dict | None:
    """思考尾信封恢复(1009 Mac 27B MLX 路由定谳:该服务全部输出落
    reasoning_content、content 恒空):与正文路同链修边后取对象——
    ①_balanced_json 直取;②代码围栏剥除+丢 {/{" 补回;③键值正则按 JSON
    转义律直取(串内裸换行为该路由实弹非法细节:json 严格模式拒收,正则
    [^"\\] 天然容之,取串后再补转义解出;尾缺 } 也活)。取不出返 None。"""
    tail = reasoning[-4000:]
    obj = _balanced_json(tail)
    if isinstance(obj, dict) and isinstance(obj.get("rewritten_prompt"), str) \
            and obj["rewritten_prompt"].strip():
        return obj
    t = tail.strip()
    if t.startswith("```"):
        t = t.strip("`").strip()
        if t.startswith("json"):
            t = t[4:].strip()
    if re.match(r'rewritten_prompt"\s*:', t):
        t = '{"' + t
    elif '"rewritten_prompt"' in t and not t.startswith("{"):
        t = "{" + t
    m = re.search(r'"?rewritten_prompt"?\s*:\s*"((?:[^"\\]|\\.)*)"', t)
    if m:
        try:
            return {"rewritten_prompt": json.loads(
                '"' + m.group(1).replace("\r", "\\r").replace("\n", "\\n") + '"')}
        except (ValueError, TypeError):
            return None
    return None


class MyQi21ApiPE:
    """漫影 API扩写PE:LM Studio(默认 Windows 远程 9B)按真源教材终炼装配全文(十入全上下文)。"""

    CATEGORY = "漫影"
    DESCRIPTION = ("API扩写PE:LM Studio(默认 Windows 远程 9B,OpenAI 兼容)按 "
                   "qi21_bases.json 中文教材扩写主体句;锚点保全实测优于蒸馏 "
                   "pe_t2i;全挂=透传自装配不炸")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        ctx = {
                "系统提示词": ("STRING", {"forceInput": True, "tooltip": "连 [4030] 真源文本·系统提示词;不连=真源热读兜底"}),
                "色卡": ("STRING", {"forceInput": True, "tooltip": "连 [4031] 真源文本·色卡;不连=真源热读兜底"}),
                "美术风格底座-正向": ("STRING", {"forceInput": True, "tooltip": "连 [4032].0 美术风格底座·正向全文;不连=真源热读兜底"}),
                "美术风格底座-负向": ("STRING", {"forceInput": True, "tooltip": "连 [4032].1 美术风格底座·负向词表(终稿负向三源之一);不连=真源热读兜底"}),
                "正向提示词": ("STRING", {"forceInput": True, "tooltip": "外部手写正向原文;锚点权重最高,润炼逐字保留其实体"}),
                "负向提示词": ("STRING", {"forceInput": True, "tooltip": "外部手写负向原文;逐条并入 negative_prompt 不丢条目"}),
                "类型句正向": ("STRING", {"forceInput": True, "tooltip": "连 [4010].0 类型句(BASE 正文)"}),
                "类型句负向": ("STRING", {"forceInput": True, "tooltip": "连 [4010].3 类型句负面词(负面精炼原料)"}),
                "画幅宽": ("INT", {"forceInput": True, "tooltip": "连 [4010].1 九型WIDTH(画幅语境)"}),
                "画幅高": ("INT", {"forceInput": True, "tooltip": "连 [4010].2 九型HEIGHT(画幅语境)"}),
                "透明模式": ("BOOLEAN", {"forceInput": True, "tooltip": "连 [4010].4 透明值:开=透明素材图,勿虚构背景"}),
        }
        return {
            "required": {
                "api_url": ("STRING", {"default": "http://192.168.0.101:1234",
                                       "tooltip": "LM Studio 服务地址,多个逗号分隔依次尝试(Windows 远程 9B;1007夜用户令:不用 Mac 本机接)"}),
                "model": ("STRING", {"default": "qwen3.5-9b-uncensored-hauhaucs-aggressive",
                                     "tooltip": "模型 id,逗号分隔与 api_url 逐一配对(Windows LM Studio 9B)"}),
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
                api_url: str = "http://192.168.0.101:1234",
                model: str = "qwen3.5-9b-uncensored-hauhaucs-aggressive", temperature: float = 0.7,
                max_tokens: int = 12000, timeout_sec: int = 600,
                thinking_effort: str = "关闭",
                **kw):  # 1008 槽名带连字符(美术风格底座-正向/-负向)不能作形参,**kw 按键名取
        """十入全上下文→LM Studio 扩写→五口(正向/负向/透明/宽/高)。

        三路外部原文(型底座/正/负向提示词)并入「画面上下文」参考块(有则加,
        无则跳),改写对象仍是装配全文;服务不在/超时/解析失败=透传
        (prompt原文, "")——PE关同效,不炸产线。
        """
        # 1006 七轮(用户令「AI挂了也从本节点做,恒有输出」):三层装配内置,
        # 逐字复刻三层装配格式(主体句\nBASE\n美术风格底座;BASE 空=两段)——AI 输入
        # 基底与降级正稿同源;AI 挂=本正稿直出,节点任何情况都有输出
        subj = (正向提示词 or "").strip()
        base = (类型句正向 or "").strip()
        _, _, hot_style = _hot_fallbacks()
        wired_style = (kw.get("美术风格底座-正向") or "").strip()
        # 1009 单线四段协议:连线值以【风格工艺件】开头=协议模式——恰4段拆解后
        # 按型拼底座段(透明开=风格+透明承载/关=风格+底色,透明与背景分开);
        # 负向段替换 style_base_neg 连线位(型负在前负向段在后,合并次序照旧)。
        # 非协议(值存在但无标记,如 i2i 旧线传全文)=现行全文行为一字不变。
        proto = _parse_bases_protocol(wired_style)
        proto_neg: str | None = None
        if proto is not None:
            proto_neg = proto["neg"]
            style = _proto_base_segment(proto, bool(透明模式))
        # 1008晚三件拆分(用户令):透明开的 PE 输入装配也换「风格工艺件+透明承载件」
        # 组合(零底色/背景命令进模型,与回退极简公式同一拆分口径);连线槽的
        # 底座全文(带背景版)透明路不采信,热读真源组合;缺拆分件旧库回退全文。
        # (1009:协议模式在上方已按段拼装,热读组合只服务 legacy 无标记线)
        elif 透明模式:
            # 1008 用户架构令:透明语义零入 PE——输入只挂风格工艺件,
            # 头尾/承载全由 [4014] 程序化包裹(官方句,AI 改不坏)。
            _asb = (_load_bases_node().get("art_style_base") or {})
            _st = str(_asb.get("positive_style_text") or "").strip()
            if _st:
                style = _st
            else:
                style = wired_style or hot_style
        else:
            style = wired_style or hot_style
        # 10-09 层冲突治理 P5:透明开时型文自带的中文透明声明句不入 PE 输入
        # (透明语义全英文承载,[4014] 包裹);原始 base 仍传 _rgba_lean_pos 作逐字匹配键
        base_pe = strip_rgba_decl(base).strip() if (透明模式 and base) else base
        direct = f"主体句:{subj}\n类型句:{base_pe}\n{style}".strip() if base_pe else f"主体句:{subj}\n{style}".strip()
        if not subj:
            print("[漫影 API扩写PE] 正向提示词未接线:主体句层缺席,装配=底座+风格两段")
        # 负面三源(型负面+美术风格底座负面热读+外部负向)去重合并——终稿负向唯一真源
        # (程序构造不进模型,1008 解耦;挂=同值直出)
        # 1008 用户令:[4032].1 负向接线优先(可视化真源链),未连=真源热读兜底(同款)
        # 1009 协议模式:负向段替换连线位(段空=热读兜底照旧,同源同值)
        if proto_neg is not None:
            style_base_neg = proto_neg
        else:
            style_base_neg = (kw.get("美术风格底座-负向") or "").strip()
        if not style_base_neg:
            try:
                style_base_neg = str((_load_bases_node().get("art_style_base") or {})
                               .get("negative_text") or "").strip()
            except Exception:
                style_base_neg = ""
        neg_tokens, seen = [], set()
        for src in (类型句负向, style_base_neg, 负向提示词):
            for tok in (x.strip() for x in re.split(r"[,，\n]", (src or "")) if x.strip()):
                if tok not in seen:
                    seen.add(tok)
                    neg_tokens.append(tok)
        # 1008 负向解耦终裁(用户令「模型不再管理负向词…负向词一路由程序组合,
        # 输出到最后」):①输入侧——负面清单不再送模型,上下文块只留正稿结构/
        # 画幅/透明运行约束(色卡在系统消息侧);②输出侧——终稿负向恒=三源源词
        # 程序合并·去重·清洗(neg_out),模型返回负向键一律忽略,首稿/重试/拒收
        # 回退/透传全路径同值(确定性)。
        neg_out = _sanitize_negative(", ".join(neg_tokens))
        # 1008 透明极简回退(R3九型实弹定谳):富装配17句画背景命令以6.7~8.3:1
        # 兵力比淹没透明指令(道具全透4.98%/三型0.00%,同seed四连逐字节复现;
        # 0927d剂量-响应同构)——透明开时,PE失败/拒收/解析失败的一切回退稿
        # 不再放行富装配,改走极简公式(主体句+rgba_positive剥中文透明句+风格
        # 托底;0927d实测90.34%透明,专用件qwen21-daotu-rgba-t2i同款)。PE成功稿
        # 不受影响(自带环境句剥离+六检+教材透明逻辑);[4014]英文头尾统一包裹
        # (1009晚修:回退路零自带头尾,治双头双尾叠加)。
        fallback_pos = _rgba_lean_pos(subj, base) if 透明模式 else direct
        ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---"]
        if style:
            ctx.append("[正稿结构] 主体句\n型底座\n美术风格底座 三层(基底即上文)")
        if 画幅宽 and 画幅高:
            ctx.append(f"[画幅] {画幅宽}×{画幅高}(按此纵横比组织画面描述)")
        ctx.append(f"[透明] {'开:本图为透明素材图,勿虚构繁杂背景' if 透明模式 else '关:常规成图'}")
        user_with_ctx = direct + "\n\n" + "\n".join(ctx)
        # 1007 用户令(开关=api_key 控件):填=云端(_CLOUD_URL/_CLOUD_MODEL 内置,
        # key=填的值),留空=本地(api_url/model 原样);云端失败→回落本地并明示原因
        cloud_mode = bool(_RUNTIME_KEY)
        # 1007夜用户令「不用本地接,用 Windows 的 LM Studio 接」——api_url 空时
        # 默认恒 Windows 9B,Mac 本机 27B(127.0.0.1:1234)出局
        local_urls = [u.strip().rstrip("/") for u in (api_url or "http://192.168.0.101:1234").split(",") if u.strip()]
        local_models = [m.strip() for m in (model or "qwen3.5-9b-uncensored-hauhaucs-aggressive").split(",") if m.strip()]
        if cloud_mode:
            # 1007晚(用户令「按建议做完」):云端在前,挂了回落本地列表逐个
            # 改写(旧=云端挂直接透传,弃了本地9B)——全挂才透传;
            # 内置本地对强制链尾保底(见 _cloud_targets,1007夜脏图役)
            urls, models = _cloud_targets(api_url, model)
        else:
            urls, models = local_urls, local_models
        # URL+model 按索引配对;model 不够时用末位
        pair = lambda i: (urls[i], models[i] if i < len(models) else models[-1] if models else "qwen3.5-9b")
        payload = {
            "model": model or "qwen3.5-9b-uncensored-hauhaucs-aggressive",
            "messages": [
                {"role": "system", "content": _build_system(系统提示词, 色卡)},
                {"role": "user", "content": user_with_ctx},
            ],
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
        # 1007 实测(1234 实弹两轮):chat_template_kwargs 被 LM Studio 层丢弃、
        # /no_think 文本尾被 aggressive finetune 无视;顶层 reasoning_effort 转发生效。
        # 档位映射**逐目标**定(本地与云端值域不同):本地 关闭→none/思考→不发;
        # 云端(1210:该族始终思考,值域 low/high/max)关闭→low/思考→max(用户令最高思考)。
        # 在目标循环内按协议设置(见下),此处不预置。
        def _post(pl: dict) -> dict:
            headers = {"Content-Type": "application/json"}
            if url.startswith("https://"):
                headers["Authorization"] = f"Bearer {_cloud_key()}"
            # 1008 用户令「做」:stream=true 流式读取(SSE)——逐块读+块间查打断
            # 打断延迟<1秒(旧 urlopen 阻塞最长 600 秒不可打断);附带进度可见
            pl["stream"] = True
            req = urllib.request.Request(
                url, data=json.dumps(pl).encode("utf-8"),
                headers=headers, method="POST")
            _check_interrupt()  # 发请求前查打断
            raw = _LAN_OPENER.open(req, timeout=max(10, int(timeout_sec)))
            # 1008 兼容:mock/旧 opener 无 readline → 走旧整块 JSON
            if not hasattr(raw, "readline"):
                return json.loads(raw.read())
            # 首行非 data: 开头=非 SSE → 整块 JSON(服务端不支持流式)
            first_line = raw.readline().decode("utf-8", errors="replace").strip()
            if not first_line.startswith("data: "):
                rest = raw.read().decode("utf-8", errors="replace")
                return json.loads(first_line + rest)
            content, reasoning = [], []
            for line_b in raw:
                line = line_b.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                _check_interrupt()  # 每块查打断(用户取消→<1秒断)
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except ValueError:
                    continue
                delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                if delta.get("content"):
                    content.append(delta["content"])
                if delta.get("reasoning_content"):
                    reasoning.append(delta["reasoning_content"])
            full_text = "".join(content)
            full_reason = "".join(reasoning)
            if not full_text and not full_reason:
                # 流式空(服务端不支持 stream 或出错)→ 回退非流式
                pl.pop("stream", None)
                req2 = urllib.request.Request(
                    url, data=json.dumps(pl).encode("utf-8"),
                    headers=headers, method="POST")
                return json.loads(_LAN_OPENER.open(
                    req2, timeout=max(10, int(timeout_sec))).read())
            # 流式结果重组为与旧格式同构的 dict
            return {"choices": [{"message": {
                "content": full_text,
                "reasoning_content": full_reason}}]}

        t0 = time.time()
        resp = None
        served = ""
        used_idx = -1  # 1010:内容层失败救回要知道已耗掉哪个目标
        _errs: list[str] = []  # 逐目标失败详情(云端失败要明示原因,1007 用户令)
        for _i in range(len(urls)):
            _u, _m = pair(_i)
            _https = _u.startswith("https://")
            # 档位映射逐目标定(本地 none/不发;云端 low/max——1210 值域)
            if _https:
                payload["reasoning_effort"] = "low" if thinking_effort == "关闭" else "max"
            elif thinking_effort == "关闭":
                payload["reasoning_effort"] = "none"
            else:
                payload.pop("reasoning_effort", None)
            # 1009 用户令「按建议做」:本地 LM Studio 挂 json_schema 语法硬约束——
            # 答文信封(丢{/围栏/键名漂移)从概率事件变物理不可能(采样器级语法锁,
            # 同机实弹对照:诱导破坏也被摁住;流式兼容,10-12s/发)。云端 anthropic
            # 口不认 OpenAI response_format 字段故仅本地挂;语法锁只管信封,内容
            # (色词逐字/部件零丢失)仍归教材+机器自检门管。
            if _https:
                payload.pop("response_format", None)
            else:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": "pe_rewrite", "strict": True, "schema": {
                        "type": "object",
                        "properties": {"rewritten_prompt": {"type": "string"}},
                        "required": ["rewritten_prompt"],
                        "additionalProperties": False,
                    }},
                }
            if not _alive(_u):
                print(f"[漫影 API扩写PE] {_u} 探活不通(3s)——跳过"
                      "(服务不在或防火墙拦;排查:docs/comfyui-kb/LMStudio-Windows远程排查.md)")
                _errs.append(f"{_m}:探活不通")
                continue
            url = _chat_url(_u)
            payload["model"] = _m
            try:
                _r = _post(payload)
                # 空正文(思考吃光)也视为不可用,切下一 URL(1006:远程9B 上下文不足案)
                _msg0 = (_r.get("choices") or [{}])[0].get("message", {})
                if not (_msg0.get("content") or "").strip() and not (_msg0.get("reasoning_content") or "").strip():
                    print(f"[漫影 API扩写PE] {_u}({_m}) 返回空,试下一个…")
                    _errs.append(f"{_m}:返回空")
                    continue
                resp = _r
                served = _m + ("(云端)" if _https else "")
                used_idx = _i
                break  # 首个有内容的用
            except urllib.error.HTTPError as _he:
                _detail = ""
                try:
                    _detail = _he.read()[:160].decode("utf-8", "ignore")
                except Exception:
                    pass
                # 1009:旧本地服务不识 json_schema(400 点名 response_format)→
                # 摘约束同目标重发一次,不弃该服务(恒有输出优先)
                if _he.code == 400 and "response_format" in _detail and "response_format" in payload:
                    payload.pop("response_format", None)
                    try:
                        _r2 = _post(payload)
                        _msg0 = (_r2.get("choices") or [{}])[0].get("message", {})
                        if (_msg0.get("content") or "").strip() or (_msg0.get("reasoning_content") or "").strip():
                            resp = _r2
                            served = _m
                            break
                    except Exception as _exc2:
                        print(f"[漫影 API扩写PE] 摘response_format重发仍挂({_exc2})")
                print(f"[漫影 API扩写PE] {_u}({_m}) HTTP {_he.code}: {_detail[:120]}")
                _errs.append(f"{_m}:HTTP {_he.code} {_detail[:80]}")
                continue
            except Exception as exc:
                print(f"[漫影 API扩写PE] {_u}({_m}) 不可达({exc}),试下一个…")
                _errs.append(f"{_m}:{str(exc)[:80]}")
                continue
        if resp is None:
            _why = "; ".join(_errs[-2:]) if _errs else "无目标"
            if cloud_mode:
                print(f"[漫影 API扩写PE] 云端失败({_why})→内置本地兜底亦全挂——"
                      f"本发透传自装配三层(恒有输出);请检查 LM Studio 服务与云端余额")
                _status = f"云端失败:{_why}→本地兜底全挂,透传"
            else:
                print(f"[漫影 API扩写PE] 全部 {len(urls)} 个 LM Studio 均不可达({_why})——"
                      f"本发透传自装配三层(恒有输出);请检查 LM Studio 服务")
                _status = "透传:LM Studio 均不可达"
            return {"ui": {"api_pe_pos": [fallback_pos], "api_pe_neg": [neg_out],
                           "api_pe_status": [_status]},
                    "result": (fallback_pos, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}

        def _salvage_next_model(reason: str):
            """1010 用户令「都做」:内容层失败也换下一模型。
            旧路=网络层失败(探活/HTTP/超时/空)才换目标;内容层失败(机检违例/
            解析失败)同模型补发一次后直接回退装配——其余目标从未被问到
            (实弹:Win9B 机检假红拒收,Mac 27B 活着载着零调用,分镜案)。
            每余位一发:零违例才收,不再二轮补发(补发在主目标已做过)。"""
            nonlocal url
            for _j in range(used_idx + 1, len(urls)):
                _u2, _m2 = pair(_j)
                try:
                    if not _alive(_u2):
                        print(f"[漫影 API扩写PE] 救回: {_u2} 探活不通——下一个")
                        continue
                    url = _chat_url(_u2)
                except Exception:
                    continue
                payload["model"] = _m2
                try:
                    _r2 = _post(payload)
                except urllib.error.HTTPError as _he2:
                    _d2 = ""
                    try:
                        _d2 = _he2.read()[:160].decode("utf-8", "ignore")
                    except Exception:
                        pass
                    if _he2.code == 400 and "response_format" in _d2 and "response_format" in payload:
                        payload.pop("response_format", None)
                        try:
                            _r2 = _post(payload)
                        except Exception as _e2:
                            print(f"[漫影 API扩写PE] 救回目标 {_u2}({_m2}) 失败({_e2})——下一个")
                            continue
                    else:
                        print(f"[漫影 API扩写PE] 救回目标 {_u2}({_m2}) HTTP {_he2.code}——下一个")
                        continue
                except Exception as exc:
                    print(f"[漫影 API扩写PE] 救回目标 {_u2}({_m2}) 失败({exc})——下一个")
                    continue
                _m2m = (_r2.get("choices") or [{}])[0].get("message", {})
                _c2 = (_m2m.get("content") or "").strip()
                _r2r = str(_m2m.get("reasoning_content") or "")
                if not _c2 and not _r2r:
                    print(f"[漫影 API扩写PE] 救回目标 {_m2} 返回空——下一个")
                    continue
                _o2 = _parse_envelope(_c2, _r2r)
                _p2 = _o2.get("rewritten_prompt") if _o2 else None
                if not (isinstance(_p2, str) and _p2.strip()):
                    print(f"[漫影 API扩写PE] 救回目标 {_m2} 稿无信封——下一个")
                    continue
                _p2s = _strip_color_codes(_strip_artifacts(_p2.strip()))
                if 透明模式:
                    _p2s = _strip_env_parens(_strip_env_sentences(_p2s, subj))
                _v2 = _self_check(_p2s, neg_tokens, bool(透明模式), subj)
                if _v2:
                    print(f"[漫影 API扩写PE] 救回目标 {_m2} 稿 {len(_v2)} 项违例"
                          f"({';'.join(_v2[:4])})——不收,下一个")
                    continue
                print(f"[漫影 API扩写PE] {reason}→救回:下一模型 {_m2} 零违例采用({len(_p2s)}字)")
                print(f"[漫影 API扩写PE] 终稿头120: {_p2s[:120]!r}")
                print(f"[漫影 API扩写PE] 终稿尾60: {_p2s[-60:]!r}")
                return {"ui": {"api_pe_pos": [_p2s], "api_pe_neg": [neg_out],
                               "api_pe_status": [f"AI扩写OK:{_m2}(内容层救回)"]},
                        "result": (_p2s, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
            return None

        try:
            _check_interrupt()  # 1008:LLM 响应后查打断(重试/自检前)
            msg = (resp.get("choices") or [{}])[0].get("message", {})
        except (AttributeError, IndexError):
            msg = {}
        content = msg.get("content") or ""
        reasoning = str(msg.get("reasoning_content") or "")
        # 1006 三轮实弹:上下文变大后思考链可吃光预算致正文空——空正文且
        # 有思考=重试一次(预算翻倍+硬指令直接出 JSON);再空=从思考尾剥 JSON 兜底
        if not content.strip() and reasoning:
            # 1009 Mac 27B MLX(回落二级)路由定谳:该服务全部输出落 reasoning_content、
            # content 恒空(与预算无关,reasoning_effort=none 亦不改道)——思考尾已含可恢复
            # 信封时直接走下方剥取路径,不烧加预算重试(实弹:重试只会原样复刻同形态)。
            _early = _envelope_from_reasoning(reasoning)
            if _early is not None:
                print(f"[漫影 API扩写PE] 正文空但思考尾含完整信封({len(reasoning)}字)——免重试直接采用")
            else:
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
        obj = _parse_envelope(content, reasoning)
        pos = obj.get("rewritten_prompt") if obj else None
        if isinstance(pos, str) and pos.strip():
            # 模型负向键(negative_prompt)一律不采信(1008 解耦):终稿负向恒=neg_out
            pos_s = pos.strip()
            # 1009晚修:出文残渣剥除(JSON 皮/自我修补注释,9B 偶写进值内)——
            # 先剥残渣再进环境句剥离与六检,两路(透明/非透明)统一过。
            pos_s = _strip_color_codes(_strip_artifacts(pos_s))
            if 透明模式:
                pos_s = _strip_env_parens(_strip_env_sentences(pos_s, subj))
            # 零违例接收门(1008 用户令):自检任一违例=不合格稿——首稿零违例直收;
            # 违例=同模型补发一次(缺什么点什么),重试稿零违例才收;重试仍有违例/
            # 重试解析失败/补发请求失败=拒收模型稿,回退已装配 direct 正稿
            # (拒收可见性=节点 print 日志+引擎 history;零新画布口,恒有输出不炸产线)。
            v1 = _self_check(pos_s, neg_tokens, bool(透明模式), subj)
            if v1:
                _check_interrupt()  # 1008:补发前查打断
                print(f"[漫影 API扩写PE] 机器自检 {len(v1)} 项违例({';'.join(v1[:6])}"
                      f"{'…' if len(v1) > 6 else ''})——同模型补发一次(零违例才收)")
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
                    _o3 = _parse_envelope(_c3, _r3)
                    _p3 = _o3.get("rewritten_prompt") if _o3 else None
                    _check_interrupt()  # 1008:拒收回退前查打断
                    if not (isinstance(_p3, str) and _p3.strip()):
                        print(f"[漫影 API扩写PE] 拒收:重试稿解析失败(无 rewritten_prompt)"
                              f"——模型稿全部拒收,回退装配正稿(fallback_pos {len(fallback_pos)}字+"
                              f"三源确定性负向 {len(neg_out)}字);引擎 history 可查本行")
                        print(f"[漫影 API扩写PE] 回退文头100: {fallback_pos[:100]!r}")
                        _sal = _salvage_next_model("拒收(重试解析失败)")
                        if _sal is not None:
                            return _sal
                        return {"ui": {"api_pe_pos": [fallback_pos], "api_pe_neg": [neg_out],
                                       "api_pe_status": ["拒收回退:重试解析失败,透传装配正稿"]},
                                "result": (fallback_pos, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
                    _p3s = _strip_env_parens(_strip_env_sentences(
                        _p3.strip(), subj)) if 透明模式 else _p3.strip()
                    v2 = _self_check(_p3s, neg_tokens, bool(透明模式), subj)
                    if v2:
                        print(f"[漫影 API扩写PE] 拒收:重试稿仍有 {len(v2)} 项违例"
                              f"({';'.join(v2[:6])};首稿违例={';'.join(v1[:6])})"
                              f"——模型稿全部拒收(违例变少不算过),回退装配正稿"
                              f"(fallback_pos {len(fallback_pos)}字+三源确定性负向 {len(neg_out)}字);"
                              f"引擎 history 可查本行")
                        print(f"[漫影 API扩写PE] 回退文头100: {fallback_pos[:100]!r}")
                        _sal = _salvage_next_model("拒收(自检违例未清)")
                        if _sal is not None:
                            return _sal
                        return {"ui": {"api_pe_pos": [fallback_pos], "api_pe_neg": [neg_out],
                                       "api_pe_status": ["拒收回退:自检违例未清,透传装配正稿"]},
                                "result": (fallback_pos, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
                    print(f"[漫影 API扩写PE] 自检重试零违例({len(v1)}→0)——取第二稿")
                    pos_s = _p3s
                except Exception as exc:
                    print(f"[漫影 API扩写PE] 拒收:自检补发失败({exc})"
                          f"——模型稿全部拒收,回退装配正稿(fallback_pos {len(fallback_pos)}字+"
                          f"三源确定性负向 {len(neg_out)}字);引擎 history 可查本行")
                    print(f"[漫影 API扩写PE] 回退文头100: {fallback_pos[:100]!r}")
                    _sal = _salvage_next_model("拒收(补发失败)")
                    if _sal is not None:
                        return _sal
                    return {"ui": {"api_pe_pos": [fallback_pos], "api_pe_neg": [neg_out],
                                   "api_pe_status": ["拒收回退:补发失败,透传装配正稿"]},
                            "result": (fallback_pos, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
            print(f"[漫影 API扩写PE] 扩写完成:{len(pos_s)}字,"
                  f"耗时 {time.time() - t0:.0f}s(全上下文:系统提示词/色卡/"
                  f"风格/型底座/外部原文/透明;负向=三源程序构造 {len(neg_out)}字)")
            # 1008 用户令「不打日志吗?」:终稿前120字入日志(排障用)
            print(f"[漫影 API扩写PE] 终稿头120: {pos_s[:120]!r}")
            print(f"[漫影 API扩写PE] 终稿尾60: {pos_s[-60:]!r}")
            _ok = f"AI扩写OK:{served}"
            if cloud_mode and not served.endswith("(云端)"):
                _ok += "(云端失败→本地回落改写)"
            return {"ui": {"api_pe_pos": [pos_s], "api_pe_neg": [neg_out],
                           "api_pe_status": [_ok]},
                    "result": (pos_s, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
        print(f"[漫影 API扩写PE] 答文无 rewritten_prompt(解析失败)——透传原文;"
              f"正文{len(content)}字/思考{len(reasoning)}字,正文头200:{content[:200]!r}")
        _sal = _salvage_next_model("解析失败")
        if _sal is not None:
            return _sal
        return {"ui": {"api_pe_pos": [fallback_pos], "api_pe_neg": [neg_out],
                       "api_pe_status": ["透传:答文解析失败"]},
                "result": (fallback_pos, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}


_register_key_route()
