"""道劫专属工作流·真文件契约测试(09-17 制作,防回退)。

被测对象 = 仓库真源文件本身(UI 格式):
    engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_道劫.json

结构背景(09-17 用户令「按照超集模板单独做一个道劫的工作流」):
  daojie_ink_guofeng 在 MyStylesLibrary 一期排除名单(_FIRST_PHASE_EXCLUDED),
  道劫底座不能走风格库节点 → 内嵌 [71] + [72] 装配自成一体,[60] 整体摘除。
提示词真源 = docs/prompts/道劫_新提示词包_0917.md(§一底座/§四负向),
本测试直接解析该 md 取围栏逐字比对(真源漂移即红)。
纯读文件断言,零网络零引擎依赖,可独立重跑。
"""
from __future__ import annotations

import json
import pathlib

# ── 真文件定位(tests/ 同级 workflows 真源;md 为提示词真源) ────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根
DAOJIE_JSON = (
    _TESTS_DIR.parent / "workflows" / "1_图片" / "K2图像" / "1_文生图"
    / "MY-K2_文生图_道劫.json"
)
PROMPT_MD = _REPO / "docs" / "prompts" / "道劫_新提示词包_0917.md"

_RAW_TEXT = DAOJIE_JSON.read_text(encoding="utf-8")
_DOC = json.loads(_RAW_TEXT)
_NODES = {n["id"]: n for n in _DOC["nodes"]}
_LINKS = {l[0]: l for l in _DOC["links"]}  # litegraph: [id, src, src_slot, dst, dst_slot, type]


def _md_fence(heading_prefix: str) -> str:
    """md 指定标题之后第一个 ```text 围栏的逐字内容(与制作脚本同法)。"""
    lines = PROMPT_MD.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith(heading_prefix))
    j = next(k for k in range(start, len(lines)) if lines[k].startswith("```text"))
    end = next(k for k in range(j + 1, len(lines)) if lines[k].startswith("```"))
    return "\n".join(lines[j + 1:end])


MD_BASE = _md_fence("## 一、")      # 新底座(线描硬锁)
MD_NEG = _md_fence("## 四、")       # Negative 基线
MD_FORMULA = _md_fence("## 二、")   # 七段公式
MD_EXAMPLE = _md_fence("### 填好示例")
MD_SCENE = _md_fence("## 三、")     # 山水场景模板

# 脏词禁入(§六纪律 2 + 任务书门禁口径)
DIRTY_WORDS = ("宣纸", "工笔线描", "工笔白描", "写意泼墨", "xuan")
# 模型链完整链序(21 起点至 12 采样器;旁路件靠 mode=4 穿透)
MODEL_CHAIN = [21, 19, 44, 45, 46, 47, 67, 68, 69, 70, 73, 12]  # 09-17 用户令拷入73鎏金


def _node(nid: int) -> dict:
    assert nid in _NODES, f"节点 {nid} 不存在"
    return _NODES[nid]


def _card_text(nid: int) -> str:
    w = _node(nid).get("widgets_values")
    assert isinstance(w, list) and w and isinstance(w[0], str), f"节点 {nid} widgets 非文本卡"
    return w[0]


def _link_between(src: int, dst: int, slot: int | None = None) -> list:
    hits = [l for l in _DOC["links"] if l[1] == src and l[3] == dst]
    if slot is not None:
        hits = [l for l in hits if l[4] == slot]
    return hits


# ── 1. 拓扑与可加载性 ──────────────────────────────────────────────

class TestTopology:
    def test_file_loads_and_top_ids(self):
        assert _DOC["revision"] == 0
        assert _DOC["last_node_id"] == 73 == max(n["id"] for n in _DOC["nodes"])
        assert _DOC["last_link_id"] == 48 == max(l[0] for l in _DOC["links"])

    def test_node_count_28(self):
        # 27 节点 + [73] 鎏金LoRA(09-17 用户令拷入) = 28
        assert len(_DOC["nodes"]) == 28
        assert len(_NODES) == 28

    def test_link_ids_unique_27(self):
        # 09-17 复审修复:超集模板带来的重复 link id 42(两条全同 [42,70,0,12,0])
        # 已去重;门禁改为显式数重复,防 dict 按 id 折叠后测不出(28 条 27 id 的畸形)
        ids = [l[0] for l in _DOC["links"]]
        assert len(ids) == len(set(ids)) == 28, \
            f"links 应 28 条且 id 唯一,实为 {len(ids)} 条/{len(set(ids))} id"
        assert len(_LINKS) == len(_DOC["links"]), "_LINKS 折叠数与原文不符(存在重复 id)"

    def test_no_my_styles_library_anywhere(self):
        for n in _DOC["nodes"]:
            assert n["type"] != "MyStylesLibrary", f"节点 {n['id']} 仍是风格库"
        assert "MyStylesLibrary" not in _RAW_TEXT, "文件仍残留 MyStylesLibrary 字样"


