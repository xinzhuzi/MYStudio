# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台面板路由测试(11-13-director-console-remake 阶段3.5,1114)。

被测对象 = my_nodes/daoyan_server.py:
- 纯函数注入 tmp app-home:projects 合并(locations 路径权威覆盖 store
  location)+activeProjectId;chapters 扫 drama 文件+章名双 fallback
  (chapters/ 首行→drama 首行→空)+缺目录 error;logs 尾读 N 行+chapter
  含 /、\\、..、>80 拒收
- 双环境降级:store 缺→error+空表;MYSTUDIO_APP_HOME 已设但缺=响亮
  print 原路返回不偷滑
- install 壳:伪 aiohttp/server 模块(零真 aiohttp)断言三路由响应形状
  (projects 200/chapters 200+404/logs 200+400+404)
"""
from __future__ import annotations

import asyncio
import json
import sys
import types

from comfyui.my_nodes import daoyan_server as ds


def _mk_app_home(tmp_path, projects=None, active=None, locations=None):
    home = tmp_path / "apphome"
    home.mkdir(parents=True, exist_ok=True)
    (home / "projects").mkdir(exist_ok=True)
    if projects is not None:
        (home / "projects" / "mystudio-project-store.json").write_text(
            json.dumps({"state": {"projects": projects,
                                  "activeProjectId": active}, "version": 0},
                       ensure_ascii=False), encoding="utf-8")
    if locations is not None:
        (home / "project-locations.json").write_text(
            json.dumps({"version": 1, "locations": locations},
                       ensure_ascii=False), encoding="utf-8")
    return home


def _mk_project(tmp_path, name="p1", chapters=(), chapter_titles=None,
                drama_first_lines=None):
    root = tmp_path / "proj" / name
    (root / "novel" / "drama").mkdir(parents=True, exist_ok=True)
    (root / "novel" / "chapters").mkdir(exist_ok=True)
    for i in chapters:
        (root / "novel" / "drama" / f"chapter-{i:03d}_漫剧.md").write_text(
            (drama_first_lines or {}).get(i, f"# 道劫 EP{i:02d}"),
            encoding="utf-8")
        title = (chapter_titles or {}).get(i)
        if title is not None:
            (root / "novel" / "chapters" / f"chapter-{i:03d}.md").write_text(
                f"# {title}", encoding="utf-8")
    return root


# ── 纯函数:projects/chapters/logs ────────────────────────────────────

def test_projects_merge_locations_store_active(tmp_path):
    root = _mk_project(tmp_path)
    home = _mk_app_home(
        tmp_path,
        projects=[{"id": "p1", "name": "道劫", "location": "/old/path"},
                  {"id": "p2", "name": "备选", "location": str(root)}],
        active="p1",
        locations={"p1": str(root)})
    data = ds.list_projects(home)
    assert data["activeProjectId"] == "p1"
    assert not data.get("error")
    by_id = {p["id"]: p for p in data["projects"]}
    assert by_id["p1"]["location"] == str(root)  # locations=路径权威覆盖
    assert by_id["p2"]["location"] == str(root)  # 无 locations 条目→store 兜底
    assert by_id["p1"]["name"] == "道劫"


def test_projects_store_missing_error(tmp_path):
    data = ds.list_projects(_mk_app_home(tmp_path))
    assert data["projects"] == [] and data["activeProjectId"] is None
    assert data["error"]  # 缺/坏→error 字段+空表,不炸


def test_chapters_scan_dual_fallback(tmp_path):
    root = _mk_project(tmp_path, chapters=[1, 2],
                       chapter_titles={1: "第1章：断剑为谁而鸣"},
                       drama_first_lines={2: "# 道劫 EP01：断剑初醒"})
    home = _mk_app_home(tmp_path,
                        projects=[{"id": "p1", "name": "道劫",
                                   "location": str(root)}],
                        active="p1")
    data = ds.list_chapters(home, "p1")
    assert data["count"] == 2 and not data.get("error")
    c1, c2 = data["chapters"]
    assert c1["id"] == "chapter-001" and c1["n"] == 1
    assert c1["title"] == "第1章：断剑为谁而鸣"  # chapters/ 首行
    assert c2["id"] == "chapter-002"
    assert c2["title"] == "道劫 EP01：断剑初醒"  # fallback:drama 首行


def test_chapters_missing_project_or_dir(tmp_path):
    home = _mk_app_home(tmp_path, projects=[], active=None)
    assert ds.list_chapters(home, "nope").get("error")  # pid 不在册
    home2 = _mk_app_home(
        tmp_path,
        projects=[{"id": "p1", "name": "x", "location": str(tmp_path / "gone")}])
    data = ds.list_chapters(home2, "p1")
    assert data["chapters"] == [] and data["count"] == 0
    assert data.get("error")  # 位置盘上不存在


def test_read_run_log_tail_and_reject(tmp_path):
    out_root = tmp_path / "out"
    log_dir = out_root / "video/导演台" / "c001"
    log_dir.mkdir(parents=True)
    (log_dir / "run-log.txt").write_text(
        "\n".join(f"L{i}" for i in range(10)), encoding="utf-8")
    data = ds.read_run_log(out_root, "c001", 3)
    assert data["lines"] == ["L7", "L8", "L9"]
    assert "run-log.txt" in data["path"] and not data.get("error")
    # 拒收:路径分隔/../超长(防穿越真边界;中文章名放行=缺失面)
    for bad in ("a/b", "a\\b", "..", "x" * 81, "第" * 41 + "章" * 40):
        assert ds.read_run_log(out_root, bad)["error"], bad
    assert "不存在" in ds.read_run_log(out_root, "不存在的章")["error"]


def test_app_home_env_loud_missing(tmp_path, monkeypatch, capsys):
    gone = tmp_path / "gone-home"
    monkeypatch.setenv("MYSTUDIO_APP_HOME", str(gone))
    home = ds._app_home()
    assert home == gone  # 已设但缺=响亮降级原路返回,不偷滑低层
    assert "MYSTUDIO_APP_HOME" in capsys.readouterr().out
    data = ds.list_projects(home)  # 双环境降级:error+空表
    assert data["projects"] == [] and data["error"]


# ── install 壳:伪 aiohttp/server 断言路由响应形状 ────────────────────

class _Resp:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status


class _Req:
    def __init__(self, query):
        self.rel_url = types.SimpleNamespace(query=query)  # dict.get 同面


def test_install_routes_shape(tmp_path, monkeypatch):
    root = _mk_project(tmp_path, chapters=[1],
                       chapter_titles={1: "第1章：断剑为谁而鸣"})
    home = _mk_app_home(
        tmp_path,
        projects=[{"id": "p1", "name": "道劫", "location": str(root)}],
        active="p1")
    monkeypatch.setenv("MYSTUDIO_APP_HOME", str(home))

    aiohttp = types.ModuleType("aiohttp")

    class _Web:
        @staticmethod
        def json_response(data, status=200):
            return _Resp(data, status)

    aiohttp.web = _Web()
    routes: dict = {}

    class _Routes:
        def get(self, path):
            def deco(fn):
                routes[path] = fn
                return fn
            return deco

    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=_Routes()))
    monkeypatch.setitem(sys.modules, "aiohttp", aiohttp)
    monkeypatch.setitem(sys.modules, "server", server)
    monkeypatch.setattr(ds, "_installed", False)
    ds.install()
    assert set(routes) == {"/my_daoyan/projects", "/my_daoyan/chapters",
                           "/my_daoyan/logs"}

    # projects:200+activeProjectId
    out = asyncio.run(routes["/my_daoyan/projects"](_Req({})))
    assert out.status == 200
    assert out.payload["activeProjectId"] == "p1"
    assert [p["id"] for p in out.payload["projects"]] == ["p1"]

    # chapters:在册 200/不在册 404 带 error
    ch = asyncio.run(routes["/my_daoyan/chapters"](_Req({"project": "p1"})))
    assert ch.status == 200 and ch.payload["count"] == 1
    assert ch.payload["chapters"][0]["id"] == "chapter-001"
    miss = asyncio.run(routes["/my_daoyan/chapters"](_Req({"project": "zz"})))
    assert miss.status == 404 and miss.payload["error"]

    # logs:伪输出根注入(folder_paths 惰性位);400 非法/404 缺失/200 尾读
    out_root = tmp_path / "outroot"
    fake_fp = types.ModuleType("folder_paths")
    fake_fp.get_output_directory = lambda: str(out_root)
    monkeypatch.setitem(sys.modules, "folder_paths", fake_fp)
    bad = asyncio.run(routes["/my_daoyan/logs"](_Req({"chapter": "a/b"})))
    assert bad.status == 400 and bad.payload["error"]
    missing = asyncio.run(routes["/my_daoyan/logs"](_Req({"chapter": "c1"})))
    assert missing.status == 404 and missing.payload["error"]
    log_dir = out_root / "video/导演台" / "c1"
    log_dir.mkdir(parents=True)
    (log_dir / "run-log.txt").write_text("a\nb\nc\n", encoding="utf-8")
    ok = asyncio.run(routes["/my_daoyan/logs"](
        _Req({"chapter": "c1", "limit": "2"})))
    assert ok.status == 200
    assert ok.payload["lines"] == ["b", "c"]
    assert ok.payload["chapter"] == "c1"
