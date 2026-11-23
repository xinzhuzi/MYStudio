"""qwen21_sheet.py — Qwen-Image-2.1 B线 i2i 设定卡引擎(布局 qwen21-sheet-i2i)。

1121 资产库设定卡换血 R1(trellis 11-21-asset-sheet-bline-i2i):设定卡生成口由
t2i 自由版式直射改走点名件「道劫-角色设定卡-i2i.json」整链——LoadImage master
接资产库角色图 → 五路编辑+武器/特效 → head/表情×5 二级链 → MySheetCardComposer
程序底框合成 4K 整卡。

驱动方式=点名件 **GUI→API 整图复用(禁拆抄拼改)**:运行时把点名件 GUI JSON
(nodes/links)按冻结 widget 序表转成 API 图,节点参数/连线/seed 逐字节取自件本体,
sidecar 零手搓载荷;分格指令由件内 MySheetPromptHub 链接分发(枢纽引擎侧运行时
热读 qi21_bases.json#sheet_card_qwen 真源装配),sidecar 只注入四旋钮
(主体句/角名/背景类型/格式)——「分格指令逐字取真源」由件内连线结构保证。

子步编排=件依赖图驱动(links 表实锚,PRD §R1):
  L1 master i2i(LoadImage[55] 槽←参考图)→ L2 五路编辑[10/15/20/25/30 全吃
  master 解码[8]]+武器/特效 t2i[40/45] → L3 head[35 候 side 产物[13]]与
  表情×5[70-110 候 face 产物[23]] → L4 Composer[50] 合成;14 路生成子步+
  1 步程序合成,任一子步失败=任务级失败可续跑,禁半卡返回。

断点续跑(照 H3 域 B 线先例 daojie_sheet_b_pipeline.py 的 step_XX 落盘/存在即
跳过/compose-only 语义):每子步产物落 comfy 家 sheet-i2i/<task>/step_NN_<tag>.png,
存在即跳过;任务态以盘上子步产物为真源可重建(sidecar 重启不丢账;task.json 标
running 而无在途 worker=重启残账,恒重建为 partial-failed 可续跑,非终态禁归
running)。异步任务+进度/结果/取消端点见 image_gen/server.py(裁定 B)。
"""
from __future__ import annotations

import base64
import copy
import json
import math
import os
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from . import qwen21 as _qwen21
from .comfyui_bridge import (
    _decode_reference,
    _fetch_bytes,
    _history_output,
    _http_json,
    _pipeline_error,
    _upload_image,
    bridge_url,
)

LAYOUT = "qwen21-sheet-i2i"
# 注册名(占位 spec;实际发车模型=qwen-image-2-1,见 start_task 校验——不进
# IMAGE_MODELS 注册表:设定卡走独立任务端点,设置页模型面零新增=PRD「UI 零新增」)
MODEL_NAME = "qwen-image-2-1-sheet"
SUPPORTS_REFERENCE = True
SUPPORTS_MULTI_REFERENCE = False
SPEC = {
    "label": "Qwen-Image-2.1 设定卡B线",
    "repo_id": "ComfyUI 服务(本机)",
    "repo_ids": ("ComfyUI 服务(本机)",),
    "size_mb": 0,
    "license": "本机 ComfyUI 配置",
    "steps": 40,
    "description": "设定卡 B线 i2i(点名件整链:master i2i→五路编辑+武器/特效→head/表情×5→Composer 4K 合成;子步落盘断点续跑)",
    "layout": LAYOUT,
}

# 点名件本体(真源,零改动):apps/backend/comfyui/workflows/1_图片/QwenImage2.1/
# 5_角色设定卡/道劫-角色设定卡-i2i.json
WORKFLOW_PATH = (
    Path(__file__).resolve().parents[2]
    / "comfyui" / "workflows" / "1_图片" / "QwenImage2.1" / "5_角色设定卡"
    / "道劫-角色设定卡-i2i.json"
)

