# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台面板服务端(11-13-director-console-remake 阶段3.5,1114;1115 三路由)。

只读路由(my_styles_server.py 同款 install 幂等自守卫+失败静默纪律):
  GET /my_daoyan/projects
      → {projects:[{id,name}],activeProjectId,error?}(store 缺/坏→error+空表)
  GET /my_daoyan/chapters?project=<pid>
      → {chapters:[{id,n,title}],count,error?}(全量返回,~4125 条原生
        select 可承载;缺项目/位置不存在→404 带 error)
  GET /my_daoyan/logs?chapter=<v>&limit=500
      → {chapter,path,lines[],error?}(尾 N 行;文件缺失 404;chapter 含
        /、\\、.. 或 >80 字符拒收——防穿越真边界,中文章名放行)
1115 增三路由(缺口2/5/6):
  GET /my_daoyan/input_media?limit=200
      → {files:[{name,mtime,size}],count,error?}(input/ 递归图清单,
        mtime 倒序,库内选图器数据源)
  POST /my_daoyan/upload_audio(原始 body+X-Filename)
      → {ok,name,size,error?}(参考音频落 input/,白名单+50MB 帽)
  → {ok,text?,error?}(智谱 /api/anthropic messages 线 LLM 扩写;
        缺 key=200+ok:False 明示)
1115 详情入 ComfyUI(derived-asset-detail):
  GET /my_daoyan/shot_detail?project=<pid>&chapter=<v>[&shot_id=<id>]
      → 无 shot_id:{chapter,count,shots:[{index,id,title,duration,
        lines,state,imageReady}...]}(整章镜 id 清单=浮层下钻与旧行
        行号对齐兜底双用)
      → 有 shot_id:{chapter,shot:{id,columns(16 列全量零截断),state,
        imageReady,imageUrl,videoUrl,revision,stale,...}}(chapter_payload
        的 160/80 截断仅驾驶舱用,此处独立装配;图/视频 URL 走
        chapter_image 同款引擎可显示路径)

1115 分镜面板「导入导演台视频」数据源:
  GET /my_daoyan/chapter_videos?chapter=<v>[&project=<pid>]
      → {chapter,videos:[{seg_id,filename,subfolder,url,size,mtime}],count,
        error?}(章内逐镜 p3-recavsr 成片纯枚举,不流文件;免 project
        ——p3 按章键于引擎 output,带 project 不报错;非法 chapter 400;
        章目录缺=空清单 200 非 error;url 走引擎标准 /view 口)

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
from urllib.parse import quote

from .nodes.director_executor import OUT_DIR_ROOT, P3_NAME

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


# ── 章成片清单(1115 分镜面板「导入导演台视频」数据源)────────────────
# 后缀白名单对齐 executor hit()(director_executor.py:107 含 .mkv);
# _VIDEO_EXTS(详情浮层 media/ai-video/ 口)缺 .mkv——两口径语义不同,
# 故本地常量,不动存量。
_P3_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv")


def list_chapter_videos(output_root, chapter) -> dict:
    """章内逐镜 p3-recavsr 成片清单(纯枚举不流文件;注入纪律同 read_run_log)。

    - valid_chapter 守卫复用(非法→error 字段,路由层 400;中文章名放行)
    - glob video/导演台/{chapter}/*/p3-recavsr*:p1-draft/p2-final 前缀
      天然不入围
    - 后缀白名单 .mp4/.webm/.mov/.mkv(hit() 同款):.bak 让名件后缀出局
      天然排除
    - 每 seg 取 mtime 最新一枚(rerun 多发并存=最新胜);多 seg 按 id 排序
    - url=/view?filename&type=output&subfolder(emit_preview 同款引擎
      标准 output 视图口,query 全 quote(safe='')编码=_media_url/cards.js
      encodeURIComponent 口径,前端拼引擎 base 直 fetch)
    - 章目录缺=空清单非 error(「本章还没跑过」是常态非故障,路由 200)
    """
    chapter = str(chapter or "")
    if not valid_chapter(chapter):
        return {"chapter": chapter, "videos": [], "count": 0,
                "error": "非法 chapter 参数(拒防路径穿越)"}
    cdir = Path(output_root) / OUT_DIR_ROOT / chapter
    if not cdir.is_dir():
        return {"chapter": chapter, "videos": [], "count": 0}
    best: dict[str, tuple] = {}
    try:
        for path in cdir.glob(f"*/{P3_NAME}*"):
            if not path.is_file() \
                    or path.suffix.lower() not in _P3_VIDEO_EXTS:
                continue
            try:
                st = path.stat()
            except OSError:
                continue
            key = (int(st.st_mtime), path.name)
            cur = best.get(path.parent.name)
            if cur is None or key > cur[0]:
                best[path.parent.name] = (key, path, st)
    except OSError:
        pass
    videos = []
    for seg_id in sorted(best):
        (_key, path, st) = best[seg_id]
        subfolder = f"{OUT_DIR_ROOT}/{chapter}/{seg_id}"
        videos.append({
            "seg_id": seg_id,
            "filename": path.name,
            "subfolder": subfolder,
            "url": (f"/view?filename={quote(path.name, safe='')}"
                    f"&type=output&subfolder={quote(subfolder, safe='')}"),
            "size": st.st_size,
            "mtime": int(st.st_mtime),
        })
    return {"chapter": chapter, "videos": videos, "count": len(videos)}


