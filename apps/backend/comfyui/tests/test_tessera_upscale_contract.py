"""TESSERA 独立超分件契约(1110 建件,用户令「单独做个超分的工作流」)。

被测对象 = 仓库真源 `2_视频/H3视频/3_超分后处理/TESSERA-超分-1080p.json`
(38 节点整株移植自 三采-单镜.json(移植时名 MY-三采-单镜)TESSERA 旁路组,平移原点+解除 mode=2 旁路)。

参数真源 = 第四发 api_formal_v4(1104 定谳,1105 入库):×1.5 lanczos→1920×1056/
σ"1,0.7,0.4,0.0"/er_sde+euler/taomate@0.7(1107 去油值)+LMS 0.75·1.0/sol-attn τ1.5/TE nvfp4_awq/CRF12。
"""
import json
from pathlib import Path

WF_DIR = Path(__file__).resolve().parents[1] / "workflows" / "2_视频" / "H3视频" / "3_超分后处理"
WF = WF_DIR / "TESSERA-超分-1080p.json"


def _load():
    assert WF.exists(), f"工作流真源缺失: {WF}"
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}, {l[0]: l for l in d["links"]}


def test_input_generic_loadvideo():
    """输入形态=LoadVideo 通用件(1110 用户裁定):吃任意片,不依赖三段链。"""
    _, nodes, _ = _load()
    lv = nodes[300]
    assert lv["type"] == "LoadVideo"
    assert isinstance(lv["widgets_values"][0], str), "文件名恒字符串槽"


def test_selfcontained_no_external_feed():
    """自足支路(1105 设计):零外部喂入零出线,底模/TE/VAE 自备([308]-[311])。"""
    d, _, _ = _load()
    ids = {n["id"] for n in d["nodes"]}
    for l in d["links"]:
        assert l[1] in ids and l[3] in ids, f"链 {l[0]} 端点越界=外部依赖"
    types = {n["type"] for n in d["nodes"]}
    assert {"UNETLoader", "CLIPLoader", "VAELoader"} <= types, "自备加载器三件在位"


def test_v4_params_anchored():
    """第四发 api_formal_v4 参数逐值钉(改动须过用户)。"""
    _, nodes, _ = _load()
    # ×1.5 lanczos 切块
    w303 = nodes[303]["widgets_values"]
    assert w303[0] == 1.5 and "lanczos" in str(w303).lower(), "TesseraEncode ×1.5 lanczos"
    # σ 四值 + er_sde + euler 双选择
    assert nodes[319]["widgets_values"] == ["1, 0.7, 0.4, 0.0"], "ManualSigmas 第四发 σ"
    assert nodes[317]["widgets_values"] == ["er_sde"], "采样器 er_sde"
    assert nodes[318]["widgets_values"] == ["euler"], "VAE 侧 euler"
    # taomate@0.7(1107 去油改动,1105 老账 1.0 已漂移)+ LMS@1.0
    assert nodes[314]["widgets_values"][0] == "taomate_h3_3step.safetensors"
    assert nodes[314]["widgets_values"][1] == 0.7, "1107 去油 0.7(非 1105 老账 1.0)"
    lms = nodes[316]["widgets_values"]
    assert lms[0] == "minimax_h3_lms_v1.0_r64.safetensors" and lms[1] == 1.0
    # sol-attn τ1.5
    assert nodes[313]["widgets_values"][1] == 1.5, "sol-attn τ1.5(保真臂,非加速)"
    # TE nvfp4 + CRF12 交付
    assert "nvfp4_awq" in nodes[309]["widgets_values"][0]
    w336 = nodes[336]["widgets_values"]
    assert "tessera-1080p" in w336[0], "独立件保存前缀"


def test_all_active_not_muted():
    """独立件全员 active:移植自三段链旁路组(mode=2)必须全数解除。"""
    d, _, _ = _load()
    muted = [n["id"] for n in d["nodes"] if n.get("mode") == 2]
    assert not muted, f"残留旁路哑音节点: {muted}"


def test_single_group_box_covers():
    """恰一组框且罩全(立宪:组框罩全复核,检查器不查组覆盖须自算)。"""
    d, nodes, _ = _load()
    gs = d["groups"]
    assert len(gs) == 1, "独立件恰一组框"
    x, y, w, h = gs[0]["bounding"]
    for n in d["nodes"]:
        nx, ny = n["pos"]
        nw, nh = n.get("size", [300, 200])
        assert nx >= x and ny >= y, f"[{n['id']}] 越组框左/上"
        assert nx + nw <= x + w + 5 and ny + nh <= y + h + 5, f"[{n['id']}] 越组框右/下"


def test_no_negative_zone_and_no_leftward():
    """负区与左向线(立宪判据,横排右向)。"""
    d, nodes, links = _load()
    for n in d["nodes"]:
        assert n["pos"][0] >= 0 and n["pos"][1] >= 0, f"[{n['id']}] 负区"
    for l in links.values():
        sx = nodes[l[1]]["pos"][0]
        tx = nodes[l[3]]["pos"][0]
        assert tx > sx, f"链 {l[0]} 左向线 [{l[1]}]→[{l[3]}]"


def test_ops_note_present():
    """1110 审读关裁定:调查定谳四条运维事实(watchdog/显存/1056→1080 归一/耗时)必须件内可见。"""
    d, _, _ = _load()
    notes = [n for n in d["nodes"] if n["type"] == "MarkdownNote"]
    assert notes, "独立件必须带运维 Note"
    txt = "".join(str(w) for n in notes for w in n.get("widgets_values", []))
    for key in ("watchdog", "1056", "1080", "29"):
        assert key in txt, f"运维 Note 缺关键词: {key}"