# ── GUI→API 转换(冻结 widget 序表;点名件类集封闭,件漂移=fail-closed 红错)──
# 序=各节点类 INPUT_TYPES 的 widget 承载序(required+optional,连线型槽不入);
# 件内节点类恰 13 种(+MarkdownNote 显示件跳过),逐类对照类定义与件内
# widgets_values 实长核账(172 链全数落位,见 comfyui/tests 契约测试)。
WIDGET_ORDER: dict[str, list[str]] = {
    "UNETLoader": ["unet_name", "weight_dtype"],
    "CLIPLoader": ["clip_name", "type", "device"],
    "VAELoaderKJ": ["vae_name", "device", "weight_dtype"],
    "LoraLoaderModelOnly": ["lora_name", "strength_model"],
    "LazyCache": ["reuse_threshold", "start_percent", "end_percent", "verbose"],
    "MySheetPromptHub": ["主体句", "角名", "背景类型", "格式"],
    "LoadImage": ["image"],
    "TextEncodeQwenImage21": ["prompt", "negative_prompt", "resolution"],
    "EmptyLatentImage": ["width", "height", "batch_size"],
    "KSampler": ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
    "VAEDecode": [],
    "MySheetCardComposer": ["角名", "格式", "背景", "档案", "武器类别"],  # 1123 Phase 6 末位追加
    "SaveImage": ["filename_prefix"],
}
_SKIP_TYPES = {"MarkdownNote"}
_CONTROL_VALUES = {"fixed", "increment", "decrement", "randomize"}

# 件内关键节点号(links 表实锚;契约测试对件复核,漂移即红)
HUB_NODE = "60"          # MySheetPromptHub(主体句/角名/背景类型/格式 四旋钮)
LOAD_IMAGE_NODE = "55"   # LoadImage(master 角色图槽,R1 唯一外部输入)
COMPOSER_NODE = "50"     # MySheetCardComposer(L4 合成)
SAVE_NODE = "51"         # SaveImage(件内前缀 道劫设定卡Q/)

# 解码节点→子步 tag(边界判定:子步切图在此换 LoadImage 抽头续喂)
_DECODE_TO_TAG = {
    8: "master", 13: "side", 18: "back", 23: "face",
    38: "head", 28: "wrist", 33: "waist", 43: "weapon", 48: "effect",
    73: "exp_happy", 83: "exp_angry", 93: "exp_sad",
    103: "exp_surprise", 113: "exp_shy",
}
_DECODE_TO_TAG_STR = {str(k): v for k, v in _DECODE_TO_TAG.items()}


@dataclass(frozen=True)
class SheetStep:
    """生成子步(tag/级别/件内节点号/依赖;号=点名件本体实锚,禁手挪)。"""
    tag: str
    level: int
    encode: int   # TextEncodeQwenImage21 节点号(指令入口,恒吃枢纽链接)
    ksampler: int  # KSampler 节点号(seed 真源=件内现值)
    decode: int    # VAEDecode 节点号(子步产物=该节点输出)
    deps: tuple[str, ...] = ()


# 子步执行序=PRD 依赖图(L1→L2[五路编辑+武器/特效]→L3[head+表情×5]→L4 compose);
# 落盘 step_NN 前缀=表序+1(14 路生成子步;compose 不占号,落 final.png)
STEPS: tuple[SheetStep, ...] = (
    SheetStep("master", 1, 5, 7, 8),
    SheetStep("side", 2, 10, 12, 13, ("master",)),
    SheetStep("back", 2, 15, 17, 18, ("master",)),
    SheetStep("face", 2, 20, 22, 23, ("master",)),
    SheetStep("wrist", 2, 25, 27, 28, ("master",)),
    SheetStep("waist", 2, 30, 32, 33, ("master",)),
    SheetStep("weapon", 2, 40, 42, 43),
    SheetStep("effect", 2, 45, 47, 48),
    SheetStep("head", 3, 35, 37, 38, ("side",)),
    SheetStep("exp_happy", 3, 70, 72, 73, ("face",)),
    SheetStep("exp_angry", 3, 80, 82, 83, ("face",)),
    SheetStep("exp_sad", 3, 90, 92, 93, ("face",)),
    SheetStep("exp_surprise", 3, 100, 102, 103, ("face",)),
    SheetStep("exp_shy", 3, 110, 112, 113, ("face",)),
)
STEP_BY_TAG = {s.tag: s for s in STEPS}
STEP_INDEX = {s.tag: i + 1 for i, s in enumerate(STEPS)}
GENERATION_STEP_COUNT = len(STEPS)  # 14(转移表进度分母)
COMPOSE_TAG = "compose"

