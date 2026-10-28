# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available via COMMERCIAL_LICENSE.md.
"""1028 Windows 枚举补码回归(S15 终局链遗留 §三.7,final-chain-1028.md)。

病灶:engine_manager._engine_home_processes 原 POSIX-only(Windows 分支显式
return None)=Windows 侧车结构性无法枚举/收编已 spawn 引擎。本役:Windows
走 PowerShell Win32_Process 清单(一次子进程取全机 pid/exe/argv),判据/
匹配环与 POSIX 同源共用。测试面=纯函数+组装层(os.name=nt 桩):
· _parse_win_process_csv:实弹 CSV 形态锚(1029 探针 E:/IP/漫影工作室,
  pid 20088 活引擎=正斜杠 argv+反斜杠 exe;pid 20240=别家 python 跑同
  main.py=双判据外;null 字段=空段;嵌入引号 CSV 倍增);
· _engine_home_processes Windows 分支:命中/分隔符归一/二道门/三态 None;
· POSIX 分支不变钉:同桩下 os.name 还原后 ps 路径照旧(既有
  test_engine_dynamic_continuation.py 全套为本钉的正源,此处不重复)。
零网络零真实子进程(清单来源=monkeypatch subprocess.run)。
mac 运行器须知:os.name=nt 桩会让 pathlib 3.13+ 在 POSIX 机上按 Windows
风味实例化 Path(UnsupportedOperation,真 Windows 无此事)——凡触达
_home_engine_markers/_exe_path_in_home_venv 的用例先冻结 cm 路径产物
(桩前捕获,见 _freeze_windows_paths)。
"""
from __future__ import annotations

import os
import subprocess as _sp

from comfyui import engine_manager as em
from comfyui import manifest as cm

# 1029 实弹探针节选(E:/IP/漫影工作室 真机 ConvertTo-Csv 原始形态):
# 表头全引号、null=空段相邻逗号、嵌入引号倍增、\r\n 行尾。
_LIVE_CSV_HEAD = (
    '"ProcessId","ExecutablePath","CommandLine"\r\n'
    '"0",,\r\n'
    '"4",,\r\n'
    '"1916","C:\\Windows\\system32\\svchost.exe",'
    '"C:\\Windows\\system32\\svchost.exe -k DcomLaunch -p"\r\n'
    '"1948","C:\\Windows\\system32\\fontdrvhost.exe","""fontdrvhost.exe"""\r\n')


def _plant_installed_engine(tmp_path, monkeypatch):
    """已装引擎的家(照 dynamic_continuation 口径):markers 随家走。"""
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    cm._read_cache.clear()
    cm.mutate_manifest(lambda m: m.update({"engine": {"version": "v0.9.2", "port": 17600}}))
    src = cm.engine_source_dir()
    src.mkdir(parents=True, exist_ok=True)
    (src / "main.py").write_text("print('engine')\n", encoding="utf-8")
    return home


def _freeze_windows_paths(monkeypatch) -> tuple[str, str, object]:
    """冻结 cm 路径产物(os.name=nt 桩**前**调用)。

    返回 (venv_py, main_py) 字符串;并把 _home_engine_markers 与二道门
    用到的 cm.venv_dir/cm.venv_python 钉到桩前捕获的 Path 实例(POSIX
    风味对象,方法调用不再按 os.name 现查风味)——Windows 分支全链即可
    在 mac 运行器上如真跑(真 Windows 上 pathlib 原生 WindowsPath,无此桩)。
    """
    venv_py_path = cm.venv_python()
    venv_dir_path = cm.venv_dir()
    main_py = str(cm.engine_source_dir() / "main.py")
    monkeypatch.setattr(em, "_home_engine_markers", lambda: (str(venv_py_path), main_py))
    monkeypatch.setattr(cm, "venv_dir", lambda: venv_dir_path)
    monkeypatch.setattr(cm, "venv_python", lambda: venv_py_path)
    return str(venv_py_path), main_py, venv_dir_path


def _fake_powershell(monkeypatch, csv_text: str):
    """Win32_Process 清单桩:只认 powershell 子进程(跨平台桩纪律),
    返回给定 CSV;ps 调用=测试写错,当场炸。"""
    def fake_run(argv, **kwargs):
        assert argv[0] == "powershell", "Windows 枚举走 PowerShell,不得跑 ps"
        assert "-Command" in argv and "Win32_Process" in " ".join(argv)

        class _R:
            stdout = csv_text
            returncode = 0

        return _R()

    monkeypatch.setattr(em.subprocess, "run", fake_run)


# ── 纯函数:Win32_Process CSV 解析(实弹形态锚) ─────────────────────

