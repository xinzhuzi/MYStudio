"""qi21_blueprint_sync_1001.py fail-closed 行为锁(1001 S8 深审 L-9 修复轮立;
1001 i2i/edit 批随多目标化更新)。

锁两件事:
  ① RGBA 头/尾句提取与锁层A/W1 同款严格唯一——§六 0927 条⑥ 窗口内多重命中/
     未命中即中文报错拒刷(兑现 docstring「提取未命中/多重命中→中文报错 exit 2,
     fail-closed 绝不猜」承诺;旧 re.search 首命中静默取一,违背承诺);
  ② fail-closed 退出码统一 exit 2(旧 raise SystemExit(中文串) 实测退 1,
     与 docstring 承诺不符——S8 报告 L-9 复核附注,全脚本统一 print+sys.exit(2))。

1001 i2i/edit 批多目标化更新:② 的节点面由单命中 _find_node(已随多目标化退役)
改锁三条现行收集缝——Assembly>1 拒/Select=0 拒/同名定义多重拒;真源实弹腿
随 --refresh-from-library 扩为三目标(t2i/i2i/edit)×工作流/蓝图两侧。

同目录无既有测试文件覆盖本脚本,照同包家法(per-script test_<script>.py,
参照 test_daojie_ma_sync_check.py)立件;夹具走临时 05 库,零仓库写入。
"""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "qi21_blueprint_sync_1001.py"

HEAD = "This is an RGBA format image with transparency."
TAIL = "The image has an alpha channel and a transparent background."
W1 = "The subject reads the quiet surface of the river."
LOCK_A = "LOCK-A-BODY 锁层A正文"

GOOD_LIB = (
    "# 05 库(测试夹具)\n"
    "## §一\n"
    "- 0930 条:主候选句在案(" + W1 + ")\n"
    "## §二\n"
    "**常量 A·基础(测试锚)**:\n\n```text\n" + LOCK_A + "\n```\n"
    "## §六\n"
    "- 0927 条⑥:三生成器 RGBA 头尾句改官方逐字**"
    "(「" + HEAD + "」/「" + TAIL + "」,备注零涉)\n"
)
# 窗口内头句引号对 ×2(多重命中面;尾句与句法其余不动)
MULTI_HEAD_LIB = GOOD_LIB.replace(
    "(「" + HEAD + "」/「" + TAIL + "」",
    "(「" + HEAD + "」/「" + HEAD + "」/「" + TAIL + "」")
# 窗口内尾句引号对 ×2
MULTI_TAIL_LIB = GOOD_LIB.replace(
    "「" + TAIL + "」,备注", "「" + TAIL + "」/「" + TAIL + "」,备注")
# 头句引号对整个缺席(未命中面)
MISSING_HEAD_LIB = GOOD_LIB.replace("「" + HEAD + "」/", "")


def load_module():
    spec = importlib.util.spec_from_file_location("qi21_blueprint_sync_1001", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ExtractFixedSentencesTests(unittest.TestCase):
    """① 严格唯一提取 + ② fail-closed 退出码/中文报错(临时 05 库夹具)。"""

    def setUp(self):
        self.mod = load_module()

    def _run(self, content):
        tmp = tempfile.TemporaryDirectory(prefix="qi21-sync-lib-")
        self.addCleanup(tmp.cleanup)
        lib = Path(tmp.name) / "05-道劫规范提示词库.md"
        lib.write_text(content, encoding="utf-8")
        old, self.mod.LIB05 = self.mod.LIB05, lib
        self.addCleanup(setattr, self.mod, "LIB05", old)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                return self.mod.extract_fixed_sentences(), out.getvalue(), None
            except SystemExit as e:
                return None, out.getvalue(), e

    def test_single_hit_each_returns_four_sentences(self):
        sent, stdout, exc = self._run(GOOD_LIB)
        self.assertIsNone(exc)
        self.assertEqual(sent, {"锁层A全文": LOCK_A, "RGBA官方头句": HEAD,
                                "RGBA官方尾句": TAIL, "W1收束句": W1})

    def test_rgba_head_multi_hit_fails_closed_exit_2(self):
        sent, stdout, exc = self._run(MULTI_HEAD_LIB)
        self.assertIsNone(sent)
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 2)  # ② docstring 承诺口径(旧实测退 1)
        self.assertIn("提取命中 2 处", stdout)
        self.assertIn("RGBA官方头句", stdout)
        self.assertIn("fail-closed 拒刷", stdout)

    def test_rgba_tail_multi_hit_fails_closed_exit_2(self):
        _, stdout, exc = self._run(MULTI_TAIL_LIB)
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 2)
        self.assertIn("提取命中 2 处", stdout)
        self.assertIn("RGBA官方尾句", stdout)
        self.assertIn("fail-closed 拒刷", stdout)

    def test_rgba_head_missing_fails_closed_exit_2(self):
        _, stdout, exc = self._run(MISSING_HEAD_LIB)
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 2)
        self.assertIn("提取命中 0 处", stdout)
        self.assertIn("fail-closed 拒刷", stdout)


