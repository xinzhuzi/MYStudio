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

1107 依赖自愈（11-07-engine-dep-selfheal，用户令「加载时不对比一下自动安装」）：
- 缺口：同步管线的 pip 步只覆盖「点同步」时刻；引擎启动链从无依赖域 →
  插件欠债（Impact-Pack 缺 segment-anything 等）沉淀到 IMPORT FAILED 才暴露。
- ①启动前对账：custom_nodes/*/requirements.txt 按 sha256 戳跳过未变件；变件
  逐行装（逐行=git+https 雷行单独失败不拖全单；git+ 行跳过留日志——过 Clash
  恒装不动）；清华直连（.cn Clash 不劫持，1107 刻碑）。
- ②启动后验愈：引擎就绪后解析本次启动日志「No module named」失败 → 重跑
  对应插件 requirements → 就地重启一轮（进程内钉死最多两代 spawn，防循环）。

用法（创建守护任务，PowerShell 管理员可选）：
  schtasks /Create /TN EngineDurable /SC ONESTART ^
    /TR "D:\\Python312\\python.exe E:\\IP\\MYStudio\\apps\\build\\scripts\\win-engine\\engine_task.py"
  重启引擎：schtasks /Run /TN EngineDurable
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

VENV_PY = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/venv/Scripts/python.exe'
MAIN = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/ComfyUI/main.py'
OUT = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/output'
CWD = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/ComfyUI'
LOG = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/logs/engine.log'
CUSTOM_NODES = CWD + '/custom_nodes'
STAMPS = 'E:/IP/\u6f2b\u5f71\u5de5\u4f5c\u5ba4/comfyui/logs/req_stamps.json'
# 清华 .cn 直连（Clash 路由直连不篡改；1107 torch 役刻碑：镜像优先于对抗）
PIP_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple'
# 「Cannot import ...custom_nodes\NAME module ...: No module named 'X'」→ 欠件插件
MISSING_MODULE_RE = re.compile(
    r"Cannot import [^\n]*custom_nodes[/\\]([A-Za-z0-9_.\-]+) "
    r"module for custom nodes: No module named '([A-Za-z0-9_.\-]+)'")

_LOG_FH = None


def _log_fh():
    """懒开引擎日志(Mac 离线导入本模块不触盘;Win 调度域首写时开)。"""
    global _LOG_FH
    if _LOG_FH is None:
        _LOG_FH = open(LOG, 'ab')
    return _LOG_FH


env = dict(os.environ)
env['TEMP'] = r'C:\Users\ZBJ\AppData\Local\Temp'
env['TMP'] = r'C:\Users\ZBJ\AppData\Local\Temp'
env['USERPROFILE'] = r'C:\Users\ZBJ'
env['LOCALAPPDATA'] = r'C:\Users\ZBJ\AppData\Local'
env.setdefault('SYSTEMROOT', r'C:\Windows')
# TESSERA(1104 4K 链):decode 磁盘缓冲指 E: 盘——首轮 C: temp 8.7GB 缓冲装配段挂死
# (tessera nodes._scratch_dirs 顺序 TESSERA_SCRATCH→LTX_SCRATCH→temp→output;目录须已存在)
env['TESSERA_SCRATCH'] = 'E:/IP/tmp/tessera_scratch'
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


def _say(msg):
    fh = _log_fh()
    fh.write(('[engine_task] ' + msg + '\n').encode('utf-8', errors='replace'))
    fh.flush()


def _load_stamps():
    try:
        data = json.load(open(STAMPS, encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_stamps(stamps):
    try:
        with open(STAMPS, 'w', encoding='utf-8') as fh:
            json.dump(stamps, fh)
    except OSError as exc:
        _say('stamps write fail: %s' % exc)


def _requirements_of(plugin_dir):
    """插件 requirements.txt 逐行(去注释去空行);git+ 行单列(装不动恒跳过)。"""
    path = os.path.join(plugin_dir, 'requirements.txt')
    if not os.path.isfile(path):
        return None, ''
    try:
        text = open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return None, ''
    lines = [ln.strip() for ln in text.splitlines()
             if ln.strip() and not ln.strip().startswith('#')]
    return lines, hashlib.sha256(text.encode('utf-8', errors='replace')).hexdigest()


def _pip_install(spec):
    """单条依赖装进引擎 venv(清华直连;600s 上限;返回 (ok, tail))。"""
    cmd = [VENV_PY, '-m', 'pip', 'install', '-q', spec, '-i', PIP_MIRROR]
    child = dict(env)
    child['PYTHONUTF8'] = '1'
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=600, env=child)
    except subprocess.TimeoutExpired:
        return False, 'timeout 600s'
    tail = (r.stderr or b'').decode('utf-8', errors='replace')[-200:].strip()
    return r.returncode == 0, tail


def _install_plugin_requirements(plugin, lines=None):
    """逐行装一个插件的 requirements(git+ 行跳过留日志);返回成功行数。"""
    plugin_dir = os.path.join(CUSTOM_NODES, plugin)
    if lines is None:
        lines, _ = _requirements_of(plugin_dir)
        if lines is None:
            _say('heal: %s 无 requirements.txt,跳过' % plugin)
            return 0
    ok = 0
    for spec in lines:
        if spec.startswith('git+'):
            _say('deps skip git+ (%s): %s' % (plugin, spec[:70]))
            continue
        good, tail = _pip_install(spec)
        if good:
            ok += 1
            _say('deps ok (%s): %s' % (plugin, spec[:70]))
        else:
            _say('deps FAIL (%s): %s | %s' % (plugin, spec[:70], tail))
    return ok


def reconcile_requirements():
    """①启动前对账:requirements.txt 变更件(sha256 戳)自动补装。"""
    if not os.path.isdir(CUSTOM_NODES):
        return
    stamps = _load_stamps()
    touched = False
    try:
        entries = sorted(os.listdir(CUSTOM_NODES))
    except OSError:
        return
    for plugin in entries:
        lines, digest = _requirements_of(os.path.join(CUSTOM_NODES, plugin))
        if lines is None:
            continue
        if stamps.get(plugin) == digest:
            continue
        _say('deps reconcile: %s (requirements 新增/变更)' % plugin)
        _install_plugin_requirements(plugin, lines)
        stamps[plugin] = digest
        touched = True
    if touched:
        _save_stamps(stamps)


def _engine_up(timeout_s=300):
    """引擎 HTTP 就绪探测(最长 timeout_s;返回 bool)。"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen('http://127.0.0.1:17000/system_stats', timeout=5)
            return True
        except Exception:
            time.sleep(5)
    return False


def _missing_modules(log_offset):
    """读本次启动日志段,提取「No module named」欠件插件→缺失模块映射。"""
    missing = {}
    try:
        with open(LOG, 'rb') as fh:
            fh.seek(log_offset)
            chunk = fh.read().decode('utf-8', errors='replace')
    except OSError:
        return missing
    for plugin, module in MISSING_MODULE_RE.findall(chunk):
        missing.setdefault(plugin, set()).add(module)
    return missing


def main():
    # spawn 标记行落引擎日志:TESSERA_SCRATCH 注入生效的直接证据(1104)
    _say('spawn TESSERA_SCRATCH=%s' % env['TESSERA_SCRATCH'])
    # ①启动前依赖对账(sha256 戳;变更件自动装)
    reconcile_requirements()
    # ②spawn 引擎(1105 用户令拔除 --lowvram:Cobijada 19.5G<24G 可整模驻显存,
    #   小显存时代遗产每步白走 PCIe 流送)
    offset = os.path.getsize(LOG) if os.path.exists(LOG) else 0
    subprocess.Popen(
        [VENV_PY, MAIN, '--listen', '0.0.0.0', '--port', '17000',
         '--enable-manager', '--use-pytorch-cross-attention',
         '--output-directory', OUT],
        cwd=CWD, stdout=_log_fh(), stderr=subprocess.STDOUT,
        creationflags=0x00000208, env=env)
    # ③验愈分身(detached 自身 --heal-watch):本进程保持秒退契约——调度任务即刻
    #   完成,否则期间 schtasks /Run 撞「任务正在运行」失败,deploy-dual 杀引擎
    #   重启流被卡死。分身钉死只愈一轮(gen2 不再派分身)。
    base_py = os.environ.get('ENGINE_TASK_BASE_PY', 'D:/Python312/python.exe')
    subprocess.Popen(
        [base_py, os.path.abspath(__file__), '--heal-watch', str(offset)],
        creationflags=0x00000208, env=env,
        cwd=os.path.dirname(os.path.abspath(__file__)))
    _say('heal-watch detached (offset=%d)' % offset)


def heal_watch(offset):
    """分身体:等引擎就绪→解析本次日志欠件→补装→杀引擎重启一代(gen2 不再愈)。"""
    if not _engine_up():
        _say('heal-watch: 引擎 300s 内未就绪,收工(交人工)')
        return
    missing = _missing_modules(offset)
    if not missing:
        _say('heal-watch: 引擎就绪,依赖零欠件,自愈收工')
        return
    _say('heal-watch: 检出欠件插件 %d 个,补装后重启一代' % len(missing))
    for plugin, modules in missing.items():
        _say('heal: %s 缺 %s → 重跑 requirements' % (plugin, ','.join(sorted(modules))))
        _install_plugin_requirements(plugin)
    # 杀当前引擎(斜杠双态:命令行有正斜杠与反斜杠两种历史形态,1107 实弹)
    killer = (
        "$ps = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ComfyUI[/\\\\]main\\.py' };"
        " foreach($p in $ps){ Stop-Process -Id $p.ProcessId -Force; Write-Output ('killed ' + $p.ProcessId) }")
    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', killer],
                   capture_output=True, timeout=60)
    time.sleep(3)
    # gen2:重启引擎,不再派分身(防循环)
    subprocess.Popen(
        [VENV_PY, MAIN, '--listen', '0.0.0.0', '--port', '17000',
         '--enable-manager', '--use-pytorch-cross-attention',
         '--output-directory', OUT],
        cwd=CWD, stdout=_log_fh(), stderr=subprocess.STDOUT,
        creationflags=0x00000208, env=env)
    _say('heal-watch: gen2 引擎已重启(只愈一轮,收工)')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--heal-watch':
        heal_watch(int(sys.argv[2]))
    else:
        main()