class TestParseWinProcessCsv:
    def test_live_shape_null_fields_and_doubled_quotes(self):
        records = em._parse_win_process_csv(_LIVE_CSV_HEAD)
        assert records == [
            {"pid": 4, "exe": "", "args": ""},  # pid 0 按纪律跳过(镜像 _parse_ps_pid_args)
            {"pid": 1916, "exe": "C:\\Windows\\system32\\svchost.exe",
             "args": "C:\\Windows\\system32\\svchost.exe -k DcomLaunch -p"},
            {"pid": 1948, "exe": "C:\\Windows\\system32\\fontdrvhost.exe",
             "args": '"fontdrvhost.exe"'},  # CSV 倍增引号还原为原文一对
        ]

    def test_nonpositive_pid_skipped(self):
        """pid≤0(System Idle 等)不入选手清单——与 POSIX 解析纪律同源。"""
        stdout = '"ProcessId","ExecutablePath","CommandLine"\r\n"0",,\r\n"-5",,\r\n"9","e","a"\r\n'
        assert em._parse_win_process_csv(stdout) == [{"pid": 9, "exe": "e", "args": "a"}]

    def test_garbage_rows_skipped(self):
        stdout = ('"ProcessId","ExecutablePath","CommandLine"\r\n'
                  '"abc","x","y"\r\n'   # 非数字 pid
                  '"-5","x","y"\r\n'    # 负 pid
                  '"",,\r\n'             # 空 pid
                  '"12","only-two-cols"\r\n'  # 短行
                  '\r\n'                 # 空行
                  '"70001","e","a b c"\r\n')
        assert em._parse_win_process_csv(stdout) == [{"pid": 70001, "exe": "e", "args": "a b c"}]

    def test_missing_or_foreign_header_returns_none(self):
        assert em._parse_win_process_csv("") is None
        assert em._parse_win_process_csv("not,a,csv\r\n1,2,3\r\n") is None
        # 列名不全(缺 ExecutablePath)=清单不可信
        assert em._parse_win_process_csv('"ProcessId","CommandLine"\r\n"1","x"\r\n') is None

    def test_column_order_agnostic(self):
        stdout = ('"CommandLine","ProcessId","ExecutablePath"\r\n'
                  '"run --port 1","42","C:\\py.exe"\r\n')
        assert em._parse_win_process_csv(stdout) == [
            {"pid": 42, "exe": "C:\\py.exe", "args": "run --port 1"}]

    def test_header_only_means_empty_list(self):
        """表头在=清单拿到(空表=确证无),与 None(不可用)三态两分。"""
        assert em._parse_win_process_csv('"ProcessId","ExecutablePath","CommandLine"\r\n') == []


# ── 组装层:Windows 分支(_engine_home_processes 经 os.name=nt 桩) ──

