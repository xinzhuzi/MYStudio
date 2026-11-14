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
import sys
from pathlib import Path

from .nodes.director_executor import OUT_DIR_ROOT

_installed = False

_CHAPTER_NUM = re.compile(r"^chapter-(\d+)")
MAX_CHAPTER_LEN = 80


def _app_home_candidates() -> list[Path]:
    """漫影 app-home 四层候选(1114 实弹定谳补层,禁硬编码绝对路径):

    ① env MYSTUDIO_APP_HOME 显式覆盖(已设但缺=响亮降级返该路径)
    ② 引擎家推导:本件部署位 <app-home>/comfyui/ComfyUI/custom_nodes/
       my-nodes/daoyan_server.py 的 parents[4](Win=storageBase 正位)
    ③ macOS App userData 默认位(地基权威位;dev 引擎住 Project/IP 时
       与 ② 不同层——② 探不到册子自然滑到这层)
    ④ Windows Electron %APPDATA% 默认位
    候选以「含 project-locations.json 或 projects/mystudio-project-store.json」
    定层;全缺=返回 ②(引擎态报错信息最可行动)。
    """
    env = os.environ.get("MYSTUDIO_APP_HOME")
    if env:
        home = Path(env)
        if not home.is_dir():
            print(f"[daoyan] MYSTUDIO_APP_HOME 已设但缺 {home}:"
                  "响亮降级原路返回(显式覆盖失效须排查,不偷滑低层)",
                  flush=True)
        return [home]
    derived = Path(__file__).resolve().parents[4]  # 引擎家推导层
    mac_default = Path.home() / "Library" / "Application Support" / "漫影工作室"
    win_default = (Path(os.environ.get("APPDATA", "")) / "漫影工作室"
                   if os.environ.get("APPDATA") else None)
    # 平台定序(1114 探针实证):Win 存储根=引擎家父目录→推导层居首;
    # macOS App userData 恒=Library 默认位→居首,推导层(dev 引擎家自带的
    # default-project 空册)会让真册(道劫)被遮——实测坑,序即防线
    if sys.platform == "win32":
        candidates = [derived]
        if win_default is not None:
            candidates.append(win_default)
        candidates.append(mac_default)
    else:
        candidates = [mac_default, derived]
    for home in candidates:
        if (home / "project-locations.json").is_file() \
                or (home / "projects" / "mystudio-project-store.json").is_file():
            return [home]
    return [candidates[0]]


def _app_home() -> Path:
    """漫影 app-home 定位(四层候选首个;见 _app_home_candidates 注)。"""
    return _app_home_candidates()[0]


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




# ── 章节驾驶舱(1114 用户令「选章→剧本/导演计划/分镜表自动带出来」)────

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
_SCRIPT_CAP = 300_000
_IMAGE_CAP = 20 * 1024 * 1024


def _project_location_path(app_home, pid: str):
    """pid→项目根 Path(位置册优先,store 兜底;不在册=None)。"""
    home = Path(app_home)
    locs: dict = {}
    loc_file = home / "project-locations.json"
    if loc_file.is_file():
        data = _read_json(loc_file)
        if isinstance(data, dict) and isinstance(data.get("locations"), dict):
            locs = {str(k): str(v) for k, v in data["locations"].items()
                    if isinstance(v, str)}
    store_file = home / "projects" / "mystudio-project-store.json"
    if not locs.get(pid) and store_file.is_file():
        data = _read_json(store_file) or {}
        for row in ((data.get("state") or {}).get("projects") or []):
            if isinstance(row, dict) and row.get("id") == pid \
                    and row.get("location"):
                locs[pid] = str(row["location"])
    loc = locs.get(pid)
    return Path(loc) if loc else None


def merge_storyboards(chapter_dir: Path) -> list:
    """跨 storyboards-*.json 分片按 index 并集(后文件胜=最新态)。"""
    merged: dict = {}
    for shard in sorted(chapter_dir.glob("storyboards-*.json")):
        data = _read_json(shard)
        if not isinstance(data, dict):
            continue
        for item in ((data.get("state") or {}).get("storyboards") or []):
            if isinstance(item, dict) and isinstance(item.get("index"), int):
                merged[item["index"]] = item
    return [merged[k] for k in sorted(merged)]


def latest_agent_work(chapter_dir: Path, key: str):
    """agentWorkData 指定 key 的最新条(directorPlan 等)。"""
    best = None
    for shard in sorted(chapter_dir.glob("agent-work-data-*.json")):
        data = _read_json(shard)
        if not isinstance(data, dict):
            continue
        for ent in ((data.get("state") or {}).get("agentWorkData") or []):
            if isinstance(ent, dict) and ent.get("key") == key:
                best = ent
    return best


