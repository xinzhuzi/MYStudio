"""道劫九型底座·数据面契约测试(09-17 制作,09-18 底座节点化改版,同日二次收缩)。

09-18 收缩背景:早间用户裁定 MY- 静态工作流库清退,真源文件(旧名
    MY-K2_文生图_道劫.json)一度删除(tar 备份+git 历史双路可恢复);同日晚间
裁定改为全库改名保留——MY- 前缀废弃,51 件去前缀+下划线转连字符,该件现名
    engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json(在库)。
本测试维持「九型底座数据面契约」口径不变——唯一被测
对象链B = my_nodes/nodes/daojie_bases.json(运行时节点数据,MyDaojieBase
消费)↔ docs/prompts/道劫_底座节点_0918.md 围栏,逐字互锁;链A =
docs/prompts/道劫_新提示词包_0917.md(修手图 [12] 唯一持有)历史口径锚。

随工作流文件退役的用例(拓扑/装配链/模型链/链接双向一致/输出卡/画布纪律,
09-18 前版本见 git 历史与 tar 备份):TestTopology / TestPromptSources /
TestAssemblyChain / TestModelChain / TestLinkIntegrity / TestOutputAndCard /
TestCanvasDiscipline。

纯读文件断言,零网络零引擎依赖。
"""
from __future__ import annotations

import json
import pathlib
import re

# ── 真源定位(md 为提示词真源,json 为运行时节点数据) ──────────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根
PROMPT_MD = _REPO / "docs" / "prompts" / "道劫_新提示词包_0917.md"
BASES_MD = _REPO / "docs" / "prompts" / "道劫_底座节点_0918.md"
BASES_JSON = _TESTS_DIR.parent / "my_nodes" / "nodes" / "daojie_bases.json"

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

# 人物型=§一 结构性超集的运行时锚:尾段+去尾主干(零硬编码关系锁)
MD_TAIL = "仙道古韵，气韵深远，完成度高的画作。"
MD_HEAD = MD_BASE[: -len(MD_TAIL)]

# 脏词禁入(§六纪律 2 + 任务书门禁口径)
DIRTY_WORDS = ("宣纸", "工笔线描", "工笔白描", "写意泼墨", "xuan")  # 风格锚:两侧都禁
POSITIVE_DIRTY = ("做旧", "泛黄", "纸纹")  # 纸纹脏污族:正向禁;负向列它们=合法内容

# 多格同人型负向黑名单(09-18 评审问题1 处置:系统性防复犯)
MULTI_PANEL_OPTIONS = ("三视图", "表情差分")
CLONE_TOKENS = (
    "cloned", "duplicated", "multiple people",
    "extra characters", "person", "human figure",
)
_CJK = re.compile(r"[\u4e00-\u9fff]")
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b")


# ── 1. 九型底座库卫生(脏词/半角标点/禁句式/禁色号,全 9 条 positive)──

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


# ── 2. 九型底座真源互锁(json ↔ 0918 md 围栏)──────────────────────

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
        """09-22 v5 纯画法口径:底座零物象词,人物型以主体立绘构图句开幅,
        句首定性句「现代修仙游戏的××资产」禁回潮;旧 §一 主干/尾句零回潮,
        v5 画法关键词在场且物象词零残留(防回退锚,与 my_nodes/tests 同口径)。"""
        renwu = BASES_BY_NAME["人物"]["positive"]
        assert renwu.startswith("主体的单人立绘"), \
            "人物型必须以主体立绘构图句开幅(v5 纯画法口径)"
        assert not renwu.startswith("现代修仙"), "人物型回潮 v2.2 句首定性句"
        assert not renwu.startswith(MD_HEAD), "人物型回潮旧 §一 主干开头"
        assert not renwu.endswith(MD_TAIL), "人物型回潮旧 §一 尾句收尾"
        for kw in ("单人立绘", "全身入画", "细墨线勾勒", "线有粗细变化"):
            assert kw in renwu, f"人物型缺 v5 画法关键词 {kw}"
        for bad in ("骨相", "眉眼", "发丝", "衣褶"):
            assert bad not in renwu, f"人物型残留物象词 {bad}(v5 底座禁具体画面)"

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
