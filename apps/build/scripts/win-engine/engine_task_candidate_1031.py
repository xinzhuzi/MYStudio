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

======================================================================
1031 双进程修复（候选件 engine_task_candidate_1031.py，未部署）
======================================================================

【修复点】只修"双进程"，其余行为逐字保留。
根因：本机该 venv 的 Scripts\\python.exe 不是完整解释器，而是 venv
launcher 壳（274712B、VersionInfo OriginalFilename=py.exe；基座
D:\\Python312\\python.exe 为 103192B）。壳读 pyvenv.cfg
（home=D:\\Python312, version=3.12.3）后，以完全相同的 argv 再 spawn
`D:\\Python312\\python.exe` 子进程并 wait。因此 engine_task.py 的那一次
Popen 在进程表里呈现为两个 python 进程：
  venv\\Scripts\\python.exe（壳，父，不持端口）
    └─ D:\\Python312\\python.exe（真解释器，子，持 0.0.0.0:17000）
两进程命令行都含 --port 17000——与 10-31 观测完全一致（装机活体快照
PID 13064(壳)→5560(基座)）。脚本本身无重试、无二次拉起；调度任务
EngineDurableBootSys 仅单一 BootTrigger 且 MultipleInstancesPolicy=
IgnoreNew，其余 4 个 EngineDurable* 任务均已禁用——双进程与重复拉起
无关。

修法：预检通过时改为【单进程直启基座解释器】并注入环境变量
`__PYVENV_LAUNCHER__=VENV_PY`。装机实测（2026-10-31/11-01，
zbj@192.168.0.101）：D:\\Python312\\python.exe 带
__PYVENV_LAUNCHER__=<venv python 路径> 启动后 sys.prefix=venv 根、
sys.executable=venv\\Scripts\\python.exe、venv\\Lib\\site-packages 三个
探针模块（dotenv/pygments/markdown_it）全部解析到 venv——venv 语义
完整复现；且该变量被解释器启动即消费并从 os.environ 清除（实测
PERSIST_VAL=None），对 ComfyUI 及其子进程零残留。进程 exe 与今天
引擎真身完全同一镜像（本来就是 D:\\Python312\\python.exe），唯一差别
是不再有壳父进程。预检不通过（或 pyvenv.cfg/基座缺失）时自动回退为
原 VENV_PY 壳启动（即旧行为），并在 engine.log 落一行决策记录。

【部署前提】
1) 必须等 E:\\IP\\incoming 接力链（pika_takeover.py / pika_autorun.py
   等）完成、引擎停止后，由用户确认再部署；本文件仅为候选件，落库
   不部署。
2) 部署=以管理员把本文件内容覆盖 E:\\IP\\engine_task.py（与仓库
   apps/build/scripts/win-engine/engine_task.py），EngineDurableBootSys
   任务定义（/TR、BootTrigger、SYSTEM Principal）无需改动。
3) 与本修复无关的独立发现：机上存在 netsh portproxy 规则
   「监听 0.0.0.0:17000 → 连接 127.0.0.1:17000」（iphlpsvc 持有），
   10-31 23:07 前后曾致引擎启动连报 "[ERROR] Port 17000 is already
   in use on address 0.0.0.0"（engine.log 共 7 次，52 次启动 45 成功）。
   部署前引擎必须能独占 17000，portproxy 的处置（删除/保留）须由
   用户拍板，本修复不触碰它。
4) 回滚：恢复原 VENV_PY 壳启动即可（本文件预检失败路径即等价旧行为；
   或整体换回旧版 engine_task.py）。
