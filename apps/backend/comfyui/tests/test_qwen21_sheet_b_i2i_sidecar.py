# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available via COMMERCIAL_LICENSE.md.
"""B线 i2i 设定卡 sidecar 契约(1121 trellis 11-21-asset-sheet-bline-i2i R1)。

被测=engines/image_engine/qwen21_sheet.py(布局 qwen21-sheet-i2i):
① GUI→API 整图复用保真(点名件 67 节点/171 链逐字节落位;指令恒吃枢纽链接=
  分格指令逐字取 qi21_bases#sheet_card_qwen 真源,sidecar 零手搓;seed=真源表);
② 子步表=件依赖图实锚(编辑参考图槽对号:head←side 解码,表情×5←face 解码,
  余←master 解码);
③ 子步切图(上游闭包+边界抽头+存盘抽头;compose-only=件内[50][51]+枢纽+14抽头);
④ 断点续跑/依赖级跳步(存在即跳过,续跑按依赖序补缺);
⑤ 失败落点(任一子步失败=任务级 partial-failed+failedStep,禁半卡交付);
⑥ 任务态重建(盘上子步产物=真源;sidecar 重启残账 running 无 worker→
  partial-failed 可续跑,非终态禁归 running)。
"""
from __future__ import annotations

import base64
import json
import pathlib
import time

import pytest

from engines.image_engine import qwen21_sheet as qs

_TESTS = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS.parents[3]
TRUTH = json.loads(
    (_REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
     "/json/qi21_bases.json").read_text(encoding="utf-8"))["sheet_card_qwen"]
DOC = qs.load_workflow_doc()
GUI_NODES = {n["id"]: n for n in DOC["nodes"]}
GUI_LINKS = {l[0]: l for l in DOC["links"]}
API = qs.gui_to_api(DOC)

PAYLOAD = {
    "model": "qwen-image-2-1",
    "prompt": "姓名:晏燎|性别:女|年龄:十九岁|身份:剑修|武器:长剑",
    "reference_image": base64.b64encode(b"fake-master-png").decode("ascii"),
    "extra": {"角名": "晏燎", "sheet_format": "全卡", "sheet_bg": "纯白"},
}


# ── ① GUI→API 整图复用保真 ────────────────────────────────────────────────

def test_gui_to_api_whole_graph_reuse():
    # 67 节点(含 MarkdownNote 显示件)→ 66 API 节点;171 链逐条落位为边
    assert len(DOC["nodes"]) == 67 and len(DOC["links"]) == 171
    assert len(API) == 66
    for lid, link in GUI_LINKS.items():
        _, src, src_slot, dst, dst_slot, _ = link[:6]
        slot_name = GUI_NODES[dst]["inputs"][dst_slot]["name"]
        assert API[str(dst)]["inputs"][slot_name] == [str(src), src_slot], lid


def test_instructions_stay_hub_wired_and_seeds_match_truth():
    # 分格指令逐字取真源:全部 TextEncode 正/负向恒吃枢纽[60]链接(sidecar 不
    # 手搓指令串);seed=qi21_bases#sheet_card_qwen.seeds 真源表
    for spec in qs.STEPS:
        te = API[str(spec.encode)]
        assert te["inputs"]["prompt"][0] == qs.HUB_NODE, spec.tag
        assert te["inputs"]["negative_prompt"][0] == qs.HUB_NODE, spec.tag
        ks = API[str(spec.ksampler)]
        assert ks["inputs"]["seed"] == TRUTH["seeds"][spec.tag], spec.tag
    for nid in (40, 45):  # 武器/特效 t2i 同律
        assert API[str(nid)]["inputs"]["prompt"][0] == qs.HUB_NODE
    # 采样口径(件内现值=v6 档3混动编辑 40步cfg4;t2i Turbo 8步cfg1)
    assert API["7"]["inputs"]["steps"] == 40 and API["7"]["inputs"]["cfg"] == 4.0
    assert API["42"]["inputs"]["steps"] == 8 and API["42"]["inputs"]["cfg"] == 1.0
    # 编辑模型=档3混动共享链(UNET[1]→Fix[65]→LazyCache[66]);t2i 模型←viggle[4]
    assert API["12"]["inputs"]["model"] == ["66", 0]
    assert API["42"]["inputs"]["model"] == ["4", 0]