def _output_root() -> Path:
    """引擎输出根(路由内惰性 import,同 my_styles_server 纪律)。"""
    import folder_paths
    return Path(folder_paths.get_output_directory())


def _input_dir() -> Path:
    """引擎 input 根(路由内惰性 import,同 _output_root 纪律)。"""
    import folder_paths
    return Path(folder_paths.get_input_directory())


# ── 库内选图器数据源(1115 缺口2):input/ 递归媒体清单 ────────────────

_INPUT_MEDIA_LIMIT_MAX = 500


def list_input_media(input_dir, limit=200) -> dict:
    """input/ 图媒体清单(picker.js 数据源;read_run_log 同注入纪律)。

    os.walk 递归含子夹(input/ 实况 59 项含 3d/ 子夹已核);相对 posix 名
    (与 cards.js thumbUrl lastIndexOf('/') 拆 subfolder 口径互吃);后缀
    白名单 _IMAGE_EXTS(chapter_image 同纪律);mtime 倒序(并列 name
    稳定序);limit 钳 1..500;目录缺=error 不炸。
    """
    root = Path(input_dir)
    if not root.is_dir():
        return {"files": [], "count": 0,
                "error": f"input 目录不存在:{root}"}
    try:
        limit = max(1, min(_INPUT_MEDIA_LIMIT_MAX, int(limit)))
    except (TypeError, ValueError):
        limit = 200
    rows = []
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            p = Path(dirpath) / name
            if p.suffix.lower() not in _IMAGE_EXTS:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            rows.append({"name": p.relative_to(root).as_posix(),
                         "mtime": int(st.st_mtime), "size": st.st_size})
    rows.sort(key=lambda r: (-r["mtime"], r["name"]))
    return {"files": rows[:limit], "count": len(rows[:limit])}


# ── 参考音频上传(1115 缺口5):引擎无 /upload/audio,自设落 input/ ────

_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac")
_AUDIO_CAP = 50 * 1024 * 1024


def save_upload_audio(input_dir, filename, data) -> dict:
    """参考音频上传落 input/(X-Filename sanitize+后缀白名单+50MB 帽)。

    面板 defaultAudioUploader=原始 body+X-Filename(引擎 /upload/image
    同式);非法名/后缀/超帽=ok:False 带原因,不炸不落盘。
    """
    name = str(filename or "").strip().replace("\\", "/").split("/")[-1]
    if not name or name in (".", "..") \
            or Path(name).suffix.lower() not in _AUDIO_EXTS:
        return {"ok": False,
                "error": f"非法音频文件名或后缀(白名单 {'/'.join(_AUDIO_EXTS)})"}
    if not isinstance(data, (bytes, bytearray)) or not data:
        return {"ok": False, "error": "空上传体"}
    if len(data) > _AUDIO_CAP:
        return {"ok": False, "error": "音频超 50MB 帽"}
    input_dir = Path(input_dir)
    input_dir.mkdir(parents=True, exist_ok=True)
    target = input_dir / name
    target.write_bytes(bytes(data))
    return {"ok": True, "name": name, "size": len(data)}