"""
import subprocess
import os
import json

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
# T13(10-29) MyShot 回写出口:注入 bridge env,对齐 engine_manager launch_env
# (MYSTUDIO_BRIDGE_URL/MYSTUDIO_BRIDGE_TOKEN 同款注入;令牌单源=sidecar
# config.json controlToken,electron main getControlToken 落盘的装机 UUID;env
# MANYING_LOCAL_IMAGE_TOKEN 优先,双缺=空串 fail-closed,与 repo
# bridge_contract.resolve_bridge_token 同序;本文件零令牌字面量)。
SIDECAR_CONFIG = ('C:/Users/ZBJ/AppData/Roaming/'
                  '\u6f2b\u5f71\u5de5\u4f5c\u5ba4/python/profiles/image-gen/config.json')


def _bridge_token():
    tok = os.environ.get('MANYING_LOCAL_IMAGE_TOKEN', '')
    if tok:
        return tok
    try:
        cfg = json.load(open(SIDECAR_CONFIG, encoding='utf-8'))
    except (OSError, ValueError):
        return ''
    t = cfg.get('controlToken') if isinstance(cfg, dict) else None
    return t if isinstance(t, str) else ''


env['MYSTUDIO_BRIDGE_URL'] = 'http://127.0.0.1:17595'
env['MYSTUDIO_BRIDGE_TOKEN'] = _bridge_token()

# ---- 1031 双进程修复:单进程直启基座解释器(预检通过)/ 原壳启动(回退) ----
# venv launcher 壳的 venv 语义靠 __PYVENV_LAUNCHER__ 传给子进程(壳本身不注入
# 任何 env,装机实测 injected={});基座 3.12.3 在 Windows 上认这个变量:
# prefix→venv 根、executable→venv python、site-packages→venv,启动即消费清除。
VENV_LAUNCHER_ENV_KEY = '__PYVENV_LAUNCHER__'
FALLBACK_BASE_PY = r'D:\Python312\python.exe'  # 1031 装机实测基座(103192B)


def _venv_root():
    # VENV_PY = <venv>/Scripts/python.exe -> <venv>
    return os.path.dirname(os.path.dirname(VENV_PY))


def _resolve_base_python():
    # 基座解释器以 pyvenv.cfg 的 home 为准,缺失时退回 1031 实测常量。
    try:
        cfg_path = os.path.join(_venv_root(), 'pyvenv.cfg')
        with open(cfg_path, encoding='utf-8', errors='replace') as f:
            for line in f:
                if line.strip().lower().startswith('home'):
                    home = line.split('=', 1)[1].strip().strip('"')
                    if home:
                        cand = os.path.join(home, 'python.exe')
                        if os.path.isfile(cand):
                            return cand
                    break
    except OSError:
        pass
    return FALLBACK_BASE_PY


def _venv_emulation_ok(base_py):
    # 预检:基座 python 注入 __PYVENV_LAUNCHER__ 后必须报出 venv 根 prefix,
    # 否则视为不支持(回退原壳启动,保证引擎永远能起)。
    probe_env = dict(env)
    probe_env[VENV_LAUNCHER_ENV_KEY] = VENV_PY
    try:
        r = subprocess.run([base_py, '-c', 'import sys;print(sys.prefix)'],
                           capture_output=True, timeout=60, env=probe_env)
        return r.stdout.decode('utf-8', 'replace').strip() == _venv_root()
    except (OSError, subprocess.SubprocessError):
        return False


_base_py = _resolve_base_python()
if os.path.isfile(_base_py) and _venv_emulation_ok(_base_py):
    ENGINE_PY = _base_py
    env[VENV_LAUNCHER_ENV_KEY] = VENV_PY
    _mode = ('single-process launch: base interpreter + __PYVENV_LAUNCHER__'
             ' (venv launcher stub bypassed; no parent python process)')
else:
    ENGINE_PY = VENV_PY
    _mode = 'fallback: original venv launcher stub launch (two python processes)'

log.write(('[engine_task] 1031 fix mode: %s\n' % _mode).encode('utf-8', 'replace'))
log.flush()

subprocess.Popen([ENGINE_PY, MAIN, '--listen', '0.0.0.0', '--port', '17000', '--lowvram',
                  '--enable-manager', '--use-pytorch-cross-attention',
                  '--output-directory', OUT],
                 cwd=CWD, stdout=log, stderr=subprocess.STDOUT,
                 creationflags=0x00000008 | 0x00000200, env=env)
