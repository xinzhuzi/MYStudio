#!/usr/bin/env python3
"""1118 QI21 道劫-角色设定卡 t2i/i2i 画布重排（node-graph 立宪 est 口径）。

只改 nodes[].pos 与 groups[].bounding；links/size/widgets/其它字段逐字节不变。
幂等：终态 -> 0 不写；修前态 -> 落盘（0）；两种都不是 -> 1 且一个字节都不写。

POS 单源（列 x / 行 y 由 C/X/ROWS 推得，表内为终值）：
  note 80 | c0 680 | c1 1300 | c2 1960 | c3 2460 | c4 3000
  e 3500 | l 4160(+100 让开 TE->KSampler 走线) | s 4660 | d 5200 | comp 5700 | save 6320
  行：臂1..臂6 700..2950(450)，臂7 3600 / 臂8 4050（+200 换分组间隙），
      gen3 4650/5100/5550/6000/6450（+600 分带）
  行序 = 10,35,15,20,25,30,40,45,70,80,90,100,110（与 ③六路/④武器/⑦表情 分组边界一致）
与修前态对照（layout_check）：
  t2i crossings 1377->1385  occlusion 84->36  est_spacing 57->0  negative 10->0
  i2i crossings 1419->1411  occlusion 85->36  est_spacing 58->0  negative 11->0
  两件 est_overlap=0 group_overlap=0 leftward 与修前同数（66 结构性右置，见 2c20be26 先例）
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WF_DIR = ROOT / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/5_角色设定卡"
INDENT = 2
TRAILING_NL = True

TARGETS = ["道劫-角色设定卡-t2i.json", "道劫-角色设定卡-i2i.json"]

X = {"note": 80, "c0": 680, "c1": 1300, "c2": 1960, "c3": 2460, "c4": 3000,
     "e": 3500, "l": 4160, "s": 4660, "d": 5200, "comp": 5700, "save": 6320}
ROWS = [700, 1150, 1600, 2050, 2500, 2950, 3600, 4050, 4650, 5100, 5550, 6000, 6450]
ARM_ROWS = [10, 35, 15, 20, 25, 30, 40, 45, 70, 80, 90, 100, 110]

POS_NEW = {
    1: (X["c0"], 80), 2: (X["c0"], 428), 3: (X["c0"], 806), 4: (X["c0"], 1184),
    52: (X["note"], 7600), 55: (X["c0"], 2600), 60: (X["c0"], 4000),
    5: (X["c1"], 80), 6: (X["c2"], 380), 7: (X["c3"], 80), 8: (X["c4"], 80),
    65: (X["d"], 80), 66: (X["d"], 308),
    50: (X["comp"], 9600), 51: (X["save"], 9700),
}
for _i, _te in enumerate(ARM_ROWS):
    for _col, _nid in zip(("e", "l", "s", "d"), range(_te, _te + 4)):
        POS_NEW[_nid] = (X[_col], ROWS[_i] + (100 if _col == "l" else 0))

POS_OLD = {
    1: (-2167.4237307646004, 100.1010751671982),
    2: (-2167.4237307646004, 280.1010751671987),
    3: (-2167.4237307646004, 460.10107516719887),
    4: (-2167.4237307646004, 660.101075167199),
    5: (-1202.9183005638831, 1870.8517509433),
    6: (-685.0715930027725, 1982.5663528534),
    7: (-296.80358070034583, 1897.775559334413),
    8: (122.70393024904442, 1940.021967975658),
    65: (3060, 60), 66: (3060, 300),
    60: (-2115.023485268391, 3105.4584854474574),
    55: (-1189.447290990257, 1902.047381415178),
    50: (4165.870508204913, 1691.9195619472232),
    51: (4665.870508204917, 1871.9195619472232),
    52: (-205.4332865884017, -486.46944368716856),
}
for _r, _y in ((560, 10), (980, 15), (1400, 20), (1820, 25), (2240, 30), (2660, 35),
               (3080, 40), (3500, 45), (5260, 70), (5680, 80), (6100, 90),
               (6520, 100), (6940, 110)):
    for _x, _nid in ((1260, _y), (1770, _y + 1), (2130, _y + 2), (2530, _y + 3)):
        POS_OLD[_nid] = (_x, _r)

# 组框：键=现有 title 前两字符；值=(修前 bounding, 修后 bounding)，[x, y, w, h]
GROUP_OLD = {
    "⑥ ": [-2273.732980004866, 2938.095227775834, 731.6793701082893, 870.5104728063475],
    "① ": [-2207.4237307646, 40.10107516719826, 660, 760],
    "② ": [-1249.447290990257, 1782.0473814151778, 1740, 480],
    "③ ": [1220, 500, 1720, 2400],
    "④ ": [1220, 3020, 1720, 900],
    "⑦ ": [1220, 5160, 1720, 2500],
    "①b": [3000, -60, 900, 560],
    "⑤ ": [4105.870508204909, 1611.9195619472232, 1100, 780],
}
GROUP_NEW = {
    "⑥ ": [640, 3940, 500, 784],
    "① ": [640, 20, 420, 1372],
    "② ": [1260, 20, 2080, 598],
    "③ ": [3460, 640, 2080, 2740],
    "④ ": [3460, 3540, 2080, 940],
    "⑦ ": [3460, 4590, 2080, 2290],
    "①b": [5160, 20, 420, 556],
    "⑤ ": [5660, 9540, 1040, 740],
}


class Fail(Exception):
    pass


def _eq(a, b):
    return abs(float(a) - float(b)) <= 1e-6


def _box_eq(a, b):
    return len(a) == len(b) == 4 and all(_eq(x, y) for x, y in zip(a, b))


def _dump(wf):
    return json.dumps(wf, ensure_ascii=False, indent=INDENT) + ("\n" if TRAILING_NL else "")


def plan(name):
    path = WF_DIR / name
    raw = path.read_text(encoding="utf-8")
    wf = json.loads(raw)
    if _dump(wf) != raw:
        raise Fail("JSON 序列化往返与原字节不一致（缩进/尾换行口径变化），拒绝改写")

    nodes = {n["id"]: n for n in wf["nodes"]}
    unknown = set(nodes) - set(POS_NEW)
    if unknown:
        raise Fail("发现坐标表未覆盖的节点：%s" % sorted(unknown))

    pos_state, bad = set(), []
    for nid, node in nodes.items():
        cur = node["pos"]
        if len(cur) != 2:
            raise Fail("节点 %s pos 非二维：%r" % (nid, cur))
        if _eq(cur[0], POS_NEW[nid][0]) and _eq(cur[1], POS_NEW[nid][1]):
            pos_state.add("new")
        elif _eq(cur[0], POS_OLD[nid][0]) and _eq(cur[1], POS_OLD[nid][1]):
            pos_state.add("old")
        else:
            bad.append((nid, cur))
    if bad:
        raise Fail("节点坐标既非修前态也非修后态：%s" % bad[:6])
    if len(pos_state) != 1:
        raise Fail("节点坐标处于修前/修后混合态（部分已改），拒绝继续")

    grp_state, seen = set(), []
    for g in wf.get("groups", []):
        key = g.get("title", "")[:2]
        if key not in GROUP_NEW:
            raise Fail("分组未登记：%r" % g.get("title"))
        seen.append(key)
        if _box_eq(g["bounding"], GROUP_NEW[key]):
            grp_state.add("new")
        elif _box_eq(g["bounding"], GROUP_OLD[key]):
            grp_state.add("old")
        else:
            raise Fail("分组 %s bounding 既非修前也非修后：%r" % (key, g["bounding"]))
    if sorted(seen) != sorted(GROUP_NEW):
        raise Fail("分组集合与登记表不一致：%s" % sorted(seen))
    if len(grp_state) != 1:
        raise Fail("分组处于修前/修后混合态，拒绝继续")
    if pos_state != grp_state:
        raise Fail("节点坐标态(%s)与分组态(%s)不一致" % (pos_state, grp_state))

    state = pos_state.pop()
    if state == "new":
        return path, wf, "new"
    for nid, node in nodes.items():
        node["pos"] = [POS_NEW[nid][0], POS_NEW[nid][1]]
    for g in wf["groups"]:
        g["bounding"] = list(GROUP_NEW[g["title"][:2]])
    return path, wf, "old"


def main(argv):
    if len(argv) != 2 or argv[1] not in ("--check", "--apply"):
        print("usage: %s --check|--apply" % argv[0], file=sys.stderr)
        return 2
    apply = argv[1] == "--apply"
    rc = 0
    for name in TARGETS:
        try:
            path, wf, state = plan(name)
        except Fail as exc:
            print("FAIL %s: %s" % (name, exc))
            rc = 1
            continue
        if state == "new":
            print("SKIP %s: 已是终态" % name)
            continue
        if not apply:
            print("PLAN %s: 修前态 -> 终态（%d 节点 + %d 组框）" % (name, len(wf["nodes"]), len(wf["groups"])))
            continue
        path.write_text(_dump(wf), encoding="utf-8")
        print("WROTE %s" % name)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
