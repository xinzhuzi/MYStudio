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
失效缓存,同 my_qi21_base 模式:改 json 即时生效免重启)+节点内固定补丁两则:
  a. 句尾 /no_think——27B 思考模式实测可吃光 token 预算零正文(232s/2047tok
     全思考案),关后 70s 出 500 字正文;
  b. 肯定式纪律一句——教材未含(1006 实测唯一瑕疵:「未出锋」否定式)。

容错(design 同 MyQi21ChinesePE:PE 关同效,不炸产线):
  - 服务不可达/超时/HTTP 错/JSON 解析失败 → 透传 (prompt,"","","",False)
    +中文 print 警告(画幅链与直写路不受波及);
  - LM Studio 须常驻(单飞资源,+16GB);本节点同步阻塞引擎队列(实测
    ~70s/发,冷首发与长思考更慢——耐心或加 timeout_sec)。

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
import time
import urllib.request
from pathlib import Path
from typing import Any

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
    lines = ["- 大面积基底=淡墨;主体色=石青/青绿/赭石;点睛(accent)只落一个叙事焦点=旧金或朱红(仅来源事实存在时)",
             "- 色词必须落到实物载体(部件/材质/布面),禁落光效特效;禁裸色词(色+材质组合,如「石青丝绦」)"]
    for word, ent in sorted((data.get("color_lexicon") or {}).get("entries", {}).items()):
        if isinstance(ent, dict):
            lines.append(f"- {word}({ent.get('ma_id','')}):{ent.get('usage_hint','')}")
    colors = "\n".join(lines) if len(lines) > 2 else ""
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
    """终版系统提示 = (连线教材||热读教材) + PE 补丁纪律 + (连线色卡||热读色卡) + /no_think。"""
    textbook, hot_colors, _ = _hot_fallbacks()
    sys_text = (wired_sys or "").strip() or textbook
    colors_text = (wired_colors or "").strip() or hot_colors
    text = (sys_text
            + "\n\n## 补充纪律\n"
              "- 画面状态一律肯定式描述(如「剑身完整收在鞘中」),禁用「未/不」"
              "句式;排除项只进 negative_prompt。\n"
              "- **全文润炼铁律(2006 五轮)**:输入是完整装配提示词(主体句+型底座"
              "+锁层A)。你是终炼师:保留全部语义锚点——身份段/部件清单/材质色号/"
              "色锚/画法关键句逐字语义不丢,只做润色衔接、增彩补细节、去冗余重复,"
              "**不得删除或改写任何名词实体**;色卡词优先落实物载体。\n"
              "- **外部手写原文(正向提示词/负向提示词)=锚点权重最高,润炼逐字"
              "保留其实体**:用户手写的正/负向原文实体一字不改进终稿;"
              "负向原文条目逐条并入 negative_prompt,不丢不译。\n"
              "- **透明模式**:上下文标「透明=开」时,本图是透明素材图,主体句"
              "禁虚构繁杂背景环境与远景叙事(背景将被透明化处理)。\n"
              "- **输出铁律**:答文=单行合法 JSON,恰含 rewritten_prompt/"
              "negative_prompt/wh_ratio 三键;禁止 Markdown 围栏、注释、"
              "键外任何文字(结构化供下游机器解析)。")
    if colors_text:
        text += "\n\n## 色卡(用色参考,词可入文,载体纪律在上)\n" + colors_text
    return text + "\n/no_think"


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
                # 1006 六轮(问题5/6/7):上下文槽全 forceInput 纯槽=画布带名连线点
                # (渲染终极机制:对象形+活连线=裸点无标签);[4010] 全五出直连本件
                "系统提示词": ("STRING", {"forceInput": True,
                                         "tooltip": "连 [4030] 真源文本·系统提示词;不连=真源热读兜底"}),
                "色卡": ("STRING", {"forceInput": True,
                                    "tooltip": "连 [4031] 真源文本·色卡;不连=真源热读兜底"}),
                "美术风格底座": ("STRING", {"forceInput": True,
                                            "tooltip": "连 [4032] 真源文本·美术风格底座;不连=热读兜底"}),
                "型底座": ("STRING", {"forceInput": True,
                                      "tooltip": "连 [4010].0 型底座 BASE 原文(参考上下文)"}),
                "正向提示词": ("STRING", {"forceInput": True,
                                        "tooltip": "外部手写正向原文(边界直连);锚点权重最高,润炼逐字保留其实体"}),
                "负向提示词": ("STRING", {"forceInput": True,
                                        "tooltip": "外部手写负向原文(边界直连);逐条并入 negative_prompt 不丢条目"}),
                "画幅宽": ("INT", {"forceInput": True,
                                  "tooltip": "连 [4010].1 九型WIDTH(画幅语境)"}),
                "画幅高": ("INT", {"forceInput": True,
                                  "tooltip": "连 [4010].2 九型HEIGHT(画幅语境)"}),
                "型负面": ("STRING", {"forceInput": True,
                                      "tooltip": "连 [4010].4 型负面词(负面精炼原料)"}),
                "透明模式": ("BOOLEAN", {"default": False,
                                        "tooltip": "连 [4010].3 透明值:开=透明素材图,主体句勿虚构背景"}),
                "正向扩写全文": ("STRING", {"multiline": True,
                                            "tooltip": "展示框:AI 扩写正向全文(执行后 JS 回填,不参与计算)"}),
                "负向扩写清单": ("STRING", {"multiline": True,
                                            "tooltip": "展示框:AI 扩写负向清单(执行后 JS 回填,不参与计算)"}),
        }
        return {
            "required": {
                "装配全文": ("STRING", {"forceInput": True,
                                       "tooltip": "完整装配提示词(主体句+型底座+锁层A;连 [4011].0——所有提示词都经过AI,2006 五轮管线归位)"}),
                "负面词": ("STRING", {"forceInput": True,
                                     "tooltip": "三源合并负面清单(连 [4011].1;经 AI 精炼后出)"}),
                "api_url": ("STRING", {"default": "http://127.0.0.1:1234",
                                       "tooltip": "LM Studio 服务地址(不带 /v1;默认本机1234口)"}),
                "model": ("STRING", {"default": "qwen3.8-27b-uncensored-mlx",
                                     "tooltip": "LM Studio 里的模型 id(lms ls 可查)"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0,
                                          "step": 0.05,
                                          "tooltip": "低温更听话;0.7=实测扩写质量档"}),
                "max_tokens": ("INT", {"default": 12000, "min": 256, "max": 13000,
                                       "tooltip": "含思考链的生成预算(qwen3.8思考焊死无法关,实测全上下文思考~7k字+正文~1k;贴 16k 上下文窗上限)"}),
                "timeout_sec": ("INT", {"default": 600, "min": 10, "max": 3600,
                                        "tooltip": "整发预算(冷首发+长文要留足;超时=透传不炸)"}),
            },
            "optional": ctx,
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("正向提示词", "负向提示词")
    FUNCTION = "rewrite"
    # 1006 四轮(用户令:UI 展示提示词,多行输入框):OUTPUT_NODE+ui 双载荷,
    # JS(my-qi21-prompt-preview.js 同款)把 api_pe_pos/api_pe_neg 落到下方
    # 两只只读多行展示框——画布上直接看 AI 扩写的正向/负向全文;
    # 批C 后正/负向槽兼外部手写原文入口:连线时 widget 转输入(展示框隐),
    # 未连线时仍为展示框(JS 回填)——双态同一槽
    OUTPUT_NODE = True

    def rewrite(self, 装配全文: str, 负面词: str | None = None,
                系统提示词: str | None = None, 色卡: str | None = None,
                美术风格底座: str | None = None, 型底座: str | None = None,
                正向提示词: str | None = None, 负向提示词: str | None = None,
                画幅宽: int | None = None, 画幅高: int | None = None,
                型负面: str | None = None, 透明模式: bool = False,
                api_url: str = "http://127.0.0.1:1234",
                model: str = "qwen3.8-27b-uncensored-mlx", temperature: float = 0.7,
                max_tokens: int = 12000, timeout_sec: int = 600,
                正向扩写全文: str = "", 负向扩写清单: str = ""
                ) -> dict:
        """九入全上下文→LM Studio 扩写→(正向提示词, 负向提示词) 双口。

        三路外部原文(型底座/正/负向提示词)并入「画面上下文」参考块(有则加,
        无则跳),改写对象仍是装配全文;服务不在/超时/解析失败=透传
        (prompt原文, "")——PE关同效,不炸产线。
        """
        direct = (装配全文 or "").strip()
        _, _, hot_style = _hot_fallbacks()
        style = (美术风格底座 or "").strip() or hot_style
        ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---"]
        if style:
            ctx.append("[美术风格底座] " + style)
        if (型底座 or "").strip():
            ctx.append("[型底座] " + 型底座.strip() +
                       "(型选择真源参考,严禁复述进 rewritten_prompt)")
        if (正向提示词 or "").strip():
            ctx.append("[正向提示词·外部手写原文] " + 正向提示词.strip() +
                       "(锚点权重最高,实体逐字保留进 rewritten_prompt)")
        if (负向提示词 or "").strip():
            ctx.append("[负向提示词·外部手写原文] " + 负向提示词.strip() +
                       "(逐条并入 negative_prompt,不丢条目)")
        neg_src = " | ".join(x.strip() for x in (负面词, 型负面, 负向提示词) if (x or "").strip())
        if neg_src:
            ctx.append("[负面词清单] " + neg_src +
                       "(逐条精炼合并去重后写进 negative_prompt,可补通用负面,不丢条目)")
        if 画幅宽 and 画幅高:
            ctx.append(f"[画幅] {画幅宽}×{画幅高}(按此纵横比组织画面描述)")
        ctx.append(f"[透明] {'开:本图为透明素材图,勿虚构繁杂背景' if 透明模式 else '关:常规成图'}")
        user_with_ctx = (装配全文 or "") + "\n\n" + "\n".join(ctx)
        url = (api_url or "http://127.0.0.1:1234").rstrip("/") + "/v1/chat/completions"
        payload = {
            "model": model or "qwen3.8-27b-uncensored-mlx",
            "messages": [
                {"role": "system", "content": _build_system(系统提示词, 色卡)},
                {"role": "user", "content": user_with_ctx + "\n/no_think"},
            ],
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
            "chat_template_kwargs": {"enable_thinking": False},
        }
        def _post(pl: dict) -> dict:
            req = urllib.request.Request(
                url, data=json.dumps(pl).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(
                req, timeout=max(10, int(timeout_sec))).read())

        t0 = time.time()
        try:
            resp = _post(payload)
        except Exception as exc:  # 服务不在/超时/HTTP 错:透传=PE关同效,不炸
            print(f"[漫影 API扩写PE] LM Studio 不可达({url},{exc})——"
                  f"本发透传主体句原文(PE关同效);请确认 lms server start 且已 load 模型")
            return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [""]},
                    "result": (direct, "")}
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
            payload2["max_tokens"] = min(int(max_tokens) * 2, 13000)
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
            print(f"[漫影 API扩写PE] 扩写完成:{len(pos)}字,"
                  f"耗时 {time.time() - t0:.0f}s(全上下文:系统提示词/色卡/"
                  f"风格/型底座/外部原文/透明)")
            neg_s = (neg.strip() if isinstance(neg, str) else "") or (负面词 or "").strip()
            return {"ui": {"api_pe_pos": [pos.strip()], "api_pe_neg": [neg_s]},
                    "result": (pos.strip(), neg_s)}
        print(f"[漫影 API扩写PE] 答文无 rewritten_prompt(解析失败)——透传原文;"
              f"正文{len(content)}字/思考{len(reasoning)}字,正文头200:{content[:200]!r}")
        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [""]},
                "result": (direct, "")}
