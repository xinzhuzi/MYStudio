# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""漫影 qi21 最终文本合成器(MyQi21PromptSelect,1001 S8 R7 集成轮裁定 A 拆件
形态=装配链下游件;10-04-chinese-negative-cfg4 役 Phase B 双口化+数据热读)。

沿革:1001 S8 裁定 A 拆件链(装配器→PE→本件)→10-02 单口化(两口合一
「进编码文本」)→**10-04 双口化**:负向拆开(cfg4 负向真实生效役),出口
=「进编码正向文本/进编码负向文本」两口;三固定句英硬编码删除,改
qi21_bases.json rgba 节热读中文化;词族剥离双语化(英文词族+中文背景词族,
真源同文件 strip_lexicon 节)。

道劫 t2i [40] 装配子图文本段集成的下游件:PE 路选择+透明文本包裹合成+
负向双路路由。10-04 前单口「进编码文本」;本役起双口——正向路四象限
择文语义逐字保持(拼接序铁律),负向路新增(pe开关 决定吃 PE负面 还是
装配器负面词直写,透明包裹/词族剥离均不施于负向路:透明包裹是正向路的
画幅服从性指令,词族整句删会误伤逗号清单式负面词)。

1005 案B Phase I(design §8.1 ③,负面断路修复):pe开路负向一行对调=
「直写优先」——负面词直写(=装配器 merge(型负面,锁层负面) 真值)非空
恒胜,PE负面 仅空档兜底。修前断路:PE 编造词(~6 条通用词)非空恒胜,
锁层 26+型 36 条真负面被顶掉(实弹 1/2-negative.txt 证实)。

裁定 A 拆件缘起(在档):一件式三口形态下「装配全文→[140].prompt」与
「[140].positive_prompt→装配器.PE出文」构成数据环,引擎验证层实测拒绝
(execution.validate_inputs 对全部连线输入递归环检,lazy 边无豁免;最小同构环
venv 实测=「Dependency cycle detected」valid=False)。拆件成链后:
MyQi21PromptAssembly(141)→[140] PE改写→本件(152),环变链。

输入口(1002 ⑭ 接口批重排保持;10-04 负向拆开轮加两槽;required 置空,
全部槽住 optional 按序声明):
  optional(声明序=前端渲染序)
    装配全文   ← [141] MyQi21PromptAssembly.装配全文(**连线槽,前置**;直写路/
               透明直写路真源);缺键(None)语义=pe关路降级空串+中文警告
               (裁定 A 自洽语义)
    负面词直写 ← [141] MyQi21PromptAssembly.负面词(**连线槽,前置**;10-04
               加:装配器整理的负面词清单=pe关路负向真源;1005 案B 起
               pe开路**直写优先**——非空恒胜 PE负面,修 PE 编造词顶掉
               真负面断路)
    PE出文     ← [140] PE改写.positive_prompt(**连线槽,前置**;lazy=True:
               pe关×联动关时 [140] 无人消费其输出→不进执行图→零 PE TE 装载;
               1001 深审修复轮起成立——修前 [151].wh_ratio 非懒必填槽强拉
               [140],实弹证违在档 s8-integration-report.json lazyVerdict=
               VIOLATED,已随 wh_ratio lazy 化根治)
    PE负面     ← [140] PE改写.negative_prompt(**连线槽,前置**;10-04 加,
               lazy=True 同上——pe关时不拉起;1005 案B 起=空档兜底:
               仅「负面词直写」空/未接时出场,design ⑮ fallback 语义
               对调为直写优先)
    pe开关     接 -10槽5(宿主面板「PE开关」,默认 true;独立手动,不再与透明
               共布尔;**参数 widget,下沉**;缺键兜底=True 与 widget default
               同态=0926 裁定1 语义不漂)
    透明模式   接 [150].透明值(纯 BOOLEAN 跨子图边界,解析住底座件;
               只参与正向路文本计算)
    RGBA官方头句 / RGBA官方尾句 / W1收束句
               三固定句参数面(multiline 大框=Q4「固定句都要输入框」;
               **default=qi21_bases.json rgba 节热读(10-04 中文化:head/tail/
               w1_closing 三键),INPUT_TYPES 调用即现读=改库即可见**;
               英文旧值备档=rgba.head_en/tail_en;**下沉**)