# ── LLM 提示词扩写(1115 缺口6):智谱 Anthropic messages 线 ──────────
# repo 1113 定谳(screenplay_critic.py):该厂 key 额度仅在 /api/anthropic
# 口生效,paas/v4 OpenAI 口恒 1113——故落 Anthropic 线格式(x-api-key 头
# +messages 形),非 paas/v4。BIGMODEL_API_KEY=仓内第三个同厂 key env 名
# (CRITIC_API_KEY/ZHIPU_API_KEY 先例),须在启动环境新增。

# ── 章节驾驶舱(1114 用户令「选章→剧本/导演计划/分镜表自动带出来」)────

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
_VIDEO_EXTS = (".mp4", ".webm", ".mov")  # 1115 详情浮层:media/ai-video/ 同口
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
    """分镜图读取(白名单目录+扩展名+20MB 帽;返回 (bytes|None, err|None))。

    1115 详情浮层补:media/ai-video/ 前缀的视频件(.mp4/.webm/.mov,
    H3 单镜产物回写位)同口可读(shot_detail 的 videoUrl 消费;图像行为
    零改——白名单外语义与错误文案逐字保留,test_daoyan_cockpit 钉)。
    """
    rel = str(rel or "").strip().lstrip("/").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        return None, "非法路径"
    if rel.startswith("media/ai-video/"):
        exts = _VIDEO_EXTS
    elif rel.startswith("workflow-images/") or rel.startswith("continuity-bibles/"):
        exts = _IMAGE_EXTS
    else:
        return None, "路径不在分镜图/连续性资产白名单"
    p = location / rel
    if not p.is_file() or p.suffix.lower() not in exts:
        return None, "图不存在或非图件"
    data = p.read_bytes()
    if len(data) > _IMAGE_CAP:
        return None, "图超 20MB 帽"
    return data, None


# ── 单镜/整章镜详情(1115 详情入 ComfyUI:MyStage「详情」浮层数据源)────

# 1120 绑定三件套·件一:「绑定参考」列素材(镜级 assetBindings,
# slot=1 起参考图顺序;①=slot 序号,类型 scene→场景/character→角色/prop→道具)
_CIRCLED_SLOTS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
_ASSET_KIND_LABELS = {"scene": "场景", "character": "角色", "prop": "道具"}


def _asset_bindings_text(shot) -> str:
    """assetBindings 按 slot 升序「①名(类型)」、串(绑定参考列值)。

    缺席/空=空串(旧章不猜序=空列,渲染端退化「—」;不重复「关联资产」
    纯名字展示)。无效 slot 排尾按位次数字兜底,缺 name 行跳过,不炸。
    """
    rows = shot.get("assetBindings")
    entries = [r for r in rows if isinstance(r, dict)] \
        if isinstance(rows, list) else []

    def _slot(row):
        s = row.get("slot")
        return s if isinstance(s, int) and s > 0 else 0  # 无效=排尾

    parts = []
    for pos, row in enumerate(sorted(entries, key=_slot), 1):
        s = _slot(row)
        mark = _CIRCLED_SLOTS[s - 1] if 0 < s <= len(_CIRCLED_SLOTS) \
            else f"{pos}."  # 超 20/无效=位次数字兜底
        name = str(row.get("name") or "").strip()
        kind = _ASSET_KIND_LABELS.get(str(row.get("kind") or ""))
        if name:
            parts.append(f"{mark}{name}({kind})" if kind else f"{mark}{name}")
    return "、".join(parts)


