"""U3(1125 根修)「重启引擎」按钮单测:restart_remote_engine 三条路径。

旧实现只 schtasks /Run /TN EngineDurable——引擎在位时计划任务入口直接跳过
(engine_task.py 的端口在位门),界面却报成功。新实现三步:① curl.exe 查
/queue 守卫(非空拒,不动引擎)→ ② curl.exe 探 /system_stats,在跑先停
(PowerShell CIM 按 PID Stop-Process -Id;禁 taskkill /F /T 树杀——会误杀
SSH 服务)→ ③ schtasks /Run 拉起 + 轮询 /system_stats 就绪(ok 只在引擎
最终应答时为真)。

零真 SSH:run_remote_command 实例级替换(照 test_engine_sync.py 的
RemoteMystudioTests 桩法),按命令片段路由回 (code, out) 并翻转模拟引擎
状态;happy 路径轮询首轮即中,零 time.sleep。
"""

from __future__ import annotations

import base64
import json
import unittest

from remote_ssh.service import SSHService


class _RestartStub:
    """run_remote_command 桩:模拟一台 Windows 远端的引擎应答状态。

    - curl.exe /queue:引擎在跑回 self.queue 的 JSON;没跑回 exit 7(拒连);
    - curl.exe /system_stats:引擎在跑 exit 0,没跑 exit 7;
    - Stop-Process PowerShell(CIM 选靶 main.py+17000):把引擎翻成停;
    - schtasks /Run /TN EngineDurable:把引擎翻成跑(计划任务拉起)。
    """

    def __init__(self, engine_up: bool, queue: dict | None = None) -> None:
        self.engine_up = engine_up
        self.queue = queue if queue is not None else {
            "queue_running": [], "queue_pending": [],
        }
        self.commands: list[str] = []
        self.scripts: list[str] = []  # 解码后的 PowerShell 脚本体

    def __call__(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
        self.commands.append(command)
        if "-EncodedCommand " in command:
            script = base64.b64decode(
                command.split("-EncodedCommand ", 1)[1]
            ).decode("utf-16le")
            self.scripts.append(script)
            if "Stop-Process -Id" in script:
                self.engine_up = False
                return 0, ""
            raise AssertionError(f"unexpected powershell script: {script}")
        if "curl.exe" in command and "/queue" in command:
            if not self.engine_up:
                return 7, ""
            return 0, json.dumps(self.queue)
        if "curl.exe" in command and "/system_stats" in command:
            return (0 if self.engine_up else 7), ""
        if command == "schtasks /Run /TN EngineDurable":
            self.engine_up = True
            return 0, 'SUCCESS: The scheduled task "EngineDurable" has been started.\n'
        raise AssertionError(f"unexpected command: {command}")


def _service_with_stub(stub: _RestartStub) -> SSHService:
    svc = SSHService()
    svc._client = object()
    svc._connected = True
    svc.run_remote_command = stub  # type: ignore[method-assign]
    return svc


class RestartRemoteEngineTests(unittest.TestCase):
    """三条路径:在跑→先停后起 / 没跑→直接起 / 队列忙→拒绝。"""

    def test_running_engine_stops_then_starts_and_reports_ok(self) -> None:
        """在跑:先按 PID 停(Stop-Process -Id,零 taskkill)再拉起,最终 ok=true。"""
        stub = _RestartStub(engine_up=True)
        result = _service_with_stub(stub).restart_remote_engine()
        self.assertTrue(result["ok"])
        self.assertTrue(result["restarted"])
        self.assertEqual(result["reason"], "ok")
        # 停进程脚本:CIM 选靶 CommandLine 含 main.py 且含 17000,逐个 Stop-Process
        self.assertEqual(len(stub.scripts), 1)
        self.assertIn("Win32_Process", stub.scripts[0])
        self.assertIn("main\\.py", stub.scripts[0])
        self.assertIn("17000", stub.scripts[0])
        self.assertIn("Stop-Process -Id $_.ProcessId -Force", stub.scripts[0])
        # 禁树杀:整轮零 taskkill(会误杀 SSH 服务,仓内有案底)
        self.assertFalse(any("taskkill" in c for c in stub.commands))
        # 拉起走了计划任务
        self.assertIn("schtasks /Run /TN EngineDurable", stub.commands)
        # 命令序:队列探针 → 在跑探针 → 停 → 确认停探针 → 拉起 → 就绪探针
        self.assertTrue(stub.commands[0].startswith("curl.exe"))
        self.assertIn("/queue", stub.commands[0])
        self.assertIn("/system_stats", stub.commands[1])
        self.assertIn("-EncodedCommand ", stub.commands[2])
        self.assertIn("/system_stats", stub.commands[3])
        self.assertEqual(stub.commands[4], "schtasks /Run /TN EngineDurable")
        self.assertIn("/system_stats", stub.commands[5])
        # 停生效:桩在 Stop-Process 后不再应答,schtasks 后重新应答
        self.assertTrue(stub.engine_up)

    def test_stopped_engine_starts_directly_without_stop(self) -> None:
        """没跑:跳过停步直接拉起(ok=true,restarted=false,零 Stop-Process)。"""
        stub = _RestartStub(engine_up=False)
        result = _service_with_stub(stub).restart_remote_engine()
        self.assertTrue(result["ok"])
        self.assertFalse(result["restarted"])
        self.assertEqual(result["reason"], "ok")
        self.assertEqual(stub.scripts, [])  # 没发过任何 PowerShell 停进程命令
        self.assertFalse(any("Stop-Process" in c for c in stub.commands))
        self.assertIn("schtasks /Run /TN EngineDurable", stub.commands)
        # 队列探针在引擎没跑时拿不到回执(curl 拒连)也不拦路——引擎本就没在跑
        self.assertTrue(stub.commands[0].startswith("curl.exe"))
        self.assertIn("/queue", stub.commands[0])

    def test_busy_queue_refuses_without_touching_engine(self) -> None:
        """队列忙:拒绝(reason=queue-busy+detail 带任务数),零停/零拉起。"""
        stub = _RestartStub(
            engine_up=True,
            queue={"queue_running": ["<task0>"], "queue_pending": ["<task1>", "<task2>"]},
        )
        result = _service_with_stub(stub).restart_remote_engine()
        self.assertFalse(result["ok"])
        self.assertFalse(result["restarted"])
        self.assertEqual(result["reason"], "queue-busy")
        self.assertEqual(result["detail"], "队列里有 3 个任务")
        # 只发过队列探针一条命令——没动引擎(无停进程、无 schtasks)
        self.assertEqual(len(stub.commands), 1)
        self.assertIn("/queue", stub.commands[0])
        self.assertEqual(stub.scripts, [])
        self.assertFalse(any("schtasks" in c for c in stub.commands))
        self.assertTrue(stub.engine_up)  # 引擎状态未被翻转


if __name__ == "__main__":
    unittest.main()