_FINAL_NAME = "final.png"
_REFERENCE_NAME = "reference.png"
_TASK_DOC_NAME = "task.json"


def load_workflow_doc() -> dict[str, Any]:
    """点名件 GUI JSON 读取(缺件/坏件=诚实红,禁静默降级)。"""
    try:
        return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _pipeline_error(
            "sheet-workflow-invalid", f"B线点名件不可读: {WORKFLOW_PATH} ({exc})"
        ) from exc


def gui_to_api(doc: dict[str, Any]) -> dict[str, dict]:
    """点名件 GUI→API 整图转换(节点参数/连线逐字节取自件本体)。

    规则:①GUI inputs 槽带 link → inputs[name]=[str(源节点), 源出槽];
    ②widgets_values 按冻结序表对名入座,已链接槽的占位值就地丢弃(链接赢);
    ③LoadImage 尾部 upload 件剥除、KSampler control_after_generate 位置槽剔
    除(与件内实形核对);任何对不齐=sheet-workflow-invalid 红错(fail-closed,
    件漂移禁静默错位)。
    """
    nodes = {n["id"]: n for n in doc.get("nodes", [])}
    links = {l[0]: l for l in doc.get("links", [])}
    api: dict[str, dict] = {}
    for nid, node in nodes.items():
        cls = node.get("type") or ""
        if cls in _SKIP_TYPES:
            continue
        order = WIDGET_ORDER.get(cls)
        if order is None:
            raise _pipeline_error(
                "sheet-workflow-invalid",
                f"B线点名件出现未册节点类 {cls}(节点{nid})——冻结序表须扩项复核",
            )
        wv = list(node.get("widgets_values") or [])
        if cls == "LoadImage" and len(wv) == 2 and wv[1] == "image":
            wv = wv[:1]  # upload 按钮件(engine 惯例不进 API)
        if cls == "KSampler" and len(wv) == len(order) + 1 and wv[1] in _CONTROL_VALUES:
            wv = wv[:1] + wv[2:]  # 旧式 control_after_generate 位置槽
        linked: dict[str, list] = {}
        for slot in node.get("inputs") or []:
            lid = slot.get("link")
            if lid is None:
                continue
            link = links.get(lid)
            if link is None:
                raise _pipeline_error(
                    "sheet-workflow-invalid", f"B线点名件节点{nid} 悬空连线 {lid}"
                )
            linked[slot["name"]] = [str(link[1]), link[2]]
        if len(wv) != len(order):
            raise _pipeline_error(
                "sheet-workflow-invalid",
                f"B线点名件节点{nid} {cls} widget 对不齐(序{order} vs 值长{len(wv)})",
            )
        by_name = dict(zip(order, wv))
        inputs = {k: v for k, v in by_name.items() if k not in linked}
        inputs.update(linked)
        if not inputs:
            raise _pipeline_error(
                "sheet-workflow-invalid", f"B线点名件节点{nid} {cls} 映射为空"
            )
        api[str(nid)] = {"class_type": cls, "inputs": inputs}
    for required in (HUB_NODE, LOAD_IMAGE_NODE, COMPOSER_NODE, SAVE_NODE):
        if required not in api:
            raise _pipeline_error(
                "sheet-workflow-invalid", f"B线点名件缺关键节点 {required}"
            )
    return api


def build_task_graph(prompt: str, name: str, bg: str, fmt: str,
                     reference_name: str) -> dict[str, dict]:
    """整图 API 化+四旋钮注入(唯一外部输入=master 参考图;指令恒走件内枢纽)。"""
    graph = gui_to_api(load_workflow_doc())
    graph[HUB_NODE]["inputs"].update(
        {"主体句": prompt, "角名": name, "背景类型": bg, "格式": fmt}
    )
    # 合成器角名=件内 widget(未链接枢纽),随 payload 同步;格式/背景/档案恒吃
    # 枢纽出 17/18/19(件内连线,背景类型联动永不脱钩)
    graph[COMPOSER_NODE]["inputs"]["角名"] = name
    graph[LOAD_IMAGE_NODE]["inputs"]["image"] = reference_name
    return graph


def _is_edge(value: Any) -> bool:
    return (isinstance(value, list) and len(value) == 2
            and isinstance(value[0], str) and isinstance(value[1], int))