def test_build_task_graph_injects_four_knobs_only():
    graph = qs.build_task_graph("主体句X", "晏燎", "纯白", "全卡", "ref-1.png")
    assert graph[qs.HUB_NODE]["inputs"]["主体句"] == "主体句X"
    assert graph[qs.HUB_NODE]["inputs"]["角名"] == "晏燎"
    assert graph[qs.HUB_NODE]["inputs"]["背景类型"] == "纯白"
    assert graph[qs.HUB_NODE]["inputs"]["格式"] == "全卡"
    assert graph[qs.LOAD_IMAGE_NODE]["inputs"]["image"] == "ref-1.png"
    assert graph[qs.COMPOSER_NODE]["inputs"]["角名"] == "晏燎"
    # 除四旋钮+合成器角名+参考图槽外,整图与件本体逐节点一致(禁拆抄拼改)
    pristine = qs.gui_to_api(DOC)
    for nid, node in pristine.items():
        for slot, value in node["inputs"].items():
            if (nid, slot) in {(qs.HUB_NODE, "主体句"), (qs.HUB_NODE, "角名"),
                               (qs.HUB_NODE, "背景类型"), (qs.HUB_NODE, "格式"),
                               (qs.COMPOSER_NODE, "角名"),
                               (qs.LOAD_IMAGE_NODE, "image")}:
                continue
            assert graph[nid]["inputs"][slot] == value, (nid, slot)


# ── ② 子步表=件依赖图实锚 ────────────────────────────────────────────────

def test_step_table_matches_file_links():
    # 编辑参考图槽对号(件 links 表):head←side 解码[13];表情×5←face 解码[23];
    # 五路编辑←master 解码[8];master i2i←LoadImage[55];武器/特效无参考(t2i)
    want_src = {"master": 55, "head": 13,
                "exp_happy": 23, "exp_angry": 23, "exp_sad": 23,
                "exp_surprise": 23, "exp_shy": 23,
                "side": 8, "back": 8, "face": 8, "wrist": 8, "waist": 8}
    assert qs.GENERATION_STEP_COUNT == 14
    assert set(qs.STEP_BY_TAG) == set(TRUTH["seeds"])
    for spec in qs.STEPS:
        slots = [i for i in GUI_NODES[spec.encode]["inputs"]
                 if i["name"] == "images.image_1"]
        if spec.tag in ("weapon", "effect"):
            assert not slots, f"{spec.tag} 为 t2i 不应有参考图槽"
            continue
        src = GUI_LINKS[slots[0]["link"]][1]
        assert src == want_src[spec.tag], spec.tag
        if spec.deps:  # 依赖声明与件连线同源
            assert src == qs.STEP_BY_TAG[spec.deps[0]].decode, spec.tag


# ── ③ 子步切图(闭包/边界抽头/存盘抽头) ───────────────────────────────────

def _slot_edge(node, name):
    return node["inputs"][name]


def test_step_subgraph_closure_and_taps():
    graph = qs.build_task_graph("主体句X", "晏燎", "纯白", "全卡", "ref.png")
    uploads = {t: f"in-{t}.png" for t in qs.STEP_BY_TAG}

    master = qs.step_subgraph(graph, "master", uploads)
    assert qs.LOAD_IMAGE_NODE in master and "save_master" in master
    assert master[qs.LOAD_IMAGE_NODE]["inputs"]["image"] == "ref.png"
    assert master["save_master"]["inputs"]["images"] == ["8", 0]
    assert not any(n["class_type"] == "LoadImage" and nid.startswith("up_")
                   for nid, n in master.items() if isinstance(nid, str))

    side = qs.step_subgraph(graph, "side", uploads)
    assert "8" not in side and "5" not in side  # master 链不进 side 闭包
    assert _slot_edge(side["10"], "images.image_1") == ["up_master", 0]
    assert side["up_master"]["inputs"]["image"] == "in-master.png"
    assert side["save_side"]["inputs"]["filename_prefix"] == "sheet-i2i/side"

    head = qs.step_subgraph(graph, "head", uploads)
    assert _slot_edge(head["35"], "images.image_1") == ["up_side", 0]
    shy = qs.step_subgraph(graph, "exp_shy", uploads)
    assert _slot_edge(shy["110"], "images.image_1") == ["up_face", 0]

    for tag in ("weapon", "effect"):  # t2i 无参考
        sub = qs.step_subgraph(graph, tag, uploads)
        assert not any(n["class_type"] == "LoadImage" for n in sub.values()), tag

    compose = qs.step_subgraph(graph, qs.COMPOSE_TAG, uploads)
    core = {n for n in compose if not n.startswith("up_")}
    assert core == {qs.COMPOSER_NODE, qs.SAVE_NODE, qs.HUB_NODE}
    assert sorted(n for n in compose if n.startswith("up_")) == sorted(
        f"up_{t}" for t in qs.STEP_BY_TAG)
    assert compose[qs.SAVE_NODE]["inputs"]["filename_prefix"] == "道劫设定卡Q/"
    assert _slot_edge(compose[qs.COMPOSER_NODE], "背景") == [qs.HUB_NODE, 17]
    assert _slot_edge(compose[qs.COMPOSER_NODE], "档案") == [qs.HUB_NODE, 19]


