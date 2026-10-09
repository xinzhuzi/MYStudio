#!/usr/bin/env python3
"""道劫·加速子图 组框分组 + [7016] 升格子图说明(1008;用户令)。

①加速子图内加 5 组框(家规=富描述标题,组框罩得住成员 est 盒):
  ①Fun-Acc 支路 [7013] / ②viggle v0.3 官方6σ 支路 [7011/7019/7017/7018/7020/7012]
  / ③直出40步支路 [7010] / ④seed 单源 [7014] / ⑤档位选择 [7015]。
②[7016] 负向生效档位 → 子图说明:标题改「[7016] 子图说明·加速档位」,挪到
  子图入口(-10 槽上方),正文=子图功能全描述;契约锚定 4 token
  (负向仅档1/直出40步 cfg4/档0 FunAcc 无负槽/蒸馏件 cfg恒1 负向无效)逐字保留。
fail-closed:恰N断言(组框 0→5/note 在场/token 在场)。
后续终态(1008 同日二次手术,inline 补丁):②拆 ②a主链[760,640,1030,490]+②σ链件
id96[760,1140,570,760](消与③重叠);说明框终位 [80,80](负区口径 y≥80);
契约重锚 3 处推翻 1001 ③「不要分组」令=随 1008 新令(112 绿)。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BAK = REPO / "apps/build/scripts/backups/qi21_viggle_v03_official_1008"

SG_NAME = "道劫·加速子图"
TOKENS = ("负向仅档1", "直出40步 cfg4", "档0 FunAcc 无负槽", "蒸馏件 cfg恒1 负向无效")
NOTE_TEXT = (
    "道劫·加速子图=三支路并行加速档+seed 单源+档位选择单点汇流"
    "(宿主面板=速度档位/seed;未选支路懒执行零加载)。\n"
    "三支路:①档0 FunAcc 无负槽=[7013] T8 一体采样 4 步;"
    "②档1 直出40步 cfg4=[7010] KSampler,负向仅档1(直出40步 cfg4)生效;"
    "③档2 viggle v0.3 官方6σ=[7011 LoRA r256]→[7019 BasicGuider 单正条件]"
    "→[7012 SamplerCustomAdvanced]+[7017 noise/7018 euler/7020 6σ插值0],"
    "蒸馏件 cfg恒1 负向无效。\n"
    "[7014] seed 单源三用=FunAcc seed/viggle noise_seed/直出 seed;"
    "三支路汇 [7015] 单点出 LATENT。"
)

GROUPS = [
    (91, "道劫·加速子图·①Fun-Acc 支路([7013] T8 一体采样 4 步,cfg1 无负槽;seed=面板单源)",
     [1340, 80, 560, 375], "#466a8c"),
    (92, "道劫·加速子图·②viggle v0.3 官方6σ 支路([7011]LoRA r256→[7019]BasicGuider cfg1 单正条件"
     "→[7012]SamplerCustomAdvanced;[7017]noise/[7018]euler/[7020]官方6σ插值0;负向不接=蒸馏件 cfg恒1 负向无效)",
     [760, 640, 1030, 1245], "#4d9e6a"),
    (93, "道劫·加速子图·③直出40步支路([7010]KSampler cfg4=负向真实生效档)",
     [1340, 1600, 500, 375], "#8c6a46"),
    (94, "道劫·加速子图·④seed 单源([7014] PrimitiveInt 面板外露,三用扇出)",
     [30, 1090, 340, 230], "#6a4d8c"),
    (95, "道劫·加速子图·⑤档位选择([7015] MyQi21SpeedSelect 单点汇流出 LATENT)",
     [2040, 840, 480, 250], "#8c465e"),
]


def main() -> None:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    sgs = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    assert len(sgs) == 1
    sg = sgs[0]
    nodes = {n["id"]: n for n in sg["nodes"]}

    assert sg.get("groups") == [], f"子图已有组框 {sg.get('groups')}(重复手术?)"
    assert 7016 in nodes and nodes[7016]["type"] == "Note"
    old_txt = nodes[7016]["widgets_values"][0]
    for tok in TOKENS:
        assert tok in old_txt, f"旧 Note 缺锚定 token {tok!r}"

    shutil.copy2(WF, BAK / (WF.stem + ".pre_groups.json"))

    sg["groups"] = [
        {"id": gid, "title": title, "bounding": bounding, "color": color, "flags": {}}
        for gid, title, bounding, color in GROUPS
    ]

    n16 = nodes[7016]
    n16["pos"] = [80, 40]
    n16["size"] = [560, 240]
    n16["title"] = "[7016] 子图说明·加速档位"
    n16["widgets_values"] = [NOTE_TEXT]
    n16["widgets_values_named"] = {"text": NOTE_TEXT}

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # 后验(写盘后从盘上读回)
    sg2 = [s for s in json.loads(WF.read_text(encoding="utf-8"))["definitions"]["subgraphs"]
           if s.get("name") == SG_NAME][0]
    assert len(sg2["groups"]) == 5, f"组框数应 5,得 {len(sg2['groups'])}"
    new_txt = [n for n in sg2["nodes"] if n["id"] == 7016][0]["widgets_values"][0]
    for tok in TOKENS:
        assert tok in new_txt, f"新说明丢锚定 token {tok!r}"
    print("[OK] 5 组框 + [7016] 子图说明完成")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
