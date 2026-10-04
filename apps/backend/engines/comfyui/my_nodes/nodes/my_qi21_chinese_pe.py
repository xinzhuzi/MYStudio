# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 中文扩写 PE(MyQi21ChinesePE,10-04 中文生图+负向拆开+cfg4 役
Phase C ⑧⑩;design.md §三 / implement.md Phase C)。

自建中文 PE 节点=上游 PE 插件(custom_nodes/ComfyUI-Qwen-Image-2.1-Prompt-
Enhancer 的 QwenImage21_T2IPromptRewrite)的 drop-in 兼容替代:槽名
(clip/prompt/温度六参)/返回口(positive_prompt/negative_prompt/wh_ratio/
thinking/parse_ok)/FUNCTION(rewrite)全同,Phase D 只改 [4013] type 即换件。
差别只在系统指令——上游 system_prompt_t2i.txt **磁盘零改动**(引擎家
custom_nodes git 恒 0 改动铁律),每次 rewrite 在内存 patch 成中文规则版:

  a. "one long English paragraph" → "one long paragraph in the same language
     as the user's request"(扩写正文跟随请求语言→中文长文)
  b. "The description is always in English" → "The description follows the
     language of the user's request"
  c. 输出格式 JSON 例加 "negative_prompt": "<中文负面清单>" 字段(插
     "wh_ratio" 键前)——扩写器开始产中文负面清单
  d. "## Output format" 节前插负向生成指引段(据输入负面词产精炼中文负面)

patch 规则真源=同目录 qi21_bases.json expand_instruction 节(热读+mtime
失效缓存,同 my_qi21_base._load_bases 模式:改 json 即时生效,免重启):
  - 节缺位(如 Phase A 未落)→ 回退本文件内置默认(=design §三 逐字);
  - 节一旦存在即全权接管:字段缺/空/结构不合法=该 patch 停用,不回落内置
    默认——回滚①(design §六下表)「expand_instruction 补丁规则清空」语义:
    清空 JSON 节即回英文原版行为;
  - json 整体损坏/不可读 → 视同节缺位(内置默认保产线,不炸)。

容错(design §三):
  - PE 插件文件不存在 → _load_and_patch_system_prompt 返空串,rewrite 直接
    透传 (prompt,"","","",True)(PE 关同效,不炸);
  - 全部 patch 未命中(上游改措辞) → 原文返回(英文退化,fallback 不炸);
  - JSON 解析失败 → positive=裸答原文,negative="",parse_ok=False;
  - JSON 含 rewritten_prompt 但缺 negative_prompt → negative=""(由 [4014]
    MyQi21PromptSelect 负面词直写路兜底,design ⑮)。

PE 插件文件定位双候选(先引擎内相对=装机位随家目录漂移免疫,后引擎家
绝对=仓内/工具位可读,ask C2a 口径):
  1. 本文件 parents[2](=引擎 custom_nodes/)/ComfyUI-Qwen-Image-2.1-
     Prompt-Enhancer/prompts/system_prompt_t2i.txt(装机运行位)
  2. 引擎家绝对路径 ~/Library/Application Support/漫影工作室/comfyui/
     ComfyUI/custom_nodes/同上(引擎家固定,machine.md 口径)

调用链与解析器(_chat_prompt/_balanced_braces/_split_thinking/
_parse_json_answer)逐字仿上游插件 nodes/prompt_rewrite_nodes.py(同包 AGPL
口径内复用);仅 _parse_json_answer 扩 negative_prompt 字段解析(has_ratio_follow
 口恒 False 随 t2i 件裁掉)。注册(import+NODE_CLASS_MAPPINGS+DISPLAY
「漫影 中文扩写PE」)在 my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# ── PE 插件 t2i 系统指令定位(双候选,见模块 docstring)──────────────────────
_PE_PLUGIN_NAME = "ComfyUI-Qwen-Image-2.1-Prompt-Enhancer"
_PE_PROMPT_RELATIVE = (
    Path(__file__).resolve().parents[2] / _PE_PLUGIN_NAME / "prompts"
    / "system_prompt_t2i.txt"
)  # 引擎装机位:custom_nodes/my-nodes/nodes/ → parents[2]=custom_nodes/
_PE_PROMPT_ENGINE_HOME = (
    Path.home() / "Library" / "Application Support" / "漫影工作室" / "comfyui"
    / "ComfyUI" / "custom_nodes" / _PE_PLUGIN_NAME / "prompts"
    / "system_prompt_t2i.txt"
)  # 引擎家绝对(machine.md 口径;仓内/工具位跑 C5 门禁走这里)