def test_step_subgraph_missing_dep_fails_closed():
    graph = qs.build_task_graph("主体句X", "晏燎", "纯白", "全卡", "ref.png")
    with pytest.raises(Exception) as excinfo:
        qs.step_subgraph(graph, "back", {})
    assert getattr(excinfo.value, "code", "") == "sheet-dependency-missing"


# ── 任务面(④续跑/⑤失败落点/⑥重建)——mock 引擎面,盘上账全真 ─────────────

@pytest.fixture()
def sheet_env(tmp_path, monkeypatch):
    """任务根指 tmp(comfy 家覆写)+引擎面三桩(mock 发车/上传/发车前门)。"""
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfy-home"))
    from image_gen import pipeline as _pipeline

    _pipeline._CANCEL_EVENT.clear()  # 防同进程其它用例的取消位毒化本任务
    fired: list[str] = []
    graphs: dict[str, dict] = {}
    fail_tags: set[str] = set()

    def fake_fire(tag, graph, task_id, cancel, entry):
        fired.append(tag)
        graphs[tag] = graph
        if tag in fail_tags:
            raise qs._pipeline_error("bridge-execution-failed", f"boom-{tag}")
        return f"PNG-{tag}".encode()

    monkeypatch.setattr(qs, "_fire_and_fetch", fake_fire)
    monkeypatch.setattr(qs, "_upload_image",
                        lambda url, b64, filename: {"name": f"in-{filename}"})
    monkeypatch.setattr(qs, "_engine_preflight", lambda: None)
    yield type("Env", (), {"fired": fired, "graphs": graphs, "fail_tags": fail_tags})()

    def settle():
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with qs._RUNNING_LOCK:
                if not qs._RUNNING:
                    return
            time.sleep(0.02)
        raise AssertionError("sheet worker 未收摊")
    settle()


def _run_start_task(env, payload=None, **overrides):
    body = dict(payload or PAYLOAD)
    body.update(overrides)
    doc = qs.start_task(body)
    task_id = doc["taskId"]
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with qs._RUNNING_LOCK:
            if task_id not in qs._RUNNING:
                break
        time.sleep(0.02)
    else:
        raise AssertionError("worker 未收摊")
    return task_id, qs.task_status(task_id)


def test_full_run_fourteen_steps_then_compose(sheet_env):
    task_id, doc = _run_start_task(sheet_env)
    # 14 生成子步按依赖级序 + compose;L1→L2(五编辑+武器/特效)→L3(head+表情×5)
    assert sheet_env.fired[:1] == ["master"]
    level2 = {"side", "back", "face", "wrist", "waist", "weapon", "effect"}
    assert set(sheet_env.fired[1:8]) == level2
    assert sheet_env.fired[8] == "head"
    assert sheet_env.fired[9:14] == ["exp_happy", "exp_angry", "exp_sad",
                                     "exp_surprise", "exp_shy"]
    assert sheet_env.fired[14] == "compose" and len(sheet_env.fired) == 15
    assert doc["status"] == "done" and doc["progress"] == {
        "done": 14, "total": 14, "percent": 100}
    assert doc["resultReady"] is True and doc["resumable"] is False
    # 子步产物+终卡全落盘;结果端点=整卡
    for spec in qs.STEPS:
        assert qs._step_path(task_id, spec.tag).is_file(), spec.tag
    assert qs.task_result_b64(task_id) == base64.b64encode(
        qs._final_path(task_id).read_bytes()).decode("ascii")
    # compose 子图=件内[50][51]+枢纽+14 抽头(整图复用)
    compose = sheet_env.graphs["compose"]
    assert {n for n in compose if not n.startswith("up_")} == {"50", "51", "60"}
    assert compose["up_master"]["inputs"]["image"].startswith("in-sheet-i2i-")


