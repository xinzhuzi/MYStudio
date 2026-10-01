"""qi21_blueprint_sync_1001.py fail-closed 行为锁(1001 S8 深审 L-9 修复轮)。

锁两件事:
  ① RGBA 头/尾句提取与锁层A/W1 同款严格唯一——§六 0927 条⑥ 窗口内多重命中/
     未命中即中文报错拒刷(兑现 docstring「提取未命中/多重命中→中文报错 exit 2,
     fail-closed 绝不猜」承诺;旧 re.search 首命中静默取一,违背承诺);
  ② fail-closed 退出码统一 exit 2(旧 raise SystemExit(中文串) 实测退 1,
     与 docstring 承诺不符——S8 报告 L-9 复核附注,全脚本统一 print+sys.exit(2))。

同目录无既有测试文件覆盖本脚本,照同包家法(per-script test_<script>.py,
参照 test_daojie_ma_sync_check.py)立件;夹具走临时 05 库,零仓库写入。
"""
import contextlib
import importlib.util
import io
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
    """② 统一口的其余 fail-closed 位(_find_node)与真源实弹。"""

    def test_find_node_fail_closed_exit_2_chinese(self):
        mod = load_module()
        sg = {"nodes": [{"type": "MyQi21PromptAssembly"},
                        {"type": "MyQi21PromptAssembly"}]}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                mod._find_node(sg, "MyQi21PromptAssembly")
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("命中 2 件", out.getvalue())
        self.assertIn("fail-closed 拒刷", out.getvalue())

    def test_live_repo_refresh_check_exits_0(self):
        """真源实弹(只读):现库/蓝图/工作流全一致 → exit 0 零写入。"""
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--refresh-from-library", "--check"],
            capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("全一致,零写入(幂等)", proc.stdout)


if __name__ == "__main__":
    unittest.main()