# 单镜详情 16 列(分镜表同源列集;label→分片字段映射单源,渲染端零拼)
def _shot_columns(shot) -> list:
    sem = shot.get("shotSemantics") if isinstance(
        shot.get("shotSemantics"), dict) else {}
    duration = shot.get("duration")
    if not isinstance(duration, (int, float)):
        duration = shot.get("durationTarget")
    action = " → ".join(
        str(x) for x in (sem.get("actionIn"), sem.get("actionOut")) if x)
    return [
        ("镜号", shot.get("index")),
        ("场次", shot.get("trackKey")),
        ("画面描述", shot.get("prompt")),
        ("视频描述", shot.get("videoDesc")),
        ("时长", f"{duration} 秒" if duration else None),
        ("景别", sem.get("shotSize")),
        ("运镜", sem.get("cameraMove")),
        ("动作", action or None),
        ("朝向", shot.get("orientation")),
        ("空间关系", shot.get("spatialRelation")),
        ("情绪", shot.get("emotion")),
        ("台词", shot.get("lines")),
        ("旁白", shot.get("line")),
        ("音效", shot.get("sound")),
        ("关联资产", "、".join(shot.get("associateAssetsNames") or []) or None),
        # 1120 绑定三件套·件一:镜级绑定参考列(置「关联资产」后)
        ("绑定参考", _asset_bindings_text(shot) or None),
    ]


def _image_ready(shot) -> bool:
    """imageReady 语义(分片无字面键):state=='ready' 且 mediaRef 可定位
    (project-file:// 可解出 rel 才有引擎可显示图)。"""
    return str(shot.get("state") or "") == "ready" \
        and bool(_media_rel(shot.get("mediaRef")))


def _media_url(pid: str, media_ref) -> str:
    """mediaRef → 引擎可显示 URL(chapter_image 先例同款;缺/坏=空串)。"""
    rel = _media_rel(media_ref)
    if not rel or str((media_ref or {}).get("kind") or "image") != "image":
        return ""
    return (f"/my_daoyan/chapter_image?project={quote(pid, safe='')}"
            f"&rel={quote(rel, safe='')}")


def _video_url(pid: str, media_ref) -> str:
    """单镜视频 URL(mediaRef kind=video=H3 产物回写态;图期=空串,
    浮层按空串隐藏视频钮)。"""
    rel = _media_rel(media_ref)
    if not rel or str((media_ref or {}).get("kind") or "") != "video":
        return ""
    return (f"/my_daoyan/chapter_image?project={quote(pid, safe='')}"
            f"&rel={quote(rel, safe='')}")


def shot_detail(location: Path, chapter: str, shot_id: str = "",
                pid: str = "") -> dict:
    """单镜 16 列全量/整章镜 id 清单(1115 详情浮层数据源,纯函数注入可测)。

    零截断纪律:chapter_payload 的 prompt/videoDesc 160 字、line 80 字截断
    仅驾驶舱用,此处独立装配全量;按 id 精确取(禁行号直取=跨源一致性)。
    """
    if not chapter or not valid_chapter(chapter):
        return {"error": "非法 chapter 参数"}
    cdir = location / "store" / "studio-workflow" / "chapters" / chapter
    shots = merge_storyboards(cdir)
    if not shot_id:
        rows = [{
            "index": s.get("index"), "id": s.get("id"),
            "title": str(s.get("prompt") or "")[:18]
            or f"分镜 {s.get('index')}",
            "duration": s.get("duration"),
            "lines": str(s.get("lines") or ""),
            "state": s.get("state"),
            "imageReady": _image_ready(s),
        } for s in shots]
        return {"chapter": chapter, "count": len(rows), "shots": rows}
    for s in shots:
        if str(s.get("id") or "") == str(shot_id):
            return {"chapter": chapter, "shot": {
                "id": s.get("id"),
                "columns": _shot_columns(s),
                "state": s.get("state"),
                "imageReady": _image_ready(s),
                "imageUrl": _media_url(pid, s.get("mediaRef")),
                "videoUrl": _video_url(pid, s.get("mediaRef")),
                "revision": s.get("revision"),
                "stale": bool(s.get("stale")),
                "speaker": s.get("speaker"),
                "voiceStyle": s.get("voiceStyle"),
                # 1120 单镜动作面:混音下拉当前值(分片字段;缺=App 默认 tts-stack)
                "audioMix": s.get("audioMix"),
            }}
    return {"error": f"镜 {shot_id} 不在分片并集(表/分片换代?请重开工作流)"}


