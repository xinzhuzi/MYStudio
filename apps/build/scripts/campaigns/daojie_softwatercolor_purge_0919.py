#!/usr/bin/env python3
"""柔水彩彻底清除(09-19 用户令「文件已删,不要再有」)。

三件事,全幂等:
  ① 删引擎家物理文件 models/loras/Krea2-画风/Krea2-柔水彩softwatercolor.safetensors
     (用户在 App 内删过但磁盘仍在,此处补刀;dev 家本就无此件);
  ② 道劫工作流摘除 [68] 节点:LoraLoaderModelOnly 旁路件,挂链
     [19]—link50→[68]—link51→[69],摘除=新 link([19]out0→[69]in0,id=last_link_id+1)
     替换 50/51 两线并删节点;bypass 链其余件([69]→[77]→…)零扰动;
  ③ 速查卡 [66] 画风件行删去 [68] 段(保留 [69]/[77]),消灭「引用不存在节点」
     (同类失真是 09-19 卡片修复轮的反面教材:[70] 幽灵引用)。

回写格式=ensure_ascii=False + indent=2 + 无尾换行(与库内其余脚本约定一致)。
改前 re-diff 已做(mtime 18:21 后无人动);改后跑 workflow_graph_lint+契约。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
LORA = (Path.home() / "Library/Application Support/漫影工作室/comfyui/models/loras"
        / "Krea2-画风" / "Krea2-柔水彩softwatercolor.safetensors")

CARD_OLD_SEG = ("[68]装饰水彩softwatercolor(实为 Art Deco 水彩,非柔和淡彩;"
                "触发词:art deco watercolor style)/")
NODE_ID = 68


def purge_file() -> None:
    if LORA.exists():
        LORA.unlink()
        print(f"[purge] 物理文件已删: {LORA}")
    else:
        print("[purge] 物理文件本就不在(用户已删净或另一家)")


def purge_workflow() -> None:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    if NODE_ID not in nodes:
        print("[purge] [68] 已不在图内,工作流幂等跳过")
        return
    n68 = nodes[NODE_ID]
    links = {l[0]: l for l in wf["links"]}
    in_link = next((i.get("link") for i in n68.get("inputs", []) if i.get("link")), None)
    out_links = [lid for o in n68.get("outputs", []) for lid in (o.get("links") or [])]
    assert in_link in links and len(out_links) == 1 and out_links[0] in links, \
        f"[68] 接线形态与预期不符: in={in_link} out={out_links}"
    src = links[in_link]                      # [19] out0 → [68]
    dst = links[out_links[0]]                 # [68] out0 → [69]
    new_id = wf["last_link_id"] + 1
    # 新线:src 节点同槽 → dst 节点同槽(类型随 src 线)
    wf["links"] = [l for l in wf["links"] if l[0] not in (in_link, out_links[0])]
    wf["links"].append([new_id, src[1], src[2], dst[3], dst[4], src[5]])
    # 侧登记:src.outputs 同槽 links 换新 id;dst.inputs 该槽 link 换新 id
    for o in nodes[src[1]].get("outputs", []):
        if in_link in (o.get("links") or []):
            o["links"] = [new_id if x == in_link else x for x in o["links"]]
    for i in nodes[dst[3]].get("inputs", []):
        if i.get("link") == out_links[0]:
            i["link"] = new_id
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] != NODE_ID]
    wf["last_link_id"] = new_id

    # 速查卡 [66]:删 [68] 段
    n66 = next((n for n in wf["nodes"] if n.get("id") == 66), None)
    if n66 and n66.get("widgets_values"):
        txt = n66["widgets_values"][0]
        if CARD_OLD_SEG in txt:
            n66["widgets_values"][0] = txt.replace(CARD_OLD_SEG, "")
            print("[purge] [66] 卡 [68] 段已删")
        elif "[68]" in txt:
            print("[purge] ⚠️ [66] 卡仍有 [68] 字样但段文本不匹配,须人工看")
        else:
            print("[purge] [66] 卡已无 [68]")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[purge] [68] 已摘除;新线 id={new_id} "
          f"[{src[1]}]out{src[2]}→[{dst[3]}]in{dst[4]};links 50/51 移除")


def main() -> int:
    purge_file()
    purge_workflow()
    r = subprocess.run([sys.executable, str(REPO / "apps/build/scripts/workflow_graph_lint.py"),
                        str(WF)], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
