# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影 qi21 加速档位选择(MyQi21SpeedSelect,0929 加速区并行化·方案 B 造件)。

三档互斥加速支路在 LATENT 汇流处的单一选择点(任务 09-29-qi21-acczone-
parallel design §2/§4):直出40步 / viggle / Fun-Acc 三条完整自足支路各自
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

档位表单源:SPEED_MODES 序即 combo 序,**首项=默认=Fun-Acc 4步**(2026-10-02
用户新令「qi21-道劫-t2i.json 默认是 Fun-Acc 加速,默认就要设置这个」推翻 0929
拉齐重放裁定;历史账不改写,以此为准);档位字符串前导数字=档号,**随新序理顺
=序位号(0/1/2)**(1002 前旧档号 0=直出/2=Fun-Acc/1=viggle 系旧 [30] 档位号
口径,重排后理顺归零重编;旧→新字符串映射=research/slot-map.md)。combo
列表即契约:/prompt
闭集硬校验,不在列表即 HTTP 400(BUILDING_NODES 陷阱在档)——改档位文案
必须与三生成器同笔;步数语义在支路采样器自身 widget,本节点不持步数。
"""

from __future__ import annotations

from typing import Any

# 档位表:combo 顺序即画布下拉顺序,首项=默认=Fun-Acc 4步(1002 用户新令,
# 推翻 0929 拉齐重放;次序理由:Fun-Acc 主加速居首,直出居二,viggle 居三)。
# 元组=(档位字符串, 选中时路由的 latent 槽名);档号内嵌字符串前导位=序位号
# (0/1/2,1002 理顺:与新 combo 序一致);分隔符=U+00B7 中点
# (契约测试锁码位防全角漂移)。
SPEED_MODES: tuple[tuple[str, str], ...] = (
    ("0 · Fun-Acc 4步", "latent_funacc"),
    ("1 · 直出40步", "latent_direct"),
    ("2 · viggle", "latent_viggle"),
)

MODES: list[str] = [mode for mode, _slot in SPEED_MODES]
DEFAULT_MODE: str = MODES[0]
_SLOT_OF: dict[str, str] = dict(SPEED_MODES)


def slot_for_mode(mode: str) -> str | None:
    """档位字符串→选中槽名;未知档位返回 None(由调用方给明确报错)。"""
    return _SLOT_OF.get(mode)


class MyQi21SpeedSelect:
    """漫影 qi21 加速档位:三并行支路 LATENT 汇流处单点选择(默认 Fun-Acc 4步,
    1002 用户新令;0929-1001 期间曾默认直出40步=拉齐重放裁定,已被推翻)。

    mode=combo 三选一(首项默认);三个 latent 槽全 optional 全 lazy——
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
            # 强依赖,由 check_lazy_status 只拉起选中支路(未选支路零执行零加载)
            "optional": {
                "latent_funacc": ("LATENT", {"lazy": True}),
                "latent_viggle": ("LATENT", {"lazy": True}),
                "latent_direct": ("LATENT", {"lazy": True}),
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
        slot = _SLOT_OF.get(mode) if mode is not None else None
        if slot is not None and slot in kwargs and kwargs[slot] is None:
            return [slot]
        return None

    def select(self, mode: str, **kwargs: Any) -> tuple[Any, ...]:
        slot = _SLOT_OF.get(mode)
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
