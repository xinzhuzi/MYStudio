# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 加速档位选择(MyQi21SpeedSelect,0929 加速区并行化·方案 B 造件)。

四档互斥加速支路(t2i 专属 E混动臂 1023 入列)在 LATENT 汇流处的单一选择点(任务 09-29-qi21-acczone-
parallel design §2/§4):原生出图 / viggle / Turbo 三条完整自足支路各自
采样后,本节点按 mode 档位把选中支路的 latent 原样路由出去——替代 0929 前
注入式开关农场(t2i 加速区 10 逻辑件→1 选择件;MODEL/steps 内聚各支路,
面板值即生效值)。

懒执行协议(R4;包内经典节点声明式懒首件,两处先例=同包 my_daojie_route.py
九槽 + 引擎核心 comfy_extras/nodes_logic.py SwitchNode):
  - 三 latent 槽声明 {"lazy": True}(经典 INPUT_TYPES 写法,等价核心
    io.MatchType.Input(lazy=True);lazy 输入在执行图 add_node 默认不跟随
    → 未选支路零执行零加载,graph.py:169-173);
  - 懒钩子实名 **check_lazy_status**:本版引擎(git 93810483)全树
    check_lazy_inputs 零命中,执行器只认 check_lazy_status
    (execution.py:503-522,反复调用至返回空才真正执行)——照旧资料写
    check_lazy_inputs 会静默失效;
  - 哨兵语义(经典节点协议):**未接线 optional 槽=kwargs 缺键**(执行器
    不投递,execution.py:172 只遍历 prompt 里实际在册的 inputs);
    **已接线未求值=投递 None**(get_input_data mark_missing)。钩子只对
    「已接线且仍 None」的选中槽返回请求名单,绝不请求未接线槽——引擎对
    未接线槽走 make_input_strong_link 会直接抛 NodeInputError
    (graph.py:132-133 "there is no input to that node at all"),
    未选档/未接线槽因此必须静默放行(返回空→进 select 由它给人话报错);
  - 选中档未接线=select 内中文报错(先例=my_daojie_route.route 未接线
    文案):带档名+槽名+已接线档位清单,不猜不代选。