# ── patch 规则内置默认(=design §三 逐字;qi21_bases.json expand_instruction ──
# ── 节缺位时兜底,节存在即被其全权接管)──────────────────────────────────────
_DEFAULT_LANGUAGE_RULES: list[dict[str, str]] = [
    {
        "pattern": "one long English paragraph",
        "replacement": "one long paragraph in the same language as the user's "
                       "request",
    },
    {
        "pattern": "The description is always in English",
        "replacement": "The description follows the language of the user's "
                       "request",
    },
]
_DEFAULT_NEGATIVE_FORMAT_PATCH = '"negative_prompt": "<中文负面清单>"'
_DEFAULT_NEGATIVE_GUIDANCE = (
    "Based on the negative words provided in the input, generate a concise "
    "Chinese negative prompt list."
)

# patch 规则数据文件(热读真源;同 my_qi21_base._BASES_JSON 同款定位)
_BASES_JSON = Path(__file__).resolve().parent / "qi21_bases.json"

# 模块级缓存(mtime 失效,同 my_qi21_base._bases_cache 模式):seen 标记首次
# 已扫(缺文件 mtime=None 也缓存,免每拍 stat 空转);node=None=节缺位(用内置
# 默认),node=dict(可空)=节存在(JSON 全权接管,空 dict=全部 patch 停用=
# 回滚①英文原版行为)。
_expand_cache: dict = {"mtime": None, "node": None, "seen": False}


def _load_expand_instruction() -> dict | None:
    """qi21_bases.json expand_instruction 节热读;mtime 变化即重读。

    返回 None=节缺位(调用方用内置默认);返回 dict(可空)=节存在,字段
    全权接管。json 不可读/非对象=视同缺位(内置默认保产线)。
    """
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _expand_cache
    if cache["seen"] and cache["mtime"] == mtime:
        return cache["node"]
    node: dict | None = None
    try:
        data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "expand_instruction" in data:
            got = data["expand_instruction"]
            node = got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        node = None
    cache["mtime"] = mtime
    cache["node"] = node
    cache["seen"] = True
    return node


def _patch_config() -> tuple[list[dict[str, str]], str, str]:
    """取生效 patch 配置:(语言替换规则表, 负向格式片段, 负向指引文)。

    节缺位→内置默认;节存在→逐字段接管,缺/空/结构不合法=该 patch 停用
    (空表/空串),不回落默认(回滚①语义,见模块 docstring)。
    """
    node = _load_expand_instruction()
    if node is None:
        return (list(_DEFAULT_LANGUAGE_RULES),
                _DEFAULT_NEGATIVE_FORMAT_PATCH,
                _DEFAULT_NEGATIVE_GUIDANCE)
    raw_rules = node.get("language_rule_replacements")
    rules = [
        {"pattern": r["pattern"], "replacement": r["replacement"]}
        for r in raw_rules
        if isinstance(r, dict)
        and isinstance(r.get("pattern"), str) and r.get("pattern")
        and isinstance(r.get("replacement"), str)
    ] if isinstance(raw_rules, list) else []
    fmt = node.get("negative_format_patch")
    fmt = fmt if isinstance(fmt, str) and fmt.strip() else ""
    guidance = node.get("negative_guidance")
    guidance = guidance if isinstance(guidance, str) and guidance.strip() else ""
    return rules, fmt, guidance


