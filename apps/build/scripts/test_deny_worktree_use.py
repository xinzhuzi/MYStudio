"""Exercise hook JSON decisions without executing any payload command."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[3]
HOOK = ROOT / ".claude/hooks/deny-worktree-use.py"
HEADER = "trellis channel send safety-review --as main --to reviewer --stdin"
BODY = "No edits, any Git command (including diff/status), worktree or destructive actions."


class HookDecisionTests(unittest.TestCase):
    def decide(self, tool="Bash", fields=None, cwd=None, raw=None):
        payload = json.dumps({"tool_name": tool, "tool_input": fields or {},
                              "cwd": str(cwd or ROOT)}) if raw is None else raw
        result = subprocess.run([sys.executable, "-B", str(HOOK)], input=payload,
                                capture_output=True, text=True, cwd=ROOT, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout) if result.stdout.strip() else None

    def assertDenied(self, command):
        result = self.decide(fields={"command": command})
        if result is None:
            self.fail("Expected deny decision")
        self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_quoted_stdin_review_prohibitions_are_data(self):
        command = HEADER + " <<'EOF'\n" + BODY + "\nEOF\n"
        self.assertIsNone(self.decide(fields={"command": command}))


    def test_supported_create_spawn_prefix_retains_review_data(self):
        prefix = ("trellis channel create safety-review --ephemeral && "
                  "trellis channel spawn safety-review --agent check && ")
        command = prefix + HEADER + " <<'EOF'\n" + BODY + "\nEOF\ntrue\n"
        self.assertIsNone(self.decide(fields={"command": command}))

    def test_executable_prefix_and_suffix_are_still_denied(self):
        message = HEADER + " <<'EOF'\n" + BODY + "\nEOF\n"
        for command in (
            "git worktree list && " + message,
            "trellis channel create git-worktree && " + message,
            "trellis channel spawn x --model claude --worktree && " + message,
            message + "git worktree list",
            message + "claude --worktree",
            message + "ls .claude/worktrees",
            HEADER + " <<'EOF'\nEOF\ngit worktree list\nEOF\n",
        ):
            with self.subTest(command=command):
                self.assertDenied(command)

    def test_unsupported_shell_contexts_keep_original_policy(self):
        for header in (
            "eval " + HEADER,
            "sh -s",
            "cat",
            "$(true) " + HEADER,
            HEADER + " $(true)",
            "'trellis' channel send x --as main --to reviewer --stdin",
            "trellis\\ channel send x --as main --to reviewer --stdin",
            "true; " + HEADER,
            "true | " + HEADER,
            "true & " + HEADER,
            "trellis channel spawn x &&\n" + HEADER,
            HEADER + " > report.txt",
            HEADER + " <<'OTHER'",
            HEADER.replace("--stdin", "--text-file review.md"),
        ):
            with self.subTest(header=header):
                self.assertDenied(header + " <<'EOF'\n" + BODY + "\nEOF\n")
        for redirect in ("<<EOF", '<<"EOF"', "<<-'EOF'", "<<'EOF' extra"):
            with self.subTest(redirect=redirect):
                self.assertDenied(HEADER + " " + redirect + "\n" + BODY + "\nEOF\n")
        self.assertDenied(HEADER + " <<'EOF'\n" + BODY)
        self.assertDenied(HEADER + " <<'EOF'\r\n" + BODY + "\r\nEOF\r\n")

    def test_control_characters_do_not_hide_executable_suffix(self):
        message = HEADER + " <<'EOF'\n" + BODY + "\nEOF\n"
        for char in ("\t", "\r", "\v", "\f", "\u0085", " ", " "):
            with self.subTest(char=repr(char)):
                self.assertDenied(message + char + "git worktree list")
                if char != "\t":
                    self.assertDenied(HEADER + char + " <<'EOF'\n" + BODY + "\nEOF\n")
        self.assertDenied(HEADER + " <<'EOF'\ntext\vEOF\ngit worktree list\nEOF\n")

    def test_original_bash_denial_families(self):
        for command in (
            "git worktree list", "true && git worktree list", "true;git worktree list",
            "true | git worktree list", "true\ngit worktree list",
            "claude -w", "claude --worktree", "claude --tmux",
            "ls .claude/worktrees", "ls ./.claude/worktrees/child",
            "ls " + str(ROOT / ".claude/worktrees"),
        ):
            with self.subTest(command=command):
                self.assertDenied(command)

    def test_non_bash_path_and_isolation_guards(self):
        forbidden = ROOT / ".claude/worktrees"
        cases = [
            ("Read", {"file_path": str(forbidden / "x")}, ROOT),
            ("Read", {"nested": {"paths": [".claude/worktrees/x"]}}, ROOT),
            ("Bash", {"command": "true"}, forbidden),
            ("Read", {"file_path": ".claude/../.claude/worktrees/x"}, ROOT),
        ]
        cases += [(tool, {"isolation": value}, ROOT)
                  for tool in ("Agent", "Task") for value in ("worktree", True, [], 0)]
        for tool, fields, cwd in cases:
            with self.subTest(tool=tool, fields=fields):
                result = self.decide(tool, fields, cwd)
                if result is None:
                    self.fail("Expected structured guard rejection")
                self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_malformed_input_fails_closed(self):
        for raw in ("{", "[]", "null"):
            with self.subTest(raw=raw):
                result = self.decide(raw=raw)
                if result is None:
                    self.fail("Expected malformed-input rejection")
                self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_unrelated_tools_and_safe_commands_remain_unmodified(self):
        self.assertIsNone(self.decide(fields={"command": "python3 --version"}))
        self.assertIsNone(self.decide("Read", {"file_path": "docs/README.md"}))
        for value in (None, "", " "):
            self.assertIsNone(self.decide("Agent", {"isolation": value}))


if __name__ == "__main__":
    unittest.main()
