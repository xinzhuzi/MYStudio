"""道劫专属工作流·真文件契约测试(09-17 制作,09-18 底座节点化改版,防回退)。

被测对象 = 仓库真源文件本身(UI 格式):
    engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_道劫.json

结构背景(09-18 用户令「底座收进一枚节点」):
  [71] 底座卡 + [72] 拼接器职责收进 [80] MyDaojieBase(漫影 道劫底座)——
  九型底座下拉,装配语义=底座在前+[50] 主体句零分隔符直拼,由节点一处
  承担;[50]→[80].positive→[51]/[62],[64]→[65] 负向直通不动。
提示词真源(双真源链,见 docs/prompts/道劫_底座节点_0918.md):
  链A=docs/prompts/道劫_新提示词包_0917.md §一 通用无型底座(修手图 [12]
  唯一持有,本测试零触碰);链B=my_nodes/nodes/daojie_bases.json 九型底座
  (↔0918 md 围栏↔道劫图 [80] 三方互锁)。09-18 v2.2 定性切换后两链独立:
  链A 旧口径历史锁定,链B=现代游戏资产新口径,人物型 §一 超集解除。
  纯读文件断言,零网络零引擎依赖。
"""
from __future__ import annotations

import json
import pathlib
import re

# ── 真文件定位(tests/ 同级 workflows 真源;md 为提示词真源) ────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根
DAOJIE_JSON = (
    _TESTS_DIR.parent / "workflows" / "1_图片" / "K2图像" / "1_文生图"
    / "MY-K2_文生图_道劫.json"
)
PROMPT_MD = _REPO / "docs" / "prompts" / "道劫_新提示词包_0917.md"
BASES_MD = _REPO / "docs" / "prompts" / "道劫_底座节点_0918.md"
BASES_JSON = _TESTS_DIR.parent / "my_nodes" / "nodes" / "daojie_bases.json"

_RAW_TEXT = DAOJIE_JSON.read_text(encoding="utf-8")
_DOC = json.loads(_RAW_TEXT)
_NODES = {n["id"]: n for n in _DOC["nodes"]}
_LINKS = {l[0]: l for l in _DOC["links"]}  # litegraph: [id, src, src_slot, dst, dst_slot, type]

# 九型底座机器真源(与 0918 md 围栏逐字互锁,见 TestDaojieBasesSources)
DAOJIE_BASES = json.loads(BASES_JSON.read_text(encoding="utf-8"))
BASES_BY_NAME = {e["zh"]: e for e in DAOJIE_BASES}
OPTIONS_ORDER = [e["zh"] for e in DAOJIE_BASES]


def _md_fence(md_path: pathlib.Path, heading_prefix: str) -> str:
    """md 指定标题之后第一个 ```text 围栏的逐字内容(与制作脚本同法)。"""
    lines = md_path.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith(heading_prefix))
    j = next(k for k in range(start, len(lines)) if lines[k].startswith("```text"))
    end = next(k for k in range(j + 1, len(lines)) if lines[k].startswith("```"))
    return "\n".join(lines[j + 1:end])


MD_BASE = _md_fence(PROMPT_MD, "## 一、")      # 通用无型底座(线描硬锁)
MD_NEG = _md_fence(PROMPT_MD, "## 四、")       # Negative 基线
MD_FORMULA = _md_fence(PROMPT_MD, "## 二、")   # 七段公式
MD_EXAMPLE = _md_fence(PROMPT_MD, "### 填好示例")
MD_SCENE = _md_fence(PROMPT_MD, "## 三、")     # 山水场景模板

# 人物型=§一 结构性超集的运行时锚:尾段+去尾主干(零硬编码关系锁)
MD_TAIL = "仙道古韵，气韵深远，完成度高的画作。"
MD_HEAD = MD_BASE[: -len(MD_TAIL)]

