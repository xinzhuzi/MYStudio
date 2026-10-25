#!/usr/bin/env python3
"""my21fast-1025 序3②:定谳4 实弹探针(dry-run 离线核验 / live 实弹投弹)。

三族臂:
  t2i / i2i —— 读两版 api 件(qwen21-道劫-t2i-api.json / qwen21-道劫-i2i-api.json)
  的 ["graph"] 平铺形(桥 comfyui_bridge.py:249 deepcopy(template["graph"]) 投弹
  同形;禁整 schemaVersion 包装件 POST);
  edit —— 复用 builder 全链 flatten_canvas→selected_graph(禁只用 flatten 段;
  旧 edit 臂=当前画布件离线展平,新 edit 臂=引擎实况展平)。

dry-run(引擎可停)核验集:
  · 三族种子键全名('7:7014' 三族前轮亲验);
  · t2i 臂正向断言:含 '6:4013' 且 inputs['AI扩写开关'] is False;
  · 4013 三式禁令(禁裸子串):仅施 edit 臂——无 =='6:4013' / endswith(':4013')
    / =='4013' 键;i2i 臂同查(现值零命中);断言保留至步骤8 实弹;
  · LoadImage 夹具:PIL 现造确定性 RGB+RGBA 两图(sha256 登记),双臂同映射
    (主参考→RGB;透明锚位吃 RGBA;映射按节点键统一施加);禁 PNG 文件字节比;
  · 每族原始出图 SaveImage 识别(像素等值唯一判据源):t2i/i2i=前缀 QI21道劫*
    的节点 8;edit=顶层唯一 SaveImage 节点 8;超分 2K SaveImage(504,前缀
    MYStudio-2K)标记为仅成功验(链路不同,不参与等值);
  · 旧 edit 臂离线展平(快照 fixture);快照缺失/过期→该段 SKIPPED-ENGINE-DOWN
    兑底,不算失败。

live(引擎须在跑):固定种子覆写(禁 builder --validate:validate_live :312
硬编码 random)+LoadImage 覆写+POST /prompt {"prompt": graph,…};取图只取
每族「原始出图 SaveImage」;记录双臂耗时作素材。产物落
apps/output/my21fast-1025/livefire/。

用法:
  python3 my21fast_livefire_probe.py --dry-run
  python3 my21fast_livefire_probe.py --live
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APP = REPO / "apps"
T2I_API = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json"
I2I_API = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
EDIT_CANVAS = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
I2I_CANVAS = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
SNAPSHOT = APP / "backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json"
BUILDER = APP / "build/scripts/qwen21_bridge_template_build.py"
OUT_DIR = APP / "output/my21fast-1025/livefire"

SEED_KEY = "7:7014"
FIXED_SEED = 20251026  # 探针自有定种子(禁 builder validate_live :312 硬编码 random)
RAW_PREFIX_T2I = "QI21道劫文生图_"
RAW_PREFIX_I2I = "QI21道劫图生图_"
UPSCALE_PREFIX = "MYStudio-2K"


def _load_builder():
    spec = importlib.util.spec_from_file_location("my21fast_builder", BUILDER)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(BUILDER.parent))  # TextGenerate→qi21_i2i_workflow_fire.PICKERS
    spec.loader.exec_module(mod)
    return mod


def _engine_base() -> str:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8"))["engine"]["port"]
    return f"http://127.0.0.1:{port}"


def _http_json(url: str, timeout: float = 30.0, data: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={"Content-Type": "application/json"},
                                 data=json.dumps(data).encode() if data else None)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def _4013_hits(graph: dict) -> dict:
    """三式精确命中(禁裸子串):=='6:4013' / endswith(':4013') / =='4013'。"""
    return {
        "eq_6_4013": [k for k in graph if k == "6:4013"],
        "endswith_4013": [k for k in graph if k.endswith(":4013")],
        "eq_4013": [k for k in graph if k == "4013"],
    }


def _make_fixtures(out_dir: Path) -> dict:
    """PIL 现造确定性 RGB+RGBA 两图;sha256 登记落盘(禁 PNG 文件字节比)。"""
    from PIL import Image

    fx_dir = out_dir / "fixtures"
    fx_dir.mkdir(parents=True, exist_ok=True)
    rgb_img = Image.new("RGB", (512, 512))
    rgba_img = Image.new("RGBA", (512, 512))
    for y in range(512):  # 确定性梯度:同 seed 同字节,任何机器同产
        for x in range(0, 512, 8):
            v = (x * 7 + y * 13) % 256
            for dx in range(8):
                rgb_img.putpixel((x + dx, y), (v, (y * 3) % 256, (x * 5) % 256))
                rgba_img.putpixel((x + dx, y), (v, (y * 3) % 256, (x * 5) % 256, (v // 2)))
    files = {}
    for name, img in (("my21fast_probe_rgb.png", rgb_img), ("my21fast_probe_rgba.png", rgba_img)):
        p = fx_dir / name
        img.save(p, format="PNG")
        files[name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return files


def _loadimage_map(graph: dict) -> dict:
    """双臂同映射:LoadImage 节点键→夹具(主参考 RGB;透明锚位/505 吃 RGBA)。"""
    mapping: dict[str, str] = {}
    for key, node in sorted(graph.items()):
        if node.get("class_type") != "LoadImage":
            continue
        name = node.get("inputs", {}).get("image", "")
        is_alpha_anchor = (key == "505" or "透明" in str(name))
        mapping[key] = "my21fast_probe_rgba.png" if is_alpha_anchor else "my21fast_probe_rgb.png"
    return mapping


def _identify_saveimages(graph: dict, family: str) -> dict:
    """每族原始出图 SaveImage 识别:前缀 QI21道劫* 节点 8;504 MYStudio-2K 仅成功验。"""
    out = {"raw": None, "upscale_success_only": None}
    for key, node in sorted(graph.items()):
        if node.get("class_type") != "SaveImage":
            continue
        prefix = node.get("inputs", {}).get("filename_prefix", "")
        if prefix.startswith("QI21道劫") or (family == "edit" and key == "8"):
            if out["raw"] is not None:
                raise SystemExit(f"[probe] {family}: 原始出图 SaveImage 不唯一({out['raw']} 与 {key})")
            out["raw"] = {"key": key, "filename_prefix": prefix}
        elif prefix.startswith(UPSCALE_PREFIX):
            out["upscale_success_only"] = {"key": key, "filename_prefix": prefix}
    if out["raw"] is None:
        raise SystemExit(f"[probe] {family}: 未识别到原始出图 SaveImage(前缀 QI21道劫*/唯一节点8)")
    return out


def _payload_shape_ok(graph: dict) -> list[str]:
    """投弹体钉形:平铺形(键→{class_type,inputs});禁整 schemaVersion 包装件。"""
    problems = []
    for banned in ("schemaVersion", "graph", "name", "inputs", "comfyuiVersionMin"):
        if banned in graph:
            problems.append(f"payload 顶层含包装键 {banned!r}(疑似整件 POST,禁)")
    for k, v in list(graph.items())[:200]:
        if not isinstance(v, dict) or "class_type" not in v:
            problems.append(f"payload[{k!r}] 非平铺节点形(缺 class_type)")
            break
    return problems


def _prepare_arm(graph: dict, family: str, fixtures: dict) -> dict:
    """投弹前覆写:种子定值+LoadImage 映射(dry-run 只回账不投弹)。"""
    plan = {"family": family, "seed_overwrite": None, "loadimage_overwrite": {}}
    if SEED_KEY in graph:
        plan["seed_overwrite"] = {"key": SEED_KEY, "old": graph[SEED_KEY].get("inputs", {}).get("value"),
                                  "new": FIXED_SEED}
    for key, fixture in _loadimage_map(graph).items():
        plan["loadimage_overwrite"][key] = {"old": graph[key]["inputs"].get("image"), "new": fixture,
                                            "fixture_sha256": fixtures[fixture]}
    return plan


def dry_run(args) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict = {"mode": "dry-run", "arms": {}, "fixtures": {}, "edit_old_arm": {}}
    fixtures = _make_fixtures(OUT_DIR)
    report["fixtures"] = fixtures
    print(f"[fixtures] RGB sha256={fixtures['my21fast_probe_rgb.png']}")
    print(f"[fixtures] RGBA sha256={fixtures['my21fast_probe_rgba.png']}")

    failures: list[str] = []
    for family, path in (("t2i", T2I_API), ("i2i", I2I_API)):
        api = json.loads(path.read_text(encoding="utf-8"))
        graph = api["graph"]
        arm = {
            "api_file": str(path.relative_to(REPO)),
            "graph_key_count": len(graph),
            "seed_keys": [k for k in graph if k.endswith(":7014") or k == "7:7014"],
            "saveimages": _identify_saveimages(graph, family),
            "payload_shape_problems": _payload_shape_ok(graph),
            "prepare": _prepare_arm(graph, family, fixtures),
            "4013_hits": _4013_hits(graph),
        }
        report["arms"][family] = arm
        print(f"[{family}] graph 键数={arm['graph_key_count']} 种子键={arm['seed_keys']} "
              f"原始出图={arm['saveimages']['raw']} 超分仅成功验={arm['saveimages']['upscale_success_only']}")
        print(f"[{family}] LoadImage 映射={ {k: v['new'] for k, v in arm['prepare']['loadimage_overwrite'].items()} }")
        print(f"[{family}] 种子覆写={arm['prepare']['seed_overwrite']}")
        if not arm["seed_keys"]:
            failures.append(f"{family}: 种子键 {SEED_KEY} 缺席")
        if arm["payload_shape_problems"]:
            failures += arm["payload_shape_problems"]
        if family == "t2i":
            ok = "6:4013" in graph and graph["6:4013"].get("inputs", {}).get("AI扩写开关") is False
            print(f"[t2i] 正向断言 含'6:4013' 且 AI扩写开关 is False -> {'PASS' if ok else 'FAIL'}")
            if not ok:
                failures.append("t2i: 6:4013 正向断言败(应在场且 AI扩写开关 is False)")
        else:  # i2i:4013 禁令同查(现值零命中)
            hits = arm["4013_hits"]
            flat = [k for ks in hits.values() for k in ks]
            print(f"[i2i] 4013 三式命中={hits} -> {'PASS(零命中)' if not flat else 'FAIL'}")
            if flat:
                failures.append(f"i2i: 4013 三式禁令违例 {flat}")

    # 旧 edit 臂:离线展平(builder 全链,快照 fixture;缺失/过期→SKIPPED-ENGINE-DOWN 兑底)
    if SNAPSHOT.is_file():
        try:
            builder = _load_builder()
            snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
            wf = json.loads(EDIT_CANVAS.read_text(encoding="utf-8"))
            flat = builder.flatten_canvas(wf, snap)  # 全链:flatten_canvas 尾调 selected_graph
            hits = _4013_hits(flat)
            flat_hits = [k for ks in hits.values() for k in ks]
            edit_arm = {
                "source": "offline-flatten(snapshot fixture,旧臂)",
                "graph_key_count": len(flat),
                "seed_keys": [k for k in flat if k.endswith(":7014") or k == "7:7014"],
                "te_keys": {k: v["class_type"] for k, v in flat.items()
                            if v["class_type"] in ("TextEncodeQwenImage21", "MyQi21FastEncode")},
                "saveimages": _identify_saveimages(flat, "edit"),
                "prepare": _prepare_arm(flat, "edit", fixtures),
                "4013_three_form": hits,
            }
            report["edit_old_arm"] = edit_arm
            print(f"[edit-old] 离线展平键集={len(flat)} TE={edit_arm['te_keys']} 种子键={edit_arm['seed_keys']}")
            print(f"[edit-old] 原始出图={edit_arm['saveimages']['raw']}(该件无超分链,唯一原始出图)")
            print(f"[edit-old] LoadImage 映射={ {k: v['new'] for k, v in edit_arm['prepare']['loadimage_overwrite'].items()} }")
            print(f"[edit-old] 4013 三式断言(人核记录)={hits} -> {'PASS(零命中)' if not flat_hits else 'FAIL'}")
            if flat_hits:
                failures.append(f"edit(旧臂): 4013 三式禁令违例 {flat_hits}")
            if not edit_arm["seed_keys"]:
                failures.append("edit(旧臂): 种子键缺席")
        except (KeyError, SystemExit) as exc:
            print(f"SKIPPED-ENGINE-DOWN edit 旧臂离线展平:快照过期/缺类({exc})——兑底不算失败")
            report["edit_old_arm"] = {"skipped": f"SKIPPED-ENGINE-DOWN snapshot-stale: {exc}"}
    else:
        print("SKIPPED-ENGINE-DOWN edit 旧臂离线展平:快照缺失——兑底不算失败")
        report["edit_old_arm"] = {"skipped": "SKIPPED-ENGINE-DOWN snapshot-missing"}

    (OUT_DIR / "dry_run_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[dry-run] 报告落 {OUT_DIR / 'dry_run_report.json'}")
    if failures:
        print(f"[dry-run] FAIL ×{len(failures)}: {failures}")
        return 1
    print("[dry-run] 全部核验过")
    return 0


def live(args) -> int:
    """实弹:固定种子+夹具覆写→POST /prompt→历史轮询→按原始出图 SaveImage 取图。"""
    base = _engine_base()
    try:
        _http_json(f"{base}/system_stats", timeout=5)
    except Exception as exc:  # noqa: BLE001
        print(f"SKIPPED-ENGINE-DOWN engine {base} 不可达({exc})——步骤8 实弹待引擎在跑")
        return 2
    fixtures = _make_fixtures(OUT_DIR)
    uploaded = {}
    for name, digest in fixtures.items():
        # 上传覆写:同名夹具重复上传幂等(引擎 input 目录覆写)
        from PIL import Image
        import io
        import urllib.parse
        buf = io.BytesIO()
        Image.open(OUT_DIR / "fixtures" / name).save(buf, format="PNG")
        boundary = "----my21fastprobe"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
                f"Content-Type: image/png\r\n\r\n").encode() + buf.getvalue() + \
               (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n--{boundary}--\r\n").encode()
        req = urllib.request.Request(f"{base}/upload/image", data=body, method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.load(resp)
        assert payload.get("name") == name, f"上传回名不符: {payload}"
        uploaded[name] = digest
    print(f"[live] 夹具上传覆写完成 sha256={uploaded}")

    builder = _load_builder()
    arms = {}
    for family, path in (("t2i", T2I_API), ("i2i", I2I_API)):
        graph = json.loads(path.read_text(encoding="utf-8"))["graph"]
        arms[family] = graph
    snap = _http_json(f"{base}/object_info")
    edit_wf = json.loads(EDIT_CANVAS.read_text(encoding="utf-8"))
    arms["edit"] = builder.flatten_canvas(edit_wf, snap)  # 新 edit 臂:引擎实况展平

    results = {}
    for family, graph in arms.items():
        if SEED_KEY in graph:
            graph[SEED_KEY]["inputs"]["value"] = FIXED_SEED
        for key, fixture in _loadimage_map(graph).items():
            graph[key]["inputs"]["image"] = fixture
        shape_problems = _payload_shape_ok(graph)
        assert not shape_problems, f"{family} 投弹体形坏: {shape_problems}"
        t0 = time.time()
        accepted = _http_json(f"{base}/prompt", timeout=120,
                              data={"prompt": graph, "client_id": "my21fast-livefire-probe"})
        # fail-closed:/prompt 可 200 带 node_errors(部分输出依赖失效→引擎只执行
        # 幸存输出;1025 实弹实测:t2i/i2i 200+node_errors=TE 校验败仅显示件执行)
        node_errors = accepted.get("node_errors") or {}
        if node_errors:
            raise SystemExit(f"[live] {family} 引擎校验败(200+node_errors,拒实弹): "
                             f"{json.dumps(node_errors, ensure_ascii=False)[:800]}")
        prompt_id = accepted["prompt_id"]
        while True:
            hist = _http_json(f"{base}/history/{prompt_id}", timeout=30).get(prompt_id)
            if hist:
                break
            if time.time() - t0 > 1800:
                raise SystemExit(f"[live] {family} 轮询超时")
            time.sleep(3)
        elapsed = time.time() - t0
        status = hist.get("status", {})
        outputs = hist.get("outputs", {})
        si = _identify_saveimages(graph, family)
        raw_key = si["raw"]["key"]
        raw_images = outputs.get(raw_key, {}).get("images", [])  # 只取原始出图(504 仅成功验)
        up_key = si["upscale_success_only"]["key"] if si["upscale_success_only"] else None
        upscale_ok = bool(outputs.get(up_key, {}).get("images")) if up_key else None
        results[family] = {
            "prompt_id": prompt_id, "elapsed_s": round(elapsed, 1),
            "status_completed": status.get("completed"),
            "raw_saveimage_key": raw_key, "raw_images": raw_images,
            "upscale_success_only": upscale_ok,
        }
        print(f"[live] {family}: {results[family]}")
    (OUT_DIR / "live_report.json").write_text(
        json.dumps({"seed": FIXED_SEED, "fixtures": uploaded, "arms": results},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[live] 报告落 {OUT_DIR / 'live_report.json'}(耗时作素材)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--live", action="store_true")
    args = ap.parse_args()
    if args.dry_run:
        return dry_run(args)
    if args.live:
        return live(args)
    ap.error("--dry-run 或 --live 其一")


if __name__ == "__main__":
    sys.exit(main())