def step_subgraph(graph: dict[str, dict], tag: str,
                  upload_names: dict[str, str] | None = None) -> dict[str, dict]:
    """按子步切自包含 API 子图(上游闭包+边界抽头+存盘抽头)。

    闭包=该子步产物节点的全部上游;边界=其它子步的解码节点(_DECODE_TO_TAG)
    ——其出边一律换成 LoadImage 抽头 up_<tag>(图=盘上已落盘子步产物,断点续跑
    语义:已完子步不重跑,依赖图按级跳步);生成子步另挂 SaveImage 抽头取产物,
    compose 子图=件内 [50][51]+枢纽+14 抽头(compose-only 语义,照 B 线先例)。
    upload_names 缺项=依赖未备(红错;worker 前置校验依赖盘上产物在)。
    """
    uploads = upload_names or {}
    if tag == COMPOSE_TAG:
        roots = [COMPOSER_NODE, SAVE_NODE]
        own_decodes: set[str] = set()
    else:
        spec = STEP_BY_TAG.get(tag)
        if spec is None:
            raise _pipeline_error("sheet-workflow-invalid", f"未知子步 {tag!r}")
        roots = [str(spec.decode)]
        own_decodes = {str(spec.decode)}
    closure: set[str] = set()
    stack = list(roots)
    while stack:
        nid = stack.pop()
        if nid in closure:
            continue
        closure.add(nid)
        for value in graph[nid]["inputs"].values():
            if not _is_edge(value) or value[0] not in graph:
                continue
            if value[0] in _DECODE_TO_TAG_STR and value[0] not in own_decodes:
                continue  # 边界:不穿透(出边换抽头)
            stack.append(value[0])
    sub: dict[str, dict] = {nid: copy.deepcopy(graph[nid]) for nid in closure}
    for node in list(sub.values()):  # 快照迭代:抽头节点入 sub 不参与本轮切边
        for slot, value in list(node["inputs"].items()):
            if not _is_edge(value):
                continue
            dep = _DECODE_TO_TAG_STR.get(value[0])
            if dep is None or value[0] in own_decodes:
                continue
            engine_name = uploads.get(dep)
            if not engine_name:
                raise _pipeline_error(
                    "sheet-dependency-missing",
                    f"子步 {tag} 依赖 {dep} 的引擎图未上传(盘上产物缺步?)",
                )
            tap = f"up_{dep}"
            if tap not in sub:
                sub[tap] = {"class_type": "LoadImage", "inputs": {"image": engine_name}}
            node["inputs"][slot] = [tap, value[1]]
    if tag == COMPOSE_TAG:
        # 1122 实弹修(晏燎一发):引擎侧 MySheetCardComposer「格式」槽=combo
        # 枚举(formats_list),API 提交校验拒 STRING 链接(return_type_mismatch
        # '格式' received STRING vs ['全卡','简版','竖版','无装备'],linked 60:18)
        # ——GUI 连线宽松/API 校验严格。件内连线不动(GUI 真源恒在),仅 compose
        # 子图把该 combo 槽改直填=枢纽当前注入值(同源同值,语义等价);「背景/
        # 档案」槽=STRING→STRING 链接合法,保留件内连线。
        fmt_slot = sub[COMPOSER_NODE]["inputs"].get("格式")
        if _is_edge(fmt_slot) and fmt_slot[0] == HUB_NODE:
            hub_fmt = sub[HUB_NODE]["inputs"].get("格式")
            if not isinstance(hub_fmt, str) or not hub_fmt:
                raise _pipeline_error(
                    "sheet-workflow-invalid",
                    "compose 直填『格式』无源:枢纽未注入格式值")
            sub[COMPOSER_NODE]["inputs"]["格式"] = hub_fmt
        return sub
    spec = STEP_BY_TAG[tag]
    sub[f"save_{tag}"] = {
        "class_type": "SaveImage",
        "inputs": {"images": [str(spec.decode), 0],
                   "filename_prefix": f"sheet-i2i/{tag}"},
    }
    return sub


# ── 任务态(盘上子步产物=真源;task.json=请求快照+终态,可重建) ──────────────

def _tasks_root() -> Path:
    from comfyui.manifest import comfy_home

    return comfy_home() / "sheet-i2i"


def _task_dir(task_id: str) -> Path:
    return _tasks_root() / task_id


