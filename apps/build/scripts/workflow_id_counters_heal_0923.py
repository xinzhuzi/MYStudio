#!/usr/bin/env python3
"""工作流 JSON id 计数器治愈(09-23,幂等;round7 edit-pe E2E 红的根因修复)。

根因(09-23 round7 取证):手术/生成脚本给工作流追加节点与连线后不抬
`last_node_id`/`last_link_id`。新前端(0.37+)configure 用这两个字段播种
id 分配器(LGraph.ts:state.lastLinkId = max(state, data 计数器)),配置期
已注册的链接不会回抬分配器——于是画布下一次接线 mintLinkId 从陈旧计数器
+1 铸 id,与实存链接撞车,linkStore.replaceLink 报
『Link N belongs to graph …; graph … cannot overwrite it.』并拒登,
connect 返回 null。round7 实证:qwen21-edit.json 计数器 12/11 萇后于实链
17/实节点 15,ShowText 临时接线 connect-failed。

不变量(本脚本治愈到的口径):last_node_id ≥ 全图实存最大节点 id、
last_link_id ≥ 全图实存最大链接 id(根图 + definitions.subgraphs 一并计入;
计数器高于 max 是合法常态——删节点/删线只减 max 不减计数器,故只抬不降)。

手术方式:最小 JSON 文本手术——仅替换两行标量,其余字节零改动(避免整文件
重排产生大面积 diff)。每文件该二字段恰一处(脚本断言,多处即跳过报警)。

跳过:0_官方模板/(哈希锚 test_official_templates_upstream_identical
钉死逐字节,官方件零改动铁律)、点开头文件。
幂等:重跑无变化即零写入。
"""
import json
import pathlib
import re
import sys

WF_ROOT = pathlib.Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"


def true_max_ids(doc):
    """根图 + 子图全量实存最大 (node_id, link_id)。"""
    max_node = max((n.get("id", 0) for n in doc.get("nodes", [])), default=0)
    links = doc.get("links", [])
    max_link = max((l[0] for l in links), default=0) if links and not isinstance(links[0], dict) \
        else max((l.get("id", 0) for l in links), default=0)
    for sg in doc.get("definitions", {}).get("subgraphs", []):
        max_node = max(max_node, max((n.get("id", 0) for n in sg.get("nodes", [])), default=0))
        for l in sg.get("links", []):
            max_link = max(max_link, l.get("id", 0))
    return max_node, max_link


def heal(path):
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    if not isinstance(doc, dict) or "nodes" not in doc or "links" not in doc:
        return None  # 非画布件(桥 API 件/清单等)不适用本不变量
    max_node, max_link = true_max_ids(doc)
    ln, ll = doc.get("last_node_id"), doc.get("last_link_id")
    need_node = max_node if (ln is None or ln < max_node) else None
    need_link = max_link if (ll is None or ll < max_link) else None
    if need_node is None and need_link is None:
        return False  # 已健康

    for field, new in (("last_node_id", need_node), ("last_link_id", need_link)):
        if new is None:
            continue
        pat = re.compile(rf'"{field}"(\s*:\s*)\d+')
        hits = pat.findall(raw)
        if len(hits) == 1:
            raw = pat.sub(f'"{field}"\\g<1>{new}', raw, count=1)
        elif len(hits) == 0 and f'"{field}"' not in raw:
            # 缺字段形状(旧格式件):锚顶层 "links": [(恰 2 空格缩进,子层级
            # 均 ≥6 空格不误伤)前插,缩进与文件机器格式一致
            anchor = re.compile(r'(?m)^  "links": \[')
            assert len(anchor.findall(raw)) == 1, \
                f"{path.name}: 顶层 links 锚不唯一,须人工核"
            raw = anchor.sub(f'  "{field}": {new},\n  "links": [', raw, count=1)
        else:
            print(f"  ⚠️ 跳过 {path.name}:{field} 出现 {len(hits)} 次(预期 1),须人工核")
            return None

    doc2 = json.loads(raw)  # 手术后可解析性自检
    m_node, m_link = true_max_ids(doc2)
    assert doc2["last_node_id"] >= m_node and doc2["last_link_id"] >= m_link, \
        f"{path.name}: 手术后不变量不成立"
    path.write_text(raw, encoding="utf-8")
    return True


def main():
    healed, healthy, skipped = [], [], []
    for p in sorted(WF_ROOT.rglob("*.json")):
        if p.name.startswith(".") or "0_官方模板" in p.parts:
            continue
        r = heal(p)
        if r is True:
            healed.append(p)
            print(f"  🩹 治愈 {p.relative_to(WF_ROOT)}")
        elif r is False:
            healthy.append(p)
        else:
            skipped.append(p)
    print(f"计数器治愈:{len(healed)} 治愈 / {len(healthy)} 健康 / {len(skipped)} 不适用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