# ── 2. 底座 [71] / 负向 [64] 与 md 真源逐字相等 ────────────────────

class TestPromptSources:
    def test_node71_base_verbatim_from_md(self):
        n = _node(71)
        assert n["type"] == "PrimitiveStringMultiline"
        assert n["widgets_values"] == [MD_BASE], "[71] 底座与 md §一不逐字相等"
        assert n["widgets_values_named"] == {"value": MD_BASE}, "[71] named 与 §一不逐字相等"
        assert "勿手改" in (n.get("title") or "")

    def test_node64_negative_verbatim_from_md(self):
        n = _node(64)
        assert n["type"] == "PrimitiveStringMultiline"
        assert n["widgets_values"] == [MD_NEG], "[64] 负向与 md §四不逐字相等"
        assert "cfg1" in (n.get("title") or "") and "cfg5" in (n.get("title") or "")

    def test_node50_default_daojie_subject(self):
        # 09-17 用户超集快照对齐:50 默认=道劫女修士主体句(named==positional)
        n = _node(50)
        v = n["widgets_values"][0]
        assert "女修士" in v and "道袍" in v, "[50] 默认应为道劫女修士句"
        named = n.get("widgets_values_named") or {}
        assert named.get("value") == v, "[50] named 与 positional 应一致"

    def test_node71_fullwidth_punctuation(self):
        for ch in ",;:!?()":
            assert ch not in MD_BASE, f"[71] 底座含半角标点 {ch!r}(纪律 4:中文+全角标点)"

    def test_no_dirty_words_in_71_64(self):
        for nid, val in ((71, MD_BASE), (64, MD_NEG)):
            low = val.lower()
            for w in DIRTY_WORDS:
                assert w not in low, f"[{nid}] 含脏词 {w!r}"


# ── 3. 装配链拓扑([72] a←71 / b←50 / 出→51 与 62;负向 64→65 直通) ──

class TestAssemblyChain:
    def test_link_43_base_into_concat_a(self):
        assert _LINKS[43] == [43, 71, 0, 72, 0, "STRING"]
        assert _node(72)["inputs"][0]["name"] == "string_a"
        assert _node(72)["inputs"][0]["link"] == 43

    def test_link_44_subject_into_concat_b(self):
        assert _LINKS[44] == [44, 50, 0, 72, 1, "STRING"]
        assert _node(72)["inputs"][1]["name"] == "string_b"
        assert _node(72)["inputs"][1]["link"] == 44

    def test_link_45_concat_out_to_clip_positive(self):
        assert _LINKS[45] == [45, 72, 0, 51, 1, "STRING"]
        assert _node(51)["inputs"][1]["name"] == "text"
        assert _node(51)["inputs"][1]["link"] == 45

    def test_link_46_concat_out_to_preview(self):
        assert _LINKS[46] == [46, 72, 0, 62, 0, "*"]
        assert _node(62)["inputs"][0]["link"] == 46
        assert "最终正向预览" in (_node(62).get("title") or "")

    def test_link_47_negative_direct_to_clip_negative(self):
        # 负向直通:不再经过风格库,[64] 输出直接接 [65].text
        assert _LINKS[47] == [47, 64, 0, 65, 1, "STRING"]
        assert _node(65)["inputs"][1]["name"] == "text"
        assert _node(65)["inputs"][1]["link"] == 47
        # 全图不存在任何进/出 [60] 的线(已摘)
        for l in _DOC["links"]:
            assert 60 not in (l[1], l[3]), f"线 {l[0]} 仍连着已摘除的节点 60"

    def test_node72_signature_follows_object_info(self):
        # object_info 实测(required 顺序):string_a, string_b, delimiter(默认 "")
        n = _node(72)
        assert n["type"] == "StringConcatenate"
        assert n["widgets_values"] == ["", "", ""]
        assert n["widgets_values_named"] == {"string_a": "", "string_b": "", "delimiter": ""}


# ── 4. 模型链完整与 mode 矩阵(照超集口径原样继承) ─────────────────

class TestModelChain:
    def test_chain_contiguous(self):
        for src, dst in zip(MODEL_CHAIN, MODEL_CHAIN[1:]):
            assert _link_between(src, dst), f"模型链断在 {src}→{dst}"

    def test_chain_modes(self):
        # 09-17 用户超集快照对齐:44/45/46/69 旁路,68/70/73 三开,19 旁路,47/67 激活
        for nid in (44, 45, 46, 19, 69):
            assert _node(nid).get("mode") == 4, f"[{nid}] 应旁路(mode=4)"
        for nid in (47, 67, 68, 70, 73):
            assert _node(nid).get("mode", 0) == 0, f"[{nid}] 应激活(mode=0)"

    def test_sampler_speed_profile_inherited(self):
        w = _node(12)["widgets_values"]
        assert _node(12)["type"] == "KSampler"
        assert w[2] == 4 and w[3] == 1.0, "采样参数应与超集一致(4步/cfg1 速度档)"


