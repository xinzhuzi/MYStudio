# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台面板服务端(11-13-director-console-remake 阶段3.5,1114)。

三条只读路由(my_styles_server.py 同款 install 幂等自守卫+失败静默纪律):
  GET /my_daoyan/projects
      → {projects:[{id,name}],activeProjectId,error?}(store 缺/坏→error+空表)
  GET /my_daoyan/chapters?project=<pid>
      → {chapters:[{id,n,title}],count,error?}(全量返回,~4125 条原生
        select 可承载;缺项目/位置不存在→404 带 error)
  GET /my_daoyan/logs?chapter=<v>&limit=500
      → {chapter,path,lines[],error?}(尾 N 行;文件缺失 404;chapter 含
        /、\\、.. 或 >80 字符拒收——防穿越真边界,中文章名放行)

数据源(地基实读验证,selectorSpec 1114):
- 项目册=<app-home>/projects/mystudio-project-store.json
  {state:{projects:[{id,name,location}],activeProjectId},version:0}(显示名)
- 路径权威=<app-home>/project-locations.json{version:1,locations:{pid:路径}}
  (渲染册 Project.location 仅显示;合并时 locations 覆盖 store location)
- 章节=/{位置}/novel/drama/chapter-NNN_漫剧.md(按 NNN 排序);章名=
  /{位置}/novel/chapters/chapter-NNN.md 首行,缺则 drama 首行,再缺空串

定位纪律(my_daojie_route.py 同款,禁硬编码绝对路径):
_app_home()=env MYSTUDIO_APP_HOME 显式覆盖(已设但缺=print 响亮降级返回
该路径,不偷滑低层)→默认 Path.home()/'Library/Application Support/
漫影工作室'(地基权威位,home 相对非绝对硬编码)。Windows app-home 布局
本期不覆盖=路由带 error 字段、面板降级(如实声明,不猜路径)。
读盘逻辑全纯函数参数注入(list_projects/list_chapters/read_run_log)=
tmp 目录可测,aiohttp 只进 install 壳。
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .nodes.director_executor import OUT_DIR_ROOT

_installed = False

_CHAPTER_NUM = re.compile(r"^chapter-(\d+)")
MAX_CHAPTER_LEN = 80


def _app_home() -> Path:
    """漫影 app-home 定位(env 显式覆盖响亮降级;默认地基权威位)。"""
    env = os.environ.get("MYSTUDIO_APP_HOME")
    if env:
        home = Path(env)
        if not home.is_dir():
            print(f"[daoyan] MYSTUDIO_APP_HOME 已设但缺 {home}:"
                  "响亮降级原路返回(显式覆盖失效须排查,不偷滑低层)",
                  flush=True)
        return home
    return Path.home() / "Library" / "Application Support" / "漫影工作室"


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _first_line(path: Path) -> str:
    """md 首行→章名(去 ``#`` 前缀与空白;缺/坏=空串)。"""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                text = line.strip().lstrip("#").strip()
                if text:
                    return text
    except OSError:
        pass
    return ""


def list_projects(app_home) -> dict:
    """项目册合并:locations(路径权威)覆盖 store.location;显示名+默认选中。"""
    app_home = Path(app_home)
    locs = {}
    loc_file = app_home / "project-locations.json"
    if loc_file.is_file():
        data = _read_json(loc_file)
        if isinstance(data, dict) and isinstance(data.get("locations"), dict):
            locs = {str(k): str(v) for k, v in data["locations"].items()
                    if isinstance(v, str)}
    store = _read_json(app_home / "projects" / "mystudio-project-store.json")
    state = (store or {}).get("state") if isinstance(store, dict) else None
    projs = state.get("projects") if isinstance(state, dict) else None
    if not isinstance(projs, list):
        return {"projects": [], "activeProjectId": None,
                "error": "项目册不可读(mystudio-project-store.json 缺/坏)"}
    projects = []
    for p in projs:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        location = locs.get(p["id"]) or p.get("location") or ""
        projects.append({"id": str(p["id"]),
                         "name": str(p.get("name") or p["id"]),
                         "location": location})
    active = state.get("activeProjectId")
    return {"projects": projects,
            "activeProjectId": str(active) if active else None}


def _project_location(app_home, pid: str) -> str | None:
    data = list_projects(app_home)
    for p in data["projects"]:
        if p["id"] == pid:
            return p["location"] or None
    return None


