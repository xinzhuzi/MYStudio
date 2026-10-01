#!/usr/bin/env python3
"""蓝图→t2i 宿主实例 幂等同步(2026-10-01,Trellis 10-01-qi21-assembly-blueprint S6)。

背景:Subgraph Blueprint 拖入画布即深拷贝(isolated copies),改蓝图库不会同步
已放置实例——本脚本就是防「改了蓝图画布没变」事故的唯一通道。

用法:
  python3 qi21_blueprint_sync_1001.py            # 同步+断言
  python3 qi21_blueprint_sync_1001.py --check    # 只检查差异,零写入
  python3 qi21_blueprint_sync_1001.py --refresh-from-library
                                                # Q3「从库刷参数」(implement S8 步骤15):
                                                # 从 05 库现读 4 固定句,刷装配器/合成器
                                                # 参数(蓝图+工作流两处,逐字对拍报告)

同步对象:
  源 = my_nodes/subgraphs/qi21-提示词类型优化子图.json 的 definitions.subgraphs[0]
  目标 = qi21-道劫-t2i.json 的 definitions.subgraphs 里同名定义(宿主[40]所引用)

幂等证明:内容一致时零写入退出(exit 0);--check 时仅报差异不落盘。
注意:宿主 widgets_values(用户面板当前值)永不覆盖,只刷子图定义本体。

--refresh-from-library(1001 深审修复轮补立,implement S8 步骤15 欠账):
  固定句真源 = docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md「§对应节」:
    锁层A全文        ← §二「常量 A·基础」标题后首个 ```text 围栏块(行以 \n 拼合)
    RGBA官方头句/尾句 ← §六 0927 条「三生成器 RGBA 头尾句改官方逐字(「…」/「…」」引号对
    W1收束句         ← §一 0930 条「主候选句在案(…)」括号内整句
  刷入位(与契约测试 QI21_SG_ASM_WV / QI21_SG_SEL_WV 同口径,禁漂移):
    工作流+蓝图两处子图内 [141] MyQi21PromptAssembly.widgets_values[1](锁层A全文);
    [152] MyQi21PromptSelect.widgets_values[2/3/4](头句/尾句/W1)
  纪律:提取未命中/多重命中→中文报错 exit 2(fail-closed 绝不猜);全一致=零写入
  (幂等);落盘后重读回逐字断言。节点 Python 侧 default(_LOCK_A/_RGBA_HEAD 等)不在
  本通道——改库后须同批过账节点代码并更新 sha16 锚(两件 docstring 有注)。
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
BLUEPRINT = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
LIB05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
ENGINE_DST = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs")
SG_NAME_PREFIX = "[40] 提示词类型优化子图"

# 刷入位序(契约 QI21_SG_ASM_WV / QI21_SG_SEL_WV 同口径,禁漂移)
ASM_LOCKA_WV_IDX = 1              # [141] widgets_values = [主体句例文, 锁层A全文]
SEL_HEAD_TAIL_W1_IDX = (2, 3, 4)  # [152] widgets_values = [pe开关, 透明模式, 头句, 尾句, W1]


def sha(b): return hashlib.sha256(b.encode() if isinstance(b, str) else b).hexdigest()[:16]


def canonical(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def extract_fixed_sentences():
    """05 库现读 4 固定句(fail-closed:未命中/多重命中即退出拒刷)。"""
    text = LIB05.read_text(encoding="utf-8")

    def one(pattern, name, flags=0):
        hits = re.findall(pattern, text, flags)
        if len(hits) != 1:
            raise SystemExit(f"[refresh] 05 库「{name}」提取命中 {len(hits)} 处(预期 1),"
                             f"fail-closed 拒刷——请核对 {LIB05.name} 对应节书写形态")
        return hits[0]

    lock_a = one(r"\*\*常量 A·基础[^*]*\*\*:\s*\n\n```text\n(.*?)\n```",
                 "锁层A全文(§二 常量 A·基础 text 块)", re.S)
    i = text.find("三生成器 RGBA 头尾句改官方逐字")
    if i < 0:
        raise SystemExit("[refresh] 05 库未找到「三生成器 RGBA 头尾句改官方逐字」节(§六 0927 条⑥),拒刷")
    seg = text[i:i + 260]
    m_head = re.search(r"[『「](This is an RGBA format image[^』」]*?)[』」]", seg)
    m_tail = re.search(r"[『「](The image has an alpha channel[^』」]*?)[』」]", seg)
    if not m_head or not m_tail:
        raise SystemExit("[refresh] 05 库 RGBA 头/尾句引号对提取失败(§六 0927 条⑥ 窗口),fail-closed 拒刷")
    w1 = one(r"主候选句在案\((The subject reads[^()]*)\)",
             "W1收束句(§一 0930 条主候选句)")
    return {"锁层A全文": lock_a, "RGBA官方头句": m_head.group(1),
            "RGBA官方尾句": m_tail.group(1), "W1收束句": w1}


def _find_node(sg, node_type):
    hits = [n for n in sg["nodes"] if n.get("type") == node_type]
    if len(hits) != 1:
        raise SystemExit(f"[refresh] 子图内 {node_type} 命中 {len(hits)} 件(预期 1),fail-closed 拒刷")
    return hits[0]


def refresh_from_library(check_only):
    sent = extract_fixed_sentences()
    wf_data = json.loads(WF.read_text())
    bp_data = json.loads(BLUEPRINT.read_text())
    targets = []
    for tag, data in (("工作流", wf_data), ("蓝图", bp_data)):
        sgs = data["definitions"]["subgraphs"]
        hits = [i for i, s in enumerate(sgs) if s.get("name", "").startswith(SG_NAME_PREFIX)]
        if len(hits) != 1:
            raise SystemExit(f"[refresh] {tag}侧同名子图定义命中 {len(hits)} 份(预期 1),fail-closed 拒刷")
        sg = sgs[hits[0]]
        targets.append((tag, _find_node(sg, "MyQi21PromptAssembly"),
                        _find_node(sg, "MyQi21PromptSelect")))

    report, changed = [], False
    slots = (("锁层A全文", None), ("RGBA官方头句", 0), ("RGBA官方尾句", 1), ("W1收束句", 2))
    for tag, asm, sel in targets:
        for name, off in slots:
            cur = (asm["widgets_values"][ASM_LOCKA_WV_IDX] if off is None
                   else sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[off]])
            want = sent[name]
            if cur == want:
                report.append(f"  {tag}[{name}] 一致(sha16={sha(want)})")
            else:
                changed = True
                report.append(f"  {tag}[{name}] 将刷新: sha16 {sha(cur)} → {sha(want)}"
                              f"(len {len(cur)}→{len(want)})")
    print("[refresh] 05 库现读 4 固定句,对拍蓝图+工作流两处:")
    print("\n".join(report))

    if not changed:
        print("[refresh] 全一致,零写入(幂等)")
        return
    if check_only:
        print("[refresh] --check 模式:有差异但不落盘")
        sys.exit(2)
    for tag, asm, sel in targets:
        asm["widgets_values"][ASM_LOCKA_WV_IDX] = sent["锁层A全文"]
        sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[0]] = sent["RGBA官方头句"]
        sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[1]] = sent["RGBA官方尾句"]
        sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[2]] = sent["W1收束句"]
    WF.write_text(json.dumps(wf_data, ensure_ascii=False, indent=2) + "\n")
    BLUEPRINT.write_text(json.dumps(bp_data, ensure_ascii=False, indent=2) + "\n")
    # 手术三件套的断言腿:重读回逐字断言
    for path in (WF, BLUEPRINT):
        reread = json.loads(path.read_text())
        sg = next(s for s in reread["definitions"]["subgraphs"]
                  if s.get("name", "").startswith(SG_NAME_PREFIX))
        asm, sel = _find_node(sg, "MyQi21PromptAssembly"), _find_node(sg, "MyQi21PromptSelect")
        assert asm["widgets_values"][ASM_LOCKA_WV_IDX] == sent["锁层A全文"], f"{path} 锁层A 回读不逐字"
        assert sel["widgets_values"][2:5] == [sent["RGBA官方头句"], sent["RGBA官方尾句"], sent["W1收束句"]], \
            f"{path} 头尾/W1 回读不逐字"
    print("[refresh] 已落盘(工作流+蓝图两处)且回读逐字断言过;引擎家蓝图随常规同步腿刷新;"
          "节点 Python default 同批过账提醒见两件 docstring 锚")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--refresh-from-library", action="store_true",
                    help="Q3 从库刷参数:05 库现读 4 固定句刷装配器/合成器参数(蓝图+工作流两处)")
    a = ap.parse_args()
    if a.refresh_from_library:
        refresh_from_library(a.check)
        return
    bp = json.loads(BLUEPRINT.read_text())
    bp_sg = bp["definitions"]["subgraphs"][0]
    assert bp_sg["name"].startswith(SG_NAME_PREFIX), "蓝图名漂移"

    d = json.loads(WF.read_text())
    hits = [i for i, s in enumerate(d["definitions"]["subgraphs"])
            if s.get("name", "").startswith(SG_NAME_PREFIX)]
    assert len(hits) == 1, f"宿主定义命中{len(hits)}份(预期1),拒绝同步"
    idx = hits[0]
    host_node = next(n for n in d["nodes"] if n["id"] == 40)
    assert host_node["properties"]["subgraph"] == d["definitions"]["subgraphs"][idx]["id"], "宿主引用与定义id不符"

    old_sg = d["definitions"]["subgraphs"][idx]
    # 1001 S5 术后宿主定义id=实例uuid(96937bbe…),蓝图定义id恒为c3f81b56…
    # ——幂等比较须除id归一(S5换uuid前两者同id,旧比较恰巧成立;S5后不归一则永判差异)
    _norm = lambda s: {k: v for k, v in s.items() if k != "id"}
    if canonical(_norm(old_sg)) == canonical(_norm(bp_sg)):
        print(f"[sync] 一致(除id归一),零写入(幂等)。蓝图sha={sha(canonical(_norm(bp_sg)).encode())}")
    else:
        diff_nodes = (len(old_sg.get('nodes', [])), len(bp_sg.get('nodes', [])))
        diff_links = (len(old_sg.get('links', [])), len(bp_sg.get('links', [])))
        if a.check:
            print(f"[check] 有差异: 节点{diff_nodes} 连线{diff_links};--check模式不落盘")
            sys.exit(2)
        # 保留工作流侧定义id(宿主引用不动),其余整体以蓝图为准
        bp_sg_with_id = json.loads(json.dumps(bp_sg, ensure_ascii=False))
        bp_sg_with_id["id"] = old_sg["id"]
        d["definitions"]["subgraphs"][idx] = bp_sg_with_id
        WF.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
        print(f"[sync] 已刷新: 节点{diff_nodes} 连线{diff_links} → 蓝图版(定义id保留)")

    # 引擎家同步(幂等)
    if ENGINE_DST.exists():
        dst_file = ENGINE_DST / BLUEPRINT.name
        if not dst_file.exists() or dst_file.read_bytes() != BLUEPRINT.read_bytes():
            if a.check:
                print("[check] 引擎家蓝图落后")
                sys.exit(2)
            dst_file.write_bytes(BLUEPRINT.read_bytes())
            print("[sync] 引擎家蓝图已刷新(重启引擎后 /global_subgraphs 生效)")
        else:
            print("[sync] 引擎家蓝图一致")
    print("done")


if __name__ == "__main__":
    main()