逻辑(正向路=10-02 单口形逐字保持;负向路=10-04 新增):
  正文   = PE出文 if pe开关 else (装配全文 or "")
  剥离(s) = 英文词族 pattern 整句删 + 中文背景词族整句删(双语,均自
            qi21_bases.json strip_lexicon 节热读)
  进编码正向文本 =
    pe开+透明   = RGBA官方头句+" "+剥离(PE出文)+" "+W1收束句+" "+RGBA官方尾句
    pe关+透明   = RGBA官方头句+" "+中文透明声明+" "+装配全文+" "+W1收束句+
                  " "+RGBA官方尾句(R1 补强:头句后追加官方中文透明声明双语强化)
    pe关+透明关 = 装配全文 原样;pe开+透明关 = PE出文 原样
  进编码负向文本 =
    pe开 = 负面词直写 非空? 负面词直写 : PE负面(1005 案B 直写优先;PE负面=空档兜底)
    pe关 = 负面词直写(缺键=空串,空负向合法态)

双口(RETURN_NAMES,口序即返回元组序):
  进编码正向文本(口0)→ 正向编码器 text + 子图输出口「最终文本」
  进编码负向文本(口1)→ 负向编码器 text + 子图输出口「负面词」

懒执行协议(SpeedSelect 实名协议;引擎实码对拍 execution.py:507-520 +
graph.py:169-170;10-04 扩双懒槽):
  - PE出文/PE负面 声明 lazy=True=执行图对该槽默认不建强依赖,pe 关时 [140]
    无人消费其输出→不进执行图→零 PE TE 装载(**成立条件=pe开关关×联动
    开关关**;[151] MyQi21WhSuggest.wh_ratio 亦已 lazy 化);
  - 钩子实名 check_lazy_status(本版引擎只认此名):pe关→[];pe开且槽已接线
    未求值(执行器投 None)→请求名单;未接线槽(kwargs 缺键)绝不请求
    ——引擎对未接线槽 make_input_strong_link 抛 NodeInputError
    (graph.py:132-133);
  - 请求名单=**纯字符串列表**(引擎把名单 sum() 摊平后按 isinstance(x,str)
    过滤再建强链,execution.py:513-516)——取 ["PE出文","PE负面"] 字符串形;
  - pe开而 PE出文 未接线=合成中文报错(不猜不代选);PE负面 未接线/为空
    不报错=直写优先直接吃负面词直写(1005 案B:PE负面=空档兜底,⑮ 对调)。

数据热读(10-04 集中地令:qi21_bases.json 一处持有 lock_layer/rgba/
expand_instruction/strip_lexicon/types;本件消费 rgba+strip_lexicon 两节):
  - _load_rgba(key)/_load_strip_lexicon() 走 _load_bases_data() 整文件
    mtime 缓存(my_daojie_base._load_lock_layer 同款模式)——热改文件=
    mtime 变=下次现读;节结构校验每次调用现跑,校验失败不写坏值进缓存
    (与旧 L-3「坏 dict 钉死缓存」根除项等价,修文件即自愈);
  - import 时刻 _RGBA_HEAD/_RGBA_TAIL/_TAIL 求值一次(widget default 面
    与旧手术脚本引用面);rgba 节缺失=import 即中文 RuntimeError——装机
    旧副本未同步时整包不注册,恢复路=漫影设置重新同步自研节点(与库缺失
    同款恢复路径);
  - 词族从 1001 §10.5「代码级常量(mtime 无关)」改判「热改数据(mtime
    缓存)」:词族已搬家进 qi21_bases.json 集中地,属热改数据;旧单源
  - qi21_strip_lexicon.json 留档不再被本件消费(en 词族已逐字搬入
    strip_lexicon 节,搬迁对拍=SHA256 一致)。
注册(import+NODE_CLASS_MAPPINGS+DISPLAY「道劫·qi21最终文本合成器」)在
my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

