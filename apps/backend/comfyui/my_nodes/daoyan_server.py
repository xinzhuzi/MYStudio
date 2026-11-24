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

import re
from pathlib import Path

from .daoyan_data import (
    _CHAPTER_NUM,
    MAX_CHAPTER_LEN,
    _app_home_candidates,
    _app_home,
    _read_json,
    _first_line,
    list_projects,
    _project_location,
    list_chapters,
    valid_chapter,
    read_run_log,
    _P3_VIDEO_EXTS,
    list_chapter_videos,
    _output_root,
    _input_dir,
    _INPUT_MEDIA_LIMIT_MAX,
    list_input_media,
    _AUDIO_EXTS,
    _AUDIO_CAP,
    save_upload_audio,
    _IMAGE_EXTS,
    _VIDEO_EXTS,
    _SCRIPT_CAP,
    _IMAGE_CAP,
    _project_location_path,
    merge_storyboards,
    latest_agent_work,
    _media_rel,
    chapter_title,
    _SCENE_RE,
    _SHOT_RE,
    parse_script_shots,
    chapter_payload,
    chapter_image_bytes,
    _CIRCLED_SLOTS,
    _ASSET_KIND_LABELS,
    _asset_bindings_text,
    _shot_columns,
    _image_ready,
    _media_url,
    _video_url,
    shot_detail,
)

_installed = False


# ── LLM 提示词扩写(1115 缺口6):智谱 Anthropic messages 线 ──────────
# repo 1113 定谳(screenplay_critic.py):该厂 key 额度仅在 /api/anthropic
# 口生效,paas/v4 OpenAI 口恒 1113——故落 Anthropic 线格式(x-api-key 头
# +messages 形),非 paas/v4。BIGMODEL_API_KEY=仓内第三个同厂 key env 名
# (CRITIC_API_KEY/ZHIPU_API_KEY 先例),须在启动环境新增。


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
