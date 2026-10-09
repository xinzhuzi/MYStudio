# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""漫影 qi21 装配全文件(MyQi21PromptAssembly,1001 S8 R7 集成轮;1001 裁定 A 拆件
形态=装配链上游件,implement.md S8 / design §10.4 / 主对话裁定 A)。

道劫 t2i [40] 装配子图文本段集成的上游件(吞原 [130][131] 装配拼接①②+[110] 美术风格底座
美术风格底座常量):装配全文=主体句+底座 BASE+美术风格底座 三段换行拼合,唯一真源文本。

1005 案B Phase I(design §8.1 ②,负面断路修复):新增 optional 连线槽「BASE负面」
← [150] MyQi21DaojieBase.负面词(第五出=型负面现读);负面词输出改
=_merge_negative(BASE负面, 美术风格底座负面现读)——美术风格底座负面弃 import 快照(_LOCK_A_NEG
退役=遗留债9 清偿),改 _load_art_style_base() mtime 现读;merge 复用同包
my_styles._merge_negative(K2 MyDaojieBase 同款,防两处实现漂移)。修前断路:
负面词=纯美术风格底座 import 快照,型负面 36 条无入口=死数据,PE 编造词恒顶真负面。

裁定 A 拆件缘起(在档):一件式三口形态下「装配全文→[140].prompt」与
「[140].positive_prompt→装配器.PE出文」构成数据环,引擎验证层实测拒绝
(execution.validate_inputs 对全部连线输入递归环检,lazy 边无豁免;最小同构环
venv 实测=「Dependency cycle detected」valid=False;graph.py:169-170 执行图
虽豁免 lazy 边,验证不过=queuePrompt 直接拒)。拆件成链后:本件(141)→
[140] PE改写→MyQi21PromptSelect(152),环变链,Q1=B+ 语义零损。

输入口(1002 ⑭ 接口批重排:连线槽前置/参数 widget 下沉——required 置空,
全部槽住 optional 按新序声明;槽位映射表=research/slot-map.md):
  optional(声明序=前端渲染序)
    BASE      ← [150] MyQi21DaojieBase.BASE(**连线槽,前置=节点顶部**);
              **缺键(None)/空串纯空白 语义=降级两段拼不炸**(裁定 A 规格②
              +1001 S8 L-1 空串补:BASE 空即无底座层,主体句+\\n+美术风格底座;产线
              缺底座层属静默降质,发中文 print 警告给指路文案,不 raise——
              与下游合成器的「缺真源」空串语义同款自洽,实弹日志可查)
    BASE负面  ← [150] MyQi21DaojieBase.负面词(**连线槽,前置**;1005 案B
              Phase I 加);缺键(None)/空串=merge 侧裸输出美术风格底座负面(宽松化
              语义同 BASE,不警告不炸——型负面缺席=美术风格底座负面兜底,负向链不断)
    主体句    多行大框(**参数 widget,下沉**),接子图输入口「主体句」
              (-10槽2←顶层 [24]);default=1001 t2i 工作流 [24] 例文逐字;
              1002 ⑭ 起随 BASE 迁 optional(缺键=default 例文兜底,宽松化
              非 breaking——前端 widget 值恒投递,旧行为不变)
    锁层A全文 多行大框参数(原 [110] 美术风格底座常量 迁入;default=工作流值逐字,
              sha256 前16位锚=eac9a808aa8f7232);optional 化同主体句