class TestEngineHomeProcessesWindows:
    def test_live_absolute_form_hit_and_foreign_python_excluded(self, tmp_path, monkeypatch):
        """实弹样本:自家 venv python 跑 main.py 命中(含口提取);别家
        python(D:\\Python312)跑同 main.py=双判据外,排除。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py, main_py, _ = _freeze_windows_paths(monkeypatch)
        engine_argv = f"{venv_py} {main_py} --listen 127.0.0.1 --port 17000"
        csv_text = (_LIVE_CSV_HEAD
                    + f'"20088","{venv_py}","{engine_argv}"\r\n'
                    + f'"20240","D:\\Python312\\python.exe",'
                    f'"D:\\Python312\\python.exe {main_py} --port 17000"\r\n')
        _fake_powershell(monkeypatch, csv_text)
        monkeypatch.setattr(os, "name", "nt")
        assert em._engine_home_processes() == [
            {"pid": 20088, "port": 17000, "args": engine_argv}]

    def test_backslash_argv_normalized_to_hit(self, tmp_path, monkeypatch):
        """分隔符归一是绝对形态生死线:cm.venv_python() 反斜杠形态 vs argv
        反斜杠形态,两侧归一后必须命中(实弹:argv 亦可为正斜杠,同码覆盖)。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py, main_py, _ = _freeze_windows_paths(monkeypatch)
        argv_bs = f"{venv_py} {main_py} --port 17600".replace("/", "\\")
        exe_bs = venv_py.replace("/", "\\")
        csv_text = ('"ProcessId","ExecutablePath","CommandLine"\r\n'
                    f'"31100","{exe_bs}","{argv_bs}"\r\n')
        _fake_powershell(monkeypatch, csv_text)
        monkeypatch.setattr(os, "name", "nt")
        found = em._engine_home_processes()
        assert found == [{"pid": 31100, "port": 17600, "args": argv_bs}], \
            "命中记录 args=平台原文(反斜杠形态回填,与 POSIX 结果语义对齐)"

    def test_quoted_argv_token_survives_substring_match(self, tmp_path, monkeypatch):
        """带空格路径的 argv token 被 Windows 引号包裹:引号只包 token 外缘,
        子串判据(路径本体)不受影响;CSV 层嵌入引号按规范倍增(实弹形态)。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py, main_py, _ = _freeze_windows_paths(monkeypatch)
        argv_quoted = f'"{venv_py}" "{main_py}" --port 17601'
        csv_field = '"' + argv_quoted.replace('"', '""') + '"'
        csv_text = ('"ProcessId","ExecutablePath","CommandLine"\r\n'
                    f'"31101","{venv_py}",{csv_field}\r\n')
        _fake_powershell(monkeypatch, csv_text)
        monkeypatch.setattr(os, "name", "nt")
        assert em._engine_home_processes() == [
            {"pid": 31101, "port": 17601, "args": argv_quoted}]

    def test_relative_form_requires_exe_gate(self, tmp_path, monkeypatch):
        """相对形态(keeper/装机配方):命中候选须过 G7 二道门——同清单
        ExecutablePath 在本家 venv 才算自家;别家同布局 exe=排除。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py, main_py, venv_root = _freeze_windows_paths(monkeypatch)
        rel_argv = "./venv/bin/python ./ComfyUI/main.py --port 17602"
        home_exe = venv_root / "bin" / "python"
        home_exe.parent.mkdir(parents=True, exist_ok=True)
        home_exe.write_text("", encoding="utf-8")
        csv_text = (
            '"ProcessId","ExecutablePath","CommandLine"\r\n'
            f'"31102","{home_exe}","{rel_argv}"\r\n'
            f'"31103","/opt/other/venv/bin/python","{rel_argv}"\r\n')
        _fake_powershell(monkeypatch, csv_text)
        monkeypatch.setattr(os, "name", "nt")
        found = em._engine_home_processes()
        assert [info["pid"] for info in found] == [31102]
        assert found[0]["port"] == 17602 and found[0]["args"] == rel_argv
        # 复核:相对形态命中证明归一与尾段匹配(_argv_matches_home_relative)
        # 在 Windows 分支同码生效;markers 为 mac 运行器尾段(venv/bin/python),
        # 真 Windows 尾段(venv/Scripts/python.exe)由 1029 实弹探针坐实同构。

    def test_empty_listing_means_confirmed_empty_list(self, tmp_path, monkeypatch):
        """清单正常拿到但无命中=确证空表(不是 None)——三态两分钉死。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        _freeze_windows_paths(monkeypatch)
        _fake_powershell(monkeypatch, _LIVE_CSV_HEAD)
        monkeypatch.setattr(os, "name", "nt")
        assert em._engine_home_processes() == []

    def test_powershell_failure_returns_unavailable_none(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        monkeypatch.setattr(os, "name", "nt")

        def fake_run(argv, **kwargs):
            raise OSError("no powershell")

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_powershell_timeout_returns_unavailable_none(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        monkeypatch.setattr(os, "name", "nt")

        def fake_run(argv, **kwargs):
            raise _sp.TimeoutExpired(cmd="powershell", timeout=15.0)

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_powershell_nonzero_exit_returns_unavailable_none(self, tmp_path, monkeypatch):
        _plant_installed_engine(tmp_path, monkeypatch)
        monkeypatch.setattr(os, "name", "nt")

        def fake_run(argv, **kwargs):
            class _R:
                stdout = ""
                returncode = 1

            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() is None

    def test_unparseable_stdout_returns_unavailable_none(self, tmp_path, monkeypatch):
        """rc=0 但输出不是 Win32_Process CSV(表头缺列)=清单不可信,
        按不可用处理——绝不降级空表(空表=确证无实例的假确证)。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        _fake_powershell(monkeypatch, "OK\r\n")
        monkeypatch.setattr(os, "name", "nt")
        assert em._engine_home_processes() is None


# ── POSIX 分支不变钉(同文件同桩,跨分支对照) ────────────────────────

class TestPosixBranchUnchanged:
    def test_posix_branch_still_runs_ps(self, tmp_path, monkeypatch):
        """os.name 还原后(mac 运行器)照旧走 ps 路径——POSIX 行为零变。"""
        _plant_installed_engine(tmp_path, monkeypatch)
        venv_py = str(cm.venv_python())
        main_py = str(cm.engine_source_dir() / "main.py")
        argv = f"{venv_py} {main_py} --port 17603"

        def fake_run(argv_, **kwargs):
            assert argv_[0] == "ps", "POSIX 分支照旧跑 ps"

            class _R:
                stdout = f"  PID ARGS\n29436 {argv}\n"
                returncode = 0

            return _R()

        monkeypatch.setattr(em.subprocess, "run", fake_run)
        assert em._engine_home_processes() == [
            {"pid": 29436, "port": 17603, "args": argv}]
