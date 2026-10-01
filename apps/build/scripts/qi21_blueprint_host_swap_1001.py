#!/usr/bin/env python3
"""qi21-道劫-t2i 宿主[40]替换为蓝图实例(2026-10-01,Trellis 10-01-qi21-assembly-blueprint S5)。

背景(design §2.3,实测先行):
  官方蓝图拖入画布即深拷贝(isolated copies),保存进工作流后的序列化形态
  **已于 1001 前端实测定论**(隔离引擎 17599 + headless chrome CDP,
  双击画布→搜索「qi21-提示词类型优化子图」→键盘选中→Enter 添加,
  app.graph.serialize() 现读;探针档 /tmp/s5-probe-out/probe4_serialized.json):
    1. nodes[].type = **新生成的实例 uuid**(非 SubgraphBlueprint.<name> 前缀,
       非蓝图定义原 uuid);
    2. definitions.subgraphs 内嵌该副本定义(id=实例 uuid,name=蓝图注册名);
    3. properties.subgraph 残留蓝图原 uuid,重载不规整但无害(前端以 type 为准,
       loadGraphData 实测 missing=0);
    4. widgets_values 五控件照常;深拷贝后与蓝图库零关联(改蓝图走 S6 同步脚本)。
  → 与 design §2.3 预判分支 b「新的内嵌 uuid + definitions 写回内嵌定义」吻合,
  不属冲突,按实测形态落刀,未升级。

手术内容(最小侵入):
  宿主 [40]: type 与 properties.subgraph 同换新实例 uuid U(两者保持一致=
    S6 同步脚本「宿主引用与定义id相符」断言不破);id/title/widgets_values/
    inputs/outputs/pos/size/flags 全部原样。
  definitions.subgraphs 的 c3f81b56 条目: 仅 id 换 U;name 保留 R1 用户裁定
    「[40] 提示词类型优化子图(双击进入)」(S6 name 前缀锚=「[40] 提示词类型优化子图」,
    换蓝图注册名会破锚;实测拖入写回 name=注册名属新建实例默认行为,不适用于
    保留显示历史的宿主);内容已与蓝图逐键相等,手术时再断言一次(防漂移双保险)。
  全图 links/其余节点/加速子图定义: 零改动。

对拍(手术三件套:改前快照/改后/断言结果 → /tmp/qi21_s5_swap_1001/):
  A. 全图 links 数组逐位相等(触 40 的 9 根=4连线入+5出点名复述)
  B. 宿主除 type/properties.subgraph 外逐字段 canonical 相等
     (id=40/title/widgets_values五元组逐字节/inputs/outputs/pos/size)
  C. 定义除 id 外 canonical 相等;节点数10/入8/出5
  D. 加速子图 e7b9d4a2 定义逐字节不变
  E. 术后全文 c3f81b56 零残留(旧引用清零)
  F. 幂等:已换态(宿主 type 非 c3f81b56)→ verify 零写入退出

用法:
  python3 qi21_blueprint_host_swap_1001.py           # 手术(默认)
  python3 qi21_blueprint_host_swap_1001.py --check   # 只检查,零写入
  python3 qi21_blueprint_host_swap_1001.py --uuid U  # 指定实例uuid(复演/对拍用)
  python3 qi21_blueprint_host_swap_1001.py verify    # 术后一致性断言

铁律:禁手工编辑JSON;断言不过=fail-closed不落盘;写回格式
  ensure_ascii=False/indent=2/末尾换行(round-trip 与现文件逐字节一致)。
"""
import argparse
import copy
import hashlib
import json
import sys
import uuid as uuidlib
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BLUEPRINT = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
SNAP = Path("/tmp/qi21_s5_swap_1001")

SG_UUID_OLD = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"   # 术前沿:蓝图原定义 uuid
ACCEL_UUID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"   # [208] 加速子图(不动)
HOST_ID = 40
SG_NAME_KEEP = "[40] 提示词类型优化子图(双击进入)"       # R1 用户裁定名(S6 name 锚)

FIELDS_KEEP = ("id", "title", "widgets_values", "inputs", "outputs",
               "pos", "size", "flags", "order", "mode", "color", "bgcolor",
               "shape", "collapsed", "locked")


