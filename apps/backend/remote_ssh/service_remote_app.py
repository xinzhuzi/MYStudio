"""service_remote_app.py — 远端应用与令牌域(拉起/关闭远端 MYStudio、重启引擎、令牌刷新与连接测试)

本模块的类由 service.SSHService 混入组合而成:方法体自 SSHService 逐字搬出(1124 超线文件拆分),对外接口不变。

两点约定:
- 须在 service 之后导入(类体里用到的名字在 service 初始化时才就绪;单独先导入本模块会循环导入失败);
- 测试会在 service 上整个替换的名字、以及定义在原类之后的名字,一律经 `service.<名字>` 取(调用时才查),
  在 service 上打桩的效果与搬出前相同。
"""

from __future__ import annotations

import concurrent.futures
import json
from remote_ssh import config as ssh_config
import time

from . import service
from .service import (
    SSHServiceError,
    TOKEN_FILE_NAME,
    _MYSTUDIO_SESSION,
    _SCHTASK_APP,
    _SCHTASK_ENGINE,
    _TOKEN_RE,
    _TORCH_KILL_PATTERN,
    _WIN_APP_EXE,
    _exclusive_mystudio,
    _torch_powershell,
)


class RemoteAppMixin:
    """远端应用与令牌域(拉起/关闭远端 MYStudio、重启引擎、令牌刷新与连接测试)"""

    def _mystudio_command(self, command: str, timeout_s: float) -> tuple[int, str]:
        with self._lock:
            if self._client is not _MYSTUDIO_SESSION.client or not self._connected:
                raise SSHServiceError("SSH 连接已切换,操作中止")
            remaining = _MYSTUDIO_SESSION.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("远端操作超时")
            try:
                result = self.run_remote_command(command, min(timeout_s, remaining))
            except SSHServiceError:
                if time.monotonic() >= _MYSTUDIO_SESSION.deadline:
                    raise TimeoutError("远端操作超时") from None
                raise
            if self._client is not _MYSTUDIO_SESSION.client or not self._connected:
                raise SSHServiceError("SSH 连接已切换,操作中止")
            if time.monotonic() >= _MYSTUDIO_SESSION.deadline:
                raise TimeoutError("远端操作超时")
            return result

    def _remote_process_count(self, script: str) -> int:
        code, output = self._mystudio_command(_torch_powershell(script), 15)
        counts = [int(line.strip()) for line in output.splitlines() if line.strip().isdecimal()]
        # 1110 实弹雷(两形态,exit code 不可信):①Get-NetTCPConnection 零匹配时
        # 即便 -ErrorAction SilentlyContinue,powershell.exe 仍 exit=1(错误流
        # 副产品)而 stdout 是干净 "0";②长连会话 recv_exit_status 毛刺返回 -1。
        # 判定只看解析:解析出干净计数行=答案;真错误时输出是错误文本,counts
        # 自然为空→诚实抛。
        if not counts:
            raise SSHServiceError(f"远端状态探测失败: {output.strip()[:500]}")
        return counts[-1]

    def _remote_app_running(self) -> bool:
        return self._remote_process_count(
            '$ErrorActionPreference=\'Stop\'; Get-CimInstance Win32_Process -Filter "Name=\'manying-studio.exe\'" | '
            'Measure-Object | Select-Object -ExpandProperty Count'
        ) > 0

    def _remote_engine_ready(self) -> bool:
        code, _ = self._mystudio_command(_torch_powershell(
            "$ErrorActionPreference='Stop'; Invoke-RestMethod -Uri "
            "'http://127.0.0.1:17000/system_stats' -TimeoutSec 3 | Out-Null"
        ), 10)
        return code == 0

    def _remote_engine_listening(self) -> bool:
        return self._remote_process_count(
            'Get-NetTCPConnection -LocalPort 17000 -State Listen -ErrorAction SilentlyContinue | '
            'Measure-Object | Select-Object -ExpandProperty Count'
        ) > 0

    def _remote_engine_running(self) -> bool:
        return self._remote_process_count(
            '$ErrorActionPreference=\'Stop\'; Get-CimInstance Win32_Process -Filter "Name like \'python%\'" | '
            f"Where-Object {{ $_.CommandLine -match '{_TORCH_KILL_PATTERN}' -or $_.CommandLine -match 'engine_task' }} | "
            'Measure-Object | Select-Object -ExpandProperty Count'
        ) > 0

    @_exclusive_mystudio
    def launch_remote_mystudio(self, timeout_s: float = 45) -> dict:
        result = {"ok": False, "alreadyRunning": False, "appRunning": False,
                  "engineReady": False, "engineRestarted": False, "output": ""}
        _MYSTUDIO_SESSION.result = result
        if self._remote_app_running():
            result.update(ok=True, alreadyRunning=True, appRunning=True)
            result["engineReady"] = self._remote_engine_ready()
            if not result["engineReady"]:
                code, output = self._mystudio_command(f"schtasks /Run /TN {_SCHTASK_ENGINE}", 30)
                result["engineRestarted"] = code == 0
                result["output"] = output.strip()[:500]
            return result
        code, _ = self._mystudio_command(f"if exist {_WIN_APP_EXE} exit 0 else exit 1", 15)
        if code:
            result["output"] = f"未找到 {_WIN_APP_EXE}，请人工核查安装路径"
            return result
        for command in (f"schtasks /Create /TN {_SCHTASK_APP} /TR {_WIN_APP_EXE} /SC ONCE /ST 00:00 /IT /F",
                        f"schtasks /Run /TN {_SCHTASK_APP}"):
            code, output = self._mystudio_command(command, 30)
            if code:
                result["output"] = output.strip()[:500] or "计划任务执行失败"
                return result
        deadline = min(_MYSTUDIO_SESSION.deadline, time.monotonic() + 30)
        while True:
            if self._remote_app_running():
                result.update(ok=True, appRunning=True, engineReady=self._remote_engine_ready())
                return result
            if time.monotonic() >= deadline:
                result["output"] = "拉起指令已发但 30 秒内未见进程"
                return result
            time.sleep(min(2, max(0, deadline - time.monotonic())))

    @_exclusive_mystudio
    def shutdown_remote_mystudio(self, timeout_s: float = 75) -> dict:
        result = {"ok": False, "appWasRunning": False, "engineWasRunning": False, "output": ""}
        _MYSTUDIO_SESSION.result = result
        app_was = self._remote_app_running()
        engine_was = self._remote_engine_listening() or self._remote_engine_running()
        result.update(appWasRunning=app_was, engineWasRunning=engine_was)
        deadline = _MYSTUDIO_SESSION.deadline
        if app_was:
            self._mystudio_command(_torch_powershell(
                '(Get-Process -Name manying-studio -ErrorAction SilentlyContinue) | '
                'ForEach-Object { $_.CloseMainWindow() }'), 15)
            graceful_deadline = min(deadline, time.monotonic() + 10)
            while self._remote_app_running() and time.monotonic() < graceful_deadline:
                time.sleep(min(2, max(0, graceful_deadline - time.monotonic())))
            if self._remote_app_running():
                self._mystudio_command(_torch_powershell(
                    'Stop-Process -Name manying-studio -Force -ErrorAction SilentlyContinue'), 15)
                kill_deadline = min(deadline, time.monotonic() + 10)
                while self._remote_app_running() and time.monotonic() < kill_deadline:
                    time.sleep(min(2, max(0, kill_deadline - time.monotonic())))
        self._mystudio_command(f"schtasks /End /TN {_SCHTASK_ENGINE}", 15)
        if self._remote_engine_running():
            self._mystudio_command(_torch_powershell(
                'Get-CimInstance Win32_Process -Filter "Name like \'python%\'" | '
                f"Where-Object {{ $_.CommandLine -match '{_TORCH_KILL_PATTERN}' -or $_.CommandLine -match 'engine_task' }} | "
                'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'), 15)
        port_deadline = min(deadline, time.monotonic() + 30)
        while self._remote_engine_listening() and time.monotonic() < port_deadline:
            time.sleep(min(3, max(0, port_deadline - time.monotonic())))
        if self._remote_app_running():
            result["output"] = "App 强杀后仍在，人工核查"
        elif self._remote_engine_listening() or self._remote_engine_running():
            result["output"] = "引擎进程或 17000 端口仍在，人工核查"
        else:
            result["ok"] = True
        return result

    def restart_remote_engine(self) -> dict:
        """结果弹窗[重启引擎](R3):SSH schtasks /Run /TN EngineDurable。"""
        code, out = self.run_remote_command(
            "schtasks /Run /TN EngineDurable", 30
        )
        return {"ok": code == 0, "output": out.strip()[:500]}

    def refresh_remote_token(self, timeout_s: float | None = None) -> bool:
        """R2 令牌自愈:SFTP 依次读 tokenConfigPaths → controlToken → 正则校验
        → tmp+replace 原子写 comfyui 家 remote-image-token.txt(消费链零改动)。

        timeout_s 给定时在独立线程执行并限时返回(R2② 的 15s 超时;超时=失败,
        后台线程自然收尾不阻塞调用方)。失败恒返回 False,不外溢异常。
        """
        if timeout_s is None:
            try:
                return self._refresh_token_once()
            except Exception:  # noqa: BLE001 — 自愈链失败=诚实 False
                return False
        future = service._sftp_executor().submit(self._refresh_token_once)
        try:
            return bool(future.result(timeout=timeout_s))
        except concurrent.futures.TimeoutError:
            return False
        except Exception:  # noqa: BLE001
            return False

    def _refresh_token_once(self) -> bool:
        cfg = ssh_config.load_config()
        for path in ssh_config.effective_token_config_paths(cfg):
            try:
                raw = self.sftp_read_text(path)
            except (SSHServiceError, OSError, ValueError):
                print(f"[remote-ssh] 令牌路径读取失败: {path}", flush=True)
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                print(f"[remote-ssh] 令牌路径 JSON 无效: {path}", flush=True)
                continue
            if not isinstance(data, dict):
                print(f"[remote-ssh] 令牌路径 JSON 格式无效: {path}", flush=True)
                continue
            token = data.get("controlToken")
            if not isinstance(token, str) or not _TOKEN_RE.fullmatch(token):
                print(f"[remote-ssh] 令牌路径校验未通过: {path}", flush=True)
                continue  # 正则拒/类型不对:试下一条(B7 同款口径)
            print(f"[remote-ssh] 令牌路径命中: {path}", flush=True)
            self._write_token_file(token)
            print("[remote-ssh] 远端令牌文件写入成功", flush=True)
            with self._lock:
                self._token_refreshed_at = time.time()
            return True
        return False

    @staticmethod
    def _write_token_file(token: str) -> None:
        """tmp+replace 原子写(与 B7 裸写同内容 last-writer-wins,无冲突 C4)。"""
        from comfyui.manifest import comfy_home

        home = comfy_home()
        home.mkdir(parents=True, exist_ok=True)
        target = home / TOKEN_FILE_NAME
        tmp = home / f"{TOKEN_FILE_NAME}.tmp"
        tmp.write_text(token, encoding="utf-8")
        tmp.replace(target)

    def peek_remote_token(self, timeout_s: float | None = None) -> dict:
        """「测试连接」用的令牌读取回执(len 掩码;只读不落盘)。

        timeout_s 给定时在独立线程执行并限时返回(R1「对外调用必带超时」,
        1103 独立复核#2:transport 半死时 paramiko SFTP 请求可无限阻塞,不许
        悬挂 HTTP handler 线程——test 路与 refresh 路同款 executor 限时;超时/
        异常=读取失败回执 {ok: False},后台线程自然收尾不阻塞调用方)。
        """
        if timeout_s is None:
            return self._peek_token_once()
        future = service._sftp_executor().submit(self._peek_token_once)
        try:
            return dict(future.result(timeout=timeout_s))
        except Exception:  # noqa: BLE001 — 超时/异常统一=失败回执,不外溢
            return {"ok": False, "length": None, "source": None}

    def _peek_token_once(self) -> dict:
        cfg = ssh_config.load_config()
        for path in ssh_config.effective_token_config_paths(cfg):
            try:
                raw = self.sftp_read_text(path)
                data = json.loads(raw)
            except (SSHServiceError, OSError, ValueError):
                continue
            if isinstance(data, dict) and isinstance(data.get("controlToken"), str):
                token = data["controlToken"]
                return {
                    "ok": bool(_TOKEN_RE.fullmatch(token)),
                    "length": len(token),
                    "source": path,
                }
        return {"ok": False, "length": None, "source": None}

    def test_connection(self) -> dict:
        """R4「测试连接」回执四件:登录用户/服务器版本/令牌读取(len 掩码)/隧道探活。

        令牌读取带 15s 超时(R1 对外调用必带超时,1103 独立复核#2);入口顺带
        后装恢复探针(paramiko 刚装好即起 keeper,本次回执按未连接、keeper
        立即开始建连,后续 status 自愈)。
        """
        if not self.available():
            return {
                "ok": False,
                "reason": "needs-runtime",
                "message": "paramiko 未安装:请在设置的 Python 运行环境页完成依赖配置后重试",
            }
        cfg = ssh_config.effective_config()
        if not cfg.get("host"):
            return {"ok": False, "reason": "not-configured", "message": "未配置 SSH 主机"}
        self._recover_start(cfg)
        with self._lock:
            connected = self._connected
            last_error = self._last_error
        if not connected:
            return {
                "ok": False,
                "reason": "disconnected",
                "host": cfg.get("host") or "",
                "message": last_error or "SSH 未连接(keeper 重连中)",
            }
        transport = self._client_transport()
        login_user = ""
        if transport is not None:
            try:
                login_user = str(transport.get_username() or "")
            except Exception:  # noqa: BLE001
                login_user = ""
        with self._lock:
            server_version = self._server_version
        # 隧道回执同用单锁快照(1103 复核#4 同源):active 与 localPort 一致取全
        tunnel_active, tunnel_port = self._tunnel.snapshot()
        return {
            "ok": True,
            "user": login_user or (cfg.get("user") or ""),
            "serverVersion": server_version,
            "token": self.peek_remote_token(timeout_s=15),
            "tunnel": {"active": tunnel_active, "localPort": tunnel_port},
        }