档位表单源:SPEED_MODES 序即 combo 序,**首项=默认=「0 · Turbo 8步」**
(1021 用户令:所有型含自由/空型默认 Turbo,不按型转原生)。Turbo 使用官方
LoRA(avg_rank_178)8步 cfg1;三手动档字符串不变,用户保存的显式选择不迁移。
「自动 · 按型」保留为末项手动选项:型名∈{设定卡,美宣,概念气氛图}→原生
出图,其余含空→Turbo(1017 路由行为保留,不再是出厂默认)。历史裁定留档。
combo 列表即契约:/prompt 闭集硬校验,不在列表即 HTTP 400
(BUILDING_NODES 陷阱在档);步数语义在支路采样器自身 widget,本节点不持步数。
"""

from __future__ import annotations

from typing import Any

# 档位表:首项=默认=Turbo 8步(1021 用户令);原生/viggle 随后,自动按型居末。
# 三手动档逐字不动;自动档无固有槽,由 resolve_slot 按型名现算。
# 元组=(档位字符串, 选中时路由的 latent 槽名);手动档档号内嵌字符串前导位=
# 序位号(0/1/2,1002 理顺:与新 combo 序一致);分隔符=U+00B7 中点
# (契约测试锁码位防全角漂移)。
# 自动档(1017)路由表:型名∈_AUTO_DIRECT_TYPES→原生出图,其余(含空)→Turbo。
# 1017 概念图役用户裁定:概念气氛图入原生名单(残殿细节锚需 40 步原生,Turbo 纹理弱化)。
AUTO_MODE = "自动 · 按型"
_AUTO_DIRECT_TYPES: tuple[str, ...] = ("设定卡", "美宣", "概念气氛图")
SPEED_MODES: tuple[tuple[str, str | None], ...] = (
    ("0 · Turbo 8步", "latent_turbo"),
    ("1 · 原生出图", "latent_direct"),
    ("2 · viggle", "latent_viggle"),
    ("3 · 混动 40步+缓存", "latent_e"),  # 1023 E混动臂:turbo LoRA×40步simple+LazyCache 步跳缓存(实弹2.41×),t2i 专属支路
    (AUTO_MODE, None),
)

MODES: list[str] = [mode for mode, _slot in SPEED_MODES]
DEFAULT_MODE: str = MODES[0]
_SLOT_OF: dict[str, str] = {mode: slot for mode, slot in SPEED_MODES
                            if slot is not None}


def slot_for_mode(mode: str) -> str | None:
    """档位字符串→选中槽名;未知档位返回 None(由调用方给明确报错)。
    自动档无固有槽不经本函数(按型名现算,见 resolve_slot)。"""
    return _SLOT_OF.get(mode)


def resolve_slot(mode: str | None, type_name: str | None = None) -> str | None:
    """档位×型名→选中槽名(1017 自动档路由单一真源)。

    自动档按型名现算:型名∈_AUTO_DIRECT_TYPES(设定卡/美宣/概念气氛图)→原生出图,
    其余(含空串/缺省 None)→Turbo(型名空=按 Turbo 的缺省口径);手动档
    忽略型名直查 _SLOT_OF;未知档位返回 None(由调用方给明确报错)。
    check_lazy_status 与 select 共用本函数,保证两路槽求值零漂移。
    """
    if mode == AUTO_MODE:
        return "latent_direct" if type_name in _AUTO_DIRECT_TYPES else "latent_turbo"
    return _SLOT_OF.get(mode)


class MyQi21SpeedSelect:
    """漫影 qi21 加速档位:三并行支路 LATENT 汇流处单点选择。
    默认「0 · Turbo 8步」(1021 用户令,所有型均走 Turbo);末项「自动 · 按型」
    需手动选择,仍保留设定卡/美宣/概念气氛图→原生、其余含空→Turbo 行为。

    mode=combo 四选一(首项默认;自动档配 optional「型名」信号);三个 latent
    槽全 optional 全 lazy——
    未选档未接线不报错、不进执行图;选中档未接线给中文报错;输出=选中
    支路 LATENT 原样直通(不拷贝不改写)。加速启停=用户操控杆(0920 铁律):
    默认档仅初始值,随时可切任何档。
    """

    CATEGORY = "漫影"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {"mode": (MODES, {"default": DEFAULT_MODE})},
            # 全 optional 防未选档未接线报错;lazy=True=执行器对三槽默认不建
            # 强依赖,由 check_lazy_status 只拉起选中支路(未选支路零执行零加载);
            # 型名(1017 自动档信号)=非 lazy 普通槽,接 MyQi21DaojieBase「型名」出,
            # 未接线/留空=按 Turbo(缺省安全侧)
            "optional": {
                "latent_turbo": ("LATENT", {"lazy": True}),
                "latent_viggle": ("LATENT", {"lazy": True}),
                "latent_direct": ("LATENT", {"lazy": True}),
                "型名": ("STRING", {
                    "tooltip": "「自动 · 按型」档用:接底座节点的「型名」出,"
                               "设定卡/美宣走原生出图,其余(含留空)走 Turbo;"
                               "手动档忽略此值"}),
                # 1023 E混动档支路槽(追加在末=存量画布槽序零漂移);未接线档
                # 静默放行(i2i/edit 画布无此臂,选它=未接线人话报错)
                "latent_e": ("LATENT", {"lazy": True}),
            },
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "select"

    def check_lazy_status(self, mode: str | None = None,
                          **kwargs: Any) -> list[str] | None:
        """只请求「选中档×已接线×尚未求值」的槽;其余一律不请求。

        执行器以 kwargs 投递当前输入(经典节点,execution.py:511):缺键=
        该槽未接线(optional 不投递)→不请求(请求未接线槽引擎抛
        NodeInputError);None=已接线未求值→请求;有值=已求值→放行执行。
        未选档的槽即便已接线且 None 也一概不请求(未选支路不进执行图)。
        """
        # 1017:自动档先按型名映射到实际支路槽(型名空=Turbo),再走原哨兵
        slot = resolve_slot(mode, kwargs.get("型名")) if mode is not None else None
        if slot is not None and slot in kwargs and kwargs[slot] is None:
            return [slot]
        return None

    def select(self, mode: str, **kwargs: Any) -> tuple[Any, ...]:
        # 1017:槽求值与 check_lazy_status 同源(resolve_slot),自动档按型名
        # 映射(型名空=Turbo);未知档枚举=MODES 自动含自动档
        slot = resolve_slot(mode, kwargs.get("型名"))
        if slot is None:
            raise ValueError(
                f"未知加速档位:「{mode}」。可选档位:{' / '.join(MODES)}"
                "——请在画布重新选择档位下拉,或检查自研节点是否为旧版")
        picked = kwargs.get(slot)
        if picked is None:
            # 键在场与否=接线与否(未求值与未接线的值面都是 None,以缺键区分)
            wired = [m for m, s in SPEED_MODES if s in kwargs]
            raise ValueError(
                f"加速档位选中「{mode}」,但其支路槽 {slot} 未接线"
                f"(已接线的档位:{'、'.join(wired) if wired else '无'})"
                "——请把该档支路的采样输出连到本节点对应 latent 槽,"
                "或把档位切换到已接线的档")
        return (picked,)