def _media_rel(media_ref) -> str:
    """project-file://<pid>/<rel> → <rel>(分镜图定位口径)。"""
    path = str((media_ref or {}).get("path") or "")
    if not path.startswith("project-file://"):
        return ""
    parts = path.split("/", 3)
    return parts[3] if len(parts) == 4 else ""


def chapter_title(location: Path, chapter: str) -> str:
    manifest = location / "store" / "studio-workflow" / "manifest.json"
    if manifest.is_file():
        data = _read_json(manifest)
        for row in ((data or {}).get("chapterIndex") or []):
            if isinstance(row, dict) and row.get("id") == chapter:
                return str(row.get("title") or "")
    md = location / "novel" / "chapters" / f"{chapter}.md"
    if md.is_file():
        for line in md.read_text(encoding="utf-8", errors="ignore") \
                .splitlines()[:6]:
            if line.startswith("# "):
                return line[2:].strip()
    return ""




_SCENE_RE = re.compile(r"^(\d+-\d+) .+ ·约(\d+)秒", re.M)
_SHOT_RE = re.compile(r"^镜头(\d+)：(.+)", re.M)


def parse_script_shots(script_text: str) -> list:
    """剧本 md → 镜列表兜底(1114 用户勘误「每章剧本都有分镜,不止2章」):
    场次行定时长(·约N秒,钳 1-15),镜头N:行定镜(全局续号)。"""
    if not script_text:
        return []
    # 场次起点行号表(镜行归属=其前最近场次)
    scene_marks = [(m.start(), int(m.group(2)))
                   for m in _SCENE_RE.finditer(script_text)]
    shots = []
    for m in _SHOT_RE.finditer(script_text):
        dur = 5
        for pos, sec in scene_marks:
            if pos < m.start():
                dur = sec
            else:
                break
        shots.append({
            "index": len(shots) + 1,
            "id": None,
            "duration": min(15, max(1, dur)),
            "prompt": "", "videoDesc": m.group(2).strip()[:160],
            "line": "", "image": "",
        })
    return shots


def chapter_payload(location: Path, chapter: str) -> dict:
    """章节驾驶舱三件:剧本(drama md)/导演计划(agentWorkData)/分镜表。"""
    if not chapter or not valid_chapter(chapter):
        return {"error": "非法 chapter 参数"}
    cdir = location / "store" / "studio-workflow" / "chapters" / chapter
    drama = location / "novel" / "drama" / f"{chapter}_漫剧.md"
    script_text = ""
    if drama.is_file():
        try:
            script_text = drama.read_text(
                encoding="utf-8", errors="ignore")[:_SCRIPT_CAP]
        except Exception:
            script_text = ""
    dp = latest_agent_work(cdir, "directorPlan") or {}
    items = []
    for shot in merge_storyboards(cdir):
        items.append({
            "index": shot.get("index"), "id": shot.get("id"),
            "duration": shot.get("duration"),
            "prompt": str(shot.get("prompt") or "")[:160],
            "videoDesc": str(shot.get("videoDesc") or "")[:160],
            "line": str(shot.get("line") or "")[:80],
            "image": _media_rel(shot.get("mediaRef")),
        })
    from_script = False
    if not items and script_text:
        items = parse_script_shots(script_text)
        from_script = bool(items)
    return {
        "chapter": chapter,
        "title": chapter_title(location, chapter),
        "script": {"text": script_text,
                   "lines": (script_text.count(chr(10)) + 1)
                   if script_text else 0},
        "directorPlan": {"text": str(dp.get("data") or ""),
                         "updatedAt": dp.get("updatedAt")},
        "storyboards": {"items": items, "count": len(items),
                        "fromScript": from_script},
    }


def chapter_image_bytes(location: Path, rel: str):
    """分镜图读取(白名单目录+扩展名+20MB 帽;返回 (bytes|None, err|None))。"""
    rel = str(rel or "").strip().lstrip("/").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        return None, "非法路径"
    if not (rel.startswith("workflow-images/")
            or rel.startswith("continuity-bibles/")):
        return None, "路径不在分镜图/连续性资产白名单"
    p = location / rel
    if not p.is_file() or p.suffix.lower() not in _IMAGE_EXTS:
        return None, "图不存在或非图件"
    data = p.read_bytes()
    if len(data) > _IMAGE_CAP:
        return None, "图超 20MB 帽"
    return data, None


