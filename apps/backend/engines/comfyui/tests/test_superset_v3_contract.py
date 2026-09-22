"""超集工作流 v3 定档·真文件契约测试(结构门固化,防回退)。

被测对象 = 仓库真源文件本身(UI 格式):
    engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-超集.json

把收敛脚本 apps/build/scripts/manying_superset_negative_prompt.py 的 v3 结构门
固化为 pytest 门禁:拓扑计数 / 模型链 / 链接双向一致 / 67 细节滑杆定档 /
69/73 画风件旁路口径 / mode 矩阵 / 66 卡两档口径 / IP 词禁入 / AABB 零相交。
(3f637c2 柔水彩清除令摘 68/70 后锚点同步:29→27 节点,链 67→69→73 直连。)
纯读文件断言,零网络零引擎依赖,可独立重跑。
"""
from __future__ import annotations

import json
import pathlib

# ── 真文件定位(tests/ 同级 workflows 真源) ────────────────────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
SUPERSET_JSON = (
    _TESTS_DIR.parent / "workflows" / "1_图片" / "K2图像" / "1_文生图"
    / "K2-文生图-超集.json"
)

_RAW_TEXT = SUPERSET_JSON.read_text(encoding="utf-8")
_DOC = json.loads(_RAW_TEXT)
_NODES = {n["id"]: n for n in _DOC["nodes"]}
_LINKS = {l[0]: l for l in _DOC["links"]}  # litegraph: [id, src, src_slot, dst, dst_slot, type]

DETAIL_SLIDER_FILE = "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors"
STYLE_TRIGGERS = {
    69: "monochrome ink wash style",
    # 73 鎏金无官方触发词;68/70 已被 3f637c2 清除令摘除
}
# 模型链:link id → (src 节点, dst 节点)
MODEL_CHAIN = [  # 09-18 摘47加速件:37 撤、38 改 46→67 直通;3f637c2 清除令摘 68/70,链 67→69→73 直连(link 52/53)
    (36, 45, 46),
    (38, 46, 67),
    (52, 67, 69),
    (53, 69, 73),
    (49, 73, 74),
    (50, 74, 75),
    (51, 75, 76),
    (42, 76, 12),
]


def _node(nid: int) -> dict:
    assert nid in _NODES, f"节点 {nid} 不存在"
    return _NODES[nid]


def _card_text(nid: int) -> str:
    w = _node(nid).get("widgets_values")
    assert isinstance(w, list) and w and isinstance(w[0], str), f"节点 {nid} widgets 非文本卡"
    return w[0]


# ── 1. 拓扑计数 ────────────────────────────────────────────────────

class TestTopology:
    def test_node_count_is_27(self):
        assert len(_DOC["nodes"]) == 27
        assert len(_NODES) == 27  # id 无重复(09-17 摘14+入73-76;09-18 摘47;3f637c2 摘 68/70)

    def test_last_ids_equal_max(self):
        assert _DOC["last_node_id"] == max(n["id"] for n in _DOC["nodes"])
        assert _DOC["last_link_id"] == max(l[0] for l in _DOC["links"])


# ── 2. 模型链(45→46→67→69→73→74→75→76→12,14/47/68/70已摘) ────────

class TestModelChain:
    def test_links_36_to_42_form_chain(self):
        for link_id, src, dst in MODEL_CHAIN:
            assert link_id in _LINKS, f"缺链接 {link_id}"
            l = _LINKS[link_id]
            assert (l[1], l[3]) == (src, dst), (
                f"链接 {link_id} 端点漂移:期望 {src}→{dst},实为 {l[1]}→{l[3]}"
            )
            assert l[5] == "MODEL", f"链接 {link_id} 非 MODEL 线:{l[5]}"

    def test_chain_is_contiguous(self):
        hops = [(_LINKS[link_id][1], _LINKS[link_id][3]) for link_id, _, _ in MODEL_CHAIN]
        assert hops == [(45, 46), (46, 67), (67, 69), (69, 73), (73, 74), (74, 75), (75, 76), (76, 12)]
        # 逐跳首尾相接:45 →…→ 12 无断点
        for (_, src, dst), (_, nxt, _) in zip(MODEL_CHAIN, MODEL_CHAIN[1:]):
            assert dst == nxt, f"模型链在 {src}→{dst} 后断:下一跳起点是 {nxt}"


# ── 3. 链接双向一致(无悬空) ───────────────────────────────────────