class FailClosedChannelTests(unittest.TestCase):
    """② 统一口的其余 fail-closed 位(多目标 refresh 收集面)与真源实弹。

    (1001 i2i/edit 批注:单命中锁 _find_node 已随多目标化退役——refresh 腋
    Assembly 改 ≤1(0=edit 无装配层跳过,>1 拒),Select 改 ≥1(0 拒);
    本类改锁三条现行 fail-closed 缝,退出码/中文口径不变。)
    """

    def _refresh_collect(self, sg_nodes, sgs_count=1):
        """以临时蓝图/工作流/05 库夹具驱动 refresh 收集面(sgs_count>1=同名定义多重命中面)。"""
        mod = load_module()
        tmp = tempfile.TemporaryDirectory(prefix="qi21-sync-bp-")
        self.addCleanup(tmp.cleanup)
        wf_tmp = Path(tmp.name) / "wf.json"
        bp_tmp = Path(tmp.name) / "bp.json"
        lib_tmp = Path(tmp.name) / "05-道劫规范提示词库.md"
        lib_tmp.write_text(GOOD_LIB, encoding="utf-8")  # 提取腿先行,库须合法
        sg_tmpl = {"name": "[40] 提示词类型优化子图(双击进入)", "nodes": sg_nodes}
        wf_tmp.write_text(json.dumps(
            {"definitions": {"subgraphs": [sg_tmpl] * sgs_count}}, ensure_ascii=False),
            encoding="utf-8")
        bp_tmp.write_text(json.dumps(
            {"definitions": {"subgraphs": [dict(sg_tmpl)]}}, ensure_ascii=False),
            encoding="utf-8")
        old_t = dict(mod.TARGETS["t2i"])
        old_lib = mod.LIB05
        mod.TARGETS["t2i"] = {"blueprint": bp_tmp, "wf": wf_tmp}
        mod.LIB05 = lib_tmp
        self.addCleanup(mod.TARGETS.__setitem__, "t2i", old_t)
        self.addCleanup(setattr, mod, "LIB05", old_lib)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                mod.refresh_from_library(check_only=True, tags=["t2i"])
        return cm.exception.code, out.getvalue()

    def test_assembly_multi_hit_fails_closed_exit_2_chinese(self):
        code, stdout = self._refresh_collect(
            [{"type": "MyQi21PromptAssembly"}, {"type": "MyQi21PromptAssembly"},
             {"type": "MyQi21PromptSelect", "widgets_values": [None, None, "", "", ""]}])
        self.assertEqual(code, 2)
        self.assertIn("命中 2 件", stdout)
        self.assertIn("MyQi21PromptAssembly", stdout)
        self.assertIn("fail-closed 拒刷", stdout)

    def test_select_zero_hit_fails_closed_exit_2_chinese(self):
        code, stdout = self._refresh_collect(
            [{"type": "MyQi21PromptAssembly", "widgets_values": [None, ""]}])
        self.assertEqual(code, 2)
        self.assertIn("命中 0 件", stdout)
        self.assertIn("MyQi21PromptSelect", stdout)
        self.assertIn("fail-closed 拒刷", stdout)

    def test_duplicate_sg_definition_fails_closed_exit_2_chinese(self):
        code, stdout = self._refresh_collect(
            [{"type": "MyQi21PromptSelect", "widgets_values": [None, None, "", "", ""]}],
            sgs_count=2)
        self.assertEqual(code, 2)
        self.assertIn("命中 2 份", stdout)
        self.assertIn("fail-closed 拒刷", stdout)

    def test_live_repo_refresh_check_exits_0(self):
        """真源实弹(只读):三目标现库/蓝图/工作流全一致 → exit 0 零写入。"""
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--refresh-from-library", "--check"],
            capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("全一致,零写入(幂等)", proc.stdout)
        # 多目标化口径:三目标×工作流/蓝图两侧都在对拍报告里
        for tag in ("t2i", "i2i", "edit"):
            self.assertIn(f"{tag}/工作流", proc.stdout)
            self.assertIn(f"{tag}/蓝图", proc.stdout)


if __name__ == "__main__":
    unittest.main()
