# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""漫影 qi21 装配全文件(MyQi21PromptAssembly,1001 S8 R7 集成轮;1001 裁定 A 拆件
形态=装配链上游件,implement.md S8 / design §10.4 / 主对话裁定 A)。

道劫 t2i [40] 装配子图文本段集成的上游件(吞原 [130][131] 装配拼接①②+[110] 美术风格底座
美术风格底座常量):装配全文=美术风格底座+底座 BASE+主体句 三段换行拼合(1017 反序令),唯一真源文本。

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
import re

from typing import Any

# 1017 运行时门禁单源(peer-load 同款家法);作用域=「新建资产」路
# (i2i 局部编辑/画风转换豁免=09 篇否定式两落法纪律在册,候用户令扩展)
try:
    from ._gongbi_gate import assert_prompt_gates
except ImportError:  # pragma: no cover - 直载形态走此腿
    import importlib.util as _glu
    _gate_spec = _glu.spec_from_file_location(
        "gongbi_gate_peer_load", Path(__file__).resolve().parent / "_gongbi_gate.py")
    _gate_mod = _glu.module_from_spec(_gate_spec)
    _gate_spec.loader.exec_module(_gate_mod)
    assert_prompt_gates = _gate_mod.assert_prompt_gates
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

# 透明声明句级剔除单源(10-09-qi21-prompt-layer-conflict P6;同上双路导入)
try:
    from ._qi21_rgba_text import strip_rgba_decl
except ImportError:  # pragma: no cover - 直载形态(单测)走此腿
    import importlib.util as _ilu
    _rgba_spec = _ilu.spec_from_file_location(
        "qi21_rgba_text_peer_load", Path(__file__).resolve().parent / "_qi21_rgba_text.py")
    _rgba_mod = _ilu.module_from_spec(_rgba_spec)
    _rgba_spec.loader.exec_module(_rgba_mod)
    strip_rgba_decl = _rgba_mod.strip_rgba_decl

# ── 主体句例文+美术风格底座 default(1001 t2i 工作流值逐字迁入,脚本注入禁手敲;──
# ── sha256 前16位对拍锚=[24]主体句 afd9e6f562e3e606 / [110]美术风格底座 ──
# ── eac9a808aa8f7232;美术风格底座改值走 05 库「从库刷参数」Q3 通道同批过账并更──
# ── 新锚;主体句例文不在 Q3 四固定句(美术风格底座/RGBA头句/尾句/W1)内、暂无自动──
# ── 过账通道(1001 S8 L-2 纠偏)——改 05 库例一须手改三处并同批更新锚:──
# ── 节点此处+工作流顶层[24].wv[0]+子图[141].wv[0](蓝图真源,工作流随 ──
# ── sync main() 过账)──────────────────────────────────────────────
_SUBJECT_EXAMPLE = '一位筑基后期的年轻女修，青玉色道袍束月白腰带，足蹬青布道履，乌黑长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门赭石石阶最上一级，身体正面朝向观者、微向左转约四分之一侧，重心落于右腿，左脚虚点下一级石阶，左臂自然垂落、左手五指放松；长剑以石青剑绦系于画面左侧腰间，剑鞘斜垂、与地面约呈四十五度，鞘尾朝画面左下方、剑柄朝画面右上方，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂暗红剑穗，剑身完整收在鞘中，全身仅此一柄长剑、始终挂定腰间；右臂自然垂落、右肘微屈，右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担；视线越过阶下青灰云海望向远处青绿群山，旧金色晨光自左侧斜照，衣袂被山风微微掀起。'  # 顶层 [24] 主体句例文(多行大框 default)
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
    """只热读绘画语言与风格负向，不读取背景或透明承载字段。"""
    try:
        mtime = _BASES_FILE.stat().st_mtime
    except OSError:
        mtime = None
    if _lock_cache["mtime"] == mtime and _lock_cache["data"] is not None:
        return _lock_cache["data"]
    data = {"positive": "", "negative": ""}
    if mtime is not None:
        try:
            raw = json.loads(_BASES_FILE.read_text(encoding="utf-8"))
            style = raw.get("art_style_base", {}) if isinstance(raw, dict) else {}
            for key, field in (("positive", "positive_text"), ("negative", "negative_text")):
                value = style.get(field, "")
                data[key] = value if isinstance(value, str) else ""
        except (OSError, ValueError):
            pass
    _lock_cache.update(mtime=mtime, data=data)
    return data


def _style_only(text: str) -> str:
    """旧四段参数只取画法，缓存中的背景件不能恢复为风格。"""
    value = (text or "").strip()
    if value.startswith("【风格工艺件】"):
        match = re.match(r"【风格工艺件】(.*?)(?=【(?:底色背景件|透明承载件|负向词表)】|\Z)", value, re.S)
        return match.group(1).strip() if match else _load_art_style_base()["positive"]
    return value


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