def _load_and_patch_system_prompt() -> str:
    """取系统指令:优先用集中地中文版(1004 中文补丁根修);无则退化英文原版+patch。

    中文版=qi21_bases.json expand_instruction.system_prompt_zh 字段——完整中文
    方法论(八步法),LLM 看到中文指令+中文输入=输出中文。1004 根修:运行时
    补丁英文原版的路径被实证无效(200 行英文语境淹没两句语言规则),改为
    集中地持有完整中文指令。回滚③=清空 system_prompt_zh 字段即回退补丁模式。
    """
    # ① 优先:集中地中文系统指令(全权接管,不走英文原版)
    node = _load_expand_instruction()
    if node and isinstance(node.get("system_prompt_zh"), str) and node["system_prompt_zh"].strip():
        return node["system_prompt_zh"]
    # ② 退化:读上游英文原版+运行时 patch(旧路径,保留作回滚态)
    original: str | None = None
    for path in (_PE_PROMPT_RELATIVE, _PE_PROMPT_ENGINE_HOME):
        try:
            original = path.read_text(encoding="utf-8").strip()
            break
        except OSError:
            continue
    if not original:
        return ""
    rules, fmt_patch, guidance = _patch_config()
    text = original
    hits = 0
    # a/b. 语言规则(正则;坏 regex 跳过不炸——热改 json 手误防线)
    for rule in rules:
        try:
            text, n = re.subn(rule["pattern"], rule["replacement"], text)
        except re.error:
            continue
        hits += n
    # c. 输出格式 JSON 例插 negative_prompt 字段(定位=", "wh_ratio" 键前,
    #    全文唯一 JSON 例;lambda 替换=片段内反斜杠不被当组引用展开)
    if fmt_patch:
        try:
            patched, n = re.subn(
                r'",\s*"wh_ratio"',
                lambda _m: '", ' + fmt_patch + ', "wh_ratio"',
                text, count=1,
            )
            if n:
                text = patched
                hits += n
        except re.error:
            pass
    # d. 负向生成指引段(锚="## Output format" 节标题前插;锚失联=未命中,
    #    不盲尾追加——保全「全部未命中→原文返回」语义)
    if guidance and text.find("## Output format") >= 0:
        idx = text.index("## Output format")
        text = (text[:idx] + "## Negative prompt\n\n" + guidance.strip()
                + "\n\n" + text[idx:])
        hits += 1
    return original if hits == 0 else text


