#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P2 标缺横幅(1127;任务 .trellis/tasks/11-26-image-workflow-engine-reconcile)。

用法:
  python3 apps/build/scripts/campaigns/image_p2_mark_missing_1127.py            # 预演,只读
  python3 apps/build/scripts/campaigns/image_p2_mark_missing_1127.py --apply    # 备份后写入

数据: 任务 research/p2-banners-1127.json(逐件横幅 + 处置方式 prepend/add)。
只改两处之一:
  prepend = 宿主说明卡(指定 id、指定类型)的 widgets_values[0] 开头前置横幅;
            如果有 widgets_values_named.text，也在其原文前置同一横幅。
  add     = 新增一张 MarkdownNote(放画布最右侧、不进负区),last_node_id 同步 +1。
不改连线、分组、其他节点、子图定义与任何控件值。

幂等: 横幅以 MARK 开头。宿主文字已以 MARK 开头 -> 整段横幅(到第一个空行)替换;
      新增卡以 properties.manying_p2_mark 识别,已存在 -> 只换文字。重跑结果逐字节不变。
fail-closed: 任一断言失败,该件不落盘,最后退出码 1。
备份: --apply 时写前把原件存到 research/bak-p2-1127/<相对路径>,并写 SHA256 清单 manifest.json。
格式: 按原件探出的 json.dumps 风格回写(原件须能逐字节回放,否则拒改),保证 diff 只落在改动处。
"""
import hashlib
import json
import os
import sys

MARK = "【标缺·不可跑("
NEW_NOTE_TAG = "1127"


def find_repo_root():
    d = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.isdir(os.path.join(d, ".trellis")):
            return d
        p = os.path.dirname(d)
        if p == d:
            sys.exit("ERROR: 找不到仓库根(含 .trellis 的目录)")
        d = p


R = find_repo_root()
WF = os.path.join(R, "apps/backend/comfyui/workflows")
TASK = os.path.join(R, ".trellis/tasks/11-26-image-workflow-engine-reconcile")
DATA = os.path.join(TASK, "research/p2-banners-1127.json")
BAK = os.path.join(TASK, "research/bak-p2-1127")


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def detect_style(raw, obj):
    for ind in (2, None, 1, 4, "\t"):
        for seps in ((",", ": "), (",", ":"), (", ", ": ")):
            if ind is None and seps == (",", ": "):
                continue
            for ea in (False, True):
                s = json.dumps(obj, ensure_ascii=ea, indent=ind, separators=seps)
                for tail in ("", "\n"):
                    if s + tail == raw:
                        return {"indent": ind, "separators": seps, "ensure_ascii": ea, "tail": tail}
    return None


def dump(obj, st):
    return json.dumps(obj, ensure_ascii=st["ensure_ascii"], indent=st["indent"], separators=st["separators"]) + st["tail"]


def canon(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True)


def with_banner(old, banner):
    if old.startswith(MARK):
        cut = old.find("\n\n")
        old = "" if cut < 0 else old[cut + 2:]
    return banner + ("\n\n" + old if old else "")


def process(item):
    rel = item["file"]
    path = os.path.join(WF, rel)
    raw_b = open(path, "rb").read()
    raw = raw_b.decode("utf-8")
    g = json.loads(raw)
    st = detect_style(raw, g)
    assert st is not None, "原件无法逐字节回放,拒改"
    assert isinstance(g.get("nodes"), list), "不是 UI 格式(无 nodes 列表)"
    before = json.loads(raw)
    nodes = g["nodes"]
    banner = item["banner"]
    assert banner.startswith(MARK), "横幅未以 MARK 开头"

    if item["mode"] == "prepend":
        hosts = [n for n in nodes if n.get("id") == item["host_id"]]
        assert len(hosts) == 1, f"宿主 #{item['host_id']} 命中 {len(hosts)} 个"
        h = hosts[0]
        assert h.get("type") == item["host_type"], f"宿主类型 {h.get('type')} != {item['host_type']}"
        wv = h.get("widgets_values")
        assert isinstance(wv, list) and wv and isinstance(wv[0], str), "宿主 widgets_values[0] 不是文字"
        new_text = with_banner(wv[0], banner)
        changed = new_text != wv[0]
        wv[0] = new_text
        if "widgets_values_named" in h:
            named = h["widgets_values_named"]
            assert isinstance(named, dict) and set(named) == {"text"}, "宿主命名控件不是单一 text"
            assert isinstance(named["text"], str), "宿主命名控件 text 不是文字"
            new_named = with_banner(named["text"], banner)
            changed = changed or new_named != named["text"]
            named["text"] = new_named
        touched_id = h["id"]
    elif item["mode"] == "add":
        tagged = [n for n in nodes if (n.get("properties") or {}).get("manying_p2_mark") == NEW_NOTE_TAG]
        assert len(tagged) <= 1, "已有多张 P2 新增卡"
        if tagged:
            h = tagged[0]
            changed = h["widgets_values"][0] != banner
            h["widgets_values"][0] = banner
            touched_id = h["id"]
        else:
            placed = [n for n in nodes if isinstance(n.get("pos"), list) and len(n["pos"]) >= 2]
            right = max(n["pos"][0] + ((n.get("size") or [0, 0])[0] if isinstance(n.get("size"), list) else 0) for n in placed)
            top = min(n["pos"][1] for n in placed)
            x, y = int(right) + 80, max(int(top), 0)
            assert x >= 0 and y >= 0, "新卡落入负区"
            last = g.get("last_node_id")
            assert isinstance(last, int), "缺 last_node_id"
            nid = last + 1
            assert all(n.get("id") != nid for n in nodes), f"新 id {nid} 已占用"
            orders = [n.get("order") for n in nodes if isinstance(n.get("order"), int)]
            nodes.append({
                "id": nid,
                "type": "MarkdownNote",
                "pos": [x, y],
                "size": [560, 360],
                "flags": {},
                "order": (max(orders) + 1) if orders else 0,
                "mode": 0,
                "inputs": [],
                "outputs": [],
                "title": "标缺说明(P2 1127)",
                "properties": {"manying_p2_mark": NEW_NOTE_TAG},
                "widgets_values": [banner],
                "color": "#432",
                "bgcolor": "#653",
            })
            g["last_node_id"] = nid
            changed = True
            touched_id = nid
    else:
        raise AssertionError(f"未知处置 {item['mode']}")

    # 结构不变断言:连线/分组/子图定义/其余节点逐字段相同
    for k in ("links", "groups", "definitions", "extra"):
        assert canon(before.get(k)) == canon(g.get(k)), f"{k} 被改动"
    bn = {n.get("id"): n for n in before["nodes"]}
    an = {n.get("id"): n for n in g["nodes"]}
    for i, n in bn.items():
        if i == touched_id:
            text_fields = {"widgets_values"}
            if item["mode"] == "prepend" and "widgets_values_named" in n:
                expected_named = {"text": with_banner(n["widgets_values_named"]["text"], banner)}
                assert an[i]["widgets_values_named"] == expected_named, "宿主命名说明变化超出横幅"
                text_fields.add("widgets_values_named")
            assert canon({k: v for k, v in n.items() if k not in text_fields}) == canon({k: v for k, v in an[i].items() if k not in text_fields}), "宿主除文字外被改动"
            assert len(n.get("widgets_values") or []) == len(an[i].get("widgets_values") or []), "宿主 widgets_values 长度变了"
            assert canon((n.get("widgets_values") or [])[1:]) == canon((an[i].get("widgets_values") or [])[1:]), "宿主其他控件值被改动"
        else:
            assert canon(n) == canon(an.get(i)), f"节点 #{i} 被改动"
    extra_ids = set(an) - set(bn)
    assert extra_ids <= {touched_id}, f"多出节点 {extra_ids}"
    for k in set(before) | set(g):
        if k not in ("nodes", "last_node_id"):
            assert canon(before.get(k)) == canon(g.get(k)), f"顶层 {k} 被改动"

    out = dump(g, st).encode("utf-8")
    # 幂等自检:再跑一遍结果不变
    g2 = json.loads(out.decode("utf-8"))
    if item["mode"] == "prepend":
        h2 = next(n for n in g2["nodes"] if n.get("id") == item["host_id"])
        assert with_banner(h2["widgets_values"][0], banner) == h2["widgets_values"][0], "非幂等"
        if "widgets_values_named" in h2:
            text = h2["widgets_values_named"]["text"]
            assert with_banner(text, banner) == text, "命名说明非幂等"
    return {"file": rel, "changed": changed and out != raw_b, "before": raw_b, "after": out,
            "node": touched_id, "delta_bytes": len(out) - len(raw_b)}


def main():
    apply = "--apply" in sys.argv[1:]
    data = json.load(open(DATA, encoding="utf-8"))
    items = data["items"]
    ok, fail, results = 0, [], []
    for it in items:
        try:
            r = process(it)
            results.append(r)
            ok += 1
        except AssertionError as e:
            fail.append((it["file"], str(e)))
        except Exception as e:  # noqa: BLE001
            fail.append((it["file"], f"{type(e).__name__}: {e}"))
    changed = [r for r in results if r["changed"]]
    print(f"[{'APPLY' if apply else 'DRY-RUN'}] 件数 {len(items)} | 断言通过 {ok} | 失败 {len(fail)} | 需写入 {len(changed)}")
    for r in results:
        print(f"  {'改' if r['changed'] else '同'} {r['file']}  #{r['node']}  {r['delta_bytes']:+d}B")
    for f, e in fail:
        print(f"  FAIL {f}: {e}")
    if fail:
        print("有失败件:全部不落盘")
        return 1
    if not apply or not changed:
        return 0
    mp = os.path.join(BAK, "manifest.json")
    old = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {"files": []}
    tracked = {entry["file"]: entry for entry in old["files"]}
    assert len(tracked) == len(old["files"]), "备份清单有重复文件"
    # 续修只接受已登记的版本，并保留最早的原件和原件指纹。
    for r in changed:
        rel = r["file"]
        bp = os.path.join(BAK, rel)
        before_sha = sha256(r["before"])
        entry = tracked.get(rel)
        if entry:
            assert before_sha in (entry["sha256_before"], entry["sha256_after"]), f"工作树脱离已登记版本 {rel}"
            assert sha256(open(bp, "rb").read()) == entry["sha256_before"], f"原始备份指纹不符 {rel}"
        elif os.path.exists(bp):
            assert sha256(open(bp, "rb").read()) == before_sha, f"未登记备份的指纹不符 {rel}"
        assert open(os.path.join(WF, rel), "rb").read() == r["before"], f"并行改动 {rel}"

    for r in changed:
        bp = os.path.join(BAK, r["file"])
        os.makedirs(os.path.dirname(bp), exist_ok=True)
        if not os.path.exists(bp):
            with open(bp, "wb") as fh:
                fh.write(r["before"])
            assert sha256(open(bp, "rb").read()) == sha256(r["before"]), f"备份回读不符 {r['file']}"
        original_sha = tracked[r["file"]]["sha256_before"] if r["file"] in tracked else sha256(r["before"])
        tracked[r["file"]] = {"file": r["file"], "sha256_before": original_sha, "sha256_after": sha256(r["after"])}
    for r in changed:
        with open(os.path.join(WF, r["file"]), "wb") as fh:
            fh.write(r["after"])
    for r in changed:
        assert sha256(open(os.path.join(WF, r["file"]), "rb").read()) == sha256(r["after"]), f"回读不符 {r['file']}"
    with open(mp, "w", encoding="utf-8") as fh:
        json.dump({"schema": "bak-p2-1127/v1", "files": list(tracked.values())}, fh, ensure_ascii=False, indent=1)
    print(f"已写入 {len(changed)} 件;备份与清单: {os.path.relpath(BAK, R)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