def list_chapters(app_home, pid: str) -> dict:
    """pid→位置→扫 drama 章文件(按 NNN 排序);章名双 fallback。"""
    location = _project_location(app_home, str(pid or ""))
    if location is None:
        return {"chapters": [], "count": 0,
                "error": f"项目 {pid} 不在册(store/locations 均缺)"}
    root = Path(location)
    if not root.is_dir():
        return {"chapters": [], "count": 0,
                "error": f"项目位置不存在:{location}"}
    chapters = []
    drama = root / "novel" / "drama"
    try:
        files = sorted(drama.glob("chapter-*_漫剧.md"))
    except OSError:
        files = []
    for f in files:
        m = _CHAPTER_NUM.match(f.name)
        if not m:
            continue
        num = m.group(1)
        title = _first_line(root / "novel" / "chapters" / f"chapter-{num}.md")
        if not title:  # fallback:drama 首行
            title = _first_line(f)
        chapters.append({"id": f.stem.replace("_漫剧", ""),
                         "n": int(num), "title": title})
    chapters.sort(key=lambda c: c["n"])
    return {"chapters": chapters, "count": len(chapters)}


def valid_chapter(chapter) -> bool:
    """chapter 参数边界:非空/无路径分隔/无 .. 上跳/≤80 字符(中文章名放行)。"""
    chapter = str(chapter or "")
    return bool(chapter) and len(chapter) <= MAX_CHAPTER_LEN \
        and "/" not in chapter and "\\" not in chapter and ".." not in chapter


def read_run_log(out_root, chapter, limit=500) -> dict:
    """章目录 run-log.txt 尾 N 行(缺失/非法→error 字段,不炸)。"""
    chapter = str(chapter or "")
    if not valid_chapter(chapter):
        return {"chapter": chapter, "path": None, "lines": [],
                "error": "非法 chapter 参数(拒防路径穿越)"}
    path = Path(out_root) / OUT_DIR_ROOT / chapter / "run-log.txt"
    if not path.is_file():
        return {"chapter": chapter, "path": str(path), "lines": [],
                "error": "日志文件不存在"}
    try:
        lines = path.read_text(encoding="utf-8",
                               errors="replace").splitlines()
    except OSError as err:
        return {"chapter": chapter, "path": str(path), "lines": [],
                "error": str(err)}
    try:
        limit = max(1, min(5000, int(limit)))
    except (TypeError, ValueError):
        limit = 500
    return {"chapter": chapter, "path": str(path), "lines": lines[-limit:]}


def _output_root() -> Path:
    """引擎输出根(路由内惰性 import,同 my_styles_server 纪律)。"""
    import folder_paths
    return Path(folder_paths.get_output_directory())


def install() -> None:
    """挂三条只读路由(幂等守卫;失败静默打印,不影响节点与出图)。"""
    global _installed
    if _installed:
        return
    try:
        from aiohttp import web
        from server import PromptServer

        @PromptServer.instance.routes.get("/my_daoyan/projects")
        async def _projects(_request):
            try:
                return web.json_response(list_projects(_app_home()))
            except Exception as error:  # noqa: BLE001 - 只读路由,可读错误
                return web.json_response(
                    {"projects": [], "activeProjectId": None,
                     "error": str(error)}, status=500)

        @PromptServer.instance.routes.get("/my_daoyan/chapters")
        async def _chapters(request):
            try:
                pid = request.rel_url.query.get("project", "")
                data = list_chapters(_app_home(), pid)
                status = 404 if data.get("error") else 200
                return web.json_response(data, status=status)
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"chapters": [], "count": 0, "error": str(error)},
                    status=500)

        @PromptServer.instance.routes.get("/my_daoyan/logs")
        async def _logs(request):
            try:
                chapter = request.rel_url.query.get("chapter", "")
                limit = request.rel_url.query.get("limit", "500")
                data = read_run_log(_output_root(), chapter, limit)
                if data.get("error"):
                    status = 404 if "不存在" in data["error"] else 400
                    return web.json_response(data, status=status)
                return web.json_response(data)
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"chapter": "", "path": None, "lines": [],
                     "error": str(error)}, status=500)

        _installed = True
        print("[daoyan] 面板路由已挂载:/my_daoyan/projects、"
              "/my_daoyan/chapters、/my_daoyan/logs", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"[daoyan] 面板路由挂载失败(不影响节点与出图):{error}",
              flush=True)