def _type_subject_first(base_text: str) -> bool:
    """BASE 型文逐字匹配 types[] 判该型 subject_first 旗(1017 设定卡主体锚役)。

    近两千字版式前置把主体句身份锚淹成设定卡原型(实弹 0/5 服装/武器锚命中);
    旗=True 的型终稿主体句置首(官方 3.2.1/3.3.1 语料人物描述在前、版式在后)。
    匹配不到=按 False(全局装配序仍=1017 用户令底座前置主体句殿后)。
    """
    try:
        raw = json.loads(_BASES_FILE.read_text(encoding="utf-8"))
        for t in raw.get("types") or []:
            if isinstance(t, dict) and (t.get("positive_text") or "").strip() == (base_text or "").strip() \
                    and t.get("subject_first") is True:
                return True
    except (OSError, ValueError):
        pass
    return False


def _resolve_card_conditionals(base_text: str, subj_text: str) -> str:
    """设定卡条件预解析(1017 官方对拍役;与 ApiPE 同款逐字匹配家法复制)。

    型文=模板(条件句照存);终稿按主体句事实落定成确定描述。原句缺席=不换
    (fail-closed,模板日后改句退回模板句)。与 PE 节点实现保持逐句同步。
    """
    if not base_text or not subj_text:
        return base_text
    out = base_text
    m = re.search(r"名号「([^」]{1,12})」", subj_text)
    if m:
        out = out.replace(
            "标题栏中央放置角色名号，主体明确提供名号时逐字使用，未提供时标题栏留白仅存细线边饰；",
            f"标题栏中央逐字放置角色名号「{m.group(1)}」；", 1)
    if "劲装" in subj_text:
        out = out.replace(
            "服装袖型、衣长与裤裙形制服从主体，主体为劲装时呈束袖束腰上衣与分开的双腿裤装，武器长短和材质服从主体；",
            "服装呈束袖束腰上衣与分开的双腿裤装，武器长短和材质服从主体句；", 1)
    if ("收鞘" in subj_text) or ("收在鞘中" in subj_text):
        out = out.replace(
            "武器的收鞘、出鞘或残损状态服从主体事实；完整武器两端均入画，局部图与完整图对应同一件武器；来源为收鞘态时，完整图与所有局部图均保持收鞘态。各特写只呈现实际存在的部件；主体未提供武器、鞘或配饰装备时，对应槽位保留净空，格面留白。",
            "完整武器两端均入画，局部图与完整图对应同一件武器，完整图与所有局部图均保持收鞘态；各特写只呈现实际存在的部件。", 1)
    if not re.search(r"技能|术法|招式|功法|神通|绝学", subj_text):
        out = out.replace(
            "底部第四区为能力资料：主体明确提供技能或术法时，上格展示一幅该能力的独立效果，下格展示其关键形态或作用部位；主体未提供时，该区保留净空，仅标注“能力未设定”。来源明确带有灵兽时，另用独立附板展示完整兽形与兽类细节，附板独立排布；来源未带灵兽时，本板保持人物设定板内容。",
            "底部第四区为能力资料：该区保留净空，仅标注“能力未设定”。", 1)
    return out


def _style_combo_transparent() -> str:
    """透明型与其他类型共用纯画法；透明包装由最终输出层负责。"""
    return _load_art_style_base()["positive"]

# widget default 面=import 时刻求值一次(同 my_qi21_prompt_select._RGBA_HEAD 家法:
# INPUT_TYPES 调用即现读,此处仅签名 default;美术风格底座正值不改语义);
# 负面面 1005 案B起弃 import 快照(_LOCK_A_NEG 退役),assemble 内每次现读。
_STYLE_BASE = _load_art_style_base()["positive"]


