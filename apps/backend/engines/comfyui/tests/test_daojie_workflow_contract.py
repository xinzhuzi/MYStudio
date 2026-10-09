"""道劫九型底座·数据面契约测试(09-17 制作,09-18 底座节点化改版,同日二次收缩)。

09-18 收缩背景:早间用户裁定 MY- 静态工作流库清退,真源文件(旧名
    MY-K2_文生图_道劫.json)一度删除(tar 备份+git 历史双路可恢复);同日晚间
裁定改为全库改名保留——MY- 前缀废弃,51 件去前缀+下划线转连字符,该件现名
    engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json(在库)。
1004 Phase A 起数据层正负拆开:daojie_bases.json 退役删件,九型 canon=
qi21_bases.json types 前 9(字段 positive/negative→positive_text/
negative_text,负面中文化);旧「json↔0918 md 围栏逐字互锁」随数据瘦身
废止(0918 md 降级设计记录,同 05 库 A4 头部声明口径),改锁 1004 结构锚
(人物系统一立绘底座/正向零禁令句/中文负面基线词);链A =
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
# 1004 Phase A:daojie_bases.json 退役删件(字段合并进 qi21_bases.json 集中地);
# 九型 canon=qi21_bases.json types 前 9 条(末位第 10 条=「自由」不入 canon);
# 字段 positive/negative → positive_text/negative_text(1004 正负拆开,负面中文化)
BASES_JSON = _TESTS_DIR.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"  # 1005 Step4:产品侧退役,直读真源家

# 九型底座机器真源(1004 前=旧 daojie_bases.json 与 0918 md 围栏逐字互锁;1004
# 正负拆开瘦身后 0918 md 降级设计记录,逐字互锁废止——数据面锚见 TestDaojieBasesSources)
DAOJIE_BASES = json.loads(BASES_JSON.read_text(encoding="utf-8"))["types"][:9]
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

# 脏词禁入(§六纪律 2 + 任务书门禁口径;1004 口径修正:数据=全本底座,0925
# 四令多彩轮文案「宣纸白只作局部透气位」=合法色彩描述在场——禁裸风格词
# 「宣纸」废止,精准锚 工笔线描/工笔白描/写意泼墨/xuan 保持两侧都禁)
DIRTY_WORDS = ("工笔线描", "工笔白描", "写意泼墨", "xuan")
POSITIVE_DIRTY = ("做旧", "泛黄", "纸纹")  # 纸纹脏污族:正向禁;负向列它们=合法内容

# 多格同人型负向黑名单(09-18 评审问题1 处置:系统性防复犯)
MULTI_PANEL_OPTIONS = ("人物多视图", "表情差分")  # 0927 改名轮:三视图→多视图
# 09-24 债清算(全仓套件唯一容红清零):裸词 "duplicated" 退役——81ab725
# 裁定21 六形态定界把「duplicated view, identical pose repeated」定为三视图
# 负向有意文案(守护格子间视角/姿势差异化),与 09-18 立黑名单所防的「克隆
# token 压制合法分格」语义反向;底座 v5.1 冻结一字不动(09-23 用户裁定),
# 09-22 挂账「三视图 negative 克隆 token 待裁」就此在测试侧裁。其余五 token
# 与冻结文案零冲突,防复犯门禁保留,故不整函数退休。
CLONE_TOKENS = (
    "cloned", "multiple people",
    "extra characters", "person", "human figure",
)
_CJK = re.compile(r"[\u4e00-\u9fff]")
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b")


# ── 1. 九型底座库卫生(脏词/半角标点/禁句式/禁色号,全 9 条 positive)──

class TestBasesHygiene:
    def test_positive_fullwidth_punctuation(self):
        # 1004:多彩配色行(「…多彩=…(记法)」)半角括号=配色职责行记法,豁免;
        # 正文行半角标点仍禁(纪律 4:中文+全角标点)
        for e in DAOJIE_BASES:
            body_lines = [ln for ln in e["positive_text"].split("\n")
                          if "多彩=" not in ln]
            for ch in ",;:!?()":
                assert all(ch not in ln for ln in body_lines), \
                    f"底座「{e['zh']}」positive 正文含半角标点 {ch!r}(纪律 4:中文+全角标点)"

    def test_positive_no_dirty_words(self):
        for e in DAOJIE_BASES:
            low = e["positive_text"].lower()
            for w in DIRTY_WORDS:
                assert w not in low, f"底座「{e['zh']}」positive 含脏词 {w!r}"
        for e in DAOJIE_BASES:
            low = e["positive_text"].lower()
            for w in POSITIVE_DIRTY:
                assert w not in low, f"底座「{e['zh']}」positive 含脏词 {w!r}"
        low64 = MD_NEG.lower()
        for w in DIRTY_WORDS:
            assert w not in low64, f"[64] 负向含风格锚脏词 {w!r}"

    def test_positive_no_prohibition_phrasing(self):
        # 提示词为正向描述文体,禁令式措辞(不要/禁止/严禁)属污染;1004 正负
        # 拆开后禁令句应全部住在 negative_text(正向残留即红);「而非」废止
        # (0925 四令「受控饱和而非一律低饱和」=对比修辞,合法在场)
        for e in DAOJIE_BASES:
            for w in ("不要", "禁止", "严禁", "避免"):
                assert w not in e["positive_text"], \
                    f"底座「{e['zh']}」positive 含禁句式 {w!r}(1004 正负拆开:禁令住负面)"

    def test_positive_no_hex_colors(self):
        for e in DAOJIE_BASES:
            assert not _HEX_COLOR.search(e["positive_text"]), \
                f"底座「{e['zh']}」positive 含十六进制色号(色彩职责在色名不在色号)"


# ── 2. 九型底座真源互锁(json ↔ 0918 md 围栏)──────────────────────

class TestDaojieBasesSources:
    def test_options_are_nine_in_design_order(self):
        assert OPTIONS_ORDER == [
            "人物", "场景", "道具", "美宣", "人物多视图",
            "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"], \
            "九型顺序=设计定序(json 条目序),不得重排"

    def test_json_positive_matches_0918_fences(self):
        """1004 Phase A 废止注记:旧 daojie_bases.json positive 与 0918 md 围栏
        逐字互锁(唯一双写对)——1004 正负拆开+统一立绘底座重写后数据瘦身,
        0918 md 降级设计记录(05 库头部声明同款口径),逐字互锁废止;改锁
        1004 结构锚:人物系=「主体的单人立绘」底座开头(design §一 钦定),
        道具型=定式句保留,场景/概念=空镜/气氛开幅。1008 S3 三型差异化重锚:
        分镜剧情图退出统一立绘锁(4fa15e9 素材+㉗ 重写=单格叙事帧开头,叙事
        画面取景自由、可多人;断言分层职责,不冻结 1004 压平旧文案——与
        test_qwen21_workflow_contract.py:3143 同口径)。"""
        renwu_xi = {"人物", "美宣", "人物多视图", "高清人脸", "表情差分"}
        for name, entry in BASES_BY_NAME.items():
            pt = entry["positive_text"]
            # 1008 用户令:三透明型改各设定图开头(单人立绘=多视图自相矛盾,硬伤清退)
            _OPEN = {"人物多视图": "同一角色的四视图设定图", "高清人脸": "同一角色的面部特写素材",
                     "表情差分": "同一角色的九格表情对比表"}
            if name in _OPEN:
                assert pt.startswith(_OPEN[name]), \
                    f"底座「{name}」应={_OPEN[name]}开头(1008 用户令),得 {pt[:12]!r}"
            elif name in renwu_xi:
                assert pt.startswith("主体的单人立绘"), \
                    f"底座「{name}」应=立绘底座开头(1004 design §一),得 {pt[:12]!r}"
            elif name == "分镜剧情图":
                assert pt.startswith("一幅单格叙事画面"), \
                    f"底座「分镜剧情图」应=单格叙事帧开头(1008 S3 三型差异化),得 {pt[:12]!r}"
                assert "头身比" not in pt, \
                    "底座「分镜剧情图」不锚头身比(1002 ㉒ 型格差异;1008 S3 随差异化恢复)"
            elif name == "道具":
                assert "器物设定图" in pt, "底座「道具」定式句随 1008 用户令去文字化(标注系统退役)"
            elif name == "场景":
                assert pt.startswith("空镜场景"), f"底座「场景」应以空镜开幅,得 {pt[:6]!r}"
            elif name == "概念气氛图":
                assert "气氛" in pt[:30], f"底座「概念气氛图」应气氛开幅,得 {pt[:30]!r}"
            assert "```" not in pt and pt.strip(), f"底座「{name}」positive_text 应为净文本"

    def test_renwu_new_framing_after_v22_switch(self):
        """09-22 v5 纯画法口径:底座零物象词,人物型以主体立绘构图句开幅,
        句首定性句「现代修仙游戏的××资产」禁回潮;旧 §一 主干/尾句零回潮,
        v5 画法关键词在场且物象词零残留(防回退锚,与 my_nodes/tests 同口径)。"""
        renwu = BASES_BY_NAME["人物"]["positive_text"]
        assert renwu.startswith("主体的单人立绘"), \
            "人物型必须以主体立绘构图句开幅(v5 纯画法口径)"
        assert not renwu.startswith("现代修仙"), "人物型回潮 v2.2 句首定性句"
        assert not renwu.startswith(MD_HEAD), "人物型回潮旧 §一 主干开头"
        assert not renwu.endswith(MD_TAIL), "人物型回潮旧 §一 尾句收尾"
        for kw in ("单人立绘", "全身入画", "细彩线勾勒", "线随结构时粗时细"):
            assert kw in renwu, f"人物型缺 v5 画法关键词 {kw}(1004 统一底座措辞)"
        # 物象词禁令域=首行画法行(1004 统一底座含 四锁段截短版=衣褶/衣物/
        # 头发/鞋靴 段头自带物象名=合法;与 qwen21 契约 split("\n")[0] 同口径)
        for bad in ("骨相", "眉眼", "发丝"):
            assert bad not in renwu.split("\n")[0], \
                f"人物型首行残留物象词 {bad}(v5 底座禁具体画面)"

    def test_positives_carry_no_old_framing_anchors(self):
        """09-18 v2.2 已废锚九型全禁:SD 质量标签串、旧「水墨国风」基底定
        性、「新中式」裸词(仅内部工作分类词,不入提示词正文)。"""
        for e in DAOJIE_BASES:
            low = e["positive_text"].lower()
            for w in ("最佳质量", "杰作", "高细节", "水墨国风", "新中式",
                      "masterpiece", "best quality", "high detail"):
                assert w not in low, f"底座「{e['zh']}」positive 残留旧锚 {w!r}"

    def test_multi_panel_negative_clone_blacklist(self):
        """多格同人型(多视图/表情差分)负向禁 clone/多人类 token——多格同
        人合法,此类 token 会压制合法分格(09-18 评审问题1 门禁)。
        09-24 债清算注记:裸词 duplicated 已退役(裁定21 冻结文案含
        duplicated view,语义反向误伤,详见 CLONE_TOKENS 注);守护对象仍
        活,本门禁不退休。"""
        for name in MULTI_PANEL_OPTIONS:
            neg = BASES_BY_NAME[name]["negative_text"].lower()
            for tok in CLONE_TOKENS:
                assert tok not in neg, \
                    f"多格同人型「{name}」负向含禁用 token {tok!r}"

    def test_all_negatives_english_comma_tokens(self):
        """1004 中文负面役:负面词全面中文化(旧英文逗号 token 形态退役)——
        负面=中文全角逗号清单;基线四词(模糊/水印/多手指/文字错误)九型在场;
        旧英文 token 零残留。"""
        for name, entry in BASES_BY_NAME.items():
            neg = entry["negative_text"]
            assert _CJK.search(neg), \
                f"底座「{name}」negative 应为中文负面清单(1004 中文负面役),得 {neg[:20]!r}"
            for base_w in ("模糊", "水印", "多手指", "文字错误"):
                assert base_w in neg, \
                    f"底座「{name}」negative 缺基线负面词 {base_w!r}(1004 基线)"
            for en in ("blurry", "watermark", "low quality", "worst quality"):
                assert en not in neg.lower(), \
                    f"底座「{name}」negative 残留旧英文 token {en!r}"
