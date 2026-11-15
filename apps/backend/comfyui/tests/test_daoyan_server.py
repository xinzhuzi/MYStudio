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

        def post(self, path):
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
                           "/my_daoyan/logs", "/my_daoyan/chapter_data",
                           "/my_daoyan/chapter_image",
                           "/my_daoyan/import_storyboard",
                           "/my_daoyan/input_media",
                           "/my_daoyan/upload_audio",
                           "/my_daoyan/shot_detail"}  # 1115 详情路由计入

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


# ══ 1115 缺口2/5/6:input_media/save_upload_audio/enhance_prompt ═════

def test_list_input_media_walk_order_whitelist_limit(tmp_path):
    """os.walk 递归含子夹;mtime 倒序(并列 name 稳定序);非图滤除;
    相对 posix 名;limit 钳;目录缺=error 不炸。"""
    media = tmp_path / "input"
    media.mkdir()

    def touch(rel, mtime):
        f = media / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        st = f.stat()
        import os
        os.utime(f, (st.st_atime, mtime))

    touch("a.png", 100)
    touch("b.jpg", 200)
    touch("3d/x.png", 300)
    touch("note.txt", 400)  # 非图滤除
    data = ds.list_input_media(media)
    assert data["count"] == 3 and not data.get("error")
    assert [f["name"] for f in data["files"]] \
        == ["3d/x.png", "b.jpg", "a.png"]  # mtime 倒序;子夹相对 posix 名
    # 并列 mtime→name 稳定序
    touch("z.png", 500)
    touch("y.png", 500)
    head = ds.list_input_media(media, 2)
    assert [f["name"] for f in head["files"]] == ["y.png", "z.png"]
    # limit 钳:m 系造足 500(盘上 510 图)→9999 钳 500 恒咬合;默认 200
    for i in range(500):
        touch(f"m{i:03d}.png", 600)
    full = ds.list_input_media(media, "9999")
    assert full["count"] == 500  # 510 件盘上,钳 500
    capped = ds.list_input_media(media)  # 默认 200
    assert capped["count"] == 200 and len(capped["files"]) == 200
    assert capped["files"][0]["name"] == "m000.png" \
        and capped["files"][-1]["name"] == "m199.png"
    assert ds.list_input_media(media, "0")["count"] == 1
    # 目录缺=error 不炸
    gone = ds.list_input_media(tmp_path / "gone")
    assert gone["files"] == [] and gone["count"] == 0 and gone.get("error")





def test_save_upload_audio_gates(tmp_path):
    """X-Filename sanitize(取 basename 防穿越)+后缀白名单+50MB 帽+落盘。"""
    inp = tmp_path / "input"
    ok = ds.save_upload_audio(inp, "ref.mp3", b"ID3data")
    assert ok["ok"] is True and ok["name"] == "ref.mp3"
    assert (inp / "ref.mp3").read_bytes() == b"ID3data"
    # sanitize:穿越名取 basename(父目录不落件)
    trav = ds.save_upload_audio(inp, "../evil.wav", b"x")
    assert trav["ok"] is True and (inp / "evil.wav").exists()
    assert not (tmp_path / "evil.wav").exists()
    # 白名单外/无后缀/空体/超 50MB 帽=拒
    assert not ds.save_upload_audio(inp, "a.exe", b"x")["ok"]
    assert not ds.save_upload_audio(inp, "noext", b"x")["ok"]
    assert not ds.save_upload_audio(inp, "a.mp3", b"")["ok"]
    assert not ds.save_upload_audio(
        inp, "big.mp3", b"x" * (50 * 1024 * 1024 + 1))["ok"]
    assert not (inp / "big.mp3").exists()


class _PostReq:
    """伪 POST request:raw read()+headers(enhance/upload_audio 消费面)。"""

    def __init__(self, body=b"", headers=None):
        self._body = body
        self.headers = headers or {}
        self.rel_url = types.SimpleNamespace(query={})

    async def read(self):
        return self._body