def import_storyboard(location: Path, chapter: str, input_dir: Path) -> dict:
    """分镜表→时间线组:镜行映射 segment+分镜图拷入 input/(自动带出来)。"""
    if not chapter or not valid_chapter(chapter):
        return {"ok": False, "error": "非法 chapter 参数", "segments": []}
    cdir = location / "store" / "studio-workflow" / "chapters" / chapter
    shots = merge_storyboards(cdir)
    from_script = False
    if not shots:
        drama = location / "novel" / "drama" / f"{chapter}_漫剧.md"
        if drama.is_file():
            shots = parse_script_shots(drama.read_text(
                encoding="utf-8", errors="ignore")[:_SCRIPT_CAP])
            from_script = bool(shots)
    if not shots:
        return {"ok": False, "error": "本章无分镜(分片与剧本均无镜行)",
                "segments": []}
    input_dir.mkdir(parents=True, exist_ok=True)
    segments, copied = [], []
    for shot in shots:
        idx = shot.get("index") or 0
        try:
            seconds = round(float(shot.get("duration") or 5) * 2) / 2
        except (TypeError, ValueError):
            seconds = 5.0
        seconds = min(15.0, max(1.0, seconds))
        images = []
        rel = _media_rel(shot.get("mediaRef"))
        if rel:
            data, _err = chapter_image_bytes(location, rel)
            if data is not None:
                ext = Path(rel).suffix.lower() or ".png"
                name = f"daoyan-sb-{chapter}-{idx:03d}{ext}"
                target = input_dir / name
                if not target.exists():
                    target.write_bytes(data)
                images = [name]
                copied.append(name)
        desc = str(shot.get("videoDesc") or "").strip() \
            or str(shot.get("prompt") or "").strip()
        segments.append({
            "id": str(shot.get("id") or f"sb-{chapter}-{idx:03d}"),
            "mode": "r2v", "seconds": seconds, "seed": None,
            "rerun": False,
            "prompt": {"summary": "", "retention": "",
                       "description": desc, "soundscape": ""},
            "images": images,
        })
    return {"ok": True, "segments": segments, "copied": copied,
            "count": len(segments), "fromScript": from_script}


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


        @PromptServer.instance.routes.get("/my_daoyan/chapter_data")
        async def _chapter_data(request):
            try:
                pid = request.rel_url.query.get("project", "")
                chapter = request.rel_url.query.get("chapter", "")
                loc = _project_location_path(_app_home(), pid)
                if loc is None:
                    return web.json_response(
                        {"error": f"项目 {pid} 不在册"}, status=404)
                data = chapter_payload(loc, chapter)
                return web.json_response(
                    data, status=400 if data.get("error") else 200)
            except Exception as error:  # noqa: BLE001
                return web.json_response({"error": str(error)}, status=500)

        @PromptServer.instance.routes.get("/my_daoyan/chapter_image")
        async def _chapter_image(request):
            try:
                pid = request.rel_url.query.get("project", "")
                rel = request.rel_url.query.get("rel", "")
                loc = _project_location_path(_app_home(), pid)
                if loc is None:
                    return web.json_response(
                        {"error": "项目不在册"}, status=404)
                data, err = chapter_image_bytes(loc, rel)
                if data is None:
                    return web.json_response({"error": err}, status=400)
                ctype = ("image/png" if rel.lower().endswith(".png")
                         else "image/jpeg")
                return web.Response(body=data, content_type=ctype)
            except Exception as error:  # noqa: BLE001
                return web.json_response({"error": str(error)}, status=500)

        @PromptServer.instance.routes.post("/my_daoyan/import_storyboard")
        async def _import_storyboard(request):
            try:
                body = await request.json()
                pid = str((body or {}).get("project", ""))
                chapter = str((body or {}).get("chapter", ""))
                loc = _project_location_path(_app_home(), pid)
                if loc is None:
                    return web.json_response(
                        {"ok": False, "error": f"项目 {pid} 不在册",
                         "segments": []}, status=404)
                import folder_paths
                input_dir = Path(folder_paths.get_input_directory())
                data = import_storyboard(loc, chapter, input_dir)
                return web.json_response(
                    data, status=200 if data.get("ok") else 400)
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"ok": False, "error": str(error), "segments": []},
                    status=500)

        _installed = True
        print("[daoyan] 面板路由已挂载:/my_daoyan/projects、"
              "/my_daoyan/chapters、/my_daoyan/logs", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"[daoyan] 面板路由挂载失败(不影响节点与出图):{error}",
              flush=True)