class MyQi21PromptAssembly:
    """漫影道劫 qi21 按用途装配。局部编辑仅输出编辑指令，画风转换追加画法。
    以下三段与负面合并说明仅适用于默认的新建资产用途：
    主体句+BASE+美术风格底座 三段换行拼合,装配全文真源
    +负面词合并出(1005 案B Phase I:负面词=merge(BASE负面, 美术风格底座负面现读))。

    装配全文(口0)=唯一真源文本:双喂 [140].prompt(PE 改写输入,Q1=B+)
    与 MyQi21PromptSelect.装配全文(直写路/透明直写路);BASE 未接线(None)
    或空串/纯空白=降级两段拼(主体句+美术风格底座)+中文警告,不炸产线。
    负面词(口1)=型负面(BASE负面槽)+美术风格底座负面 mtime 现读 的 _merge_negative
    合并:BASE负面缺键/空串=裸输出美术风格底座负面(负向链不断,不警告)。
    """

    CATEGORY = "漫影"
    DESCRIPTION = ("道劫按组装用途输出：新建资产=主体句+类型+画法；"
                   "局部编辑=编辑指令；画风转换=指令+画法。"
                   "旧调用默认新建资产；局部编辑不继承类型与全局负面。")

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
                "BASE": ("STRING", {"tooltip": "所选类型的布局、背景、照明与状态规则,连「底座十选一"
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
                                          "tooltip": "新建资产/画风转换使用的共同画法(现代"
                                                     "修仙游戏数字绘画规范),改画风才"
                                                     "动它,一般不用改"}),
                "组装用途": (["新建资产", "局部编辑", "画风转换", "无底座出图"],
                            {"default": "新建资产", "tooltip": "新建资产追加类型与画法；局部编辑仅保留编辑指令；画风转换只追加画法，保留原构图；无底座出图=主体句+类型句两段(美术底座正/负全离场,裸测底座贡献用;底座热读兜底在此档失效)。"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("装配全文", "负面词")
    FUNCTION = "assemble"

    def assemble(self, BASE: str | None = None,
                 BASE负面: str | None = None,
                 主体句: str = _SUBJECT_EXAMPLE,
                 主体句负面: str | None = None,
                 锁层A全文: str = _STYLE_BASE,
                 组装用途: str = "新建资产") -> tuple[str, str]:
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
        # 局部编辑不继承类型布局、统一打光或全局负向；保留参考图画法。
        # 新参数可省略，旧工作流仍走既有新建资产路径。
        if 组装用途 not in ("新建资产", "局部编辑", "画风转换", "无底座出图"):
            raise ValueError(f"未知组装用途: {组装用途}")
        # 1017 运行时门禁:t2i 语义路(新建资产/无底座出图)主体句全查;
        # i2i 路(局部编辑/画风转换)否定式门(1017 用户令「4,开始做」扩展,
        # 两落法豁免退役——「去掉/摘掉」去除操作与肯定枚举不在禁词族,零波及)
        if 组装用途 in ("新建资产", "无底座出图"):
            assert_prompt_gates((主体句 or "").strip(), is_subject=True, context=f"[主体句·{组装用途}]")
        else:
            assert_prompt_gates((主体句 or "").strip(), is_subject=True, negation_only=True,
                                context=f"[指令·{组装用途}]")
        锁层A全文 = _style_only(锁层A全文)
        if 组装用途 == "局部编辑":
            return ((主体句 or "").strip(), (主体句负面 or "").strip())
        if 组装用途 == "画风转换":
            style = _style_combo_transparent() if _type_is_transparent(BASE) else 锁层A全文
            return ("\n".join(p for p in ((主体句 or "").strip(), style.strip()) if p),
                    (主体句负面 or "").strip())
        # 1016 用户令「真关掉底座」:显式裸测档——美术底座正/负全离场,
        # 含 mtime 热读兜底(此档压过 1001 S8 L-1 的「空 BASE 回落底座」语义);
        # 类型层保留(裸测对象=底座贡献,非型规则);配 PE 关(默认)才是纯裸测。
        if 组装用途 == "无底座出图":
            negative_nb = _merge_negative((BASE负面 or ""), (主体句负面 or "").strip())
            if not (BASE or "").strip():
                _out_nb = (f"主体句:{主体句}", negative_nb)
            else:
                base_out_nb = strip_rgba_decl(BASE) if _type_is_transparent(BASE) else BASE
                _out_nb = (f"类型句:{base_out_nb}\n主体句:{主体句}", negative_nb)
            assert_prompt_gates(_out_nb[0], is_subject=False, context="[终稿·无底座出图]")
            return _out_nb
        # 负面词(口1):merge 单源复用+美术风格底座负面 mtime 现读(两分支同值,先算)
        negative = _merge_negative(_merge_negative((BASE负面 or ""),
                                   _load_art_style_base()["negative"]),
                                  (主体句负面 or "").strip())
        # 类型句提供背景、光照与状态呈现规则；风格始终只有绘画语言。
        # 透明类型的中文透明声明由最终输出层统一包装，不进入 PE。
        if _type_is_transparent(BASE):
            base_out = strip_rgba_decl(BASE)
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
            # 1009 用户令:段前加标签(类型句:/主体句:)——模型对段角色的显式信号
            return (f"{锁层A全文}\n主体句:{主体句}", negative)
        # 1017 用户令:装配序反转——底座前置、主体句殿后(标签随内容走)
        # 1017 设定卡主体锚役:型旗 subject_first 例外=主体句置首(身份锚优先);
        # 条件预解析=确定描述进终稿(模板句在真源不动)
        if _type_subject_first(BASE):
            _out = (f"主体句:{主体句}\n{style_out}\n类型句:"
                    f"{_resolve_card_conditionals(base_out, 主体句)}", negative)
        else:
            _out = (f"{style_out}\n类型句:{base_out}\n主体句:{主体句}", negative)
        assert_prompt_gates(_out[0], is_subject=False, context="[终稿·新建资产]")
        return _out