# 脏词禁入(§六纪律 2 + 任务书门禁口径)
DIRTY_WORDS = ("宣纸", "工笔线描", "工笔白描", "写意泼墨", "xuan")  # 风格锚:两侧都禁
POSITIVE_DIRTY = ("做旧", "泛黄", "纸纹")  # 纸纹脏污族:正向禁;负向列它们=合法内容
# 模型链完整链序(21 起点至 12 采样器;旁路件靠 mode=4 穿透)
MODEL_CHAIN = [21, 19, 46, 67, 68, 69, 73, 76, 77, 78, 12]  # 09-18 摘47加速件+摘44/45/74/75破限件+摘79风格参照半套件+摘70复古漫(改连环画提示词路线,紫调日系件让位;用户裁定)
# 09-17 用户令拷入73鎏金;09-18 全量扩架 +74-79(在库 16 件 K2 LoRA 全展示)

# 多格同人型负向黑名单(09-18 评审问题1 处置:系统性防复犯)
MULTI_PANEL_OPTIONS = ("三视图", "表情差分")
CLONE_TOKENS = (
    "cloned", "duplicated", "multiple people",
    "extra characters", "person", "human figure",
)
_CJK = re.compile(r"[\u4e00-\u9fff]")
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b")


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
        assert _DOC["last_node_id"] == 80 == max(n["id"] for n in _DOC["nodes"])
        assert _DOC["last_link_id"] == 55 == max(l[0] for l in _DOC["links"])

    def test_node_count_26(self):
        # 34(09-18 扩架后)−[71]−[72]+[80]−[47]−[44/45/74/75]−[79]−[70] = 26(09-18 底座节点化+摘加速/破限/风格参照半套件+摘70复古漫=改连环画提示词路线,紫调日系件让位)
        assert len(_DOC["nodes"]) == 26
        assert len(_NODES) == 26

    def test_link_ids_unique(self):
        # 09-17 复审修复:超集模板带来的重复 link id 42 已去重;显式数重复,
        # 防 dict 按 id 折叠后测不出(畸形序列化)
        ids = [l[0] for l in _DOC["links"]]
        assert len(ids) == len(set(ids)) == 26, \
            f"links 应 26 条且 id 唯一,实为 {len(ids)} 条/{len(set(ids))} id"
        assert len(_LINKS) == len(_DOC["links"]), "_LINKS 折叠数与原文不符(存在重复 id)"

    def test_lora_stack_full_inventory(self):
        """09-18 全量扩架:在库 16 件 K2 LoRA 全部展示;同日摘 47 加速件+摘
        破限/尺度件 44/45/74/75+摘 79 风格参照半套件(道劫流内无参考图编码
        通道,单独激活无效;完整用法在 MY-K2-文生图_风格参照.json)+摘 70
        复古漫(改连环画提示词路线,紫调日系件让位)→9 件。
        lora_name 不重复、新增 3 件默认旁路(mode=4)×1.0。既有件开关=用户画布自由,契约不锁。"""
        loras = [n for n in _DOC["nodes"] if n["type"] == "LoraLoaderModelOnly"]
        names = [(n["widgets_values_named"] or {}).get("lora_name") for n in loras]
        assert len(loras) == 9, f"LoRA 节点应 9 件,实际 {len(loras)}"
        assert len(set(names)) == 9, f"lora_name 重复: {names}"
        expect_new = {
            76: "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors",
            77: "Krea2-画风/Krea2-美学Masterpiece_v51.safetensors",
            78: "Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors",
        }
        for nid, fname in expect_new.items():
            n = _node(nid)
            named = n["widgets_values_named"]
            assert named["lora_name"] == fname, f"[{nid}] lora_name 应为 {fname}"
            assert n["mode"] == 4, f"[{nid}] 新增件应默认旁路"
            assert named["strength_model"] == 1.0, f"[{nid}] 默认强度应为 1.0"
            assert n["widgets_values"] == [fname, 1.0], f"[{nid}] named/positional 恒等"

    def test_no_my_styles_library_anywhere(self):
        for n in _DOC["nodes"]:
            assert n["type"] != "MyStylesLibrary", f"节点 {n['id']} 仍是风格库"
        assert "MyStylesLibrary" not in _RAW_TEXT, "文件仍残留 MyStylesLibrary 字样"