def test_install_new_routes_shape(tmp_path, monkeypatch):
    """三新路由注册+响应形状:input_media {files,count};upload_audio 落
    input/。"""
    routes: dict = {}
    aiohttp = types.ModuleType("aiohttp")

    class _Web:
        @staticmethod
        def json_response(data, status=200):
            return _Resp(data, status)

    aiohttp.web = _Web()

    class _Routes:
        def get(self, path):
            def deco(fn):
                routes[path] = fn
                return fn
            return deco

        post = get

    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=_Routes()))
    monkeypatch.setitem(sys.modules, "aiohttp", aiohttp)
    monkeypatch.setitem(sys.modules, "server", server)
    monkeypatch.setattr(ds, "_installed", False)
    ds.install()
    assert {"/my_daoyan/input_media", "/my_daoyan/upload_audio"} <= set(routes)
    assert "/my_daoyan/enhance_prompt" not in routes  # 1115 撤裁

    inp = tmp_path / "input"
    inp.mkdir()
    (inp / "p1.png").write_bytes(b"x")
    (inp / "p2.png").write_bytes(b"x")
    fake_fp = types.ModuleType("folder_paths")
    fake_fp.get_output_directory = lambda: str(tmp_path / "out")
    fake_fp.get_input_directory = lambda: str(inp)
    monkeypatch.setitem(sys.modules, "folder_paths", fake_fp)

    # input_media:200+{files,count},mtime 序缩略名
    out = asyncio.run(routes["/my_daoyan/input_media"](
        _Req({"limit": "10"})))
    assert out.status == 200
    assert out.payload["count"] == 2
    assert {f["name"] for f in out.payload["files"]} == {"p1.png", "p2.png"}

    # upload_audio:原始 body+X-Filename→落 input/
    up = asyncio.run(routes["/my_daoyan/upload_audio"](
        _PostReq(body=b"ID3data", headers={"X-Filename": "ref.mp3"})))
    assert up.status == 200 and up.payload["ok"] is True
    assert (inp / "ref.mp3").read_bytes() == b"ID3data"
    bad = asyncio.run(routes["/my_daoyan/upload_audio"](
        _PostReq(body=b"x", headers={"X-Filename": "a.exe"})))
    assert bad.status == 400 and bad.payload["ok"] is False


# ══ 1115 详情入 ComfyUI:shot_detail 路由 + print 九路由清单 ═══════

_LONG_PROMPT = "镜" * 300  # >160 字:证详情路由零截断(chapter_payload 才截)


def _mk_shard_project(tmp_path):
    """分片夹具:两分片并集(后片胜)+mediaRef/state 造三态。"""
    root = tmp_path / "proj" / "sb"
    cdir = root / "store" / "studio-workflow" / "chapters" / "chapter-001"
    cdir.mkdir(parents=True)

    def shard(name, shots):
        (cdir / name).write_text(json.dumps(
            {"state": {"storyboards": shots}, "version": 0},
            ensure_ascii=False), encoding="utf-8")

    shard("storyboards-001-aaa.json", [{
        "index": 1, "id": "sb-c1-001", "state": "ready",
        "prompt": _LONG_PROMPT, "videoDesc": "描述一", "lines": "台词一",
        "duration": 6, "trackKey": "001-01",
        "mediaRef": {"kind": "image", "path":
                     "project-file://p1/workflow-images/c1/sb1.png"},
        "associateAssetsNames": ["独孤剑尘", "青盐鞭"],
        "shotSemantics": {"shotSize": "全景", "cameraMove": "极缓移",
                          "actionIn": "入画", "actionOut": "出画"},
        "orientation": "正面", "spatialRelation": "中轴", "emotion": "紧绷",
        "line": "旁白一", "sound": "音效:风", "revision": 3,
    }, {
        # state 非 ready+mediaRef 空:imageReady 必须 False(语义换算)
        "index": 2, "id": "sb-c1-002", "state": "pending",
        "prompt": "描述二", "lines": "", "duration": 8,
        "mediaRef": None,
    }])
    shard("storyboards-002-bbb.json", [{
        # mediaRef kind=video(H3 回写态):videoUrl 出、imageUrl 空
        "index": 3, "id": "sb-c1-003", "state": "ready",
        "prompt": "描述三", "lines": "台词三", "duration": 5,
        "mediaRef": {"kind": "video", "path":
                     "project-file://p1/media/ai-video/2026-11/s3.mp4"},
    }])
    return root


def test_shot_detail_fifteen_columns_uncut(tmp_path):
    """单镜模式:15 列全量(长 prompt 零截断)+imageReady 语义+URL 换算。"""
    root = _mk_shard_project(tmp_path)
    data = ds.shot_detail(root, "chapter-001", "sb-c1-001", "p1")
    shot = data["shot"]
    cols = shot["columns"]
    assert len(cols) == 15  # 15 列契约
    assert [c[0] for c in cols] == [
        "镜号", "场次", "画面描述", "视频描述", "时长", "景别", "运镜",
        "动作", "朝向", "空间关系", "情绪", "台词", "旁白", "音效",
        "关联资产"]
    by_label = dict(cols)
    assert by_label["画面描述"] == _LONG_PROMPT  # 300 字全量≠160 截断
    assert by_label["台词"] == "台词一" and by_label["旁白"] == "旁白一"
    assert by_label["动作"] == "入画 → 出画"
    assert by_label["关联资产"] == "独孤剑尘、青盐鞭"
    assert shot["imageReady"] is True  # state ready+mediaRef 可定位
    assert shot["imageUrl"] == ("/my_daoyan/chapter_image?project=p1"
                                "&rel=workflow-images%2Fc1%2Fsb1.png")
    assert shot["videoUrl"] == ""  # 图期镜无视频
    assert shot["revision"] == 3
    # 换算语义:pending 镜 imageReady False(分片无字面键)
    d2 = ds.shot_detail(root, "chapter-001", "sb-c1-002", "p1")
    assert d2["shot"]["imageReady"] is False
    assert d2["shot"]["imageUrl"] == ""
    # H3 回写态:videoUrl 出、imageUrl 空
    d3 = ds.shot_detail(root, "chapter-001", "sb-c1-003", "p1")
    assert d3["shot"]["videoUrl"].startswith("/my_daoyan/chapter_image")
    assert "media%2Fai-video%2F" in d3["shot"]["videoUrl"]
    assert d3["shot"]["imageUrl"] == ""
    # 缺镜/非法章
    assert ds.shot_detail(root, "chapter-001", "sb-xx", "p1").get("error")
    assert ds.shot_detail(root, "../etc", "sb-c1-001").get("error")