def test_resume_skips_existing_steps_in_dependency_order(sheet_env):
    # 预置 master+side+face 于盘上(如断点残账)→续跑只补缺,依赖级跳步
    task_id, _ = _run_start_task(sheet_env)  # 先完整跑一遍拿合法任务账
    for tag in ("master", "side", "face"):
        assert qs._step_path(task_id, tag).is_file()
    # 推倒重来:同盘账重发(其余子步产物移除,保留三步)
    for spec in qs.STEPS:
        if spec.tag not in ("master", "side", "face"):
            qs._step_path(task_id, spec.tag).unlink()
    qs._final_path(task_id).unlink()
    sheet_env.fired.clear()
    _, doc = _run_start_task(sheet_env, taskId=task_id)
    assert sheet_env.fired[0] == "back"  # master/side/face 存在即跳过
    assert not {"master", "side", "face"} & set(sheet_env.fired)
    # head 候 side(在)可跑;表情×5 候 face(在)可跑;序=依赖级
    assert sheet_env.fired == ["back", "wrist", "waist", "weapon", "effect",
                               "head", "exp_happy", "exp_angry", "exp_sad",
                               "exp_surprise", "exp_shy", "compose"]
    assert doc["status"] == "done" and doc["progress"]["done"] == 14


def test_resume_out_of_order_artifact_fills_dependencies_first(sheet_env):
    # 依赖级跳步:盘上只有末梢产物(exp_shy)无上游 → 续跑从 master 起按依赖序补,
    # exp_shy 不重跑
    task_id, _ = _run_start_task(sheet_env)
    keep = {"exp_shy"}
    for spec in qs.STEPS:
        if spec.tag not in keep:
            qs._step_path(task_id, spec.tag).unlink()
    qs._final_path(task_id).unlink()
    sheet_env.fired.clear()
    _, doc = _run_start_task(sheet_env, taskId=task_id)
    assert sheet_env.fired[0] == "master" and "exp_shy" not in sheet_env.fired
    assert doc["status"] == "done"


def test_step_failure_is_task_level_no_half_card(sheet_env):
    sheet_env.fail_tags.update({"back", "compose"})
    task_id, doc = _run_start_task(sheet_env)
    # back 失败=任务级失败立即止步:后续子步不再发车,无终卡(禁半卡返回)
    assert sheet_env.fired == ["master", "side", "back"]
    assert doc["status"] == "partial-failed" and doc["resumable"] is True
    assert doc["failedStep"] == "back" and "bridge-execution-failed" in doc["error"]
    assert doc["progress"] == {"done": 2, "total": 14, "percent": 14}
    assert not qs._final_path(task_id).is_file()
    assert qs.task_result_b64(task_id) is None
    # 续跑(失败已修):从 back 起补,compose 仍失败=落在 compose(禁半卡依旧)
    sheet_env.fired.clear()
    sheet_env.fail_tags.clear()
    sheet_env.fail_tags.add("compose")
    _, doc2 = _run_start_task(sheet_env, taskId=task_id)
    assert sheet_env.fired[0] == "back" and "master" not in sheet_env.fired
    assert doc2["status"] == "partial-failed" and doc2["failedStep"] == "compose"
    assert doc2["progress"]["done"] == 14  # 14 子步全在,只差合成
    assert qs.task_result_b64(task_id) is None
    # 再续(compose 修好)→ compose-only 完成(照 B 线 --compose-only 语义)
    sheet_env.fired.clear()
    sheet_env.fail_tags.clear()
    _, doc3 = _run_start_task(sheet_env, taskId=task_id)
    assert sheet_env.fired == ["compose"] and doc3["status"] == "done"
    assert qs.task_result_b64(task_id) is not None


def test_task_state_rebuild_from_disk_after_sidecar_restart(sheet_env, tmp_path):
    # sidecar 重启=内存 _RUNNING 空;task.json 残 running → 盘上账重建
    task_id, _ = _run_start_task(sheet_env)
    qs._write_doc(task_id, status="running", currentStep="face")  # 伪造残账
    for tag in ("head", "exp_happy", "exp_angry", "exp_sad", "exp_surprise",
                "exp_shy"):
        qs._step_path(task_id, tag).unlink()
    qs._final_path(task_id).unlink()
    rebuilt = qs.task_status(task_id)
    assert rebuilt["status"] == "partial-failed"  # 非终态禁归 running
    assert rebuilt["resumable"] is True
    assert rebuilt["progress"] == {"done": 8, "total": 14, "percent": 57}
    assert rebuilt["currentStep"] is None
    # 终卡在=done(盘上真源赢过 task.json 残 running)
    qs._final_path(task_id).write_bytes(b"PNG-compose")
    assert qs.task_status(task_id)["status"] == "done"
    assert qs.task_status("no-such-task") is None
    # 取消面:not-running 任务可标 cancelled(已落盘保留);done 任务=terminal
    qs._final_path(task_id).unlink()
    assert qs.cancel_task(task_id) == {"cancelled": True, "reason": "not-running"}
    assert qs.task_status(task_id)["status"] == "cancelled"
    assert qs.cancel_task("no-such-task") is None