class TestLinkIntegrity:
    def test_every_link_two_way_consistent(self):
        for l in _DOC["links"]:
            link_id, src, s_slot, dst, d_slot, _typ = l
            assert src in _NODES and dst in _NODES, f"链接 {link_id} 端点节点缺失"
            outs = _NODES[src].get("outputs") or []
            ins = _NODES[dst].get("inputs") or []
            assert s_slot < len(outs), f"链接 {link_id} src 槽位 {s_slot} 越界(节点 {src})"
            assert d_slot < len(ins), f"链接 {link_id} dst 槽位 {d_slot} 越界(节点 {dst})"
            assert link_id in (outs[s_slot].get("links") or []), (
                f"链接 {link_id} 未被源节点 {src} outputs[{s_slot}].links 引用"
            )
            assert ins[d_slot].get("link") == link_id, (
                f"链接 {link_id} 未被目的节点 {dst} inputs[{d_slot}].link 引用"
            )

    def test_no_dangling_node_references(self):
        for nid, n in _NODES.items():
            for i, o in enumerate(n.get("outputs") or []):
                for ref in o.get("links") or []:
                    assert ref in _LINKS, f"节点 {nid} outputs[{i}] 引用悬空线 {ref}"
            for i, ip in enumerate(n.get("inputs") or []):
                ref = ip.get("link")
                assert ref is None or ref in _LINKS, (
                    f"节点 {nid} inputs[{i}] 引用悬空线 {ref}"
                )


# ── 4. [67] 细节滑杆定档激活 ───────────────────────────────────────

class TestDetailSliderNode67:
    def test_node67_contract(self):
        n = _node(67)
        assert n["type"] == "LoraLoaderModelOnly"
        assert n.get("mode", 0) == 0, "[67] 应默认激活(v3 定档)"
        w = n["widgets_values"]
        assert w[0] == DETAIL_SLIDER_FILE, f"[67] lora 文件名漂移:{w[0]}"
        assert w[1] == 1.0, f"[67] strength 应为 ×1.0(矩阵定档),实为 {w[1]}"
        assert "细节滑杆 ×1" in (n.get("title") or ""), "[67] title 缺「细节滑杆 ×1」口径"


# ── 5. [69/73] 画风件旁路口径(68/70 已摘) ─────────────────────────

class TestStyleLoraNodes:
    def test_style_nodes_bypassed_with_triggers(self):
        # 09-17 深夜用户画布快照:画风件 68/70/73 三开(用户调教裁量),69 旁路;
        # 09-19 画布态更新:70 转旁路(并行会话/用户手调,b0b5eec 披露入账);
        # 3f637c2 柔水彩清除令:68(art deco watercolor)/70(purple retro anime)全库摘除
        user_modes = {69: 4, 73: 0}
        for nid, want in user_modes.items():
            assert _node(nid).get("mode") == want, f"[{nid}] 用户快照 mode 应为 {want}"
        for nid, trigger in STYLE_TRIGGERS.items():
            assert trigger in (_node(nid).get("title") or ""), f"[{nid}] title 缺官方触发词 {trigger}"


# ── 6. mode 矩阵与速度档采样参数 ──────────────────────────────────

class TestModeMatrix:
    def test_scale_loras_44_45_bypassed(self):
        assert _node(44).get("mode") == 4
        assert _node(45).get("mode") == 4

    def test_identity_distill_active_afterlight_bypassed(self):
        # 09-17 深夜用户画布快照为 canon:identity[19] 旁路;09-18 摘47后 67 激活
        assert _node(19).get("mode") == 4, "[19] 用户快照:identity 旁路"
        for nid in (67,):
            assert _node(nid).get("mode", 0) == 0, f"[{nid}] 应激活"
        assert _node(46).get("mode") == 4, "[46] Afterlight 应默认旁路"
        assert "工笔/画意防污染" in (_node(46).get("title") or "")

    def test_ksampler_speed_profile(self):
        w = _node(12)["widgets_values"]
        assert _node(12)["type"] == "KSampler"
        assert w[2] == 8, f"steps 应为 8(速度档,09-18 摘47后),实为 {w[2]}"
        assert w[3] == 1.0, f"cfg 应为 1.0(速度档),实为 {w[3]}"


# ── 7. [66] 用法速查卡两档口径 ────────────────────────────────────

class TestUsageCard:
    def test_card_two_profile_wording(self):
        text = _card_text(66)
        assert "速度档=默认" in text
        assert "质量档=手调12步/cfg5" in text
        assert "光影[46]默认旁路" in text  # 09-16 用户裁定:Afterlight 默认旁路

    def test_mutual_exclusion_hint_exactly_once(self):
        assert _card_text(66).count("一次只开一枚") == 1


# ── 8. IP 词禁入 ──────────────────────────────────────────────────

class TestIpHygiene:
    def test_no_ip_words_in_file(self):
        low = _RAW_TEXT.lower()
        for word in ("道劫", "daojie", "凡人"):
            assert word not in low, f"IP 词「{word}」泄漏进工作流文件"


# ── 9. AABB 布局零相交 ────────────────────────────────────────────

class TestLayoutAabb:
    def test_all_node_rects_pairwise_disjoint(self):
        rects = []
        for nid, n in _NODES.items():
            pos, size = n.get("pos"), n.get("size")
            assert pos and size, f"节点 {nid} 缺 pos/size"
            x1, y1 = pos[0], pos[1]
            rects.append((nid, x1, y1, x1 + size[0], y1 + size[1]))
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                overlap = a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]
                assert not overlap, f"节点 {a[0]} 与 {b[0]} 矩形相交"
