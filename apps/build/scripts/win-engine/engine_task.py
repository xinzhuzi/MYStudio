# -*- coding: utf-8 -*-
"""engine_task.py -- Windows 引擎守护拉起器（调度器域入口）。

来源：2026-10-16 FLUX3 Windows 战役首建、10-18 起为 EngineDurable 调度任务的
/TR 实体；2026-10-25 自 E:\\IP\\engine_task.py 收编入仓（单点风险解除）。

为什么存在：Windows OpenSSH 会话带 Job 对象，SSH 断开时连带清杀 detached
子进程——从 SSH 直接起引擎（含 Popen DETACHED）必秒死。唯一逃生路是
Task Scheduler 调度器域。本脚本即调度域入口，由 EngineDurable 任务以
`D:\\Python312\\python.exe <repo>\\apps\\build\\scripts\\win-engine\\engine_task.py`
调用。

关键配方（勿省略）：
- 必须用引擎 venv python（base python 缺 comfy_aimdo 等秒崩）；
- 调度器域进程缺 TEMP/TMP/USERPROFILE → torch/tempfile 采样期
  [Errno 22] Invalid argument，必须硬补；
- creationflags = DETACHED_PROCESS | NEW_PROCESS_GROUP（0x08|0x200）；
- 启动参数唯一真源=引擎家 manifest.json 的 engine.launchArgs，本脚本的
  硬编码参数与其保持同步；改参数先改 manifest，再同步此处。

用法（创建守护任务，PowerShell 管理员可选）：
  schtasks /Create /TN EngineDurable /SC ONESTART ^
    /TR "D:\\Python312\\python.exe E:\\IP\\MYStudio\\apps\\build\\scripts\\win-engine\\engine_task.py"
  重启引擎：schtasks /Run /TN EngineDurable
"""
import subprocess
import os

VENV_PY = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/venv/Scripts/python.exe'
MAIN = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/ComfyUI/main.py'
OUT = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/output'
CWD = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/ComfyUI'
LOG = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/logs/engine.log'
log = open(LOG, 'ab')
env = dict(os.environ)
env['TEMP'] = r'C:\Users\ZBJ\AppData\Local\Temp'
env['TMP'] = r'C:\Users\ZBJ\AppData\Local\Temp'
env['USERPROFILE'] = r'C:\Users\ZBJ'
env['LOCALAPPDATA'] = r'C:\Users\ZBJ\AppData\Local'
env.setdefault('SYSTEMROOT', r'C:\Windows')
subprocess.Popen([VENV_PY, MAIN, '--listen', '127.0.0.1', '--port', '17000',
                  '--enable-manager', '--use-pytorch-cross-attention',
                  '--output-directory', OUT],
                 cwd=CWD, stdout=log, stderr=subprocess.STDOUT,
                 creationflags=0x00000008 | 0x00000200, env=env)
