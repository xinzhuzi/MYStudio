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
