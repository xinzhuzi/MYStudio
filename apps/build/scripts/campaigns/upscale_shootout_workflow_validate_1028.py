#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
upscale_shootout_workflow_validate_1028.py — 横评工作流结构校验器(只读校验,不发车不动引擎)

对 apps/output/fasth3-upscale-shootout-1028/ 下全部 workflow-api-*.json 逐件执行:
  ① JSON 可解析且为 API 格式(节点 id → {class_type, inputs})
  ② 节点类名合法(对照 node-registry-1028.json,含出处)
  ③ 连线完整(每个 [id, slot] 引用的节点存在且 slot < 该类输出数)
  ④ 吃视频文件的输入通道明确(恰 1 个 LoadVideo/VHS_LoadVideo,文件名=统一输入)
  ⑤ 必填输入齐(注册表 inputs + 激活档动态参数;VHS extra_widgets 白名单)
  ⑥ 输出节点在位(SaveVideo 或 VHS_VideoCombine save_output=true)
  ⑦ 输出分辨率符合横评口径(从工作流自身参数推算 == 主档1216x704/附档2432x1408;latent 链按±32 ADJUSTED 规则标注)
结果落 apps/output/fasth3-upscale-shootout-1028/_workflows/structural-checks-1028.json;任何 FAIL→exit 1。
用法:python3 apps/build/scripts/upscale_shootout_workflow_validate_1028.py
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
CAMP = os.path.join(REPO, "apps", "output", "fasth3-upscale-shootout-1028")
INPUT_VIDEO = "t2v-480p_00001_.mp4"
SRC_W, SRC_H = 608, 352
W2X, H2X, W4X, H4X = 1216, 704, 2432, 1408

reg_doc = json.load(open(os.path.join(CAMP, "_workflows", "node-registry-1028.json"), encoding="utf-8"))
REG = reg_doc["registry"]
man = json.load(open(os.path.join(CAMP, "_workflows", "workflows-manifest-1028.json"), encoding="utf-8"))