# ── 2. 底座节点 [80] / 负向 [64] 与真源逐字相等 ─────────────────────

class TestPromptSources:
    def test_node80_base_node_signature(self):
        """[80]=MyDaojieBase(九型底座节点):widget 恒单条 [型名],标题钉
        「勿手改」;inputs 仅两 forceInput 槽(positive/negative),无文本
        widget 槽。"""
        n = _node(80)
        assert n["type"] == "MyDaojieBase"
        assert n["widgets_values"] == ["人物"], "[80] widget 应恒单条 [型名]"
        assert n.get("widgets_values_named") in (None, {"base": "人物"})
        assert "勿手改" in (n.get("title") or "")
        ins = {i["name"]: i for i in n["inputs"]}
        assert set(ins) == {"positive", "negative"}, "[80] 输入槽应仅 positive/negative"
        assert all(not i.get("widget") for i in n["inputs"]), "[80] 不得带文本 widget 槽"

    def test_node80_widget_default_renwu(self):
        # 默认型=人物(节点 DEFAULT_BASE 钉死,图上初值同锚)
        assert _node(80)["widgets_values"][0] == "人物"

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

    def test_retired_nodes_and_links_gone(self):
        # 09-18 底座节点化:[71]/[72] 与其旧线 43/44 不得回潮
        assert 71 not in _NODES and 72 not in _NODES, "旧 [71]/[72] 节点残留"
        assert 43 not in _LINKS and 44 not in _LINKS, "旧线 43/44 残留"
        for l in _DOC["links"]:
            assert 71 not in (l[1], l[3]) and 72 not in (l[1], l[3]), \
                f"线 {l[0]} 仍连着已摘除的节点 71/72"
        # 09-18 摘 70 复古漫(改连环画提示词路线,紫调日系件让位):节点/旧线 41 不得回潮
        assert 70 not in _NODES, "[70] 复古漫残留(已摘,连环画走提示词不占画风件位)"
        assert 41 not in _LINKS, "旧线 41(69→70)残留"
        for l in _DOC["links"]:
            assert 70 not in (l[1], l[3]), f"线 {l[0]} 仍连着已摘除的节点 70"


# ── 3. 九型底座库卫生(脏词/半角标点/禁句式/禁色号,全 9 条 positive)──

class TestBasesHygiene:
    def test_positive_fullwidth_punctuation(self):
        for e in DAOJIE_BASES:
            for ch in ",;:!?()":
                assert ch not in e["positive"], \
                    f"底座「{e['zh']}」positive 含半角标点 {ch!r}(纪律 4:中文+全角标点)"

    def test_positive_no_dirty_words(self):
        for e in DAOJIE_BASES:
            low = e["positive"].lower()
            for w in DIRTY_WORDS:
                assert w not in low, f"底座「{e['zh']}」positive 含脏词 {w!r}"
        for e in DAOJIE_BASES:
            low = e["positive"].lower()
            for w in POSITIVE_DIRTY:
                assert w not in low, f"底座「{e['zh']}」positive 含脏词 {w!r}"
        low64 = MD_NEG.lower()
        for w in DIRTY_WORDS:
            assert w not in low64, f"[64] 负向含风格锚脏词 {w!r}"

    def test_positive_no_prohibition_phrasing(self):
        # 提示词为正向描述文体,禁令式措辞(不要/禁止/严禁)属污染
        for e in DAOJIE_BASES:
            for w in ("不要", "禁止", "严禁", "避免", "而非"):
                assert w not in e["positive"], \
                    f"底座「{e['zh']}」positive 含禁句式 {w!r}"

    def test_positive_no_hex_colors(self):
        for e in DAOJIE_BASES:
            assert not _HEX_COLOR.search(e["positive"]), \
                f"底座「{e['zh']}」positive 含十六进制色号(色彩职责在色名不在色号)"


# ── 4. 装配链拓扑([50]→[80].positive / [80] 出→51 与 62;负向 64→65 直通)──

