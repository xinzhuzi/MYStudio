#!/usr/bin/env python3
"""workflow_repair_1113 —— 全量排查确定性结构修复役(1113 用户令「必须全部排查一遍…并且进行美观美化」)。

只修「确定性结构缺陷」(链路登记错乱/断线),不做布局(布局另役)。每件修前备份到
/tmp/wf_repair_backup_1113/,修后跑 workflow_graph_lint 验证 + 结构保真断言。

修复件与口径:
  A. dst_slot 重写三件(moss-道劫-t2i / qi21-道劫-人物姿势 / pika-单镜视频-fl2v):
     links 表 dst_slot 被压平为错值,但节点 inputs[].link 登记正确且唯一。
     口径=以节点侧登记为真,把每条 link 的 dst_slot 改写到节点实际登记的槽位。
     只动 link[4],其余字节不动;源侧已全登记(验过)。
  B. qwen21-charcard-t2i:links 表与节点侧双向均错乱(深损坏,无干净 git 版/无生成器)。
     口径=按节点类型推导唯一正确拓扑,重建 links 表+节点登记(保留原 link id 语义)。
  C. yue2-整曲-官方版:node9 VAEDecodeAudio 的 vae 悬空(死支路,真实出音频走 node17
     VAEDecodeAudioTiled);node18 AudioEncoderLoader(bypass)输出悬空引用 link25。
     口径=给 node9.vae 补连线(源 node15 CheckpointLoaderSimple out2 VAE),清 node18 悬空输出引用。

用法:python3 workflow_repair_1113.py [--dry]   # --dry 只报告不落盘
"""
from __future__ import annotations
import json, pathlib, shutil, subprocess, sys, copy

REPO = pathlib.Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/comfyui/workflows"
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"
BACKUP = pathlib.Path("/tmp/wf_repair_backup_1113")
DRY = "--dry" in sys.argv

TARGETS = {
    "moss": WF / "1_图片/MossImage/moss-道劫-t2i.json",
    "pose": WF / "1_图片/QwenImage2.1/4_姿势编辑/qi21-道劫-人物姿势.json",
    "pika": WF / "2_视频/H3视频/7_测试/pika-单镜视频-fl2v.json",
    "charcard": WF / "1_图片/QwenImage2.1/1_文生图/qwen21-charcard-t2i.json",
    "yue2": WF / "3_声音/Yue2/yue2-整曲-官方版.json",
}