# ── 带出链出词层(1115 superi 审计件#9 拟改法2:J6/J7/J1 吸收)──────────
# 官方协议参照(workflows/2_视频/H3视频/7_测试/):AIMixer-r2v.json 尾行
# 「No text or logos.」(H3 无负向口下的正向否定防线=J1)+ AIMixer-
# external-groups-i2v.json 首句「15秒，16:9横版视频。」(时长规格+格式+
# 媒介身份式开头=J6);面板骨架(web/daoyan/prompt.js STRUCT_TEMPLATE,
# 1115 已换血)同口径。带出链不再 videoDesc 单段直落 description,分发
# 预填:summary=身份首句(J6)+场景身份(画面描述列),description=运镜
# 句前置到动作之前(J7)+尾补否定线(J1)。retention/soundscape 分镜表
# 无对应列,恒空待面板手填/插入结构模板——「只填空段不覆盖已有内容」
# 语义不动(带出=新组创建,无已有内容可覆盖;assemble_prompt 纯拼接零改)。

PROMPT_GUARD_LINE = "No text or logos."
_GUARD_RE = re.compile(r"no\s+text\s+or\s+logos", re.I)

# 英文受控运镜词透传判定(词表对齐 App 链 h3-shot-prompt.ts
# mapH3CameraMove——两链同模(H3)同词,禁各说各话)
_CAMERA_EN_RE = re.compile(
    r"push\s*in|pull\s*out|pan\s+(?:left|right)|truck|tracking\s+shot"
    r"|pedestal\s+(?:up|down)|tilt\s+(?:up|down)|arc\s+shot"
    r"|zoom\s+(?:in|out)", re.I)

# 分镜域运镜 17 值枚举真源=App 链 camera-move-bridge.ts
# STORYBOARD_CAMERA_MOVE_IDS(10-10 批C 词表;LLM 出的分镜表即此枚举),
# 直投会出「The camera uses a static.」病句——查表归一为受控词。
STATIC_HOLD = "Static Hold"  # 固定机位=刻意静止的显式决策(桥注释口径)
_CAMERA_ENUM = {
    "static": STATIC_HOLD,
    "tracking": "Tracking Shot",
    "orbit": "Arc Shot",
    "zoom-in": "Zoom In",
    "zoom-out": "Zoom Out",
    "pan-left": "Pan Left",
    "pan-right": "Pan Right",
    "tilt-up": "Tilt Up",
    "tilt-down": "Tilt Down",
    "dolly-in": "Dolly In",
    "dolly-out": "Dolly Out",
    "truck-left": "Truck Left",
    "truck-right": "Truck Right",
    "crane-up": "Crane Up",
    "crane-down": "Crane Down",
    "drone-aerial": "Aerial Shot",
    "360-roll": "360 Roll",
}


def map_camera_move(value) -> str:
    """分镜运镜词归一:①17 值枚举 id 查表(camera-move-bridge 词表);
    ②英文受控词透传不改写;③中文→英文受控词(词表逐条对齐 App 链
    mapH3CameraMove,含变焦/推/拉/摇/移/跟/升/降/俯/仰/环绕/固定);
    未知词原样透传;空=空。"""
    raw = str(value or "").strip()
    if not raw:
        return ""
    hit = _CAMERA_ENUM.get(raw.lower())
    if hit:
        return hit
    if _CAMERA_EN_RE.search(raw):
        return raw
    if "固定" in raw or "静止" in raw:
        return STATIC_HOLD
    if "变焦" in raw:
        return "Zoom Out" if re.search(r"拉远|出", raw) else "Zoom In"
    if "推" in raw:
        return "Push In"
    if "拉" in raw:
        return "Pull Out"
    if "摇" in raw:
        if "左" in raw:
            return "Pan Left"
        if "右" in raw:
            return "Pan Right"
        return "Pan"
    if "横移" in raw or "移" in raw:
        if "左" in raw:
            return "Truck Left"
        if "右" in raw:
            return "Truck Right"
        return "Truck"
    if "跟拍" in raw or "跟" in raw:
        return "Tracking Shot"
    if "升" in raw:
        return "Pedestal Up"
    if "降" in raw:
        return "Pedestal Down"
    if "俯" in raw:
        return "Tilt Down"
    if "仰" in raw:
        return "Tilt Up"
    if "环绕" in raw or "弧" in raw:
        return "Arc Shot"
    return raw


