# -*- coding: utf-8 -*-
"""测试锚:道劫提示词冲突扫描器。

规格来源:.trellis/tasks/10-18-daojie-prompt-conflict-cleanup/design.md §7(D15/D16);
步骤来源:同任务 implement.md Task T1 Step 1。

Case 设定(tmp 目录 3 个 md):
  - current.md       现行区命中 1(浓墨或焦墨 → 规则 ink_line / C20)
  - history.md       「## 历史口径」小节内命中 1(不计)
  - annotated.md     带「旧口径」标注行命中 1(不计)
断言:只报 1 条且 exit 2;空命中 exit 0。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import daojie_prompt_conflict_scan as scanner  # noqa: E402


CURRENT_MD = "# 手册\n\n线条用浓墨或焦墨勾勒。\n"
HISTORY_MD = (
    "# 手册\n"
    "\n"
    "正文现行区,无命中。\n"
    "\n"
    "## 历史口径(1018 前)\n"
    "\n"
    "(原 :3)线条用浓墨或焦墨——被 1018 动漫底座裁定取代。\n"
    "\n"
    "## 后续小节\n"
    "\n"
    "正文。\n"
)
ANNOTATED_MD = "# 手册\n\n旧口径:线条用浓墨或焦墨。\n"


def test_only_current_zone_hit_counts(tmp_path, capsys):
    (tmp_path / "current.md").write_text(CURRENT_MD, encoding="utf-8")
    (tmp_path / "history.md").write_text(HISTORY_MD, encoding="utf-8")
    (tmp_path / "annotated.md").write_text(ANNOTATED_MD, encoding="utf-8")

    rc = scanner.main(["--json", str(tmp_path)])

    assert rc == 2, "有现行区命中时 exit code 必须为 2"
    payload = json.loads(capsys.readouterr().out)
    assert payload["summary"]["total"] == 1, "历史小节与旧口径标注行命中不得计入"
    hit = payload["hits"][0]
    assert hit["file"].endswith("current.md")
    assert hit["line"] == 3
    assert hit["rule"] == "ink_line"
    assert "C20" in hit["c_ids"]


def test_zero_hits_exit_zero(tmp_path, capsys):
    (tmp_path / "clean.md").write_text(
        "# 干净手册\n\n线条随主体配色与材质从色卡选取协调彩线色。\n", encoding="utf-8"
    )

    rc = scanner.main(["--json", str(tmp_path)])

    assert rc == 0, "零命中时 exit code 必须为 0"
    payload = json.loads(capsys.readouterr().out)
    assert payload["summary"]["total"] == 0


def test_tag_flag_only_annotates_output(tmp_path, capsys):
    (tmp_path / "current.md").write_text(CURRENT_MD, encoding="utf-8")

    rc = scanner.main(["--json", "--tag", "T1-baseline", str(tmp_path)])

    assert rc == 2
    payload = json.loads(capsys.readouterr().out)
    assert payload["meta"]["tag"] == "T1-baseline"
    assert payload["summary"]["total"] == 1, "--tag 不得改变命中行为"


# ---------- 行级白名单·稳健模式(槽名/台账行正则;P1 手术员上报,L1 收口) ----------

CONTRACT_TEST_REL = (
    "apps/backend/comfyui/tests/test_qwen21_workflow_contract.py"
)

# 契约测试实文摘录(P1 报 38 命中的机器槽名/台账/日期锚行)。
SLOT_NAME_CODE = '        for inp_name, host_slot, dst_slot in (("九型WIDTH", 2, 0), ("九型HEIGHT", 3, 1)):\n'
TOKEN_PIN_CODE = '        for token in ("装配子图", "MyQi21DaojieBase", "九型", "空镜无人",\n'
MIGRATION_LEDGER = "# canon 口径改读 qi21_bases.json types 前 10 条(1015 设定卡入列九型→十型;末位「自由」不入 canon)。\n"
SLOT_SHORT_NARRATION = "        [4018].width/height(画幅规则后终值);[4018] 吃 [6] 宿主两出口:九型W/H\n"
RETIRED_LEDGER = "        ——九型=按型 rgba_default 自动,[210] 三态件退役,i2i 侧三态锚零动);\n"
DOCSTRING_DNA_LEDGER = "     英文长文;DNA:ink wash/expressive brushwork/expansive negative space/\n"


def test_machine_slot_name_identifier_whitelisted(tmp_path, capsys):
    """九型WIDTH/九型HEIGHT 是 MyQi21WhSuggest API 输入槽名(机器标识符),不计。"""
    (tmp_path / "subgraph.json").write_text(
        '{\n  "九型WIDTH": 0,\n  "九型HEIGHT": 0\n}\n', encoding="utf-8"
    )

    rc = scanner.main(["--json", str(tmp_path)])

    assert rc == 0, "机器槽名行不得计入命中"


def test_contract_test_ledger_lines_whitelisted():
    """契约测试的台账/沿革/日期锚/槽名简称接线叙述行不计(内容正则,非行号)。"""
    ledger_lines = [
        SLOT_NAME_CODE,
        TOKEN_PIN_CODE,
        MIGRATION_LEDGER,
        SLOT_SHORT_NARRATION,
        RETIRED_LEDGER,
        DOCSTRING_DNA_LEDGER,
        "# 1015 画幅按型联动:[4018] 画幅建议器(九型宽高直通+手动成对优先)\n",
        "# AI扩写恒开退役;[4018] wh_ratio/联动开关 未接=恒九型直通);\n",
        "# ── 6f. i2i 件专属契约(09-24 新增:道劫风格图生图=edit 骨架+九型装配移植;\n",
        '        "[150] WIDTH/HEIGHT 应接 [4018] 九型宽高(1015 画幅按型联动;原「不移植」随用户令反转)"\n',
    ]
    for line in ledger_lines:
        assert scanner.scan_text(CONTRACT_TEST_REL, line, scanner.RULES) == [], line


def test_current_prose_not_whitelisted_by_ledger_patterns():
    """现行口径散文一行不得进白名单:含规则词的现行指称/越权文件仍须命中。"""
    # 契约测试文件内:现行断言句(非台账锚)仍命中
    assert len(scanner.scan_text(CONTRACT_TEST_REL, 'assert "九型装配" in positive\n', scanner.RULES)) == 1
    # 台账正则有文件作用域:手册/文档文件中的同类字样不受契约测试白名单保护
    manual_like = scanner.scan_text(
        "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/style_guide/06_新中式设计语言.md",
        "运营注记:道劫九型基座负面按场景选配。\n",
        scanner.RULES,
    )
    assert len(manual_like) == 1
    docs_like = scanner.scan_text("docs/prompts/道劫_x.md", "九型W/H 接线叙述\n", scanner.RULES)
    assert len(docs_like) == 1, "槽名简称白名单不得外溢到 docs 手册域"
    # 全局机器槽名模式只收 WIDTH/HEIGHT 全称:裸「九型」现行指称不受保护
    bare = scanner.scan_text("docs/prompts/道劫_x.md", "九型各自点亮谁\n", scanner.RULES)
    assert len(bare) == 1