def test_start_task_payload_gates(sheet_env):
    from image_gen.pipeline import PipelineError

    def _expect_reject(payload, code):
        with pytest.raises(PipelineError) as excinfo:
            qs.start_task(payload)
        assert excinfo.value.code == code

    _expect_reject({**PAYLOAD, "model": "krea2-turbo"}, "invalid-model")
    _expect_reject({**PAYLOAD, "prompt": "  "}, "invalid-prompt")
    _expect_reject({**PAYLOAD, "reference_image": ""}, "invalid-input")
    _expect_reject({**PAYLOAD, "extra": {"sheet_format": "全卡", "sheet_bg": "纯白"}},
                   "invalid-input")  # 缺角名
    _expect_reject({**PAYLOAD, "extra": {**PAYLOAD["extra"], "sheet_bg": "星空"}},
                   "invalid-payload")  # 真源 backgrounds 不在册
    _expect_reject({**PAYLOAD, "extra": {**PAYLOAD["extra"], "sheet_format": "横幅"}},
                   "invalid-payload")  # 真源 formats 不在册
    _expect_reject({**PAYLOAD, "taskId": "deadbeef00"}, "sheet-task-not-found")
    # 缺省旋钮=裁定D 一期(全卡/纯白);model 缺省=qwen-image-2-1
    task_id, doc = _run_start_task(
        sheet_env, {"prompt": PAYLOAD["prompt"],
                    "reference_image": PAYLOAD["reference_image"],
                    "extra": {"角名": "晏燎"}})
    assert doc["status"] == "done"
    assert json.loads(qs._task_doc_path(task_id).read_text(encoding="utf-8"))[
        "extra"] == {"角名": "晏燎", "sheet_format": "全卡", "sheet_bg": "纯白"}


# ── server 端点面(路由分发+错误码映射;直调 Handler 方法,零真 HTTP 面) ─────

@pytest.fixture()
def handler_stub():
    from image_gen.server import Handler

    stub = Handler.__new__(Handler)
    sent: list[tuple[int, dict]] = []
    stub._send_json = lambda payload, status=200: sent.append((int(status), payload))
    stub._send_error_json = lambda status, message, code="error": sent.append(
        (int(status), {"error": {"message": message, "code": code}}))
    return stub, sent


def test_server_sheet_routes_dispatch_and_error_map(sheet_env, handler_stub):
    stub, sent = handler_stub
    task_id, _ = _run_start_task(sheet_env)  # 完整跑完=done

    stub._handle_sheet_i2i_create(PAYLOAD)  # 单飞:新任务在途才拒;已收摊=新账
    assert sent[-1][0] == 200 and sent[-1][1]["status"] in ("running", "done")
    new_id = sent[-1][1]["taskId"]

    stub._handle_sheet_i2i_get(f"/v1/images/sheet-i2i/{task_id}")
    assert sent[-1][1]["status"] == "done" and sent[-1][1]["resultReady"] is True
    stub._handle_sheet_i2i_get(f"/v1/images/sheet-i2i/{task_id}/result")
    assert sent[-1][0] == 200 and sent[-1][1]["data"][0]["b64_json"]
    stub._handle_sheet_i2i_get("/v1/images/sheet-i2i/who/")
    assert sent[-1][0] == 404 and sent[-1][1]["error"]["code"] == "sheet-task-not-found"
    stub._handle_sheet_i2i_cancel(f"/v1/images/sheet-i2i/{task_id}/cancel")
    assert sent[-1][1] == {"cancelled": False, "reason": "terminal"}

    # 未完任务:终卡端点=409 禁半卡;取消=not-running 落 cancelled
    stub._handle_sheet_i2i_get(f"/v1/images/sheet-i2i/{new_id}/result")
    if qs.task_status(new_id)["status"] != "done":
        assert sent[-1][0] == 409
        assert sent[-1][1]["error"]["code"] == "sheet-result-not-ready"
    stub._handle_sheet_i2i_cancel(f"/v1/images/sheet-i2i/{new_id}/cancel")
    assert sent[-1][1]["cancelled"] is True

    # 错误码映射:busy→409 / unreachable→503 / 无效载荷→400
    from image_gen.pipeline import PipelineError

    for code, http in (("generation-busy", 409), ("engine-queue-busy", 409),
                       ("bridge-unreachable", 503), ("invalid-input", 400),
                       ("sheet-workflow-invalid", 500)):
        stub._sheet_error_response(PipelineError(code, f"m-{code}"))
        assert sent[-1][0] == http and sent[-1][1]["error"]["code"] == code