# ---------------------------------------------------------------------------
# 调用链与解析器(逐字仿上游插件 nodes/prompt_rewrite_nodes.py;仅
# _parse_json_answer 扩 negative_prompt 解析、裁 has_ratio_follow 恒 False 口)
# ---------------------------------------------------------------------------
def _chat_prompt(system_prompt: str, user_text: str) -> str:
    # Qwen chat format, assembled manually (not via llama_template) because the
    # PE system prompts contain literal braces that the template .format() would eat.
    return (
        "<|im_start|>system\n" + system_prompt + "<|im_end|>\n"
        "<|im_start|>user\n" + user_text + "<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def _balanced_braces(text: str) -> list[str]:
    spans: list[str] = []
    depth = 0
    start = -1
    in_str = False
    escaped = False
    for i, ch in enumerate(text):
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                spans.append(text[start : i + 1])
    return spans


def _parse_json_answer(answer: str) -> dict[str, Any]:
    """解析扩写 JSON;negative_prompt 缺失=空串(由 [4014] Select 兜底,⑮)。"""
    answer = (answer or "").strip()
    for candidate in reversed(_balanced_braces(answer)):
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            try:
                import json_repair
                obj = json_repair.repair_json(candidate, return_objects=True)
                if isinstance(obj, list):
                    obj = obj[0] if obj else None
            except Exception:
                continue
        if not isinstance(obj, dict):
            continue
        rewritten = obj.get("rewritten_prompt") or obj.get("rewrited_prompt")
        if isinstance(rewritten, str) and rewritten.strip():
            negative = obj.get("negative_prompt")
            return {
                "positive_prompt": rewritten.strip(),
                "negative_prompt": (
                    negative.strip() if isinstance(negative, str) else ""
                ),
                "wh_ratio": str(obj.get("wh_ratio") or "").strip(),
                "parse_ok": True,
            }
    return {"positive_prompt": answer, "negative_prompt": "",
            "wh_ratio": "", "parse_ok": False}


def _split_thinking(text: str) -> tuple[str, str]:
    if "</think>" in text:
        think, _, answer = text.partition("</think>")
        if "<think>" in think:
            think = think.partition("<think>")[2]
        return think.strip(), answer.strip()
    if "<think>" in text:
        return text.partition("<think>")[2].strip(), ""
    return "", text.strip()


# ===========================================================================
# 中文 PE 节点(drop-in 兼容上游 QwenImage21_T2IPromptRewrite)
# ===========================================================================
class MyQi21ChinesePE:
    """漫影中文扩写 PE:上游英文 PE 系统指令内存 patch 中文规则+负向双出。

    与上游 QwenImage21_T2IPromptRewrite 同槽名同返回口(drop-in):positive_
    prompt=中文扩写长文,negative_prompt=中文负面清单(JSON 缺该字段=空串,
    由 [4014] MyQi21PromptSelect 负面词直写路兜底),wh_ratio/thinking/
    parse_ok 同上游。PE 插件文件缺失=装配全文原样透传(PE 关同效)。
    """

    CATEGORY = "漫影"
    DESCRIPTION = ("道劫中文扩写PE:运行时读上游英文PE系统指令,内存patch成"
                   "「跟随请求语言」+输出JSON加negative_prompt字段(磁盘零改"
                   "),中文长文+中文负面双出;上游文件缺失时原样透传")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 槽名/序=上游 QwenImage21_T2IPromptRewrite 逐字同款(drop-in:Phase D
        # 换 [4013] type 后 widgets_values 序零漂移)。
        return {
            "required": {
                "clip": ("CLIP",),
                "prompt": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "短提示词/装配全文(任意语言;中文进=中文长文出)",
                }),
            },
            "optional": {
                "temperature": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
                "top_p": ("FLOAT", {
                    "default": 0.95, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {
                    "default": 20, "min": 1, "max": 200, "step": 1}),
                "presence_penalty": ("FLOAT", {
                    "default": 1.5, "min": 0.0, "max": 5.0, "step": 0.1,
                    "tooltip": "Should be 1.5 for T2I",
                }),
                "max_new_tokens": ("INT", {
                    "default": 16256, "min": 256, "max": 32768, "step": 256}),
                "seed": ("INT", {
                    "default": 42, "min": 0, "max": 0xFFFFFFFF}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "BOOLEAN")
    RETURN_NAMES = ("positive_prompt", "negative_prompt", "wh_ratio",
                    "thinking", "parse_ok")
    FUNCTION = "rewrite"
    OUTPUT_NODE = False

    def rewrite(
        self,
        clip,
        prompt,
        temperature=1.0,
        top_p=0.95,
        top_k=20,
        presence_penalty=1.5,
        max_new_tokens=16256,
        seed=42,
    ):
        if not (prompt or "").strip():
            return ("", "", "", "", True)

        system_prompt = _load_and_patch_system_prompt()
        if not system_prompt:
            # PE 插件文件缺失:不扩写,装配全文原样透传(PE 关同效,C2f/C3e)
            print("[MyQi21ChinesePE] 上游 PE 系统指令文件未找到"
                  f"({_PE_PROMPT_RELATIVE} 与 {_PE_PROMPT_ENGINE_HOME} 均缺):"
                  "本次不扩写,prompt 原样透传(positive=prompt,negative=空,"
                  "负面由最终文本合成器直写路兜底)")
            return (prompt, "", "", "", True)

        tokens = clip.tokenize(
            _chat_prompt(system_prompt, prompt),
            skip_template=True,
            min_length=1,
            thinking=True,
        )
        generated_ids = clip.generate(
            tokens,
            do_sample=True,
            max_length=max_new_tokens,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            min_p=0.0,
            repetition_penalty=1.0,
            presence_penalty=presence_penalty,
            seed=seed,
        )
        raw_text = clip.decode(generated_ids)
        thinking_text, answer_text = _split_thinking(raw_text)
        result = _parse_json_answer(answer_text)

        if not result["parse_ok"]:
            print("[MyQi21ChinesePE] 扩写答案未按 JSON 解析:positive 用裸答"
                  "原文兜底,negative=空(由最终文本合成器负面词直写路兜底),"
                  "parse_ok=False")

        return (
            result["positive_prompt"],
            result["negative_prompt"],
            result["wh_ratio"],
            thinking_text,
            result["parse_ok"],
        )
