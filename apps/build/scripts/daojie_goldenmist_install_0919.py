#!/usr/bin/env python3
"""道劫金雾仙侠装机 0919(LoRA 治理 R1:金雾入流,新增不替换)。

编号与链位说明(与任务书差异,如实记录):
- 任务书/PRD R1 写「新增节点 [85],链位 [84]→[85]→[12]」,依据是 09-19 21:00
  审计(当时 85 空闲、链尾 84→12)。21:08 提交 a8ca8f7(九型套件并行会话)已把
  MyDaojieLoras 装进 [85]([86]=按型生效清单展示),现链 = 84→[85]MyDaojieLoras→12。
  「不删不改任何既有节点」是硬约束 → 金雾节点顺延下一空闲 id=87,插在 [84] 之后、
  MyDaojieLoras 之前:链变 84→[87]→85→12。水墨四件 82/83/84/87 同排同组,与既有
  三件对拍条件一致;MyDaojieLoras 保持采样前末位(「勿手改」设计不被扰动)。
- 金雾已在九型单源 daojie_loras.json 场景系(@0.6)被 MyDaojieLoras 引用;本节点
  是图上显式旁路件,服务 R2 五锚对拍,两机制并存互不干扰。

链路(重接两条 link):新增 84→87 新线;原 84→85 桥线(link id 保留)改源为
87→85;[12] 的 model 入线(来自 [85])不动。
前置:金雾已由用户下载在引擎家(09-19 20:34,448M)——本脚本不下载,只做在盘
校验(≥150MB + safetensors 头 sane);mode=4 旁路 ×1.0 = 旁路态出图零变化。
美化:LoRA 链 14 件按链序横排 y=80(等距 490,先例=tancai 脚本),分组②扩界。
幂等:[87] 已在场且件名一致则跳过图改造;重跑产出字节级相同。
回写:ensure_ascii=False/indent=2/无尾换行,与文件现行格式字节级兼容。
"""
from __future__ import annotations

import copy
import json
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
ENGINE_LORA = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
               "/models/loras/Krea2-画风/金雾仙侠GoldenMisty.safetensors")

NEW_ID = 87                      # 85/86 已被 a8ca8f7 占用(MyDaojieLoras/生效清单)
PREV_ID = 84                     # 链位:[84] 之后
REL = "Krea2-画风/金雾仙侠GoldenMisty.safetensors"
TITLE = f"[{NEW_ID}] 画风·金雾仙侠 ×1.0(默认旁路)"
MIN_BYTES = 150 * 1024 * 1024


def check_lora_on_disk() -> None:
    size = ENGINE_LORA.stat().st_size if ENGINE_LORA.exists() else 0
    if size < MIN_BYTES:
        raise RuntimeError(f"金雾未在盘或过小: {ENGINE_LORA} size={size}")
    with open(ENGINE_LORA, "rb") as f:
        head = f.read(8)
    header_len = struct.unpack("<Q", head)[0]
    if not 0 < header_len < 10 * 1024 * 1024:
        raise RuntimeError(f"金雾 safetensors 头异常: size={size} header={header_len}")
    print(f"DISK {ENGINE_LORA.name} {size} bytes(≥150MB,头 sane)")