def load(p): return json.loads(p.read_text(encoding="utf-8"))
def save(p, d): p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def lint(p):
    r = subprocess.run([sys.executable, str(LINT), str(p)], capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def rewrite_dst_slots(d):
    """A 类:以节点 inputs[].link 登记为真,重写 links 表 dst_slot。返回改写数。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    n = 0
    for l in d["links"]:
        lid, dst, ds = l[0], l[3], l[4]
        dn = nodes.get(dst)
        if not dn:
            raise RuntimeError(f"link{lid} dst节点{dst}缺失")
        reg = [i for i, ip in enumerate(dn.get("inputs") or []) if ip.get("link") == lid]
        if len(reg) != 1:
            raise RuntimeError(f"link{lid} 节点侧登记数={len(reg)}(须唯一),不可自动重写")
        if reg[0] != ds:
            # 类型 sanity:link 类型须与目标槽类型一致
            it = (dn["inputs"][reg[0]].get("type") or "")
            lt = l[5] if len(l) > 5 else ""
            if it and lt and it != lt and not (it == "*" or lt == "*"):
                raise RuntimeError(f"link{lid} 类型不符 slot={it} link={lt}")
            l[4] = reg[0]
            n += 1
    return n


def repair_charcard(d):
    """B 类:按节点类型重建唯一正确拓扑(保留原 link id)。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    # 正确连接表 (lid, src, sslot, dst, dslot, type) —— 由节点类型/槽位语义推导
    correct = [
        [1, 1, 0, 5, 3, "STRING"],   # 提示词 -> prompt
        [2, 1, 1, 5, 4, "STRING"],   # 负面提示词 -> negative_prompt
        [3, 8, 0, 14, 0, "IMAGE"],   # VAEDecode -> PreviewImage(原缺,补 id3)
        [4, 1, 4, 6, 0, "INT"],      # 宽度 -> width
        [5, 1, 5, 6, 1, "INT"],      # 高度 -> height
        [6, 3, 0, 5, 0, "CLIP"],     # CLIPLoader -> clip
        [7, 4, 0, 5, 2, "VAE"],      # VAELoader -> vae(原 src 误为 3)
        [8, 4, 0, 8, 1, "VAE"],      # VAELoader -> VAEDecode.vae
        [9, 2, 0, 701, 0, "MODEL"],  # UNETLoader -> LoraLoaderModelOnly
        [10, 701, 0, 702, 0, "MODEL"],  # LoRA -> LazyCache
        [11, 702, 0, 703, 0, "MODEL"],  # LazyCache -> BasicGuider
        [12, 5, 0, 703, 1, "CONDITIONING"],  # TextEncode.positive -> BasicGuider
        [13, 701, 0, 704, 0, "MODEL"],  # LoRA -> BasicScheduler
        [14, 705, 0, 707, 0, "NOISE"],
        [15, 703, 0, 707, 1, "GUIDER"],
        [16, 706, 0, 707, 2, "SAMPLER"],
        [17, 704, 0, 707, 3, "SIGMAS"],
        [18, 6, 0, 707, 4, "LATENT"],  # EmptyLatentImage -> latent_image
        [19, 707, 0, 8, 0, "LATENT"],  # Sampler -> VAEDecode.samples
        [20, 8, 0, 10, 0, "IMAGE"],   # VAEDecode -> SaveImage
        [21, 1, 2, 5, 1, "IMAGE"],    # 版式引导图 -> images.image_1
        [22, 8, 0, 9, 0, "IMAGE"],    # VAEDecode -> PreviewImage(node9,原乱线指向GUIDER)
    ]
    # 校验所有端点/槽位存在且类型匹配
    for lid, src, ss, dst, ds, typ in correct:
        sn, dn = nodes[src], nodes[dst]
        assert ss < len(sn.get("outputs") or []), f"link{lid} src槽越界"
        assert ds < len(dn.get("inputs") or []), f"link{lid} dst槽越界"
        ot = sn["outputs"][ss].get("type"); it = dn["inputs"][ds].get("type")
        assert ot == typ and it == typ, f"link{lid} 类型不符 out={ot} in={it} want={typ}"
    d["links"] = correct
    # 重建节点侧登记(先清空所有 inputs[].link / outputs[].links,再按 correct 填)
    for n in d["nodes"]:
        for ip in n.get("inputs") or []:
            if "link" in ip: ip["link"] = None
        for o in n.get("outputs") or []:
            if "links" in o: o["links"] = []
    for lid, src, ss, dst, ds, typ in correct:
        nodes[dst]["inputs"][ds]["link"] = lid
        outs = nodes[src]["outputs"][ss]
        outs.setdefault("links", [])
        if outs["links"] is None: outs["links"] = []
        outs["links"].append(lid)
    return len(correct)


def repair_yue2(d):
    """C 类:node9.vae 补线(源 node15 out2 VAE);清 node18 悬空输出引用。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    n9, n15, n18 = nodes[9], nodes[15], nodes[18]
    assert n9["type"] == "VAEDecodeAudio" and n15["type"] == "CheckpointLoaderSimple"
    assert n15["outputs"][2]["type"] == "VAE"
    assert n9["inputs"][1]["name"] == "vae" and n9["inputs"][1].get("link") is None
    new_id = max(l[0] for l in d["links"]) + 1
    d["links"].append([new_id, 15, 2, 9, 1, "VAE"])
    n9["inputs"][1]["link"] = new_id
    n15["outputs"][2].setdefault("links", [])
    if n15["outputs"][2]["links"] is None: n15["outputs"][2]["links"] = []
    n15["outputs"][2]["links"].append(new_id)
    # 清 node18 悬空输出引用(link25 不在 links 表)
    lids = {l[0] for l in d["links"]}
    cleaned = 0
    for o in n18.get("outputs") or []:
        if o.get("links"):
            keep = [x for x in o["links"] if x in lids]
            cleaned += len(o["links"]) - len(keep)
            o["links"] = keep
    return new_id, cleaned


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    results = []
    for key, p in TARGETS.items():
        bak = BACKUP / p.name
        if not bak.exists():
            BACKUP.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, bak)
        orig = load(bak)  # 恒从 pristine 备份出发,重跑幂等
        d = copy.deepcopy(orig)
        info = {}
        if key in ("moss", "pose", "pika"):
            info["dst_rewrites"] = rewrite_dst_slots(d)
            # 保真断言:除 link[4] 外,links 其余字段与节点全不动
            for a, b in zip(orig["links"], d["links"]):
                assert a[:4] == b[:4] and a[5:] == b[5:], f"{key} link 非dst_slot字段被改"
            assert json.dumps(orig["nodes"], sort_keys=True) == json.dumps(d["nodes"], sort_keys=True), f"{key} 节点被改"
        elif key == "charcard":
            info["links_rebuilt"] = repair_charcard(d)
            # widgets 保真:节点 widgets_values 不动
            ow = {n["id"]: n.get("widgets_values") for n in orig["nodes"]}
            nw = {n["id"]: n.get("widgets_values") for n in d["nodes"]}
            assert ow == nw, "charcard widgets 被改"
        elif key == "yue2":
            nid, cleaned = repair_yue2(d)
            info["new_link"] = nid; info["dangling_cleaned"] = cleaned
            ow = {n["id"]: n.get("widgets_values") for n in orig["nodes"]}
            nw = {n["id"]: n.get("widgets_values") for n in d["nodes"]}
            assert ow == nw, "yue2 widgets 被改"
        if DRY:
            print(f"[DRY] {key}: {info}")
            results.append((key, "dry", info)); continue
        save(p, d)
        rc, out = lint(p)
        # pika 仍有布局/必填槽问题(另役),其余件应 lint 绿
        status = "LINT_GREEN" if rc == 0 else f"LINT_REMAIN(rc={rc})"
        print(f"[{status}] {key} {p.name}: {info}")
        if rc != 0:
            for line in out.splitlines():
                if line.strip().startswith("-"): print("    " + line.strip())
        results.append((key, status, info))
    print("\n汇总:")
    for key, st, info in results: print(f"  {key}: {st} {info}")


if __name__ == "__main__":
    main()