# 数据真源(10-04 集中地令):qi21_bases.json 四层候选链解析(1004 §十六)
def _daojie_data(fn: str) -> Path:
    """道劫资产四层候选(1004 §十六):env→dev真源家→引擎家数据位→装机固定位→同目录产物兜底。

    env 显式设置但文件不在=响亮降级原路返回(下游缺档占位/报错指路),不偷偷
    滑落低层——免测试/定制环境静默读到别家库(MYSTUDIO_ART_SKILLS 先例纪律)。
    引擎家数据位=parents[4]/daojie-data:随文件真实所在地走(引擎家内节点在
    <家>/ComfyUI/custom_nodes/my-nodes/nodes/,上四级即家根,上三级只到
    ComfyUI 源码层),MYSTUDIO_COMFYUI_HOME 覆写/~manying-dev 兜底布局自动
    跟随,零 import(勿 import 化禁令)。装机固定位两安装位(同 my_styles
    _INSTALL_FIXED_CANDIDATES)。
    """
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
        / "studio-manuals" / "art_skills" / "daojie_ink_guofeng" / "json",
    ]
    for _base in _cands:
        _p = _base / fn
        if _p.is_file():
            return _p
    return _here.parent / fn


_BASES_JSON = _daojie_data("qi21_bases.json")

# 整文件解析缓存(mtime 失效,同 my_daojie_base._load_lock_layer 模式):
# 缓存 json.loads 原文解析结果且以 mtime 为键——热改文件=mtime 变=现读重扫;
# 节结构校验(_load_rgba/_load_strip_lexicon)每次调用现跑,失败不写缓存。
_bases_cache: dict = {"mtime": None, "data": None}