def _summary_prefill(seconds: float, scene: str) -> str:
    """summary 预填(J6 身份首句):时长规格+格式媒介(16:9 横版,产线
    960×544→1440×832 恒横版)+场景身份(分镜画面描述列;缺=仅规格句,
    首句恒身份不落「谁在干嘛」)。"""
    head = f"{seconds:g}秒，16:9横版视频。"
    scene = str(scene or "").strip()
    return head + scene if scene else head


def _description_prefill(desc: str, camera_move) -> str:
    """description 预填(J7 运镜前置+J1 否定线):运镜句先于动作正文
    (镜头先于动作存在;固定机位=持静句不加「uses a」病句);尾补
    「No text or logos.」(官方 r2v 样例口径;已含该守卫线不重复补);
    零运镜零正文=空段待手填(不硬造内容)。"""
    parts = []
    camera = map_camera_move(camera_move)
    if camera == STATIC_HOLD:
        parts.append("The camera holds still.")
    elif camera:
        parts.append(f"The camera uses a {camera}.")
    text = str(desc or "").strip()
    if text:
        parts.append(text)
    if not parts:
        return ""
    if not _GUARD_RE.search(" ".join(parts)):
        parts.append(PROMPT_GUARD_LINE)
    return " ".join(parts)


def import_storyboard(location: Path, chapter: str, input_dir: Path) -> dict:
    """分镜表→时间线组:镜行映射 segment+分镜图拷入 input/(自动带出来)。

    1115 带出链出词层下沉(审计件#9 拟改法2):videoDesc 不再单段直落,
    四段分发预填——summary=时长/格式/媒介身份首句+画面描述列作场景身份
    (J6);description=运镜句(shotSemantics.cameraMove,中文归一英文受控
    词)前置到动作正文之前+尾补否定线(J7/J1);retention/soundscape 无
    对应列恒空(面板「插入结构模板」只填空段接管)。"""
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
        frame_desc = str(shot.get("prompt") or "").strip()
        desc = str(shot.get("videoDesc") or "").strip() or frame_desc
        # 1121 对照修:台词+speaker 进视频描述(Toonflow 视频提示词含台词
        # 语速+口播时段;我方视频链此前零台词=模型不知道该镜该说什么/何时
        # 说)。台词列有值且非「无台词」占位才带;末尾独立行不并正文。
        lines_raw = str(shot.get("lines") or "").strip()
        if lines_raw and lines_raw not in ("无台词", "无对白", "无", "—", "-"):
            desc = f"{desc}；台词：{lines_raw}" if desc else f"台词：{lines_raw}"
        # 场景身份=画面描述列;它已任描述体(videoDesc 缺)时不重复入 summary
        scene = frame_desc if frame_desc and frame_desc != desc else ""
        sem = shot.get("shotSemantics") if isinstance(
            shot.get("shotSemantics"), dict) else {}
        segments.append({
            "id": str(shot.get("id") or f"sb-{chapter}-{idx:03d}"),
            "mode": "r2v", "seconds": seconds, "seed": None,
            "rerun": False,
            "prompt": {"summary": _summary_prefill(seconds, scene),
                       "retention": "",
                       "description": _description_prefill(
                           desc, sem.get("cameraMove")),
                       "soundscape": ""},
            "images": images,
        })
    return {"ok": True, "segments": segments, "copied": copied,
            "count": len(segments), "fromScript": from_script}