def test_shot_detail_chapter_list_mode(tmp_path):
    """清单模式:无 shot_id=整章 id 清单(浮层下钻+旧行对齐兜底双用)。"""
    root = _mk_shard_project(tmp_path)
    data = ds.shot_detail(root, "chapter-001", "", "p1")
    assert data["count"] == 3 and not data.get("error")
    assert [s["id"] for s in data["shots"]] \
        == ["sb-c1-001", "sb-c1-002", "sb-c1-003"]
    assert data["shots"][0]["imageReady"] is True
    assert data["shots"][1]["imageReady"] is False
    assert data["shots"][0]["title"] == _LONG_PROMPT[:18]  # 清单行短标题


def test_shot_detail_video_media_whitelist(tmp_path):
    """chapter_image 视频扩:media/ai-video/*.mp4 可读;白名单外语义不变。"""
    root = _mk_shard_project(tmp_path)
    vdir = root / "media" / "ai-video" / "2026-11"
    vdir.mkdir(parents=True)
    (vdir / "s3.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    data, err = ds.chapter_image_bytes(root, "media/ai-video/2026-11/s3.mp4")
    assert data is not None and data.startswith(b"\x00\x00") and not err
    # 白名单外/穿越/非图语义逐字保留(test_daoyan_cockpit 同钉)
    assert ds.chapter_image_bytes(
        root, "../projects/store.json")[0] is None
    assert ds.chapter_image_bytes(
        root, "novel/drama/x.md")[1] == "路径不在分镜图/连续性资产白名单"
    assert ds.chapter_image_bytes(
        root, "media/ai-video/2026-11/note.txt")[1] == "图不存在或非图件"


def test_install_shot_detail_route_and_print(tmp_path, monkeypatch, capsys):
    """路由注册+响应形状+print 九路由逐名断言(1115 print 修正钉)。"""
    root = _mk_shard_project(tmp_path)
    home = _mk_app_home(
        tmp_path,
        projects=[{"id": "p1", "name": "道劫", "location": str(root)}],
        active="p1",
        locations={"p1": str(root)})
    monkeypatch.setenv("MYSTUDIO_APP_HOME", str(home))

    routes: dict = {}
    aiohttp = types.ModuleType("aiohttp")

    class _Web:
        @staticmethod
        def json_response(data, status=200):
            return _Resp(data, status)

        @staticmethod
        def Response(body=None, content_type=None):
            return _Resp({"body": body, "ctype": content_type})

    aiohttp.web = _Web()

    class _Routes:
        def get(self, path):
            def deco(fn):
                routes[path] = fn
                return fn
            return deco

        post = get

    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=_Routes()))
    monkeypatch.setitem(sys.modules, "aiohttp", aiohttp)
    monkeypatch.setitem(sys.modules, "server", server)
    monkeypatch.setattr(ds, "_installed", False)
    ds.install()

    # print 清单=九路由逐名在案(chapter_data/chapter_image/
    # import_storyboard 旧漏三路由回补+shot_detail 计入+不悬「、」)
    out = capsys.readouterr().out
    for name in ("/my_daoyan/projects", "/my_daoyan/chapters",
                 "/my_daoyan/logs", "/my_daoyan/chapter_data",
                 "/my_daoyan/chapter_image",
                 "/my_daoyan/import_storyboard", "/my_daoyan/input_media",
                 "/my_daoyan/upload_audio", "/my_daoyan/shot_detail"):
        assert name in out, name
    assert not out.rstrip("\n").endswith("、")  # 旧悬「、」退役

    # shot_detail 路由:清单 200/单镜 200/缺镜 404/缺项目 404
    lst = asyncio.run(routes["/my_daoyan/shot_detail"](
        _Req({"project": "p1", "chapter": "chapter-001"})))
    assert lst.status == 200 and lst.payload["count"] == 3
    one = asyncio.run(routes["/my_daoyan/shot_detail"](
        _Req({"project": "p1", "chapter": "chapter-001",
              "shot_id": "sb-c1-001"})))
    assert one.status == 200 and len(one.payload["shot"]["columns"]) == 15
    miss = asyncio.run(routes["/my_daoyan/shot_detail"](
        _Req({"project": "p1", "chapter": "chapter-001",
              "shot_id": "sb-xx"})))
    assert miss.status == 404 and miss.payload["error"]
    noproj = asyncio.run(routes["/my_daoyan/shot_detail"](
        _Req({"project": "zz", "chapter": "chapter-001"})))
    assert noproj.status == 404 and noproj.payload["error"]