class TestAssemblyChain:
    def test_link_55_subject_into_base_positive(self):
        assert _LINKS[55] == [55, 50, 0, 80, 0, "STRING"]
        assert _node(80)["inputs"][0]["name"] == "positive"
        assert _node(80)["inputs"][0]["link"] == 55

    def test_link_45_base_out_to_clip_positive(self):
        assert _LINKS[45] == [45, 80, 0, 51, 1, "STRING"]
        assert _node(51)["inputs"][1]["name"] == "text"
        assert _node(51)["inputs"][1]["link"] == 45

    def test_link_46_base_out_to_preview(self):
        assert _LINKS[46] == [46, 80, 0, 62, 0, "*"]
        assert _node(62)["inputs"][0]["link"] == 46
        assert "最终正向预览" in (_node(62).get("title") or "")

    def test_link_47_negative_direct_to_clip_negative(self):
        # 负向直通不变:[64] 输出直接接 [65].text;[80].negative 默认不接线
        # (维持道劫默认图负向现状,速度档 cfg1 下负向不参与采样)
        assert _LINKS[47] == [47, 64, 0, 65, 1, "STRING"]
        assert _node(65)["inputs"][1]["name"] == "text"
        assert _node(65)["inputs"][1]["link"] == 47
        # 全图不存在任何进/出 [60] 的线(已摘)
        for l in _DOC["links"]:
            assert 60 not in (l[1], l[3]), f"线 {l[0]} 仍连着已摘除的节点 60"

    def test_node80_negative_slot_unwired_by_default(self):
        ins = {i["name"]: i for i in _node(80)["inputs"]}
        assert ins["negative"]["link"] is None, \
            "[80].negative 默认不接线(手动接负向编码时按型英文负面才生效)"

    def test_node80_signature_follows_object_info(self):
        # object_info 实测形态:required=[base],optional positive/negative 均
        # forceInput → widgets_values 恒单条 [型名](无文本 widget 值混入)
        n = _node(80)
        assert n["type"] == "MyDaojieBase"
        assert n["widgets_values"] == ["人物"]
        assert all(not i.get("widget") for i in n["inputs"])


# ── 5. 九型底座真源互锁(json ↔ 0918 md ↔ 图 [80])────────────────

class TestDaojieBasesSources:
    def test_options_are_nine_in_design_order(self):
        assert OPTIONS_ORDER == [
            "人物", "场景", "道具", "美宣", "三视图",
            "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"], \
            "九型顺序=设计定序(json 条目序),不得重排"

    def test_json_positive_matches_0918_fences(self):
        for name, entry in BASES_BY_NAME.items():
            fence = _md_fence(BASES_MD, f"## {name}")
            assert entry["positive"] == fence, \
                f"底座「{name}」positive 与 0918 md 围栏不逐字相等(唯一双写对,兜底即此)"

    def test_renwu_new_framing_after_v22_switch(self):
        """09-18 v2.2 定性切换:人物型 §一 超集解除——§一 自带 SD 标签串与
        旧「水墨国风」定性,与新口径互斥;人物以现代游戏资产定性句开头,旧
        §一 主干/尾句零回潮,人物共性增量仍在场(防回退锚)。"""
        renwu = BASES_BY_NAME["人物"]["positive"]
        assert renwu.startswith("现代修仙游戏的角色立绘资产"), \
            "人物型必须以 v2.2 定性句开头(现代游戏资产载体)"
        assert not renwu.startswith(MD_HEAD), "人物型回潮旧 §一 主干开头"
        assert not renwu.endswith(MD_TAIL), "人物型回潮旧 §一 尾句收尾"
        for kw in ("单人立像", "六成", "两至四条"):
            assert kw in renwu, f"人物型增量段缺共性关键词 {kw}"

    def test_positives_carry_no_old_framing_anchors(self):
        """09-18 v2.2 已废锚九型全禁:SD 质量标签串、旧「水墨国风」基底定
        性、「新中式」裸词(仅内部工作分类词,不入提示词正文)。"""
        for e in DAOJIE_BASES:
            low = e["positive"].lower()
            for w in ("最佳质量", "杰作", "高细节", "水墨国风", "新中式",
                      "masterpiece", "best quality", "high detail"):
                assert w not in low, f"底座「{e['zh']}」positive 残留旧锚 {w!r}"

    def test_multi_panel_negative_clone_blacklist(self):
        """多格同人型(三视图/表情差分)负向禁 clone/多人类 token——多格同
        人合法,此类 token 会压制合法分格(09-18 评审问题1 门禁)。"""
        for name in MULTI_PANEL_OPTIONS:
            neg = BASES_BY_NAME[name]["negative"].lower()
            for tok in CLONE_TOKENS:
                assert tok not in neg, \
                    f"多格同人型「{name}」负向含禁用 token {tok!r}"

    def test_all_negatives_english_comma_tokens(self):
        for name, entry in BASES_BY_NAME.items():
            assert not _CJK.search(entry["negative"]), \
                f"底座「{name}」negative 残留中文(应为英文逗号 token 形态)"


