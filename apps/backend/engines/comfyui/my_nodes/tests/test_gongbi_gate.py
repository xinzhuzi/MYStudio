# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""运行时门禁测试(1017 用户令:产线常跑,违规提示词报错)。

单源模块 _gongbi_gate + 两节点接线:PE=t2i 全路(入口主体句+出口终稿八点),
Assembly=新建资产路全查+i2i 路(局部编辑/画风转换)否定式门(1017 用户令
「4,开始做」扩展,两落法豁免退役——「去掉/摘掉」去除操作与肯定枚举本就
不在禁词族,合法路零波及)。"""
import importlib.util
from pathlib import Path
import pytest

_spec = importlib.util.spec_from_file_location(
    "gongbi_gate", Path(__file__).resolve().parents[1] / "nodes/_gongbi_gate.py")
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

GOOD = "青年男性刀修，玄色劲装束袖束腰配双腿裤装，乌黑长发高束马尾，左腰黑革刀带悬一柄短刀，刀身完整收在鞘中。"


def test_clean_subject_passes():
    assert gate.prompt_violations(GOOD, is_subject=True) == []
    gate.assert_prompt_gates(GOOD, is_subject=True)


@pytest.mark.parametrize("bad,word", [
    ("人物特写，不能出现手部。", "不能"),
    ("背景不见山石。", "不见"),
    ("共九张脸，无第四行。", "无第"),
    ("光照方向与色温一致。", "光照方向"),
    ("取景为半身或全身。", "或全身"),
    ("写实风格人物。", "写实"),
    ("杰作，8K 超高清。", "8K"),
    ("工笔重彩人物立绘。", "工笔"),
    # 1018 人械握姿+发色门禁
    ("女修腰悬长剑，剑身完整收在鞘中，右手握住剑柄。", "握柄"),
    ("道人佩刀，刀身完整收在鞘中，左手按在刀柄上端。", "握柄"),
    ("青年握剑而立。", "握姿"),
    ("女修长发半束，腰悬长剑。", "发色"),
])
def test_toxins_raise(bad, word):
    v = gate.prompt_violations(bad, is_subject=True)
    assert v and word in v[0], v


def test_weapon_grip_and_hair_color_pass():
    ok_subjects = [
        "女修乌黑长发半束，腰悬一柄乌木鞘长剑，剑身完整收在鞘中，全身仅此一柄长剑、始终挂定腰间，"
        "右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担。",
        "道人墨黑短发，双手扶在行囊肩带上。",  # 有发色;无握械词=零触发
        "武者持剑迎击，剑光如虹。",  # 无鞘语境的持剑(战斗)但含「持剑」须细节?——含柄身/剑柄?否→应拒,移除本条
    ]
    # 第三条实为违例(持剑无部位细节),改为只测前两条
    for s in ok_subjects[:2]:
        v = gate.prompt_violations(s, is_subject=True)
        assert v == [], (s, v)


def test_weapon_state_axis_1019():
    """1019 用户裁定(暂定):持械判定主轴=武器在不在鞘里(剑/刀/枪同例)。
    已脱鞘+空鞘在画+握柄=正;坐姿桌上按鞘=正;在鞘证据+握柄且无脱鞘证据=拒。"""
    ok = [
        "长剑已然出鞘，空剑鞘仍系于腰间，他右手握住剑柄，五指收拢。",
        "长刀已然出鞘，空刀鞘仍悬于腰侧，她右手握住刀柄，虎口扣柄。",
        "她端坐案前，长剑连鞘平放桌上，右手按住剑鞘。",
        "她端坐案前，长刀连鞘平放桌上，右手按住刀鞘。",
    ]
    for s in ok:
        v = gate._weapon_grip_violations(s)
        assert v == [], (s, v)
    v = gate._weapon_grip_violations("女修腰悬一柄乌木鞘长剑，剑身完整收在鞘中，右手按住剑柄。")
    assert v and "握柄" in v[0], v


def test_gender_anchor_conflict_1019():
    """1019 用户裁定:性别恒定——角色词后接错配代词拒收;正确代词与双人分句场景过。"""
    bad = [
        "女修立于山门石阶，他右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身。",
        "男修立于崖畔，她按住挂定的剑柄。",
    ]
    for s in bad:
        v = gate.prompt_violations(s, is_subject=True)
        assert any("性别锚冲突" in x for x in v), (s, v)
    ok = [
        "女修立于山门，她右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身。",
        "她立于山门石阶最上一级；远处一名男子守着山门。",
    ]
    for s in ok:
        v = gate.prompt_violations(s, is_subject=True)
        assert not any("性别" in x for x in v), (s, v)


def test_verbatim_block_exempt():
    s = GOOD + "【文字要求】画面中所有文字必须是以上明确指定的中文，逐字准确；不要生成任何未指定的多余文字。"
    assert gate.prompt_violations(s, is_subject=True) == []


def test_skin_warmth_not_optic():
    assert gate.prompt_violations("青年刀修，肤色温润的浅麦色。", is_subject=True) == []


def test_empty_passes():
    gate.assert_prompt_gates("", is_subject=True)
    gate.assert_prompt_gates(None, is_subject=False)


def test_pe_node_rejects_toxic_subject():
    spec = importlib.util.spec_from_file_location(
        "api_pe_g", Path(__file__).resolve().parents[1] / "nodes/my_qi21_api_pe.py")
    pe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pe)
    with pytest.raises(ValueError, match="道劫提示词门禁"):
        pe.MyQi21ApiPE().rewrite(正向提示词="人物特写，不能出现手部。",
                                 类型句正向="型文", AI扩写开关=False)


def test_assembly_i2i_route_negation_gated():
    spec = importlib.util.spec_from_file_location(
        "asm_g", Path(__file__).resolve().parents[1] / "nodes/my_qi21_prompt_assembly.py")
    asm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asm)
    # 1017 用户令「4,开始做」:i2i 否定式门接入,两落法豁免退役
    with pytest.raises(ValueError, match="否定式"):
        asm.MyQi21PromptAssembly().assemble(
            BASE="", BASE负面="", 主体句="把红色外套改为蓝色，不要改动脸部。", 组装用途="局部编辑")
    with pytest.raises(ValueError, match="否定式"):
        asm.MyQi21PromptAssembly().assemble(
            BASE="", BASE负面="", 主体句="把画法转为淡彩长卷，不能改变构图。", 组装用途="画风转换")
    # 合法两落法不受影响:去除操作(动词去掉,锚定图内实存物)+肯定枚举收尾
    out = asm.MyQi21PromptAssembly().assemble(
        BASE="", BASE负面="", 主体句="去掉颈间玉坠，双手空空，发间与腕上素净，其余未提及之处保持原样。",
        组装用途="局部编辑")
    assert "去掉颈间玉坠" in out[0]


def test_resolver_drift_lock_between_nodes():
    """1017 复查锁:两节点各持 _resolve_card_conditionals 副本(零跨模块家法),
    无锁则静默漂移——本锁用真源 canon+三类主体(带武器/极简/带技能)对拍逐字节相等。"""
    import json as _json
    base = Path(__file__).resolve().parents[3] / "daojie-data/qi21_bases.json"
    if not base.exists():
        base = Path(__file__).resolve().parents[6] / \
            "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
    import importlib.util as _ilu
    def _mod(fn, nm):
        sp = _ilu.spec_from_file_location(nm, fn)
        m = _ilu.module_from_spec(sp); sp.loader.exec_module(m); return m
    pe = _mod(Path(__file__).resolve().parents[1] / "nodes/my_qi21_api_pe.py", "pe_drift")
    asm = _mod(Path(__file__).resolve().parents[1] / "nodes/my_qi21_prompt_assembly.py", "asm_drift")
    card = next(t for t in _json.loads(base.read_text(encoding="utf-8"))["types"]
                if t.get("zh") == "设定卡")["positive_text"]
    for subj in ("青年男性刀修玄色劲装，腰侧短刀，刀身完整收在鞘中。名号「玄刀客」。",
                 "少女青裙。",
                 "老者持杖，掌握御剑术。"):
        assert pe._resolve_card_conditionals(card, subj) == \
               asm._resolve_card_conditionals(card, subj), subj[:12]


def test_bare_route_and_ink_word_doctrine():
    """1017 复查落锁:①无底座出图路=t2i 语义,主体句门必罩(复查补的洞);
    ②水墨=条件毒药不进硬禁词(三国望神州方向合法),厚涂/赛璐璐恒毒保留。"""
    import importlib.util as _ilu
    def _mod(fn, nm):
        sp = _ilu.spec_from_file_location(nm, fn)
        m = _ilu.module_from_spec(sp); sp.loader.exec_module(m); return m
    asm = _mod(Path(__file__).resolve().parents[1] / "nodes/my_qi21_prompt_assembly.py", "asm_bare")
    with pytest.raises(ValueError, match="道劫提示词门禁"):
        asm.MyQi21PromptAssembly().assemble(BASE="型文", BASE负面="",
                                            主体句="人物特写，不能出现手部。", 组装用途="无底座出图")
    gate = _mod(Path(__file__).resolve().parents[1] / "nodes/_gongbi_gate.py", "gate_ink")
    assert gate.prompt_violations("水墨山水意境的人物。", is_subject=True) == []
    assert any("厚涂" in v for v in gate.prompt_violations("厚涂质感人物。", is_subject=True))
