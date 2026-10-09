#!/usr/bin/env python3
"""9B PE 答文探针(1009):复刻 [4013] ApiPE 同款载荷直发 LM Studio,取 9B 原始稿。

用途:节点拒收(自检违例/解析失败)时,答文只留摘要进日志;本探针还原 9B 到底写了什么。
载荷构造与 my_qi21_api_pe.py 逐字同构:
  system = _build_system(系统提示词, 色卡)       ← 教材+色卡
  user   = direct(主体句\n类型句\n风格) + 上下文块  ← 四段协议/热读,按 history 真实入参复刻
用法:python3 qi21_pe9b_probe_1009.py [--max-tokens 16384]
"""
from __future__ import annotations
import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
sys.path.insert(0, str(REPO / "apps/backend/engines/comfyui/my_nodes/nodes"))
NODES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
URL = "http://192.168.0.101:1234/v1/chat/completions"
MODEL = "qwen3.5-9b-uncensored-hauhaucs-aggressive"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tokens", type=int, default=16384)
    args = ap.parse_args()

    # 与节点同源:导入 _build_system 与数据热读
    import importlib.util
    spec = importlib.util.spec_from_file_location("api_pe", NODES / "my_qi21_api_pe.py")
    pe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pe)

    bases = pe._load_bases_node()
    d = json.loads((REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json").read_text(encoding="utf-8"))
    t7 = next(t for t in d["types"] if t["zh"] == "分镜剧情图")
    subj = "山雨欲来的渡口，青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中，双手扶在行囊肩带上，第一次背起行囊离乡；老船工收篙回望，江天压满墨青雨云，渡口一盏朱红灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。"
    base_txt = t7["positive_text"]
    style = str((bases.get("art_style_base") or {}).get("positive_style_text") or "")
    sys_txt = d["expand_instruction"]["system_prompt_zh"]
    # 色卡[4031]全文=工作流 widget 现值
    wf = json.loads((REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json").read_text(encoding="utf-8"))
    sg6 = next(s for s in wf["definitions"]["subgraphs"] if any(n["id"] == 4031 for n in s["nodes"]))
    n4031 = next(n for n in sg6["nodes"] if n["id"] == 4031)
    card = n4031["widgets_values"][0]

    direct = f"主体句:{subj}\n类型句:{base_txt}\n{style}".strip()
    ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---",
           "[正稿结构] 主体句\n型底座\n美术风格底座 三层(基底即上文)",
           "[画幅] 1664×944(按此纵横比组织画面描述)",
           "[透明] 关:常规成图"]
    user = direct + "\n\n" + "\n".join(ctx)
    system = pe._build_system(sys_txt, card)

    payload = {"model": MODEL,
               "messages": [{"role": "system", "content": system},
                            {"role": "user", "content": user}],
               "temperature": 0.7, "max_tokens": args.max_tokens,
               "reasoning_effort": "none", "stream": True}
    print(f"[probe] system={len(system)}字 user={len(user)}字 → {URL} ({MODEL})")
    req = urllib.request.Request(URL, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    content, reasoning = [], []
    with urllib.request.urlopen(req, timeout=600) as raw:
        for line_b in raw:
            line = line_b.decode("utf-8", errors="replace").strip()
            if not line.startswith("data: "):
                continue
            ds = line[6:]
            if ds == "[DONE]":
                break
            try:
                chunk = json.loads(ds)
            except ValueError:
                continue
            delta = (chunk.get("choices") or [{}])[0].get("delta", {})
            if delta.get("content"):
                content.append(delta["content"])
            if delta.get("reasoning_content"):
                reasoning.append(delta["reasoning_content"])
    full, think = "".join(content), "".join(reasoning)
    out = Path("/tmp/pe9b_probe_raw.txt")
    out.write_text(f"═══ 思考链({len(think)}字,头300)═══\n{think[:300]}\n\n═══ 正文({len(full)}字)═══\n{full}\n", encoding="utf-8")
    print(f"[probe] 正文 {len(full)} 字 / 思考链 {len(think)} 字 → {out}")
    print("═══ 正文头 600 字 ═══")
    print(full[:600])
    return 0


if __name__ == "__main__":
    sys.exit(main())