# ── 5. 链接双向一致(无悬空) ───────────────────────────────────────

class TestLinkIntegrity:
    def test_every_link_two_way_consistent(self):
        for l in _DOC["links"]:
            link_id, src, s_slot, dst, d_slot, _typ = l
            assert src in _NODES and dst in _NODES, f"链接 {link_id} 端点节点缺失"
            outs = _NODES[src].get("outputs") or []
            ins = _NODES[dst].get("inputs") or []
            assert s_slot < len(outs), f"链接 {link_id} src 槽位越界"
            assert d_slot < len(ins), f"链接 {link_id} dst 槽位越界"
            assert link_id in (outs[s_slot].get("links") or [])
            assert ins[d_slot].get("link") == link_id

    def test_no_dangling_node_references(self):
        for nid, n in _NODES.items():
            for o in n.get("outputs") or []:
                for ref in o.get("links") or []:
                    assert ref in _LINKS, f"节点 {nid} 输出引用悬空线 {ref}"
            for ip in n.get("inputs") or []:
                ref = ip.get("link")
                assert ref is None or ref in _LINKS


# ── 6. 保存前缀与 [66] 用法速查卡(道劫七要件) ─────────────────────

class TestOutputAndCard:
    def test_node4_prefix(self):
        n = _node(4)
        assert n["widgets_values"] == ["K2道劫文生图_"]
        assert n["widgets_values_named"]["filename_prefix"] == "K2道劫文生图_"

    def test_card_contains_formula_and_example(self):
        text = _card_text(66)
        assert "[50]" in text and "[71]" in text, "卡缺①正向=只写主体句/底座自动携带口径"
        assert MD_FORMULA in text, "卡缺②七段公式全文"
        assert MD_EXAMPLE in text, "卡缺②填好示例全文"
        assert "可直接粘贴" in text, "卡缺②「可直接粘贴」标注"

    def test_card_contains_scene_template(self):
        assert MD_SCENE in _card_text(66), "卡缺③山水场景模板全文"

    def test_card_contains_disciplines(self):
        text = _card_text(66)
        assert "纪律六条" in text
        for kw in ("美感词前置", "脏词禁用", "全角标点", "无权重语法", "均匀柔光无投影"):
            assert kw in text, f"卡缺④纪律关键词 {kw}"

    def test_card_contains_negative_and_profiles(self):
        text = _card_text(66)
        assert MD_NEG in text, "卡缺⑤负向基线全文"
        assert "cfg1 下负向不生效" in text, "卡缺⑤ cfg1 无效口径"
        assert "速度档=默认" in text and "约90秒" in text, "卡缺⑥速度档口径"
        assert "质量档=旁路[47]" in text and "12步/cfg5" in text and "约500秒" in text, "卡缺⑥质量档口径"

    def test_card_contains_lora_matrix(self):
        text = _card_text(66)
        assert "[67]" in text and "默认激活" in text, "卡缺⑦[67]默认开口径"
        assert "一次只开一枚" in text, "卡缺⑦68-70 互斥口径"
        for nid in (68, 69, 70):
            assert f"[{nid}]" in text


# ── 7. 画布纪律与布局 ─────────────────────────────────────────────

class TestCanvasDiscipline:
    def test_no_fullwidth_label_banner(self):
        # 09-15 裁定:画布禁大标题横幅——不新增整幅 Label/标题节点,说明一律进 [66] 卡
        for n in _DOC["nodes"]:
            assert n["type"] not in ("Label", "easy label", "Note (rgthree)"), \
                f"节点 {n['id']} 是禁用的标题横幅件"

    def test_group4_covers_prompt_chain(self):
        g4 = next(g for g in _DOC["groups"] if g["title"].startswith("④"))
        assert g4["title"] == "④ 提示词链(主体句+道劫底座→装配→编码→12带)"
        bx, by, bw, bh = g4["bounding"]
        for nid in (50, 64, 71, 72, 51, 65, 62):
            n = _node(nid)
            x1, y1 = n["pos"][0], n["pos"][1]
            x2, y2 = x1 + n["size"][0], y1 + n["size"][1]
            assert bx <= x1 and x2 <= bx + bw and by <= y1 and y2 <= by + bh, \
                f"组框④未覆盖节点 {nid}"

    def test_all_node_rects_pairwise_disjoint(self):
        rects = []
        for nid, n in _NODES.items():
            pos, size = n.get("pos"), n.get("size")
            assert pos and size, f"节点 {nid} 缺 pos/size"
            rects.append((nid, pos[0], pos[1], pos[0] + size[0], pos[1] + size[1]))
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                overlap = a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]
                assert not overlap, f"节点 {a[0]} 与 {b[0]} 矩形相交"