# ── 6. 模型链完整与 mode 矩阵(照超集口径原样继承)────────────────

class TestModelChain:
    def test_chain_contiguous(self):
        for src, dst in zip(MODEL_CHAIN, MODEL_CHAIN[1:]):
            assert _link_between(src, dst), f"模型链断在 {src}→{dst}"

    def test_chain_modes(self):
        # 09-17 用户超集快照对齐:46/69 旁路,68/70/73 三开,19 旁路,67 激活
        # 09-18 摘 47 加速件+44/45/74/75 破限件后激活集=67/68/70/73;
        # 同日再摘 70 复古漫(改连环画提示词路线,紫调日系件让位)→激活集=67/68/73
        for nid in (46, 19, 69):
            assert _node(nid).get("mode") == 4, f"[{nid}] 应旁路(mode=4)"
        for nid in (67, 68, 73):
            assert _node(nid).get("mode", 0) == 0, f"[{nid}] 应激活(mode=0)"

    def test_sampler_speed_profile_inherited(self):
        w = _node(12)["widgets_values"]
        assert _node(12)["type"] == "KSampler"
        assert w[2] == 8 and w[3] == 1.0, "采样参数应与超集一致(8步/cfg1 速度档,09-18 摘47后4步→8步)"


# ── 7. 链接双向一致(无悬空) ───────────────────────────────────────

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


# ── 8. 保存前缀与 [66] 用法速查卡(道劫七要件) ──────────────────────

class TestOutputAndCard:
    def test_node4_prefix(self):
        n = _node(4)
        assert n["widgets_values"] == ["K2道劫文生图_"]
        assert n["widgets_values_named"]["filename_prefix"] == "K2道劫文生图_"

    def test_card_contains_formula_and_example(self):
        text = _card_text(66)
        assert "[50]" in text and "[80]" in text, "卡缺①正向=只写主体句/底座自动携带口径"
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
        assert "速度档=默认" in text and "8步/cfg1" in text, "卡缺⑥速度档口径"
        assert "质量档=手调12步/cfg5" in text and "约500秒" in text, "卡缺⑥质量档口径"

    def test_card_contains_lora_matrix(self):
        text = _card_text(66)
        assert "[67]" in text and "默认激活" in text, "卡缺⑦[67]默认开口径"
        assert "一次只开一枚" in text, "卡缺⑦68/69 互斥口径"
        for nid in (68, 69):
            assert f"[{nid}]" in text


# ── 9. 画布纪律与布局 ──────────────────────────────────────────────

class TestCanvasDiscipline:
    def test_no_fullwidth_label_banner(self):
        # 09-15 裁定:画布禁大标题横幅——不新增整幅 Label/标题节点,说明一律进 [66] 卡
        for n in _DOC["nodes"]:
            assert n["type"] not in ("Label", "easy label", "Note (rgthree)"), \
                f"节点 {n['id']} 是禁用的标题横幅件"

    def test_group4_covers_prompt_chain(self):
        g4 = next(g for g in _DOC["groups"] if g["title"].startswith("④"))
        assert g4["title"] == "④ 提示词链(主体句+道劫底座节点→编码→12带)"
        bx, by, bw, bh = g4["bounding"]
        for nid in (50, 64, 80, 51, 65, 62):
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