def model_chain(d: dict) -> list[int]:
    """从 [21] 沿 MODEL 链走到 [12]。MyDaojieLoras 非 LoraLoader/KSampler,
    走到它即视作链尾透传(与 tancai 先例同一走法;美化只排 LoRA 行,不动 [85])。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    links = d["links"]
    chain, cur = [21], 21
    while True:
        nxt = None
        for l in links:
            if l[1] == cur and nodes.get(l[3], {}).get("type") in (
                    "LoraLoaderModelOnly", "KSampler"):
                nxt = l[3]
                break
        if nxt is None or nxt == 12:
            chain.append(12)
            return chain
        if nxt in chain:
            raise RuntimeError(f"模型链成环: {chain + [nxt]}")
        chain.append(nxt)
        cur = nxt


def mutate_graph(d: dict) -> int:
    """插入 [87] 到 84→(后继) 之间;返回后继节点 id(现态=85 MyDaojieLoras)。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    existing = nodes.get(NEW_ID)
    if existing is not None and existing.get("type") == "LoraLoaderModelOnly" \
            and (existing.get("widgets_values") or [None])[0] == REL:
        print("GRAPH [87] 已在场且件名一致,跳过图改造(幂等)")
        out = next(l for l in d["links"] if l[1] == NEW_ID and l[5] == "MODEL")
        return out[3]
    # 断点续装:摘除半成品 [87] 与其线,重建 84→87→(后继)
    d["nodes"] = [n for n in d["nodes"] if n["id"] != NEW_ID]
    d["links"] = [l for l in d["links"] if l[1] != NEW_ID and l[3] != NEW_ID]
    nodes = {n["id"]: n for n in d["nodes"]}
    outs = [l for l in d["links"] if l[1] == PREV_ID and l[5] == "MODEL"]
    if len(outs) != 1:
        raise RuntimeError(f"[{PREV_ID}] MODEL 出线数异常: {outs}")
    bridge, succ = outs[0], outs[0][3]
    base = max([l[0] for l in d["links"]] + [int(d.get("last_link_id", 0))]) + 1
    new = copy.deepcopy(nodes[PREV_ID])          # 以 [84] 为模板(tancai 形制)
    new["id"] = NEW_ID
    new["title"] = TITLE
    new["mode"] = 4
    new["widgets_values"] = [REL, 1]
    new["widgets_values_named"] = {"lora_name": REL, "strength_model": 1}
    new["inputs"] = [{"name": "model", "type": "MODEL", "link": base}]
    new["outputs"] = [{"name": "MODEL", "type": "MODEL", "slot_index": 0,
                       "links": [bridge[0]]}]
    new["properties"] = {"Node name for S&R": "LoraLoaderModelOnly"}
    d["links"].append([base, PREV_ID, 0, NEW_ID, 0, "MODEL"])
    bridge[1] = NEW_ID            # 桥线改源:84→后继 变 87→后继(link id 保留)
    d["nodes"].append(new)
    nodes[PREV_ID]["outputs"][0]["links"] = [base]
    # 后继节点的 model 入线登记不变(桥线 id 未动);[12] 入线未动
    d["last_node_id"] = max(int(d.get("last_node_id", 0)), NEW_ID)
    d["last_link_id"] = max(l[0] for l in d["links"])
    print(f"GRAPH 新增 [{NEW_ID}] {REL},链 {PREV_ID}→{NEW_ID}→{succ}"
          f"(link {base} 新建 84→87;link {bridge[0]} 改源 87→{succ})")
    return succ


def beautify(d: dict) -> None:
    chain = model_chain(d)          # 21, 14×LoRA, 12
    lora_chain = chain[1:-1]
    nodes = {n["id"]: n for n in d["nodes"]}
    for i, nid in enumerate(lora_chain):     # 链序等距横排一行(先例=tancai)
        n = nodes[nid]
        n["pos"] = [1300 + i * 490, 80]
        n["size"] = [460, 130]
        n["order"] = 10 + i
    for g in d.get("groups", []):
        if g.get("title", "").startswith("②"):
            g["title"] = (f"② LoRA 链({len(lora_chain)} 件,链序自左向右;"
                          "水墨四件 82/83/84/87 默认旁路;画风件一次一枚)")
            g["bounding"] = [1220, 40, 490 * len(lora_chain) + 100, 190]
    print(f"BEAUTIFY 链序横排 {len(lora_chain)} 件,分组②已扩界")


def validate(d: dict, succ: int) -> None:
    ids = {n["id"] for n in d["nodes"]}
    assert len(d["nodes"]) == len(ids), "节点 id 重复"
    link_ids = [l[0] for l in d["links"]]
    dups = sorted({i for i in link_ids if link_ids.count(i) > 1})
    assert not dups, f"link id 重复: {dups}"
    for l in d["links"]:
        assert l[1] in ids and l[3] in ids, f"悬空 link {l}"
    nodes = {n["id"]: n for n in d["nodes"]}
    l_in = next(l for l in d["links"] if l[1] == PREV_ID and l[5] == "MODEL")
    l_out = next(l for l in d["links"] if l[1] == NEW_ID and l[5] == "MODEL")
    l_sampler = next(l for l in d["links"] if l[3] == 12 and l[5] == "MODEL")
    assert l_in[3] == NEW_ID and l_out[3] == succ and l_sampler[1] == succ, \
        (l_in, l_out, l_sampler)
    assert nodes[NEW_ID]["mode"] == 4, "新节点须 mode=4 旁路"
    assert nodes[NEW_ID]["widgets_values"] == [REL, 1], "widgets 须 [金雾, 1]"
    chain = model_chain(d)
    assert chain[0] == 21 and chain[-1] == 12 and NEW_ID in chain, chain
    assert chain[chain.index(NEW_ID) - 1] == PREV_ID, chain
    print(f"VALIDATE 节点={len(d['nodes'])} links={len(d['links'])} 链={chain}")


def main() -> int:
    check_lora_on_disk()
    d = json.loads(WF.read_text(encoding="utf-8"))
    succ = mutate_graph(d)
    beautify(d)
    validate(d, succ)
    WF.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    check = json.loads(WF.read_text(encoding="utf-8"))
    validate(check, succ)
    print("OK 金雾落位([87] mode=4 旁路 ×1.0;引擎家模型在盘校验通过)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