def install() -> None:
    """挂只读路由族(幂等守卫;失败静默打印,不影响节点与出图)。

    清单(与尾部 print 一对一,1115 修正):projects/chapters/logs/
    chapter_data/chapter_image/import_storyboard(POST)/input_media/
    upload_audio(POST)/shot_detail/chapter_videos(1115 分镜面板导入)。"""
    global _installed
    if _installed:
        return
    try:
        from aiohttp import web
        from server import PromptServer

        # CORS(1116 审计 B3/E11 blocker 修):App 渲染窗跨域 fetch 首跳即死。
        # on_response_prepare 信号=运行中可挂(中间件列表启动后冻结不可追)
        try:
            _app = PromptServer.instance.app
            if _app and not getattr(_app, "_daoyan_cors", False):
                async def _daoyan_cors_prepare(request, response):
                    origin = request.headers.get("Origin", "")
                    if origin:
                        response.headers["Access-Control-Allow-Origin"] = origin
                        response.headers["Access-Control-Allow-Methods"] = (
                            "GET,POST,OPTIONS")
                        response.headers["Access-Control-Allow-Headers"] = (
                            "Content-Type,X-Filename,Authorization,"
                            "X-Manying-Image-Token,Bearer")
                _app.on_response_prepare.append(_daoyan_cors_prepare)
                _app._daoyan_cors = True
                print("[daoyan] CORS on_response_prepare attached", flush=True)
        except Exception as _cors_err:
            print(f"[daoyan] CORS attach failed (non-fatal): {_cors_err}",
                  flush=True)

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
                low = rel.lower()
                if low.endswith((".mp4", ".mov")):
                    ctype = "video/mp4"
                elif low.endswith(".webm"):
                    ctype = "video/webm"
                elif low.endswith(".png"):
                    ctype = "image/png"
                else:
                    ctype = "image/jpeg"
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

        @PromptServer.instance.routes.get("/my_daoyan/input_media")
        async def _input_media(request):  # noqa: ANN202 - aiohttp handler
            try:
                limit = request.rel_url.query.get("limit", "200")
                return web.json_response(list_input_media(_input_dir(), limit))
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"files": [], "count": 0, "error": str(error)},
                    status=500)

        @PromptServer.instance.routes.post("/my_daoyan/upload_audio")
        async def _upload_audio(request):  # noqa: ANN202 - aiohttp handler
            try:
                # 原始 body+X-Filename(引擎 /upload/image 同式;引擎无
                # /upload/audio 故自设)
                name = request.headers.get("X-Filename", "")
                data = await request.read()
                out = save_upload_audio(_input_dir(), name, data)
                return web.json_response(
                    out, status=200 if out.get("ok") else 400)
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"ok": False, "error": str(error)}, status=500)

        @PromptServer.instance.routes.get("/my_daoyan/shot_detail")
        async def _shot_detail(request):  # noqa: ANN202 - aiohttp handler
            try:
                pid = request.rel_url.query.get("project", "")
                chapter = request.rel_url.query.get("chapter", "")
                shot_id = request.rel_url.query.get("shot_id", "")
                loc = _project_location_path(_app_home(), pid)
                if loc is None:
                    return web.json_response(
                        {"error": f"项目 {pid} 不在册"}, status=404)
                data = shot_detail(loc, chapter, shot_id, pid)
                status = 404 if ("不在分片并集" in str(data.get("error") or "")
                                 or "不在册" in str(data.get("error") or "")) \
                    else (400 if data.get("error") else 200)
                return web.json_response(data, status=status)
            except Exception as error:  # noqa: BLE001
                return web.json_response({"error": str(error)}, status=500)

        @PromptServer.instance.routes.get("/my_daoyan/chapter_videos")
        async def _chapter_videos(request):  # noqa: ANN202 - aiohttp handler
            try:
                # project 免参:p3 产物按章键于引擎 output(OUT_DIR_ROOT=
                # {chapter}/{seg_id},director_executor.py:61),章值已够
                # 定位;带 project 不报错(调用方习惯参数兼容)
                chapter = request.rel_url.query.get("chapter", "")
                data = list_chapter_videos(_output_root(), chapter)
                if data.get("error"):
                    return web.json_response(data, status=400)
                return web.json_response(data)
            except Exception as error:  # noqa: BLE001
                return web.json_response(
                    {"chapter": "", "videos": [], "count": 0,
                     "error": str(error)}, status=500)

        _installed = True
        # 1115 print 修正:与实际 add_route 清单一一对齐(八存量+shot_detail
        # +chapter_videos;旧 print 悬「、」且漏 chapter_data/chapter_image/
        # import_storyboard)
        print("[daoyan] 面板路由已挂载(10):/my_daoyan/projects、"
              "/my_daoyan/chapters、/my_daoyan/logs、/my_daoyan/chapter_data、"
              "/my_daoyan/chapter_image、/my_daoyan/import_storyboard、"
              "/my_daoyan/input_media、/my_daoyan/upload_audio、"
              "/my_daoyan/shot_detail、/my_daoyan/chapter_videos", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"[daoyan] 面板路由挂载失败(不影响节点与出图):{error}",
              flush=True)