def _load_bases_data() -> dict:
    """qi21_bases.json 整文件现读(mtime 缓存);缺失/损坏=中文 RuntimeError。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _bases_cache
    if mtime is not None and cache["mtime"] == mtime and cache["data"] is not None:
        return cache["data"]
    if mtime is None:
        raise RuntimeError(
            "qi21 数据库缺失:my_nodes/nodes/qi21_bases.json 未找到——请在漫影"
            "设置里重新同步自研节点,或重启漫影工作室")
    try:
        data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            "qi21 数据库缺失或损坏:my_nodes/nodes/qi21_bases.json 读取失败"
            f"({exc})——请在漫影设置里重新同步自研节点,或重启漫影工作室") from exc
    if not isinstance(data, dict):
        raise RuntimeError(
            "qi21 数据库结构不合法:my_nodes/nodes/qi21_bases.json 顶层应为"
            "对象(lock_layer/rgba/expand_instruction/strip_lexicon/types)"
            "——请重新同步自研节点,或重启漫影工作室")
    cache["mtime"], cache["data"] = mtime, data
    return data


def _load_rgba(key: str) -> str:
    """qi21_bases.json rgba 节热读(mtime 缓存走 _load_bases_data)。

    key∈{head, tail, head_en, tail_en, w1_closing};节缺失/key 缺失/值非
    非空串=中文 RuntimeError(不猜不代选;修文件后 mtime 变即自愈)。
    """
    rgba = _load_bases_data().get("rgba")
    if not isinstance(rgba, dict):
        raise RuntimeError(
            "qi21_bases.json 缺 rgba 节(应含 head/tail/head_en/tail_en/"
            "w1_closing 五键)——请在漫影设置里重新同步自研节点,或重启"
            "漫影工作室")
    value = rgba.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(
            f"qi21_bases.json rgba 节缺「{key}」或值非非空字符串——请重新"
            "同步自研节点,或重启漫影工作室")
    return value


def _load_strip_lexicon() -> dict:
    """qi21_bases.json strip_lexicon 节热读:{en:[正则…], zh:[词…],
    case_insensitive:bool};结构不合法=中文 RuntimeError(校验每次现跑,
    修文件 mtime 变即自愈)。"""
    lex = _load_bases_data().get("strip_lexicon")
    if (not isinstance(lex, dict)
            or not isinstance(lex.get("en"), list)
            or not all(isinstance(p, str) and p for p in lex["en"])
            or not isinstance(lex.get("zh"), list)
            or not all(isinstance(w, str) and w for w in lex["zh"])
            or not isinstance(lex.get("case_insensitive"), bool)):
        raise RuntimeError(
            "qi21 词族库缺失或损坏:my_nodes/nodes/qi21_bases.json "
            "strip_lexicon 节结构不合法(须含 en=非空正则串列表、"
            "zh=非空词列表、case_insensitive=布尔)——请重新同步自研节点,"
            "或重启漫影工作室")
    return lex


# ── 三固定句 default(10-04 Phase B:英硬编码删除,改 rgba 节热读;import ──
# ── 时刻求值一次=旧手术脚本引用面;运行时 default 面=INPUT_TYPES 现读)──
_RGBA_HEAD = _load_rgba("head")    # RGBA官方头句(中文;英文备档=rgba.head_en)
_RGBA_TAIL = _load_rgba("tail")    # RGBA官方尾句(中文;英文备档=rgba.tail_en)
_TAIL = _load_rgba("w1_closing")   # W1收束句(中文)
_W1_TAIL = _TAIL  # 历史名兼容别名(qi21_integration_surgery_* 旧手术脚本引用)

# ── R1 双语透明强化(10-02 补强实验第1轮,用户令「补强」非接受) ──────────────
# 缘起:s5b 实测 pe关×透明开单英文包裹→模型出 opaque(四角 alpha=255,ratioAlpha0=0);
# pe开路同包裹但正文=剥离(PE英文出文)→四型 4/4 过门。差别在正文语言(pe关=装配
# 中文直写),英文头尾离中文正文远→对 alpha 的服从度衰减。补强=头句后追加官方
# 中文同款透明声明(两句=qi21-道劫-t2i.json 速查卡在档原文逐字,亦见
# docs/prompts/Qwen-Image-2.1/06-视频提示词精要.md:85),把透明指令以正文
# 同语种再锚一次。**只改 pe关路(pe开路 4/4 在役形零动)**。
_ZH_ALPHA_DECL = ('这是一张带有透明度的RGBA图像 '
                  '该图像具有alpha通道,背景是透明的')


def strip_word_family(text: str) -> str:
    """词族整句剥离(原 [206] 语义,10-04 双语化):英文词族(pattern 自带句界
    包裹+词边界,自 strip_lexicon.en)与中文背景词族(句界包裹就地拼装,自
    strip_lexicon.zh)各跑一遍,命中词族的整句删;大小写由
    strip_lexicon.case_insensitive 驱动(=true);count=0 全局替换。"""
    lex = _load_strip_lexicon()
    flags = re.IGNORECASE if lex["case_insensitive"] else 0
    out = text
    for pattern in lex["en"]:
        out = re.sub(pattern, "", out, flags=flags)
    zh_words = sorted({w for w in lex["zh"] if w}, key=len, reverse=True)
    if zh_words:
        zh_pattern = (r"[^\n。.；;！!？?]*(?:" + "|".join(re.escape(w) for w in zh_words)
                      + r")[^\n。.；;！!？?]*[。.；;！!？?\n]?")
        out = re.sub(zh_pattern, "", out)
    return out


class MyQi21PromptSelect:
    """漫影道劫 qi21 最终文本合成器:正向四象限择文+负向双路路由,双口产出
    (10-04 双口化;原单口「进编码文本」拆「进编码正向/负向」)。

    进编码正向文本 = 透明模式? (pe开关? 头句+剥离(PE出文)+W1+尾句
                                   : 头句+中文透明声明+装配全文+W1+尾句)
                     : (pe开关? PE出文 : 装配全文)
    进编码负向文本 = pe开关? (负面词直写 非空? 负面词直写 : PE负面) : 负面词直写
    (拼接序铁律=10-02 单口形逐字保持;负向不包裹不剥离;预览=实况=口本文本;
    pe开负向=1005 案B 直写优先——真负面恒进编码器,PE负面仅空档兜底)
    """

    CATEGORY = "漫影"
    DESCRIPTION = ("道劫最终文本合成器:双口「进编码正向/负向文本」=透明开关"
                   "决定拼不拼官方头尾、pe开关决定用 PE 出文还是装配原文"
                   "(透明时词族剥离+W1收束);负向=负面词直写/PE负面双路"
                   "(1005 案B 直写优先:pe开直写非空恒胜,PE负面空档兜底,"
                   "pe关吃直写)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 1002 ⑭ 接口批保持:连线槽前置=节点顶部连线区,参数 widget 下沉;
        # 10-04 负向拆开轮:负面词直写/PE负面 两连线槽插入(装配全文/负面词
        # 直写=装配器双出,PE出文/PE负面=PE改写双出,声明序=连线槽四枚前置)。
        # required 恒空(⑭ 纪律:连线槽保「可不接」语义,required 化会被引擎
        # 验证层拒=breaking);widget 缺键=签名 default 兜底。渲染序=声明序。
        return {
            "required": {},
            "optional": {
                "装配全文": ("STRING", {"tooltip": "装配好的完整提示词原文,连「装配"
                                                "全文件」节点的输出;不连=直写路空文,"
                                                "日志有中文警告"}),
                "负面词直写": ("STRING", {"tooltip": "装配器整理好的负面词清单,连"
                                                 "「装配全文件」节点的 负面词 输出;"
                                                 "PE 关时它直接进负向编码,PE 开时"
                                                 "也是它优先(只要非空,PE 改写的"
                                                 "负面词不再顶掉它)"}),
                "PE出文": ("STRING", {"lazy": True,
                                       "tooltip": "PE 改写好的正向长提示词,连 PE 改写"
                                                  "节点的 positive_prompt 输出;开关关"
                                                  "时它不会被拉起"}),
                "PE负面": ("STRING", {"lazy": True,
                                       "tooltip": "PE 改写出的负面词清单,连 PE 改写"
                                                  "节点的 negative_prompt 输出;开关"
                                                  "关时它不会被拉起;只有「负面词直写」"
                                                  "没接或为空时才轮到它兜底"}),
                "pe开关": ("BOOLEAN", {"default": True,
                                        "tooltip": "总开关:开=先用 PE 把中文短句改写"
                                                   "成长提示词;关=直接用装配好的"
                                                   "原文"}),
                "透明模式": ("BOOLEAN", {"default": False,
                                          "tooltip": "要不要出透明底图,自动跟着所选型"
                                                     "走(接底座节点的「透明值」),"
                                                     "一般不用管"}),
                "RGBA官方头句": ("STRING", {"multiline": True,
                                             "default": _load_rgba("head"),
                                             "tooltip": "教模型输出透明图的官方开头句"
                                                        "(真源=qi21_bases.json,中文;"
                                                        "一般不用改)"}),
                "RGBA官方尾句": ("STRING", {"multiline": True,
                                             "default": _load_rgba("tail"),
                                             "tooltip": "告诉模型图带透明通道的官方"
                                                        "收尾句(真源=qi21_bases.json,"
                                                        "中文;一般不用改)"}),
                "W1收束句": ("STRING", {"multiline": True,
                                          "default": _load_rgba("w1_closing"),
                                          "tooltip": "让主体变成干净抠图素材的收尾"
                                                     "描述(独占画面+四周留透明,"
                                                     "真源=qi21_bases.json;一般"
                                                     "不用改)"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("进编码正向文本", "进编码负向文本")
    FUNCTION = "compose"

    def check_lazy_status(self, pe开关: bool | None = None,
                          **kwargs: Any) -> list[str]:
        """只请求「pe开×已接线×尚未求值」的 PE出文/PE负面,其余一律空名单。

        执行器以 kwargs 投递当前输入(经典节点,execution.py:511):缺键=该槽
        未接线(optional 不投递)→绝不请求(引擎对未接线槽 make_input_strong_link
        抛 NodeInputError);None=已接线未求值→请求;有值=已求值→放行。pe关时
        即便两槽已接线未求值也不请求([140] 无人消费其输出→不进执行图)。
        10-04 扩:PE负面 同入请求名单(pe开路负向真源,漏请求=None 静默兜底
        直写=错路;名单仍纯字符串形)。

        pe开关 缺键(None,仅手写 API prompt 省略槽时可达;前端 widget 值恒
        投递)按 widget default=True 兜底(0926 裁定1「画布默认 PE 开路」
        语义不随槽位搬家漂移)。
        """
        if pe开关 is None:
            pe开关 = True
        if not pe开关:
            return []
        requests: list[str] = []
        for slot in ("PE出文", "PE负面"):
            if slot in kwargs and kwargs[slot] is None:
                requests.append(slot)
        return requests

    def compose(self, 装配全文: str | None = None,
                负面词直写: str | None = None, PE出文: str | None = None,
                PE负面: str | None = None, pe开关: bool | None = None,
                透明模式: bool = False, RGBA官方头句: str = _RGBA_HEAD,
                RGBA官方尾句: str = _RGBA_TAIL,
                W1收束句: str = _TAIL) -> tuple[str, str]:
        """双口合成:(进编码正向文本, 进编码负向文本)(元组序=RETURN_NAMES 序)。

        正向路(10-02 单口形逐字保持):先 pe开关 选正文(PE出文/装配全文),
        再 透明模式 决定拼不拼包裹——拼接序铁律:
          pe开+透明=头句+" "+剥离(PE出文)+" "+W1收束句+" "+尾句
          pe关+透明=头句+" "+中文透明声明+" "+装配全文+" "+W1收束句+" "+尾句
          pe关+透明关=装配全文 原样;pe开+透明关=PE出文 原样。
        负向路(10-04 新增,不包裹不剥离;1005 案B 直写优先):
          pe开=负面词直写 非空? 负面词直写 : PE负面(空档兜底)
          pe关=负面词直写(缺键=空串,空负向合法态)。

        形参序=⑭ 新槽序(四连线槽前置);引擎按名投递与形参序无关,直接调用方
        (单测/脚本)用关键字传参零波及。全参数有 default,缺投不炸 TypeError;
        pe开关 None 兜底 True(同 widget default/懒钩子)。

        装配全文 None(未接线)语义(裁定 A 自洽):pe开路不消费它=照常;pe关路
        降级空串+中文 print 警告(缺真源=缺整段文本,日志可查,不猜不代选)。
        """
        if pe开关 is None:
            pe开关 = True
        direct_neg = (负面词直写 or "").strip()
        if 装配全文 is None:
            print("[MyQi21PromptSelect] 装配全文输入未接线:pe关路(直写/透明直写)"
                  "无真源文本可用,进编码正向文本降级为空串——请把 [141] "
                  "MyQi21PromptAssembly 的 装配全文 输出连到本节点 装配全文 "
                  "输入,或检查该连线是否被改动")
            direct = ""
        else:
            direct = 装配全文
        if pe开关:
            if PE出文 is None:
                raise ValueError(
                    "pe开关=开但 PE出文 输入未接线:PE 路需要 [140] PE改写的"
                    "positive_prompt 出文——请把 [140] 出文连到本节点 PE出文 "
                    "输入,或把 pe开关 关掉走直写路")
            # pe开路:正向正文=PE出文;透明 mid=剥离(PE出文)+W1(拼接序=原形逐字);
            # 负向=1005 案B 直写优先——负面词直写(型+锁层真值)非空恒胜,
            # PE负面 仅空档兜底(修 PE 编造词顶掉真负面断路;⑮ 对调)
            main_text = PE出文
            # 1005 ㉜ 重序修复:PE出文=装配全文(PE扩写主体句\n型底座\n锁层A)
            # 剥离只作用于第一段(PE 扩写段),中文型底座/锁层A 段禁过剥离
            # (旧管线 PE出文=纯英文长文可整段剥;新管线中文层含画风定义句,
            #  zh 词族"山水/远景"会误删锁层A 核心句——深度审查 HIGH-2 实锤)
            _parts = PE出文.split("\n", 1)
            _stripped_subject = strip_word_family(_parts[0])
            _kept_layers = _parts[1] if len(_parts) > 1 else ""
            _stripped_full = _stripped_subject + ("\n" + _kept_layers if _kept_layers else "")
            transparent_mid = _stripped_full + " " + W1收束句
            pe_neg = (PE负面 or "").strip()
            negative_text = direct_neg if direct_neg else pe_neg
        else:
            # pe关路:正向正文=装配全文;透明 mid 同包 W1 收束句(Q4;R1 双语
            # 透明强化:头句后追加官方中文透明声明);负向=负面词直写
            main_text = direct
            transparent_mid = _ZH_ALPHA_DECL + " " + direct + " " + W1收束句
            negative_text = direct_neg
        # 透明模式参与计算(R1 边界迁入):开=拼官方头尾,关=正文原样直出;
        # 负向路不包裹(透明包裹是正向路指令)
        if 透明模式:
            return (f"{RGBA官方头句} {transparent_mid} {RGBA官方尾句}",
                    negative_text)
        return (main_text, negative_text)