输出口(双口,1004 正负拆开;口1 语义 1005 案B 起改):
  装配全文(口0)→ 双喂:[140].prompt(Q1=B+ 根治「写死的种子文被旁路」:[140]
           种子文 widget 退役清空+Note[250] 注明)+ MyQi21PromptSelect.装配全文
           (下游合成器直写路与透明直写路的真源)
  负面词(口1)→ MyQi21PromptSelect.负面词直写(pe关路负向真源+pe开路直写
           优先——案B:直写非空恒胜 PE负面)=merge(BASE负面,
           美术风格底座负面, 主体句负面)(1005 ㊄ 三源:型负面 token 在前、美术风格底座负面
           居中、主体句负面(用户手写,经 [4021] 透传)在后,整 token 相等才去重
           (_merge_negative 保守口径;负面清单全角逗号=整段一 token,两段
           以半角", "拼接=K2 侧同款现行为)

注册(import+NODE_CLASS_MAPPINGS+DISPLAY「道劫·qi21装配全文件」)在
my_nodes/__init__.py;词族剥离逻辑随选择器件(my_qi21_prompt_select.py,词族
真源=同目录 qi21_strip_lexicon.json)。
"""

from __future__ import annotations
from pathlib import Path
import json
import os

from typing import Any

# merge 单源复用(K2 MyDaojieBase 同款防两处实现漂移纪律;design §8.1 ②):
# 双路导入=本件单测家法 importlib 直载无包上下文,相对导入在该形态 ImportError
# →同目录直载同一 my_styles.py(同函数对象级防漂移,非复制实现)。
try:
    from .my_styles import _merge_negative  # 包上下文(引擎装载/包路径单测)
except ImportError:  # pragma: no cover - 直载形态(单测)走此腿
    import importlib.util as _ilu
    _styles_spec = _ilu.spec_from_file_location(
        "my_styles_peer_load", Path(__file__).resolve().parent / "my_styles.py")
    _styles_mod = _ilu.module_from_spec(_styles_spec)
    _styles_spec.loader.exec_module(_styles_mod)
    _merge_negative = _styles_mod._merge_negative

# ── 主体句例文+美术风格底座 default(1001 t2i 工作流值逐字迁入,脚本注入禁手敲;──
# ── sha256 前16位对拍锚=[24]主体句 afd9e6f562e3e606 / [110]美术风格底座 ──
# ── eac9a808aa8f7232;美术风格底座改值走 05 库「从库刷参数」Q3 通道同批过账并更──
# ── 新锚;主体句例文不在 Q3 四固定句(美术风格底座/RGBA头句/尾句/W1)内、暂无自动──
# ── 过账通道(1001 S8 L-2 纠偏)——改 05 库例一须手改三处并同批更新锚:──
# ── 节点此处+工作流顶层[24].wv[0]+子图[141].wv[0](蓝图真源,工作流随 ──
# ── sync main() 过账)──────────────────────────────────────────────
_SUBJECT_EXAMPLE = '一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，腰侧石青剑绦悬一柄长剑，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂暗红剑穗，剑身完整收在鞘中，右手轻按剑柄，视线越过阶下青灰云海望向远处，旧金色晨光自左侧斜照，衣袂被山风微微掀起。'  # 顶层 [24] 主体句例文(多行大框 default)
# 1004 正负拆开轮+集中地令:美术风格底座正向/负向真源=qi21_bases.json art_style_base(唯一集中地)
# 本文件不再持有 _STYLE_BASE/_LOCK_A_NEG 硬编码常量——全部热读
# 1004 §十六 Step2:qi21_bases.json 活路径改四层候选链(真源家优先,同目录产物仅兜底)
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


_BASES_FILE = _daojie_data("qi21_bases.json")

# art_style_base mtime 缓存(1005 案B Phase I:负面词改每次装配现读——消灭 _LOCK_A_NEG
# import 快照=遗留债9;模式=my_daojie_base._load_art_style_base 同款,热改美术风格底座负面
# 即时生效不重启)
_lock_cache: dict = {"mtime": None, "data": None}


def _load_art_style_base() -> dict:
    """qi21_bases.json art_style_base 现读(mtime 缓存):positive/negative+三件拆分件。"""
    try:
        mtime = _BASES_FILE.stat().st_mtime
    except OSError:
        mtime = None
    cache = _lock_cache
    if cache["mtime"] == mtime and cache["data"] is not None:
        return cache["data"]
    if mtime is None:
        data = {"positive": "", "negative": "",
                "positive_style_text": "", "positive_ground_text": "", "rgba_text": ""}
    else:
        try:
            raw = json.loads(_BASES_FILE.read_text(encoding="utf-8"))
            ll = raw.get("art_style_base", {}) if isinstance(raw, dict) else {}
            data = {"positive": ll.get("positive_text", ""),
                    "negative": ll.get("negative_text", "")}
            # 1008晚三件拆分(用户令):风格工艺件/底色背景件/透明承载件;缺字段=旧库
            # 兼容回退(拆件面回退用 positive 全文,保产线恒有输出)
            for k in ("positive_style_text", "positive_ground_text", "rgba_text"):
                v = ll.get(k, "")
                data[k] = v if isinstance(v, str) else ""
        except (OSError, ValueError):
            data = {"positive": "", "negative": "",
                    "positive_style_text": "", "positive_ground_text": "", "rgba_text": ""}
    cache["mtime"], cache["data"] = mtime, data
    return data


def _type_is_transparent(base_text: str) -> bool:
    """BASE 型文逐字匹配 types[] 判该型 rgba_default(1008晚三件拆分:装配按型配底)。

    匹配不到(自由型空串/外接自定义型文)=按不透明处理(产线保守);零跨模块
    import,与 ApiPE._rgba_lean_pos 同款逐字匹配家法。
    """
    try:
        raw = json.loads(_BASES_FILE.read_text(encoding="utf-8"))
        for t in raw.get("types") or []:
            if isinstance(t, dict) and (t.get("positive_text") or "").strip() == (base_text or "").strip() \
                    and t.get("rgba_default") is True:
                return True
    except (OSError, ValueError):
        pass
    return False


def _style_combo_transparent() -> str:
    """透明型底座组合=风格工艺件+透明承载件(1008晚三件拆分;缺件回退 positive 全文)。"""
    d = _load_art_style_base()
    if d.get("positive_style_text") and d.get("rgba_text"):
        return d["positive_style_text"] + d["rgba_text"]
    return d["positive"]

# widget default 面=import 时刻求值一次(同 my_qi21_prompt_select._RGBA_HEAD 家法:
# INPUT_TYPES 调用即现读,此处仅签名 default;美术风格底座正值不改语义);
# 负面面 1005 案B起弃 import 快照(_LOCK_A_NEG 退役),assemble 内每次现读。
_STYLE_BASE = _load_art_style_base()["positive"]


class MyQi21PromptAssembly:
    """漫影道劫 qi21 装配全文件:主体句+BASE+美术风格底座 三段换行拼合,装配全文真源
    +负面词合并出(1005 案B Phase I:负面词=merge(BASE负面, 美术风格底座负面现读))。

    装配全文(口0)=唯一真源文本:双喂 [140].prompt(PE 改写输入,Q1=B+)
    与 MyQi21PromptSelect.装配全文(直写路/透明直写路);BASE 未接线(None)
    或空串/纯空白=降级两段拼(主体句+美术风格底座)+中文警告,不炸产线。
    负面词(口1)=型负面(BASE负面槽)+美术风格底座负面 mtime 现读 的 _merge_negative
    合并:BASE负面缺键/空串=裸输出美术风格底座负面(负向链不断,不警告)。
    """

    CATEGORY = "漫影"
    DESCRIPTION = ("道劫装配全文件:装配全文=主体句+底座BASE+美术风格底座 三段换行"
                   "拼合(真源,专喂 PE 改写与最终文本合成器);负面词=型负面+"
                   "美术风格底座负面合并(1005 案B:型负面出口接通)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 1002 ⑭ 接口批:连线槽 BASE 前置(节点顶部)/两个大框参数下沉(节点下部)
        # ——required 置空全住 optional:optional 连线槽保「可不接」语义(BASE 缺键
        # =两段降级拼,required 化会被引擎验证层拒=breaking);widget 缺键=签名
        # default 兜底(宽松化)。渲染序=required 序+optional 序,故声明序即面板序。
        # 1005 案B Phase I:BASE负面 第二连线槽(BASE 与参数 widget 之间,连线槽
        # 相邻前置);缺键=空串(宽松化语义同 BASE,不警告)。
        return {
            "required": {},
            "optional": {
                # BASE:轻件直拉([150] 常驻执行图,非 lazy);未接线或空串=降级两段拼+警告
                "BASE": ("STRING", {"tooltip": "所选型的底座画风文字,连「底座十选一"
                                               "」的 BASE 输出;不连就只用主体句+美术风格底座"
                                               "两段拼"}),
                "BASE负面": ("STRING", {"tooltip": "所选型自带的负面词清单,连「底座"
                                                  "十选一」的 负面词 输出;不连就只用"
                                                  "美术风格底座自带的负面词"}),
                "主体句": ("STRING", {"multiline": True, "default": _SUBJECT_EXAMPLE,
                                       "tooltip": "画面里画什么的人话描述;生产时由子图"
                                                  "入口喂入,这里一般是兜底例文"}),
                "主体句负面": ("STRING", {"multiline": True, "default": "",
                                       "tooltip": "用户手写的主体句负面描述(如「不要出现xxx」);与型负面/美术风格底座负面合并"}),
                "锁层A全文": ("STRING", {"multiline": True, "default": _STYLE_BASE,
                                          "tooltip": "全九型通用的画风锁底长文(现代"
                                                     "修仙游戏数字绘画规范),改画风才"
                                                     "动它,一般不用改"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("装配全文", "负面词")
    FUNCTION = "assemble"

    def assemble(self, BASE: str | None = None,
                 BASE负面: str | None = None,
                 主体句: str = _SUBJECT_EXAMPLE,
                 主体句负面: str | None = None,
                 锁层A全文: str = _STYLE_BASE) -> tuple[str, str]:
        """装配:装配全文=主体句+\\n+BASE+\\n+美术风格底座;负面词=merge(BASE负面,
        美术风格底座负面现读)(返回元组序=RETURN_NAMES 序)。

        形参序=⑭ 槽序(BASE/BASE负面 两连线槽前置);引擎按名投递与形参序无关,
        直接调用方(单测/脚本)用关键字传参零波及。optional 化:主体句/锁层A全文
        缺键=default 兜底(签名恒有值,可选槽缺投不炸 TypeError)。

        BASE None(未接线)或空串/纯空白(BASE 空即无底座层)=两段降级拼
        (主体句+\\n+美术风格底座)+中文 print 警告(裁定 A 规格② optional 缺键语义
        +1001 S8 L-1 空串补;判空家法=my_daojie_base (x or "").strip();
        实弹日志可查,与选择器件空串语义同款)。BASE负面缺键/空串=merge 侧
        裸输出美术风格底座负面(1005 案B:型负面缺席=美术风格底座兜底,负向链不断,不警告)。

        负面词=1005 案B Phase I:_merge_negative(BASE负面 or "", 美术风格底座负面)
        ——型负面 token 在前、美术风格底座负面在后,整 token 相等去重(my_styles 单源
        复用,K2 同款);美术风格底座负面=_load_art_style_base() mtime 现读(遗留债9:
        import 快照退役,热改美术风格底座负面即时生效)。

        1001 用户测试批 P1 警告中性化(design §2.2):自由型 BASE 恒空串
        (qi21_bases.json 十档末位,base_text="")→空 BASE=自由型正常态,
        警告改双关文案「自由型正常态;非自由型请检查连线」——逻辑零改,
        仅文案去「意外断线」口吻(旧行为/旧两段拼语义不变,i2i/edit 零波及)。
        """
        # 负面词(口1):merge 单源复用+美术风格底座负面 mtime 现读(两分支同值,先算)
        negative = _merge_negative(_merge_negative((BASE负面 or ""),
                                   _load_art_style_base()["negative"]),
                                  (主体句负面 or "").strip())
        # 1008晚三件拆分(用户令):BASE 逐字匹配 types[] 命中 rgba_default 型=透明路,
        # 底座段换「风格工艺件+透明承载件」组合(零底色/背景命令);带背景型/匹配不到
        # =锁层A全文原样(positive_text 字节不变,六型行为零变)。缺拆分件的旧库
        # 回退 positive 全文(_style_combo_transparent 内兜底),产线恒有输出。
        # 1008 用户令「用英文拼接」:透明路=官方英文头尾承载全部透明语义;
        # 型文内中文透明声明行(图为带透明通道…背景透明)不再重复拼入。
        if _type_is_transparent(BASE):
            base_out = "\n".join(l for l in BASE.split("\n")
                                 if "带透明通道" not in l and "背景透明" not in l)
            style_out = _style_combo_transparent()
        else:
            base_out, style_out = BASE, 锁层A全文
        if not (BASE or "").strip():
            # 1001 用户测试批 P1 中性化:自由型(BASE 空串)此为正常态;非自由型
            # BASE 空=缺整个型底座层,请检查连线——双关文案,逻辑零改(design §2.2)
            print("[MyQi21PromptAssembly] BASE 输入未接线或为空串/纯空白:"
                  "装配全文降级为「主体句+美术风格底座」两段拼——自由型此为正常态"
                  "(自由型无型底座层);非自由型请检查连线:把 [150] "
                  "MyQi21DaojieBase 的 BASE 输出连到本节点 BASE 输入,"
                  "已接线时请检查该连线是否被改动、[150] BASE 产文是否为空")
            return (f"{主体句}\n{锁层A全文}", negative)
        return (f"{主体句}\n{base_out}\n{style_out}", negative)
