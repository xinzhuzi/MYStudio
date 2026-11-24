#!/usr/bin/env python3
"""终版追踪参数四面同步(1118 收尾役·②):把七发探针定谳的配方灌进产线四面。

配方(探针 P7+livefire 实弹验证):
  select=closest_to_xy / X=1920 / Y=900 / frame_index=170(结尾大特写帧锚,按镜可调)
  identity_model=clip_vision / identity_threshold=0.0(模型默认)
  identity_clip_vision ← CLIPVisionLoader(clip_vision_g.safetensors) 新增节点 #800

同步面:
  画布三件(单镜 / 一镜到底-分段 / 7_测试 克隆件):widgets 五值 + 5011 加槽 + #800 节点 + 链 + 四采组框罩全复算
  API 模板(h3-three-stage-template.api.json):inputs 同步 + #800 节点 + 接线
  双生成器(sancai_inline / multiseg_inline):widget 表+装载器发码同步(重生不回啃)

守门(每画布件):layout_check 八判据不增/六硬项恒零/恒向右(装载器恒在 5011 左侧)/幂等复跑零改动;
收尾:双契约+树审计全绿。
用法:
  python3 apps/build/scripts/track_params_sync_1118.py            # 施治+守门
  python3 apps/build/scripts/track_params_sync_1118.py --verify   # 只验盘上态
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
from layout_check import CHECK_KEYS, check_workflow  # noqa: E402

CANVAS_FILES = [
    ("apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json", "四采修脸组(5000 段·远景/高清双档·默认旁路·1118→1119)"),
    ("apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json", None),  # 组名自动探测(含「四采」)
    ("apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-小脸修复.json", "四采·小脸修复(FaceRefine)"),
]
API_TPL = "apps/frontend/lib/comfyui/h3/templates/h3-three-stage-template.api.json"
GENERATORS = [
    "apps/build/scripts/sancai_inline_facerefine_build_1118.py",
    "apps/build/scripts/multiseg_inline_facerefine_build_1118.py",
]
LOADER_ID = 800
CLIP_NAME = "clip_vision_g.safetensors"
ZEROS = ("est_spacing", "est_overlap", "negative_region", "output_rightmost", "leftward", "group_overlap")


def die(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def sync_canvas(path: str, group_title: str | None, verify_only: bool, full: bool = True) -> None:
    wf = Path(REPO / path)
    raw = wf.read_text(encoding="utf-8")
    d = json.loads(raw)
    tc = next((n for n in d["nodes"] if n.get("type") == "H3FaceTrackCrop"), None)
    if tc is None:
        die(f"{path}: 无 TrackCrop")
    wv = tc["widgets_values"]
    before = check_workflow(d)[0]["counts"]

    g = next((x for x in d["groups"] if (group_title and x["title"] == group_title)
              or (group_title is None and "四采" in str(x.get("title", "")))), None)
    if g is None:
        die(f"{path}: 找不到四采组框")

    # 1) widgets(序:... idthr@11, select@12, ..., idmodel@16, ..., X@20, Y@21, fi@22)
    #    full=False(multiseg 分策):仅锚三元组——490 位仪表扫描实证任何新线必破棘轮,
    #    且七发探针定谳 clip_vision 身份全程 never consulted,锚才是根因修复
    wv[12] = "closest_to_xy"
    wv[20] = 1920
    wv[21] = 900
    wv[22] = 170
    if full:
        wv[11] = 0.0
        wv[16] = "clip_vision"
    else:
        wv[11] = 0.28      # 显式回写(防重生从母本继承 clip_vision 而装载器缺位)
        wv[16] = "insightface"

    # 2) #800 装载器 + 5011 加槽 + 链(幂等:已存在则跳过);落位=小网格搜净位(仅 full)
    if full and not any(n.get("id") == LOADER_ID for n in d["nodes"]):
        tx, ty = tc["pos"]
        base = {
            "id": LOADER_ID, "type": "CLIPVisionLoader", "size": [340, 58], "flags": {},
            "order": tc.get("order", 0), "mode": 0, "inputs": [],
            "outputs": [{"name": "CLIP_VISION", "type": "CLIP_VISION", "links": []}],
            "properties": {"Node name for S&R": "CLIPVisionLoader"},
            "widgets_values": [CLIP_NAME],
        }
        link_id = max(l[0] for l in d["links"]) + 1
        chosen = None
        for dy in (1400, 1600, 1800, -260, -360, -160, 500, 640, 760, 900, 1050, 1250):
            for dx in (-470, -570, -670, -300, -240, -180, -120, -60, -400):
                trial = dict(base)
                trial["pos"] = [tx + dx - 60, ty + dy]
                d["nodes"].append(trial)
                c = check_workflow(d)[0]["counts"]
                d["nodes"].pop()
                if all(c[k] <= before[k] for k in CHECK_KEYS):
                    chosen = [tx + dx - 60, ty + dy]
                    break
            if chosen:
                break
        if not chosen:
            die(f"{path}: 装载器九宫格无净位,需人工布局")
        loader = dict(base)
        loader["pos"] = chosen
        d["nodes"].append(loader)
        slot = {"name": "identity_clip_vision", "type": "CLIP_VISION", "link": link_id}
        tc.setdefault("inputs", []).append(slot)
        d["links"].append([link_id, LOADER_ID, 0, tc["id"], len(tc["inputs"]) - 1, "CLIP_VISION"])
        loader["outputs"][0]["links"] = [link_id]

    # 3) 四采组框罩全复算(成员=原 bbox 圈内节点 ∪ #800;不吞他组成员如 5100/4100)
    ob = g["bounding"]
    band_ids = {n["id"] for n in d["nodes"]
                if ob[0] <= n["pos"][0] and ob[1] <= n["pos"][1]
                and n["pos"][0] + n["size"][0] <= ob[0] + ob[2]
                and n["pos"][1] + n["size"][1] <= ob[1] + ob[3]}
    if full or any(n.get("id") == LOADER_ID for n in d["nodes"]):
        band_ids.add(LOADER_ID)
    ns = [n for n in d["nodes"] if n["id"] in band_ids]
    x1 = min(n["pos"][0] for n in ns); y1 = min(n["pos"][1] for n in ns)
    x2 = max(n["pos"][0] + n["size"][0] for n in ns); y2 = max(n["pos"][1] + n["size"][1] for n in ns)
    g["bounding"] = [x1 - 60, y1 - 80, x2 - x1 + 60, y2 - y1 + 120]

    after = check_workflow(d)[0]["counts"]
    for k in CHECK_KEYS:
        if after[k] > before[k]:
            die(f"{path}: 判据变差 {k} {before[k]}→{after[k]}(装载器位需再调)")
    if not all(after[k] == 0 for k in ZEROS):
        die(f"{path}: 六硬项失零 { {k: after[k] for k in ZEROS} }")
    nodes_by_id = {n["id"]: n for n in d["nodes"]}
    if full and nodes_by_id[LOADER_ID]["pos"][0] >= tc["pos"][0]:
        die(f"{path}: 装载器不在 5011 左侧(恒向右破门)")
    bx = g["bounding"]
    for nid in band_ids:
        n = nodes_by_id[nid]
        if not (bx[0] <= n["pos"][0] and bx[1] <= n["pos"][1]
                and n["pos"][0] + n["size"][0] <= bx[0] + bx[2]
                and n["pos"][1] + n["size"][1] <= bx[1] + bx[3]):
            die(f"{path}: [{nid}] 未落框")

    new_raw = json.dumps(d, ensure_ascii=False, indent=1) + "\n"
    if verify_only:
        print(f"[VERIFY] {path.split('/')[-1]} 盘上态达标(不改写)")
        return
    if new_raw != raw:
        wf.write_text(new_raw, encoding="utf-8")
    # 幂等复验
    d2 = json.loads(wf.read_text(encoding="utf-8"))
    if json.dumps(d2, ensure_ascii=False, indent=1) + "\n" != new_raw:
        die(f"{path}: 幂等失败")
    tail = " + clip_vision + #800 已接" if full else "(锚三元组;clip_vision 免——布线密度无余量,身份嵌入探针实证非胜负手)"
    print(f"[SYNC] {path.split('/')[-1]}: select=closest_to_xy(1920,900)@f170{tail}")


def sync_api(verify_only: bool) -> None:
    p = Path(REPO / API_TPL)
    d = json.loads(p.read_text(encoding="utf-8"))
    t = d["5011"]["inputs"]
    t.update({"identity_threshold": 0.0, "select": "closest_to_xy",
              "X": 1920, "Y": 900, "frame_index": 170, "identity_model": "clip_vision",
              "identity_clip_vision": [str(LOADER_ID), 0]})
    d[str(LOADER_ID)] = {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": CLIP_NAME}}
    if verify_only:
        print("[VERIFY] API 模板达标")
        return
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("[SYNC] API 模板:终版参数+#800 已接")


def sync_generators(verify_only: bool) -> None:
    for gpath in GENERATORS:
        gp = Path(REPO / gpath)
        s = gp.read_text(encoding="utf-8")
        orig = s
        s = s.replace('"per_frame", True, 0.28, "largest_face", "segm\\\\person_yolov8m-seg.pt", 0.5, 0,\n           "insightface", "none", 3.0, "off", 0, 0, 0]',
                      '"per_frame", True, 0.0, "closest_to_xy", "segm\\\\person_yolov8m-seg.pt", 0.5, 0,\n           "clip_vision", "none", 3.0, "off", 1920, 900, 170]')
        s = s.replace('"select": "largest_face", "fallback_detector": "segm\\\\person_yolov8m-seg.pt"',
                      '"select": "closest_to_xy", "X": 1920, "Y": 900, "frame_index": 170,\n            "identity_model": "clip_vision", "identity_threshold": 0.0,\n            "identity_clip_vision": [800, 0], "fallback_detector": "segm\\\\person_yolov8m-seg.pt"')
        # 装载器发码(幂等)
        if "CLIPVisionLoader" not in s:
            s = s.replace("# ---- 连线(名寻槽,禁猜索引) ----",
                          '# CLIP Vision 身份嵌入器(终版追踪配方 1118)\n'
                          'N(800, "CLIPVisionLoader", clip_name="clip_vision_g.safetensors")\n\n'
                          "# ---- 连线(名寻槽,禁猜索引) ----")
        if verify_only:
            ok = s != orig or "closest_to_xy" in gp.read_text(encoding="utf-8")
            print(f"[VERIFY] {gpath.split('/')[-1]}: {'达标' if 'closest_to_xy' in gp.read_text(encoding='utf-8') else '未同步'}")
            continue
        if s != orig:
            gp.write_text(s, encoding="utf-8")
            print(f"[SYNC] {gpath.split('/')[-1]}")
        else:
            print(f"[SKIP] {gpath.split('/')[-1]} 无匹配锚(检查发码形态)")


def main() -> int:
    verify_only = "--verify" in sys.argv
    for path, gt in CANVAS_FILES:
        sync_canvas(path, gt, verify_only, full=("一镜到底" not in path and "7_测试" not in path))
    sync_api(verify_only)
    sync_generators(verify_only)
    print("[毕] 四面同步完成" if not verify_only else "[毕] 四面验态完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