def check_file(spec):
    path = os.path.join(REPO, spec["file"])
    res = {"file": spec["file"], "run": spec["run"], "tier": spec["tier"],
           "target_wh": spec["target_wh"], "checks": {}, "fail": [], "warn": []}

    # ① JSON 可解析 + API 结构
    try:
        wf = json.load(open(path, encoding="utf-8"))
        assert isinstance(wf, dict) and all(isinstance(v, dict) for v in wf.values())
        ok_struct = all(("class_type" in v and "inputs" in v) for v in wf.values())
        if not ok_struct:
            res["fail"].append("① 节点缺 class_type/inputs(非 API 格式)")
        res["checks"]["①json-parse-api-format"] = "PASS"
    except Exception as e:
        res["fail"].append(f"① JSON 解析失败: {e}")
        res["checks"]["①json-parse-api-format"] = "FAIL"
        return res
    res["node_count"] = len(wf)

    # ② 类名合法
    unknown = [v["class_type"] for v in wf.values() if v["class_type"] not in REG]
    res["checks"]["②class-legality"] = "PASS" if not unknown else f"FAIL: {unknown}"
    if unknown:
        res["fail"].append(f"② 未知类名 {unknown}")

    # ③ 连线完整
    link_errors = []
    for nid, v in wf.items():
        for k, val in v["inputs"].items():
            if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str) and isinstance(val[1], int):
                tgt, slot = val
                if tgt not in wf:
                    link_errors.append(f"节点{nid}.{k} → 不存在节点 {tgt}")
                else:
                    tcls = wf[tgt]["class_type"]
                    if tcls in REG and slot >= len(REG[tcls]["out"]):
                        link_errors.append(f"节点{nid}.{k} → {tgt}({tcls}) slot {slot} 越界(输出数 {len(REG[tcls]['out'])})")
    res["checks"]["③link-integrity"] = "PASS" if not link_errors else f"FAIL: {link_errors}"
    if link_errors:
        res["fail"].append(f"③ {link_errors}")

    # ④ 视频输入通道
    vin = [(nid, v) for nid, v in wf.items() if v["class_type"] in ("LoadVideo", "VHS_LoadVideo")]
    if len(vin) != 1:
        res["fail"].append(f"④ 视频输入节点数={len(vin)}(应为 1)")
        res["checks"]["④video-input-channel"] = "FAIL"
    else:
        nid, v = vin[0]
        fn = v["inputs"].get("file") or v["inputs"].get("video")
        if fn != INPUT_VIDEO:
            res["fail"].append(f"④ 输入文件名={fn} != {INPUT_VIDEO}")
            res["checks"]["④video-input-channel"] = "FAIL"
        else:
            res["checks"]["④video-input-channel"] = f"PASS({v['class_type']} file={fn})"

    # ⑤⑥ 必填输入齐 + 输出节点
    missing, warn_unknown = [], []
    for nid, v in wf.items():
        cls = v["class_type"]
        if cls not in REG:
            continue
        r = REG[cls]
        allowed = list(r["inputs"]) + list(r.get("optional", [])) + list(r.get("extra_widgets", []))
        dyn = r.get("dynamic", {})
        for key_field, options in dyn.items():
            chosen = v["inputs"].get(key_field)
            allowed += options.get(chosen, []) if chosen is not None else []
        for k in v["inputs"]:
            if k not in allowed:
                warn_unknown.append(f"节点{nid}({cls}) 非注册表输入键 [{k}]")
        for k in r["inputs"]:
            if k not in v["inputs"]:
                missing.append(f"节点{nid}({cls}) 缺必填 [{k}]")
    res["checks"]["⑤required-inputs"] = "PASS" if not missing else f"FAIL: {missing}"
    if missing:
        res["fail"].append(f"⑤ {missing}")
    if warn_unknown:
        res["warn"].extend(warn_unknown)
    out_nodes = [(nid, v) for nid, v in wf.items() if v["class_type"] in ("SaveVideo", "VHS_VideoCombine")]
    out_ok = any(
        (v["class_type"] == "SaveVideo") or (v["inputs"].get("save_output") is True) for _, v in out_nodes)
    res["checks"]["⑥output-node"] = "PASS" if out_ok else "FAIL"
    if not out_ok:
        res["fail"].append("⑥ 无有效输出节点")

    # ⑦ 目标分辨率推算(从工作流自身参数)
    up_nodes = [v for v in wf.values() if v["class_type"] == "SeedVR2VideoUpscaler"]
    calc = None
    rule = "exact"
    if up_nodes:
        r = up_nodes[0]["inputs"]["resolution"]  # 短边口径
        s = r / SRC_H
        calc = [round(SRC_W * s), r]
    elif any(v["class_type"] == "ImageUpscaleWithModel" for v in wf.values()):
        calc = [SRC_W * 4, SRC_H * 4]; rule = "exact(esrgan 架构固定 4x)"
    elif any(v["class_type"] == "FlashVSRNodeAdv" for v in wf.values()):
        s = [v for v in wf.values() if v["class_type"] == "FlashVSRNodeAdv"][0]["inputs"]["scale"]
        calc = [SRC_W * s, SRC_H * s]; rule = "exact(tiled_dit 画布=scale 全幅)"
    elif any(v["class_type"] == "VOSR2Upscale" for v in wf.values()):
        u = [v for v in wf.values() if v["class_type"] == "VOSR2Upscale"][0]["inputs"]["upscale"]
        calc = [SRC_W * u, SRC_H * u]
    elif any(v["class_type"] == "RTXVideoSuperResolution" for v in wf.values()):
        n = [v for v in wf.values() if v["class_type"] == "RTXVideoSuperResolution"][0]
        s = n["inputs"]["scale"]
        calc = [round(SRC_W * s / 8) * 8, round(SRC_H * s / 8) * 8]; rule = "exact(SDK 8 对齐,1216/704/2432/1408 均 8 整除)"
    elif any(v["class_type"] == "MinimaxH3LatentUpscaler3D" for v in wf.values()):
        n = [v for v in wf.values() if v["class_type"] == "MinimaxH3LatentUpscaler3D"][0]
        calc = [n["inputs"]["width"], n["inputs"]["height"]]; rule = "exact(align32+VAE/16 双向精确;判据②按 latent 链 ADJUSTED 容差执行)"
    elif any(v["class_type"] == "LTXVLatentUpsampler" for v in wf.values()):
        calc = [SRC_W * 2, SRC_H * 2]; rule = "latent-x2(判据② ±32px 内=PASS(ADJUSTED),计划 §三.2)"
    tgt = spec["target_wh"]
    if calc is None:
        res["fail"].append("⑦ 未能从工作流参数推算输出分辨率")
        res["checks"]["⑦output-resolution"] = "FAIL"
    elif calc == tgt:
        res["checks"]["⑦output-resolution"] = f"PASS(calc={calc[0]}x{calc[1]} rule={rule})"
    else:
        res["fail"].append(f"⑦ 推算 {calc} != 档位目标 {tgt}")
        res["checks"]["⑦output-resolution"] = f"FAIL(calc={calc})"

    # 附:raw 是否带音轨(重混提示)
    res["raw_has_audio"] = any(
        isinstance(val, list) and wf.get(val[0], {}).get("class_type") == "GetVideoComponents" and key == "audio" and val[1] == 1
        for v in wf.values() for key, val in v.get("inputs", {}).items()) or any(
        v["class_type"] == "VHS_VideoCombine" and "audio" in v["inputs"] for v in wf.values())
    res["status"] = "PASS" if not res["fail"] else "FAIL"
    return res


def main():
    results = [check_file(s) for s in man["specs"]]
    out = {"input_video": INPUT_VIDEO, "input_wh": [SRC_W, SRC_H],
           "tier_canonical": {"2x": [W2X, H2X], "4x": [W4X, H4X]},
           "files": results}
    fails = [r for r in results if r["status"] == "FAIL"]
    out["summary"] = {"total": len(results), "pass": len(results) - len(fails), "fail": len(fails)}
    p = os.path.join(CAMP, "_workflows", "structural-checks-1028.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    for r in results:
        print(f"[{r['status']}] {r['run']}/{os.path.basename(r['file'])} nodes={r.get('node_count')} "
              f"target={r['target_wh'][0]}x{r['target_wh'][1]} raw_audio={r.get('raw_has_audio')}")
        for c, v in r["checks"].items():
            print(f"    {c}: {v}")
        for w in r["warn"]:
            print(f"    WARN: {w}")
    print(f"\n[validate] {out['summary']}  -> {os.path.relpath(p, REPO)}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
