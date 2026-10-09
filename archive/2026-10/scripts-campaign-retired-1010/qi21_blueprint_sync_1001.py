#!/usr/bin/env python3
"""蓝图→宿主实例 幂等同步(2026-10-01,Trellis 10-01-qi21-assembly-blueprint S6 立;
1001 i2i/edit 同构批多目标化,Trellis 10-01-qi21-i2i-edit-isomorphic R3)。

背景:Subgraph Blueprint 拖入画布即深拷贝(isolated copies),改蓝图库不会同步
已放置实例——本脚本就是防「改了蓝图画布没变」事故的唯一通道。

用法:
  python3 qi21_blueprint_sync_1001.py                      # 三目标全同步+断言
  python3 qi21_blueprint_sync_1001.py --target i2i         # 单目标(按名选)
  python3 qi21_blueprint_sync_1001.py --check              # 只检查差异,零写入
  python3 qi21_blueprint_sync_1001.py --refresh-from-library
                                                          # Q3「从库刷参数」(implement S8 步骤15):
                                                          # 从 05 库现读 4 固定句,刷装配器/合成器
                                                          # 参数(蓝图+工作流两处,逐字对拍报告)

同步对象(1001 i2i/edit 批起 t2i/i2i/edit 三目标,--target {t2i,i2i,edit,all}):
  t2i  = subgraphs/qi21-提示词类型优化子图.json      ↔ 1_文生图/qi21-道劫-t2i.json
  i2i  = subgraphs/qi21-提示词类型优化子图-i2i.json  ↔ 2_图生图/qi21-道劫-i2i.json
  edit = subgraphs/qi21-提示词类型优化子图-edit.json ↔ 2_图生图/qi21-edit.json
  源 = 蓝图 definitions.subgraphs[0];目标 = 工作流 definitions.subgraphs 里同名定义
  (「[40] 提示词类型优化子图」前缀锚,宿主[40]所引用)。宿主定位随多目标化由
  id==40 硬定位改为 properties.subgraph 引用定位(三件宿主现皆 id=40,语义不变)。

幂等证明:内容一致时零写入退出(exit 0);--check 时仅报差异不落盘。
注意:宿主 widgets_values(用户面板当前值)永不覆盖,只刷子图定义本体。
幂等比较除 id 归一:术后宿主定义 id=实例 uuid(S5 换轨),蓝图定义 id 恒为抽取时
宿主 id——不归一则永判差异(先例在档,S5 教训)。

--refresh-from-library(1001 深审修复轮补立,implement S8 步骤15 欠账;
                      1001 i2i/edit 批起多目标化):
  固定句真源 = docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md「§对应节」:
    锁层A全文        ← §二「常量 A·基础」标题后首个 ```text 围栏块(行以 \n 拼合)
    RGBA官方头句/尾句 ← §六 0927 条「三生成器 RGBA 头尾句改官方逐字(「…」/「…」」引号对
    W1收束句         ← §一 0930 条「主候选句在案(…)」括号内整句
  刷入位(与契约测试 QI21_SG_ASM_WV / QI21_SG_SEL_WV 同口径,禁漂移):
    各目标 工作流+蓝图两处子图内 [4011] MyQi21PromptAssembly.widgets_values[1](锁层A全文);
    MyQi21PromptSelect.widgets_values[6/7/8](头句/尾句/W1;1004 Phase B 双口化后
    qi21 件 9 值形,头部 4 空串=装配全文/负面词直写/PE出文/PE负面四连线槽占位;
    i2i/edit 件仍 7 值旧形——头/尾/W1 在 4/5/6,锚随 i2i/edit 推广役再分 target 化)
  多目标节点面(1001 i2i/edit 批):
    Assembly 恰 1 件→刷美术风格底座;0 件(edit 无装配层)→跳过并注记;>1 件 fail-closed;
    Select ≥1 件→全刷头/尾/W1(i2i 两件:[152] 择文器+[153] 透明包裹器,同参数面);
    0 件 fail-closed。
  纪律:提取未命中/多重命中→中文报错 exit 2(fail-closed 绝不猜);全一致=零写入
  (幂等);落盘后重读回逐字断言。节点 Python 侧 default(_STYLE_BASE/_RGBA_HEAD 等)不在
  本通道——改库后须同批过账节点代码并更新 sha16 锚(两件 docstring 有注)。
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
SUBGRAPHS = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
LIB05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
ENGINE_DST = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs")
SG_NAME_PREFIX = "[6] 文本提示词类型优化子图"

# 目标表(单点串行;t2i=S6 原目标,i2i/edit=1001 同构批入列)
TARGETS = {
    "t2i": {"blueprint": SUBGRAPHS / "qi21-提示词类型优化子图.json",
            "wf": WF_DIR / "1_文生图" / "qi21-道劫-t2i.json"},
    "i2i": {"blueprint": SUBGRAPHS / "qi21-提示词类型优化子图-i2i.json",
            "wf": WF_DIR / "2_图生图" / "qi21-道劫-i2i.json"},
    "edit": {"blueprint": SUBGRAPHS / "qi21-提示词类型优化子图-edit.json",
             "wf": WF_DIR / "2_图生图" / "qi21-edit.json"},
}

# 刷入位序(契约 QI21_SG_ASM_WV / QI21_SG_SEL_WV 同口径,禁漂移)
ASM_LOCKA_WV_IDX = 1              # [4011] widgets_values = [主体句例文, 锁层A全文](2 值形不变)
# 1002 大轮 F1 修复随账:连线 STRING 槽也建 widget 按全序消费 wv(契约
# QI21_SG_SEL_WV 同口径);1004 Phase B 双口化加 负面词直写/PE负面 两连线槽
# →qi21 件 9 值形,头/尾/W1 移 idx 6/7/8(遗留债4:旧 (4,5,6) 按 7 值形锚,
# 术后跑 refresh 读 idx4=bool(pe开关) sha() TypeError 崩、写则错槽——1005
# 案B Phase I 随账归正;i2i/edit 件仍 7 值形,该通道跑 i2i/edit 侧须待其推广役)。
SEL_HEAD_TAIL_W1_IDX = (6, 7, 8)  # [4014] wv = ["","","","", pe开关, 透明模式, 头句, 尾句, W1]


def sha(b): return hashlib.sha256(b.encode() if isinstance(b, str) else b).hexdigest()[:16]


def canonical(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fail_closed(msg):
    """fail-closed 统一口:中文报错打屏后 exit 2(docstring 承诺的退出码口径)。"""
    print(msg)
    sys.exit(2)


def extract_fixed_sentences():
    """05 库现读 4 固定句(fail-closed:未命中/多重命中即退出拒刷)。"""
    text = LIB05.read_text(encoding="utf-8")

    def one(pattern, name, flags=0, src=text):
        hits = re.findall(pattern, src, flags)
        if len(hits) != 1:
            fail_closed(f"[refresh] 05 库「{name}」提取命中 {len(hits)} 处(预期 1),"
                        f"fail-closed 拒刷——请核对 {LIB05.name} 对应节书写形态")
        return hits[0]

    lock_a = one(r"\*\*美术风格底座常量·基础[^*]*\*\*:\s*\n\n```text\n(.*?)\n```",
                 "锁层A全文(§二 常量 A·基础 text 块)", re.S)
    i = text.find("三生成器 RGBA 头尾句改官方逐字")
    if i < 0:
        fail_closed("[refresh] 05 库未找到「三生成器 RGBA 头尾句改官方逐字」节(§六 0927 条⑥),拒刷")
    seg = text[i:i + 260]
    head = one(r"[『「](This is an RGBA format image[^』」]*?)[』」]",
               "RGBA官方头句(§六 0927 条⑥ 引号对)", src=seg)
    tail = one(r"[『「](The image has an alpha channel[^』」]*?)[』」]",
               "RGBA官方尾句(§六 0927 条⑥ 引号对)", src=seg)
    w1 = one(r"主候选句在案\((The subject reads[^()]*)\)",
             "W1收束句(§一 0930 条主候选句)")
    return {"锁层A全文": lock_a, "RGBA官方头句": head,
            "RGBA官方尾句": tail, "W1收束句": w1}


def _find_nodes(sg, node_type):
    """节点命中清单(多目标面:Select 在 i2i 有两件[152/153];0/多件的裁决在调用方)。"""
    return [n for n in sg["nodes"] if n.get("type") == node_type]


def refresh_from_library(check_only, tags):
    sent = extract_fixed_sentences()
    # 收集各目标×两侧(工作流/蓝图)的子图定义与装配器/合成器节点
    plan = []
    for tag in tags:
        t = TARGETS[tag]
        for side_name, path in (("工作流", t["wf"]), ("蓝图", t["blueprint"])):
            data = json.loads(path.read_text())
            sgs = data["definitions"]["subgraphs"]
            hits = [i for i, s in enumerate(sgs) if s.get("name", "").startswith(SG_NAME_PREFIX)]
            if len(hits) != 1:
                fail_closed(f"[refresh] [{tag}] {side_name}侧同名子图定义命中 {len(hits)} 份(预期 1),fail-closed 拒刷")
            sg = sgs[hits[0]]
            asm = _find_nodes(sg, "MyQi21PromptAssembly")
            if len(asm) > 1:
                fail_closed(f"[refresh] [{tag}] {side_name}侧 MyQi21PromptAssembly 命中 {len(asm)} 件(预期 ≤1),fail-closed 拒刷")
            sels = _find_nodes(sg, "MyQi21PromptSelect")
            if not sels:
                fail_closed(f"[refresh] [{tag}] {side_name}侧 MyQi21PromptSelect 命中 0 件(预期 ≥1),fail-closed 拒刷")
            plan.append({"tag": tag, "side": side_name, "path": path, "data": data,
                         "asm": asm[0] if asm else None, "sels": sels})

    report, changed = [], False
    for p in plan:
        label = f"{p['tag']}/{p['side']}"
        if p["asm"] is None:
            report.append(f"  {label}[锁层A全文] 无 MyQi21PromptAssembly({p['tag']} 无装配层),跳过")
        else:
            cur = p["asm"]["widgets_values"][ASM_LOCKA_WV_IDX]
            if cur == sent["锁层A全文"]:
                report.append(f"  {label}[锁层A全文] 一致(sha16={sha(sent['锁层A全文'])})")
            else:
                changed = True
                report.append(f"  {label}[锁层A全文] 将刷新: sha16 {sha(cur)} → {sha(sent['锁层A全文'])}"
                              f"(len {len(cur)}→{len(sent['锁层A全文'])})")
        for sel in p["sels"]:
            for name, off in (("RGBA官方头句", 0), ("RGBA官方尾句", 1), ("W1收束句", 2)):
                cur = sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[off]]
                if cur == sent[name]:
                    report.append(f"  {label}[Select{sel['id']}/{name}] 一致(sha16={sha(sent[name])})")
                else:
                    changed = True
                    report.append(f"  {label}[Select{sel['id']}/{name}] 将刷新: sha16 {sha(cur)} → {sha(sent[name])}"
                                  f"(len {len(cur)}→{len(sent[name])})")
    print(f"[refresh] 05 库现读 4 固定句,对拍 {len(tags)} 目标({'/'.join(tags)})×蓝图+工作流两处:")
    print("\n".join(report))

    if not changed:
        print("[refresh] 全一致,零写入(幂等)")
        return
    if check_only:
        print("[refresh] --check 模式:有差异但不落盘")
        sys.exit(2)
    for p in plan:
        if p["asm"] is not None:
            p["asm"]["widgets_values"][ASM_LOCKA_WV_IDX] = sent["锁层A全文"]
        for sel in p["sels"]:
            sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[0]] = sent["RGBA官方头句"]
            sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[1]] = sent["RGBA官方尾句"]
            sel["widgets_values"][SEL_HEAD_TAIL_W1_IDX[2]] = sent["W1收束句"]
        p["path"].write_text(json.dumps(p["data"], ensure_ascii=False, indent=2) + "\n")
    # 手术三件套的断言腿:重读回逐字断言
    for p in plan:
        reread = json.loads(p["path"].read_text())
        sg = next(s for s in reread["definitions"]["subgraphs"]
                  if s.get("name", "").startswith(SG_NAME_PREFIX))
        asm = _find_nodes(sg, "MyQi21PromptAssembly")
        if asm:
            assert asm[0]["widgets_values"][ASM_LOCKA_WV_IDX] == sent["锁层A全文"], \
                f"{p['path']} 美术风格底座 回读不逐字"
        for sel in _find_nodes(sg, "MyQi21PromptSelect"):
            assert sel["widgets_values"][6:9] == [sent["RGBA官方头句"], sent["RGBA官方尾句"], sent["W1收束句"]], \
                f"{p['path']} 头尾/W1 回读不逐字"
    print("[refresh] 已落盘(各目标 工作流+蓝图 两处)且回读逐字断言过;引擎家蓝图随常规同步腿刷新;"
          "节点 Python default 同批过账提醒见两件 docstring 锚")


def sync_target(tag, check):
    """单目标同步腿:蓝图定义 → 宿主工作流同名定义(幂等,除 id 归一)。"""
    t = TARGETS[tag]
    bp = json.loads(t["blueprint"].read_text())
    bp_sg = bp["definitions"]["subgraphs"][0]
    assert bp_sg["name"].startswith(SG_NAME_PREFIX), f"[{tag}] 蓝图名漂移"

    d = json.loads(t["wf"].read_text())
    hits = [i for i, s in enumerate(d["definitions"]["subgraphs"])
            if s.get("name", "").startswith(SG_NAME_PREFIX)]
    assert len(hits) == 1, f"[{tag}] 宿主定义命中{len(hits)}份(预期1),拒绝同步"
    idx = hits[0]
    old_sg = d["definitions"]["subgraphs"][idx]
    host_hits = [n for n in d["nodes"]
                 if n.get("properties", {}).get("subgraph") == old_sg["id"]]
    assert len(host_hits) == 1, f"[{tag}] 宿主节点命中{len(host_hits)}件(预期1),拒绝同步"

    # 幂等比较除 id 归一(S5 教训在档:术后宿主定义id=实例uuid,蓝图定义id恒为抽取时id,
    # S5 换 uuid 前两者同 id 旧比较恰巧成立;不归一则永判差异)
    _norm = lambda s: {k: v for k, v in s.items() if k != "id"}
    if canonical(_norm(old_sg)) == canonical(_norm(bp_sg)):
        print(f"[sync:{tag}] 一致(除id归一),零写入(幂等)。蓝图sha={sha(canonical(_norm(bp_sg)).encode())}")
        return
    diff_nodes = (len(old_sg.get('nodes', [])), len(bp_sg.get('nodes', [])))
    diff_links = (len(old_sg.get('links', [])), len(bp_sg.get('links', [])))
    if check:
        print(f"[check:{tag}] 有差异: 节点{diff_nodes} 连线{diff_links};--check模式不落盘")
        sys.exit(2)
    # 保留工作流侧定义id(宿主引用不动),其余整体以蓝图为准
    bp_sg_with_id = json.loads(json.dumps(bp_sg, ensure_ascii=False))
    bp_sg_with_id["id"] = old_sg["id"]
    d["definitions"]["subgraphs"][idx] = bp_sg_with_id
    t["wf"].write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print(f"[sync:{tag}] 已刷新: 节点{diff_nodes} 连线{diff_links} → 蓝图版(定义id保留)")


def sync_engine_home(tags, check):
    """引擎家蓝图同步腿(幂等;重启引擎后 /global_subgraphs 生效)。"""
    if not ENGINE_DST.exists():
        print(f"[sync] 引擎家目录缺席,跳过:{ENGINE_DST}")
        return
    for tag in tags:
        bp = TARGETS[tag]["blueprint"]
        dst_file = ENGINE_DST / bp.name
        if not dst_file.exists() or dst_file.read_bytes() != bp.read_bytes():
            if check:
                print(f"[check] 引擎家蓝图落后: {bp.name}")
                sys.exit(2)
            dst_file.write_bytes(bp.read_bytes())
            print(f"[sync:{tag}] 引擎家蓝图已刷新 {bp.name}(重启引擎后 /global_subgraphs 生效)")
        else:
            print(f"[sync:{tag}] 引擎家蓝图一致: {bp.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=[*TARGETS, "all"], default="all",
                    help="同步目标(默认 all=t2i/i2i/edit 三目标;1001 i2i/edit 批起多目标化)")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--refresh-from-library", action="store_true",
                    help="Q3 从库刷参数:05 库现读 4 固定句刷装配器/合成器参数(各目标 蓝图+工作流 两处)")
    a = ap.parse_args()
    tags = list(TARGETS) if a.target == "all" else [a.target]
    if a.refresh_from_library:
        refresh_from_library(a.check, tags)
        return
    for tag in tags:
        sync_target(tag, a.check)
    sync_engine_home(tags, a.check)
    print("done")


if __name__ == "__main__":
    main()
