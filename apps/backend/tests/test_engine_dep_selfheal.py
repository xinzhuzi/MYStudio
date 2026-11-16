# -*- coding: utf-8 -*-
"""engine_task.py 依赖自愈纯函数离线测试(11-07-engine-dep-selfheal)。

engine_task 在 Windows 调度器域执行,本测试只覆盖可移植纯函数:
欠件正则(正/反斜杠双形态+多插件聚合)、requirements 行筛选(git+/注释/空行)。
"""
import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_SCRIPT = (Path(__file__).resolve().parents[2]
           / "build" / "scripts" / "win-engine" / "engine_task.py")


def _load_module():
    """importlib 加载引擎启动脚本(模块级只定义常量与函数,Popen 在 main 内)。"""
    spec = importlib.util.spec_from_file_location("engine_task_mod", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_missing_module_regex_both_slash_forms():
    mod = _load_module()
    chunk = (
        "[WARNING] Cannot import E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes\\ComfyUI-Impact-Pack "
        "module for custom nodes: No module named 'segment_anything'\n"
        "[WARNING] Cannot import E:/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/CRT-Nodes "
        "module for custom nodes: No module named 'soundfile'\n"
    )
    # 直接驱动正则(不触盘:_missing_modules 读 LOG 文件,离线不可用)
    found = {}
    for plugin, module in mod.MISSING_MODULE_RE.findall(chunk):
        found.setdefault(plugin, set()).add(module)
    assert found == {
        "ComfyUI-Impact-Pack": {"segment_anything"},
        "CRT-Nodes": {"soundfile"},
    }


def test_missing_module_regex_ignores_other_causes():
    mod = _load_module()
    chunk = (
        "[WARNING] Cannot import E:\\IP\\x\\custom_nodes\\ComfyUI-LTXVideo "
        "module for custom nodes: Could not load this library: torchaudio\n"
    )
    assert mod.MISSING_MODULE_RE.findall(chunk) == []


def test_requirements_lines_filter(tmp_path, monkeypatch):
    mod = _load_module()
    req = tmp_path / "requirements.txt"
    req.write_text(
        "# 注释行\n"
        "segment-anything\n"
        "\n"
        "git+https://github.com/facebookresearch/sam2\n"
        "opencv-python-headless>=4.7\n",
        encoding="utf-8",
    )
    lines, digest = mod._requirements_of(str(tmp_path))
    # git+ 行保留在 lines 里由安装步跳过(单列可见性),注释/空行剔除
    assert lines == [
        "segment-anything",
        "git+https://github.com/facebookresearch/sam2",
        "opencv-python-headless>=4.7",
    ]
    assert len(digest) == 64
    # 同内容恒同戳
    _, digest2 = mod._requirements_of(str(tmp_path))
    assert digest == digest2
    # 无 requirements.txt → (None, '')
    empty = tmp_path / "nope"
    empty.mkdir()
    assert mod._requirements_of(str(empty)) == (None, "")


def test_stamps_roundtrip(tmp_path, monkeypatch):
    mod = _load_module()
    stamp_file = tmp_path / "stamps.json"
    monkeypatch.setattr(mod, "STAMPS", str(stamp_file))
    assert mod._load_stamps() == {}
    mod._save_stamps({"a": "1"})
    assert mod._load_stamps() == {"a": "1"}
    stamp_file.write_text("broken{", encoding="utf-8")
    assert mod._load_stamps() == {}  # 损坏容错回空


# ---- 1116 端口在位跳过门(EngineDurable 重触发免疫,11-16-engine-task-port-gate) ----


def _patch_main_harness(mod, monkeypatch):
    """main() 离线驱动架:_say/_log_fh/Popen/reconcile 全部替换,零触盘。"""
    says, popens = [], []
    monkeypatch.setattr(mod, '_say', lambda m: says.append(m))
    monkeypatch.setattr(mod, '_log_fh', lambda: None)  # spawn 路 stdout=_log_fh() 直呼真身
    monkeypatch.setattr(mod, 'reconcile_requirements', lambda: says.append('RECONCILE'))
    monkeypatch.setattr(
        mod.subprocess, 'Popen',
        lambda *a, **k: popens.append(list(a[0])) and None)
    return says, popens


def test_main_skips_when_engine_port_up(monkeypatch):
    """引擎已监听 → main() 不 spawn 不对账,落 skip 日志即收工。"""
    mod = _load_module()
    says, popens = _patch_main_harness(mod, monkeypatch)
    monkeypatch.setattr(mod, '_engine_port_up', lambda: True)
    monkeypatch.setattr(mod, '_engine_proc_alive', lambda: False)
    mod.main()
    assert says and says[0].startswith('skip:')
    assert 'RECONCILE' not in says
    assert popens == []


def test_main_skips_when_engine_proc_alive_startup_window(monkeypatch):
    """启动窗口(进程在、端口未开)同样跳过——13s 连发簇免疫的关键态。"""
    mod = _load_module()
    says, popens = _patch_main_harness(mod, monkeypatch)
    monkeypatch.setattr(mod, '_engine_port_up', lambda: False)
    monkeypatch.setattr(mod, '_engine_proc_alive', lambda: True)
    mod.main()
    assert any(s.startswith('skip:') for s in says)
    assert 'RECONCILE' not in says
    assert popens == []


def test_main_spawns_when_engine_absent(monkeypatch):
    """引擎不在位 → 门放行:spawn 引擎本体 + heal-watch 分身两件照旧。"""
    mod = _load_module()
    says, popens = _patch_main_harness(mod, monkeypatch)
    monkeypatch.setattr(mod, '_engine_port_up', lambda: False)
    monkeypatch.setattr(mod, '_engine_proc_alive', lambda: False)
    mod.main()
    assert not any(s.startswith('skip:') for s in says)
    assert 'RECONCILE' in says
    assert len(popens) == 2
    # 第一件=引擎本体(venv python + main.py + --port 17000);第二件=分身 --heal-watch
    assert any('main.py' in str(a) and '17000' in str(a) for a in popens)
    assert any('--heal-watch' in str(a) for a in popens)


def test_engine_proc_alive_parses_measure_count(monkeypatch):
    """Measure-Object 口径输出解析:>0 在位;0/非数字/异常不在位(fail-open)。"""
    mod = _load_module()

    class _R:
        def __init__(self, out):
            self.returncode = 0
            self.stdout = out

    monkeypatch.setattr(mod.subprocess, 'run', lambda *a, **k: _R(b'2\r\n'))
    assert mod._engine_proc_alive() is True
    monkeypatch.setattr(mod.subprocess, 'run', lambda *a, **k: _R(b'0\r\n'))
    assert mod._engine_proc_alive() is False
    # 探针输出非数字(异常形态)→不在位,不拦冷启动
    monkeypatch.setattr(mod.subprocess, 'run', lambda *a, **k: _R(b''))
    assert mod._engine_proc_alive() is False


def test_engine_proc_alive_failopen_on_probe_error(monkeypatch):
    """powershell 不存在/超时等异常 → False(fail-open=退回旧无门行为)。"""
    mod = _load_module()

    def _boom(*a, **k):
        raise OSError('no powershell')

    monkeypatch.setattr(mod.subprocess, 'run', _boom)
    assert mod._engine_proc_alive() is False