def canon(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha16(s):
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="swap", choices=["swap", "verify"])
    ap.add_argument("--check", action="store_true", help="只检查,零写入")
    ap.add_argument("--uuid", help="指定新实例uuid(复演对拍用)")
    a = ap.parse_args()

    SNAP.mkdir(parents=True, exist_ok=True)
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)
    wf_pre = copy.deepcopy(d)

    # ---------- 术前定位与断言 ----------
    hosts = [n for n in d["nodes"] if n.get("id") == HOST_ID]
    assert len(hosts) == 1, f"宿主 id={HOST_ID} 命中 {len(hosts)} 件(预期1)"
    host = hosts[0]
    defs = d["definitions"]["subgraphs"]
    old_defs = [i for i, s in enumerate(defs) if s.get("id") == SG_UUID_OLD]
    already = not old_defs and host["type"] != SG_UUID_OLD

    if already:
        # 幂等态:以蓝图真源为基准复跑对拍(S6 会合法演进定义内容如补 category,
        # 术前快照逐键比对在 S5+S6 交错后会假性失配,故基准=蓝图而非快照)
        assert host["properties"]["subgraph"] == host["type"], "幂等态:宿主type与properties.subgraph不符"
        host_def = next(s for s in defs if s["id"] == host["type"])
        assert host_def["name"] == SG_NAME_KEEP, "幂等态:定义name漂移"
        print(f"[swap] 已是术后态(type={host['type'][:8]}…),以蓝图真源复跑对拍")
        _post_asserts(d, d, host["type"], strict_pre=False)
        print("[verify] 术后一致性断言全过(幂等零写入)")
        return

    if a.cmd == "verify":
        print("[verify] 文件仍是术前态(宿主 type=c3f81b56),无术后态可验")
        sys.exit(2)

    assert host["type"] == SG_UUID_OLD, f"术前宿主type={host['type']}(预期{SG_UUID_OLD})"
    assert host["properties"].get("subgraph") == SG_UUID_OLD, "术前宿主properties.subgraph不符"
    assert len(old_defs) == 1, f"术前定义 c3f81b56 命中 {len(old_defs)} 份(预期1)"
    old_idx = old_defs[0]
    host_def_old = defs[old_idx]

    # 蓝图与宿主定义逐键对拍(除 id/name)——蓝图漂移即拒刀(同步走 S6,不混入本手术)
    bp = json.loads(BLUEPRINT.read_text(encoding="utf-8"))
    bp_sg = bp["definitions"]["subgraphs"][0]
    bp_root = bp["nodes"][0]
    assert bp_root["type"] == SG_UUID_OLD, "蓝图根节点type漂移(蓝图自引用断裂?)"
    hd, bd = copy.deepcopy(host_def_old), copy.deepcopy(bp_sg)
    hd.pop("id"), hd.pop("name"), bd.pop("id"), bd.pop("name")
    assert canon(hd) == canon(bd), (
        "宿主定义与蓝图定义不一致——先跑 qi21_blueprint_sync_1001.py 对齐再换宿主,"
        f"宿主sha={sha16(canon(hd))} 蓝图sha={sha16(canon(bd))}")
    print(f"[pre] 宿主定义==蓝图定义(除id/name),sha16={sha16(canon(hd))}")

    new_uuid = a.uuid or str(uuidlib.uuid4())
    try:
        uuidlib.UUID(new_uuid)
    except ValueError:
        raise SystemExit(f"[pre] --uuid 非法: {new_uuid}")

    # 改前快照
    (SNAP / "pre.json").write_text(json.dumps(wf_pre, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")

    if a.check:
        print("[check] 术前断言全过;--check 模式不落盘。将换 uuid="
              f"{SG_UUID_OLD} → {new_uuid}")
        return

    # ---------- 手术 ----------
    host["type"] = new_uuid
    host["properties"]["subgraph"] = new_uuid
    defs[old_idx]["id"] = new_uuid
    # 其余一概不动(定义 name/内容、宿主其它字段、links、加速子图)

    # ---------- 术后断言(fail-closed:不过不落盘) ----------
    _post_asserts(wf_pre, d, new_uuid)
    post_txt = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    assert "c3f81b56" not in post_txt, "术后全文仍有 c3f81b56 残留"
    assert SG_UUID_OLD not in json.dumps(d["definitions"]["subgraphs"][1]), "加速子图被误伤?"

    WF.write_text(post_txt, encoding="utf-8")
    (SNAP / "post.json").write_text(post_txt, encoding="utf-8")
    (SNAP / "assertions.txt").write_text(
        f"uuid: {SG_UUID_OLD} -> {new_uuid}\n"
        f"host_keep_sha16: {sha16(canon({k: host.get(k) for k in FIELDS_KEEP}))}\n"
        f"links_sha16: {sha16(canon(d['links']))}\n"
        f"def_content_sha16(id除外): {sha16(canon(hd))}\n"
        "asserts: A links逐位相等 / B 宿主字段保持 / C 定义内容保持 / D 加速子图不变 / E 旧uuid零残留\n",
        encoding="utf-8")
    print(f"[swap] 手术完成: type/properties.subgraph/定义id → {new_uuid}")
    print(f"[swap] 快照三件套: {SNAP}/pre.json post.json assertions.txt")


def _post_asserts(pre: dict, post: dict, new_uuid: str, strict_pre: bool = True):
    """A-F 六组术后断言(pre=术前 deepcopy,post=术后对象)。

    strict_pre=True(落盘前):pre 为真术前态,C 断言同时校验「手术零内容变化」
    (定义除id外与术前逐键相等)与「蓝图真源对齐」。
    strict_pre=False(幂等复跑):pre=post=当前态(术前快照已被 S6 合法演进,
    不再可比),C 断言只校验蓝图真源对齐。
    """
    ph = next(n for n in pre["nodes"] if n["id"] == HOST_ID)
    qh = next(n for n in post["nodes"] if n["id"] == HOST_ID)

    # A. 全图 links 逐位相等 + 触40连线点名(4连线入+5出,其余4入为面板控件)
    assert canon(pre["links"]) == canon(post["links"]), "A断言失败:全图links有变化"
    touch = [l for l in post["links"] if l[1] == HOST_ID or l[3] == HOST_ID]
    in_l = sorted(l[0] for l in touch if l[3] == HOST_ID)
    out_l = sorted(l[0] for l in touch if l[1] == HOST_ID)
    assert len(touch) == 9 and len(in_l) == 4 and len(out_l) == 5, \
        f"A断言失败:触40连线形态漂移 in={in_l} out={out_l}"

    # B. 宿主除 type/properties.subgraph 外逐字段保持
    for k in FIELDS_KEEP:
        assert canon(ph.get(k)) == canon(qh.get(k)), f"B断言失败:宿主字段 {k} 漂移"
    assert qh["type"] == new_uuid and qh["properties"]["subgraph"] == new_uuid, \
        "B断言失败:宿主引用未指向新uuid"
    wv = qh.get("widgets_values")
    assert isinstance(wv, list) and len(wv) == 5, "B断言失败:widgets_values非五元组"

    # C. 定义:新uuid命中唯一,内容(除id)与蓝图真源对齐,结构10/8/5
    qdefs = post["definitions"]["subgraphs"]
    hits = [s for s in qdefs if s["id"] == new_uuid]
    assert len(hits) == 1, f"C断言失败:新uuid定义命中{len(hits)}份"
    qd = hits[0]
    qd2 = copy.deepcopy(qd); qd2.pop("id")
    bp_now = json.loads(BLUEPRINT.read_text(encoding="utf-8"))
    bd2 = copy.deepcopy(bp_now["definitions"]["subgraphs"][0]); bd2.pop("id")
    assert canon(qd2) == canon(bd2), "C断言失败:宿主定义与蓝图真源不一致(先跑 qi21_blueprint_sync_1001.py 对齐)"
    if strict_pre:
        pd = next(s for s in pre["definitions"]["subgraphs"] if s["id"] == SG_UUID_OLD)
        pd2 = copy.deepcopy(pd); pd2.pop("id")
        assert canon(pd2) == canon(qd2), "C断言失败:手术改变了定义内容(除id)"
    assert qd["name"] == SG_NAME_KEEP, "C断言失败:定义name漂移(R1裁定)"
    assert len(qd["nodes"]) == 10 and len(qd["inputs"]) == 8 and len(qd["outputs"]) == 5, \
        "C断言失败:定义结构非10节点/8入/5出"

    # D. 加速子图定义逐字节不变
    pa = next(s for s in pre["definitions"]["subgraphs"] if s["id"] == ACCEL_UUID)
    qa = next(s for s in post["definitions"]["subgraphs"] if s["id"] == ACCEL_UUID)
    assert canon(pa) == canon(qa), "D断言失败:加速子图被误伤"

    # E. 术后对象内旧 uuid 零残留
    assert SG_UUID_OLD not in canon(post), "E断言失败:对象内旧uuid残留"

    print(f"[assert] A触40连线9根(入{in_l}出{out_l})逐位相等")
    print(f"[assert] B宿主字段保持(id=40/title/{qh['title']}/五控件/4连线口+5出)")
    print(f"[assert] C定义内容保持(除id) 结构10/8/5 name={qd['name']!r}")
    print("[assert] D加速子图不变 / E旧uuid零残留")


if __name__ == "__main__":
    main()
