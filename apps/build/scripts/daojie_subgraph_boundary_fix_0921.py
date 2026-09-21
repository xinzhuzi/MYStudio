#!/usr/bin/env python3
"""道劫子图边界线根修(09-21)。

前端 1.53 子图边界(入口-10/出口-20)连线要在图引擎里登记,登记依据=
definitions.subgraphs[].inputs[].linkIds / outputs[].linkIds(装载时读取)。
生成器 v12 只写了 sg.links(origin_id=-10),linkIds 恒空 → 边界线在引擎
不注册 → 三症状同根:①入口圆点无线(渲染跳过) ②graphToPrompt 拿不到
子图输出 → [12].inputs.model 缺失 → 「KSampler - model 缺少连接」报错
③行首 loader 的 model 口看似有 link 数据但执行链断。

本脚本幂等:按 sg.links 实测回填 linkIds;顺带把入口/出口锚挪到行的
近旁(短线可见)。只动子图 IO 四槽与两个锚节点,不动任何行内布局。
"""
from __future__ import annotations
import json, sys
from pathlib import Path

WF = Path("apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json")
SG_ID = "5e476247-329e-4c57-8550-86c288ed4bb3"
ROUTE_ID = 1
ROWS_Y0, ROW_GAP = 40, 190          # v12 行锚(Route 顶=40)
IN_X, OUT_X = -360, 3130            # 边界锚新坐标(行区近旁)

def main() -> int:
    wf = json.loads(WF.read_text())
    sg = next(s for s in wf["definitions"]["subgraphs"] if s.get("id") == SG_ID)
    links = sg.get("links", [])
    obj = lambda l: l if isinstance(l, dict) else {"id": l[0], "origin_id": l[1], "origin_slot": l[2],
                                                   "target_id": l[3], "target_slot": l[4], "type": l[5]}
    ins_model, ins_base = [], []
    out_model, out_applied = [], []
    for raw in links:
        l = obj(raw)
        if l["origin_id"] == -10:
            (ins_model if l["origin_slot"] == 0 else ins_base).append(l["id"])
        if l["target_id"] == -20:
            (out_model if l["target_slot"] == 0 else out_applied).append(l["id"])
    assert len(ins_model) == 9 and len(ins_base) == 1, f"入口线数异常: model={len(ins_model)} base={len(ins_base)}"
    assert len(out_model) == 1 and len(out_applied) == 1, f"出口线数异常: {len(out_model)}/{len(out_applied)}"
    for slot, ids in ((sg["inputs"][0], ins_model), (sg["inputs"][1], ins_base),
                      (sg["outputs"][0], out_model), (sg["outputs"][1], out_applied)):
        slot["linkIds"] = sorted(ids)
    # 锚与槽坐标:入口贴第1行左,出口贴路由右(短线可见)
    sg["inputNode"]["bounding"] = [IN_X, ROWS_Y0 - 10, 128, 88]
    sg["outputNode"]["bounding"] = [OUT_X, ROWS_Y0 - 10, 128, 88]
    sg["inputs"][0]["pos"] = [IN_X + 128, ROWS_Y0 + 18]
    sg["inputs"][1]["pos"] = [IN_X + 128, ROWS_Y0 + 38]
    sg["outputs"][0]["pos"] = [OUT_X, ROWS_Y0 + 18]
    sg["outputs"][1]["pos"] = [OUT_X, ROWS_Y0 + 38]
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2))
    print(f"[boundary-fix] linkIds 回填: model←{len(ins_model)} base←{len(ins_base)} "
          f"model→{len(out_model)} applied→{len(out_applied)}; 锚=入({IN_X},{ROWS_Y0-10}) 出({OUT_X},{ROWS_Y0-10})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
