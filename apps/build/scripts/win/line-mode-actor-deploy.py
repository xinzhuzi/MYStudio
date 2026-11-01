#!/usr/bin/env python3
"""line-mode-actor 部署/升级脚本(2026-11-01,1101 自动化改版;Mac 上跑)。

目标:Win 产线机(zbj@192.168.0.101)部署 actor 执行件+档位感知看门狗,
并注册计划任务 MY-LineMode-actor(ZBJ + S4U,解无人登入触发,D3 拍板)。

步骤(蓝图 F7,幂等可重跑):
  0. 全程持 win-control-lock.sh L2(渲染类观察级部署,不碰引擎进程);
  1. 推送 line-mode-actor.ps1 与 lmstudio-watchdog.ps1——远端 PowerShell 一律
     UTF-16-LE base64 -EncodedCommand(退役 win-line-switch 的 ps_enc 同款工艺,
     零引号嵌套);文件本体走 stdin(scp/cat 管道)落盘后本地校验行数;
  2. 部署看门狗前备份原 GBK 件为 lmstudio-watchdog.ps1.bak-<date>(回滚唯一
     源——原件不在仓库);幂等:已有当日备份不重复盖;
  3. 注册计划任务 MY-LineMode-actor:Register-ScheduledTask -User ZBJ
     -LogonType S4U;已存在则先 Unregister 再注册(幂等)。需提升会话——
     ssh 会话非管理员则打印手动提升指引并以非零退出(G0d 前置);
  4. 看门狗核账:LMStudio-Watchdog 现值 State=Disabled(2026-11-01 勘察实测)
     → schtasks /Change /ENABLE 恢复,输出立账(实弹窗口外也恒开);
  5. actor 通路自检(=G0a 定谳):写一发只读 action(lms ps,attempt_id
     握手)→ schtasks /Run MY-LineMode-actor → 轮询 line-mode-result.json
     回读 done 且 attempt_id 匹配;
  6. 打印部署摘要(SHA256 与回滚指引)。

用法:
  python3 apps/build/scripts/win/line-mode-actor-deploy.py [--host zbj@192.168.0.101]
      [--skip-selftest]   # 跳过步骤⑤(仅观察部署时用)
退出码:0 成功;1 参数/前置失败;3 锁被持;4 ssh 不可达;5 自检失败。
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ACTOR_PS1 = HERE / "line-mode-actor.ps1"
WATCHDOG_PS1 = HERE / "lmstudio-watchdog.ps1"
LOCK_SH = HERE.parent / "win-control-lock.sh"

SSH_BASE_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]
REMOTE_DIR = r"C:\Users\ZBJ\.lmstudio"
ACTION_REMOTE = REMOTE_DIR + r"\line-mode-action.json"
RESULT_REMOTE = REMOTE_DIR + r"\line-mode-result.json"


def die(code: int, msg: str) -> "None":
    print(f"❌ {msg}", file=sys.stderr)
    raise SystemExit(code)


def sh(args: list, **kw) -> subprocess.CompletedProcess:
    # F2(1101 实弹):远端 PowerShell 错误输出走 GBK 代码页,默认 UTF-8 严格解码
    # 在提升态预检即 UnicodeDecodeError 崩溃——errors=replace 容错(同仓内
    # flux3_daojie_ssh.py / win-control-lock.sh 的 LC_ALL=C tr 工艺同语义)。
    return subprocess.run(args, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def ssh(host: str, ps_script: str, timeout: float = 60.0, stdin_b64: str | None = None) -> tuple[int, str]:
    """远端 PowerShell:UTF-16-LE base64 -EncodedCommand(ps_enc 同款工艺)。

    F3(1101 实弹):大载荷(如 push_file 的 base64 文件体)严禁内联进命令行
    ——EncodedCommand 会爆 cmd.exe 8191 字符上限(win-control-lock.sh:410 已
    立碑的坑);这类载荷经 stdin 喂远端短解码器,PS 命令恒短(同 lock 脚本工艺)。
    """
    if stdin_b64 is None:
        enc = base64.b64encode(ps_script.encode("utf-16-le")).decode("ascii")
        proc = sh(["ssh", *SSH_BASE_OPTS, host,
                   f"powershell -NoProfile -EncodedCommand {enc}"], timeout=timeout)
        out = (proc.stdout or "").replace("\r", "")
        return proc.returncode, out
    enc = base64.b64encode(ps_script.encode("utf-16-le")).decode("ascii")
    proc = sh(["ssh", *SSH_BASE_OPTS, host,
               f"powershell -NoProfile -EncodedCommand {enc}"],
              timeout=timeout, input=stdin_b64)
    out = (proc.stdout or "").replace("\r", "")
    return proc.returncode, out


def ps_out(cli: str) -> str:
    return "$ErrorActionPreference='Continue'\n" + cli


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="zbj@192.168.0.101")
    ap.add_argument("--skip-selftest", action="store_true")
    args = ap.parse_args()
    host = args.host
    for f in (ACTOR_PS1, WATCHDOG_PS1, LOCK_SH):
        if not f.is_file():
            die(1, f"缺件:{f}")

    # ── 0. 持锁 L2(部署全程;渲染类观察级) ──────────────────────────────
    owner = f"line-mode-actor-deploy-{time.strftime('%m%d%H%M')}-{os_pid()}"
    lock = sh(["bash", str(LOCK_SH), "lock", "--owner", owner,
               "--purpose", "line-mode-actor 部署(ps1 两件+S4U 注册+看门狗核账)",
               "--level", "L2", "--ttl-min", "30"])
    if lock.returncode == 4:
        die(4, "ssh 不可达(win-control-lock exit 4)")
    if lock.returncode != 0:
        die(3, f"拿锁失败(他人持锁中):\n{lock.stdout}\n{lock.stderr}")
    try:
        deploy(host, args.skip_selftest)
    finally:
        sh(["bash", str(LOCK_SH), "release", "--owner", owner])


def os_pid() -> str:
    import os
    return str(os.getpid())


def push_file(host: str, local: Path, remote: str) -> None:
    """文件本体**字节级**推送(评审#3 修正:base64 载荷+远端 FromBase64String
    +WriteAllBytes——不 decode/encode 文本,UTF-8 BOM 原样保留;此前
    utf-8-sig 解码再 GetBytes 写盘会剥掉 lmstudio-watchdog.ps1 的 BOM,
    zh-CN PowerShell 5.1 对无 BOM 件按 ANSI(GBK)解析)。

    F3(1101 实弹):载荷经 stdin 喂远端短解码器(PS 命令恒短)——内联进
    EncodedCommand 会爆 cmd.exe 8191 字符上限。"""
    payload = base64.b64encode(local.read_bytes()).decode("ascii")
    ps = (
        "$b64=[Console]::In.ReadToEnd().Trim();"
        f"[System.IO.File]::WriteAllBytes('{remote}',"
        "[Convert]::FromBase64String($b64)); 'PUSHED ' + (Get-Item "
        f"'{remote}').Length\n"
    )
    rc, out = ssh(host, ps, timeout=120.0, stdin_b64=payload)
    if rc != 0 or "PUSHED" not in out:
        die(1, f"推送 {local.name} 失败:rc={rc} {out[:400]}")
    # BOM 保真核账(有 BOM 的件部署后必须仍带 BOM)
    rc, out = ssh(host, ps_out(
        f"$b=[System.IO.File]::ReadAllBytes('{remote}');"
        "'size=' + $b.Length + ' bom=' + (($b.Length -ge 3) -and "
        "($b[0] -eq 0xEF) -and ($b[1] -eq 0xBB) -and ($b[2] -eq 0xBF))"))
    print(f"  已推送 {local.name} -> {remote}(远端 {out.strip()})")
    local_bom = local.read_bytes()[:3] == b"\xef\xbb\xbf"
    if local_bom and "bom=True" not in out:
        die(1, f"{local.name} BOM 在部署后丢失(远端按 ANSI 解析风险)")


def deploy(host: str, skip_selftest: bool) -> None:
    today = time.strftime("%Y%m%d")
    print(f"== 1. 提升态前置(G0d:非管理员则只告警,S4U 注册会失败)==")
    rc, out = ssh(host, ps_out(
        "$id=[System.Security.Principal.WindowsIdentity]::GetCurrent();"
        "(New-Object System.Security.Principal.WindowsPrincipal($id))"
        ".IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)"))
    elevated = out.strip().endswith("True")
    print(f"  ssh 会话提升态 = {elevated}")
    if not elevated:
        print("  ⚠ 未提升:S4U 注册(步骤③)将失败。手动提升指引:\n"
              "    在 Win 上开管理员 PowerShell 跑:\n"
              "      Register-ScheduledTask -TaskName 'MY-LineMode-actor' -User ZBJ "
              "-LogonType S4U -Action (New-ScheduledTaskAction -Execute 'powershell.exe' "
              f"-Argument '-NoProfile -ExecutionPolicy Bypass -File {REMOTE_DIR}\\line-mode-actor.ps1')\n"
              "  或以提升会话重跑本脚本。", file=sys.stderr)
        die(1, "ssh 会话非管理员(S4U 注册前置不满足)")

    print("== 2. 推送执行件 ==")
    push_file(host, ACTOR_PS1, REMOTE_DIR + r"\line-mode-actor.ps1")
    print("== 3. 备份原 GBK 看门狗(回滚唯一源)后覆盖 ==")
    rc, out = ssh(host, ps_out(
        f"$bak='{REMOTE_DIR}\\lmstudio-watchdog.ps1.bak-{today}';"
        f"if ((Test-Path $bak) -eq $false -and (Test-Path '{REMOTE_DIR}\\lmstudio-watchdog.ps1')) "
        f"{{ Copy-Item '{REMOTE_DIR}\\lmstudio-watchdog.ps1' $bak; 'BACKED-UP' }} else {{ 'SKIP' }}"))
    print(f"  原件备份: {out.strip()}")
    push_file(host, WATCHDOG_PS1, REMOTE_DIR + r"\lmstudio-watchdog.ps1")

    print("== 4. 注册计划任务 MY-LineMode-actor(ZBJ + S4U;幂等:先删后注)==")
    # MultipleInstances=Parallel(评审#7 第二道网):挂死的旧实例不再静默吞掉
    # 后续 /Run(attempt_id 握手天然丢弃旧实例的过期 result)。
    rc, out = ssh(host, ps_out(
        "Unregister-ScheduledTask -TaskName 'MY-LineMode-actor' -Confirm:$false -ErrorAction SilentlyContinue;"
        "$a = New-ScheduledTaskAction -Execute 'powershell.exe' "
        f"-Argument '-NoProfile -ExecutionPolicy Bypass -File {REMOTE_DIR}\\line-mode-actor.ps1';"
        "$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1);"
        # F4(1101 实弹):PS5.1 的 Register-ScheduledTask 无 -LogonType 参数
        # (属 New-ScheduledTaskPrincipal),旧写法参数绑定报错且被 stderr 吞;
        # 且本机机器名=用户名=ZBJ,裸 'ZBJ' 过不了 UserId 校验——须 Principal
        # 对象 + ZBJ\ZBJ 全名(实弹 12:14 定谳)。
        "$p = New-ScheduledTaskPrincipal -UserId 'ZBJ\\ZBJ' -LogonType S4U -RunLevel Limited;"
        "Register-ScheduledTask -TaskName 'MY-LineMode-actor' -Action $a -Trigger $t -Principal $p "
        "-Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable "
        "-MultipleInstances Parallel) | Out-Null;"
        "(Get-ScheduledTask -TaskName 'MY-LineMode-actor').State"))
    print(f"  任务状态: {out.strip() or '(查询为空——注册可能失败,自检会暴露)'}")

    print("== 5. 看门狗核账(Disabled→ENABLE 恢复并立账)==")
    rc, out = ssh(host, ps_out(
        "$s=(Get-ScheduledTask -TaskName 'LMStudio-Watchdog' -ErrorAction SilentlyContinue).State;"
        "'before=' + $s;"
        "if ($s -eq 'Disabled') { schtasks /Change /TN LMStudio-Watchdog /ENABLE | Out-Null;"
        "'after=' + (Get-ScheduledTask -TaskName 'LMStudio-Watchdog').State } else { 'after=' + $s }"))
    print(f"  {out.strip()}")

    if skip_selftest:
        print("== 6. 自检跳过(--skip-selftest)== ")
        summary()
        return

    print("== 6. actor 通路自检(=G0a:只读 lms ps 全链)==")
    attempt = uuid.uuid4().hex
    action = {"attempt_id": attempt, "action": "lms_ps", "params": {}, "ts": int(time.time())}
    # action 原子写(远端 PowerShell)
    rc, out = ssh(host, ps_out(
        "$p='" + ACTION_REMOTE + "';$tmp=$p+'.tmp';"
        f"[System.IO.File]::WriteAllText($tmp, '{json.dumps(action)}', "
        "[System.Text.Encoding]::UTF8);Move-Item -Force $tmp $p;'ACTION-WRITTEN'"))
    if "ACTION-WRITTEN" not in out:
        die(5, f"action 写入失败:{out[:300]}")
    rc, out = ssh(host, ps_out("schtasks /Run /TN MY-LineMode-actor"))
    if rc != 0:
        die(5, f"schtasks /Run 失败:{out[:300]}")
    deadline = time.time() + 30
    result = None
    while time.time() < deadline:
        time.sleep(2)
        rc, out = ssh(host, ps_out(
            f"if (Test-Path '{RESULT_REMOTE}') {{ Get-Content '{RESULT_REMOTE}' -Raw }}"))
        try:
            result = json.loads(out.strip())
        except Exception:
            continue
        if isinstance(result, dict) and result.get("attempt_id") == attempt:
            break
        result = None
    if not isinstance(result, dict) or result.get("attempt_id") != attempt:
        die(5, f"自检超时/attempt_id 不匹配:{str(result)[:300]}")
    if result.get("status") != "done":
        die(5, f"自检回读非 done:{str(result)[:300]}")
    print(f"  ✅ actor 全链通(attempt_id={attempt[:8]}…,stdout 摘要 "
          f"{str(result.get('stdout'))[:80]}…)")
    summary()


def summary() -> None:
    print("\n== 部署摘要 ==")
    for f in (ACTOR_PS1, WATCHDOG_PS1):
        import hashlib
        digest = hashlib.sha256(f.read_bytes()).hexdigest()
        print(f"  {f.name}: sha256={digest[:16]}…")
    print("  回滚:actor 任务停用 = schtasks /Change /TN MY-LineMode-actor /DISABLE;"
          "看门狗恢复 = 部署备份 lmstudio-watchdog.ps1.bak-<date> 覆盖回 "
          f"{REMOTE_DIR}\\lmstudio-watchdog.ps1")
    print("  完整回滚三档见蓝图 rollback 节(线上急停标记文件/功能回滚/git revert)。")


if __name__ == "__main__":
    main()