def _task_doc_path(task_id: str) -> Path:
    return _task_dir(task_id) / _TASK_DOC_NAME


def _step_path(task_id: str, tag: str) -> Path:
    return _task_dir(task_id) / f"step_{STEP_INDEX[tag]:02d}_{tag}.png"


def _final_path(task_id: str) -> Path:
    return _task_dir(task_id) / _FINAL_NAME


def _reference_path(task_id: str) -> Path:
    return _task_dir(task_id) / _REFERENCE_NAME


def _read_doc(task_id: str) -> dict[str, Any] | None:
    try:
        doc = json.loads(_task_doc_path(task_id).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def _write_doc(task_id: str, **fields: Any) -> dict[str, Any]:
    """task.json 更新(原子写;值 None=删字段——重跑起手清残账 error/failedStep)。"""
    doc = _read_doc(task_id) or {"id": task_id, "createdAt": int(time.time() * 1000)}
    for key, value in fields.items():
        if value is None:
            doc.pop(key, None)
        else:
            doc[key] = value
    doc["updatedAt"] = int(time.time() * 1000)
    path = _task_doc_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
    return doc


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(content)
    tmp.replace(path)


# 在途任务登记(sidecar 内存;重启即空=盘上账重建为 partial-failed 可续跑)
_RUNNING: dict[str, dict] = {}
_RUNNING_LOCK = threading.Lock()


class _TaskCancelled(Exception):
    """任务取消(用户停/全局停;已落盘子步保留,状态=cancelled 可续跑)。"""


def _check_stop(cancel: threading.Event) -> None:
    from image_gen.pipeline import is_generation_cancelled

    if cancel.is_set() or is_generation_cancelled():
        raise _TaskCancelled()


def _step_timeout_s() -> float:
    """单子步墙钟帽(同 qwen21 桥 1500s 口径,robust 解析)。"""
    try:
        timeout_s = float(os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S", "1500"))
    except (TypeError, ValueError, OverflowError):
        timeout_s = 1500.0
    if not math.isfinite(timeout_s) or timeout_s <= 0:
        timeout_s = 1500.0
    return timeout_s


def _cancel_engine_prompt(prompt_id: str | None) -> None:
    if not prompt_id:
        return
    try:
        _http_json("POST",
                   f"{bridge_url()}/api/jobs/{quote(prompt_id, safe='')}/cancel",
                   {}, timeout=5)
    except Exception:  # noqa: BLE001 — 取消降级(软停兜底),永不 5xx
        pass


def _fire_and_fetch(tag: str, graph: dict[str, dict], task_id: str,
                    cancel: threading.Event, entry: dict) -> bytes:
    """单发纪律子步发车:互斥锁内提交→轮询→取产物(取消感知,引擎队列单发)。"""
    from image_gen.pipeline import exclusive_generation

    with exclusive_generation():
        _check_stop(cancel)
        submitted = _http_json(
            "POST", f"{bridge_url()}/prompt",
            {"prompt": graph, "client_id": f"manying-sheet-i2i-{task_id[:8]}"},
            timeout=30,
        )
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id.strip():
            if submitted.get("node_errors"):
                raise _pipeline_error(
                    "bridge-execution-failed",
                    f"ComfyUI 拒绝子步 {tag}: {str(submitted['node_errors'])[:500]}")
            raise _pipeline_error("bridge-execution-failed",
                                  f"ComfyUI 未返回子步 {tag} 任务编号")
        entry["promptId"] = prompt_id
        deadline = time.monotonic() + _step_timeout_s()
        try:
            while time.monotonic() < deadline:
                _check_stop(cancel)
                try:
                    history = _http_json(
                        "GET", f"{bridge_url()}/history/{prompt_id}", timeout=10)
                except Exception:  # noqa: BLE001 — 引擎瞬断重试至墙钟
                    _check_stop(cancel)
                    time.sleep(2)
                    continue
                state, image = _history_output(history, prompt_id)
                if state == "success":
                    if not image:
                        raise _pipeline_error(
                            "bridge-no-output", f"子步 {tag} 完成但没有输出图片")
                    query = urlencode({
                        "filename": image["filename"],
                        "subfolder": image.get("subfolder", ""),
                        "type": image.get("type", "output")})
                    return _fetch_bytes(f"{bridge_url()}/view?{query}")
                time.sleep(2)
        except _TaskCancelled:
            _cancel_engine_prompt(prompt_id)
            raise
        _cancel_engine_prompt(prompt_id)
        raise _pipeline_error("bridge-timeout", f"子步 {tag} 生成超时")


def _upload_step_image(task_id: str, tag: str) -> str:
    """盘上子步产物→引擎 input(依赖图喂下游;ASCII 名防 GBK 雷,同 B 线先例)。"""
    data = _step_path(task_id, tag).read_bytes()
    result = _upload_image(
        f"{bridge_url()}/upload/image",
        base64.b64encode(data).decode("ascii"),
        f"sheet-i2i-{task_id[:12]}-{tag}.png",
    )
    name = result.get("name")
    if not isinstance(name, str) or not name:
        raise _pipeline_error("bridge-execution-failed",
                              f"ComfyUI 未返回子步 {tag} 产物文件名")
    return name


def _sheet_truth() -> dict[str, Any] | None:
    """qi21_bases.json 本地候选(MYSTUDIO_DAOJIE_DATA → 仓内真源;断层=None)。

    引擎侧枢纽读引擎家真源=最终裁判;此处仅前置早诊断(fail-open:1121 装机
    asar 数据断层在档,本地缺真源不拦发车)。
    """
    candidates: list[Path] = []
    env_home = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    if env_home:
        candidates.append(Path(env_home))
    candidates.append(
        Path(__file__).resolve().parents[3]
        / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json")
    for home in candidates:
        try:
            return json.loads((home / "qi21_bases.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return None


def _validate_knobs(bg: str, fmt: str) -> None:
    """背景/格式旋钮前置校验(真源可达才查;镜像枢纽 assert 阈值 v4+,不另立)。"""
    truth = _sheet_truth()
    if not truth:
        return
    q = truth.get("sheet_card_qwen") or {}
    try:
        version_ok = int(str(q.get("format_version", "v0")).lstrip("v")) >= 4
    except (TypeError, ValueError):
        version_ok = False
    if not version_ok or q.get("engine") != "qwen-image-2.1":
        raise _pipeline_error(
            "sheet-truth-invalid",
            "qi21_bases#sheet_card_qwen 真源缺位或版本漂移(须 v4+/qwen-image-2.1)")
    if bg not in (q.get("backgrounds") or {}):
        raise _pipeline_error(
            "invalid-payload", f"背景类型 {bg!r} 不在真源 backgrounds 注册表")
    if fmt not in (q.get("formats") or {}):
        raise _pipeline_error(
            "invalid-payload", f"格式 {fmt!r} 不在真源 formats 注册表")


def _engine_preflight() -> None:
    """发车前门(照 B 线先例):桥可达 + 引擎队列空(单发纪律让行)。"""
    from .comfyui_bridge import resolve_big_files

    if not resolve_big_files():
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试")
    queue = _http_json("GET", f"{bridge_url()}/queue", timeout=10)
    running = queue.get("queue_running") or []
    pending = queue.get("queue_pending") or []
    if running or pending:
        raise _pipeline_error(
            "engine-queue-busy",
            f"引擎队列非空,B线单发纪律让行(在途 {len(running)}+待 {len(pending)}),稍后重试")


def _run_worker(task_id: str) -> None:  # noqa: C901 — 子步编排主循环(注释分段)
    """B线任务工作线程:按依赖级序跑 14 生成子步+合成;任何失败=任务级失败可续跑。"""
    entry = _RUNNING.get(task_id) or {}
    cancel: threading.Event = entry.get("cancel") or threading.Event()
    failed_step: str | None = None
    try:
        doc = _read_doc(task_id) or {}
        _engine_preflight()
        # master 参考图=唯一外部输入(盘上 reference.png;断点续跑重启不丢)
        reference_b64 = base64.b64encode(
            _reference_path(task_id).read_bytes()).decode("ascii")
        uploaded = _upload_image(
            f"{bridge_url()}/upload/image", reference_b64,
            f"sheet-i2i-{task_id[:12]}-master-ref.png")
        reference_name = uploaded.get("name")
        if not isinstance(reference_name, str) or not reference_name:
            raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回参考图文件名")
        graph = build_task_graph(
            doc.get("prompt") or "",
            (doc.get("extra") or {}).get("角名") or "",
            (doc.get("extra") or {}).get("sheet_bg") or "纯白",
            (doc.get("extra") or {}).get("sheet_format") or "全卡",
            reference_name,
        )
        uploads: dict[str, str] = {}

        def ensure_uploaded(dep: str) -> None:
            if dep not in uploads:
                uploads[dep] = _upload_step_image(task_id, dep)

        for spec in STEPS:
            _check_stop(cancel)
            if _step_path(task_id, spec.tag).is_file():
                continue  # 断点续跑:存在即跳过(依赖级跳步)
            missing = [d for d in spec.deps
                       if not _step_path(task_id, d).is_file()]
            if missing:
                failed_step = spec.tag
                raise _pipeline_error(
                    "sheet-dependency-missing",
                    f"子步 {spec.tag} 依赖缺步 {missing}(盘上产物不完整),须先补依赖")
            for dep in spec.deps:
                ensure_uploaded(dep)
            failed_step = spec.tag
            _write_doc(task_id, status="running", currentStep=spec.tag)
            content = _fire_and_fetch(
                spec.tag, step_subgraph(graph, spec.tag, uploads),
                task_id, cancel, entry)
            _atomic_write_bytes(_step_path(task_id, spec.tag), content)
            failed_step = None

        _check_stop(cancel)
        if not _final_path(task_id).is_file():  # compose-only:子步全在只重合成
            failed_step = COMPOSE_TAG
            _write_doc(task_id, status="running", currentStep=COMPOSE_TAG)
            for dep in (s.tag for s in STEPS):
                ensure_uploaded(dep)
            content = _fire_and_fetch(
                COMPOSE_TAG, step_subgraph(graph, COMPOSE_TAG, uploads),
                task_id, cancel, entry)
            _atomic_write_bytes(_final_path(task_id), content)
            failed_step = None
        _write_doc(task_id, status="done", currentStep=None)
    except _TaskCancelled:
        _write_doc(task_id, status="cancelled", currentStep=None,
                   error="用户停止(已落盘子步保留,可续跑)")
    except Exception as exc:  # noqa: BLE001 — 任务级失败落点(禁半卡返回)
        from image_gen.pipeline import PipelineError

        detail = (f"{exc.code}: {exc.message}" if isinstance(exc, PipelineError)
                  else f"{type(exc).__name__}: {exc}")
        _write_doc(task_id, status="partial-failed", currentStep=None,
                   error=detail, **({"failedStep": failed_step} if failed_step else {}))
    finally:
        with _RUNNING_LOCK:
            _RUNNING.pop(task_id, None)


def start_task(payload: dict[str, Any]) -> dict[str, Any]:
    """建/续 B线任务(裁定B 异步):POST 同步面只做校验+发车前门,跑动归 worker 线程。

    payload={model, prompt(主体句), reference_image(master 角色图 b64/data URL),
    extra:{角名, sheet_format="全卡", sheet_bg="纯白"}, taskId?(续跑=同 id 重发,
    已落盘子步跳过;参考图以盘上首存为准,换图须新任务)};单飞纪律:同时至多
    一个 B线任务在途(引擎单发)。
    """
    from engines.image_engine.model_cache import (
        DEFAULT_IMAGE_MODEL,
        resolve_image_model_name,
    )

    model = resolve_image_model_name(str(payload.get("model") or DEFAULT_IMAGE_MODEL))
    if model != _qwen21.MODEL_NAME:
        raise _pipeline_error(
            "invalid-model", f"B线设定卡 i2i 仅支持 {_qwen21.MODEL_NAME},收到 {model}")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise _pipeline_error("invalid-prompt", "prompt(主体句)必须是非空字符串")
    reference = payload.get("reference_image")
    if not isinstance(reference, str) or not reference.strip():
        raise _pipeline_error(
            "invalid-input", "reference_image(master 角色图 b64)必填——无定妆图请先出定妆图")
    extra = payload.get("extra") if isinstance(payload.get("extra"), dict) else {}
    name = extra.get("角名")
    if not isinstance(name, str) or not name.strip():
        raise _pipeline_error("invalid-input", "extra.角名必须是非空字符串")
    fmt = str(extra.get("sheet_format") or "全卡")
    bg = str(extra.get("sheet_bg") or "纯白")
    _validate_knobs(bg, fmt)

    task_id = str(payload.get("taskId") or "").strip()
    if task_id:
        if not task_id.isalnum() or len(task_id) > 64:
            raise _pipeline_error("invalid-input", "taskId 必须是字母数字(≤64)")
        if _read_doc(task_id) is None:
            raise _pipeline_error("sheet-task-not-found", f"任务不存在: {task_id}")
    _engine_preflight()  # 发车前门(建任务前拦,无残账)

    # 单飞纪律收口在锁内:建账+登记原子化,并发第二发在创建残账前即被拒
    with _RUNNING_LOCK:
        if any(tid != task_id for tid in _RUNNING):
            raise _pipeline_error(
                "generation-busy", "B线设定卡任务已在途,请候其完成或先停止")
        if task_id and task_id in _RUNNING:
            raise _pipeline_error("generation-busy", "该任务已在途")
        if not task_id:
            task_id = uuid.uuid4().hex
            _task_dir(task_id).mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(_reference_path(task_id), _decode_reference(reference))
        # 起手清残账(error/failedStep=None 删字段),终态以本轮回写为准
        _write_doc(task_id, status="running", model=model, prompt=prompt,
                   extra={"角名": name.strip(), "sheet_format": fmt, "sheet_bg": bg},
                   currentStep=None, error=None, failedStep=None)
        entry = {"cancel": threading.Event(), "promptId": None}
        _RUNNING[task_id] = entry
    threading.Thread(target=_run_worker, args=(task_id,),
                     name=f"sheet-i2i-{task_id[:8]}", daemon=True).start()
    return task_status(task_id) or {"taskId": task_id, "status": "running"}


def task_status(task_id: str) -> dict[str, Any] | None:
    """任务态(盘上子步产物=真源重建;非终态禁归 running——poller 水合坑在档)。"""
    doc = _read_doc(task_id)
    if doc is None:
        return None
    steps = []
    done = 0
    for spec in STEPS:
        exists = _step_path(task_id, spec.tag).is_file()
        steps.append({"tag": spec.tag, "level": spec.level,
                      "step": STEP_INDEX[spec.tag], "done": exists})
        if exists:
            done += 1
    final_exists = _final_path(task_id).is_file()
    with _RUNNING_LOCK:
        live = task_id in _RUNNING
    if final_exists:
        status = "done"
    elif live:
        status = "running"
    elif doc.get("status") == "running":
        status = "partial-failed"  # sidecar 重启残账:盘上账重建为可续跑态
    else:
        status = str(doc.get("status") or "partial-failed")
    result: dict[str, Any] = {
        "taskId": task_id,
        "status": status,
        "createdAt": doc.get("createdAt"),
        "updatedAt": doc.get("updatedAt"),
        "progress": {"done": done, "total": GENERATION_STEP_COUNT,
                     "percent": round(done * 100 / GENERATION_STEP_COUNT)},
        "steps": steps,
        "currentStep": doc.get("currentStep") if live else None,
        "resumable": status in ("partial-failed", "cancelled"),
    }
    if status == "done":
        result["resultReady"] = True
    if doc.get("error"):
        result["error"] = doc["error"]
    if doc.get("failedStep"):
        result["failedStep"] = doc["failedStep"]
    return result


def task_result_b64(task_id: str) -> str | None:
    """终卡 b64(done 态;未完=无终卡=None,禁半卡返回)。"""
    final = _final_path(task_id)
    if not final.is_file():
        return None
    return base64.b64encode(final.read_bytes()).decode("ascii")


def cancel_task(task_id: str) -> dict[str, Any] | None:
    """取消(引擎队列单发语义:秒杀在途 prompt;已落盘子步保留可续跑)。"""
    if _read_doc(task_id) is None:
        return None
    with _RUNNING_LOCK:
        entry = _RUNNING.get(task_id)
    if entry is not None:
        cancel = entry.get("cancel")
        if cancel is not None:
            cancel.set()
        _cancel_engine_prompt(entry.get("promptId"))
        return {"cancelled": True, "reason": "forwarded"}
    status = task_status(task_id) or {}
    if status.get("status") == "done":
        return {"cancelled": False, "reason": "terminal"}
    _write_doc(task_id, status="cancelled", currentStep=None,
               error="用户停止(已落盘子步保留,可续跑)")
    return {"cancelled": True, "reason": "not-running"}
