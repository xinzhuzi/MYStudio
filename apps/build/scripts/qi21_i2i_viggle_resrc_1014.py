#!/usr/bin/env python3
"""qi21-道劫-i2i viggle 正源回切手术(2026-10-14 深夜,鉴别矩阵定谳后修复弹)。

定谳链(1014 五探针矩阵+云端视觉终审):
  E2(直出40,双参考)=实体 / E3(σ链9步双段,单参考)=实体+金纹换袍成功 /
  E、E4(σ链6/9步,双参考)、E5(旧式6步,双参考)=纯黑+alpha0。
→ **0928 铁案不翻:少步蒸馏×多参考拼接=黑屏;σ表无罪**(旧形态黑=合并式LoRA×双参考,
  E5 复现原案;σ链黑=σ表×双参考,同象异因)。E 弹「色彩回正」判词系幻觉判图作废
  (Read 图像被服务端丢弃,判效已改机器指标 img_stat_1014.py+云端视觉二审)。

修复=保 σ链 9步双段(色彩/速度增益实证),正源回切单参考:
  [7019]/[7022] BasicGuider.conditioning:边界 positive(槽1)→positive_single(槽3)
  配套:测试锚 vig_pos_asg 撤回(断言器 viggle 档正源回 [171]);
  [402] 正源沿革段补 1014 定谳句(双参考黑=少步×拼接,与调度无关)。
蓝图不涉。fail-closed;幂等:conditioning 已指槽3 即拦停 exit 3。
"""
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"

NOTE_EDITS = [
    ("两段 conditioning=[6].positive 多参考正源(1014 回切:色彩真源回归参考图继承,Fun-Acc 仍单参考)。",
     "两段 conditioning=[6].positive_single 单参考正源(1014 定谳:五探针矩阵实证**少步蒸馏×多参考拼接=黑屏**(σ链/合并式 LoRA 双双落黑,alpha0),0928 铁案不翻、σ表无罪——σ链9步双段在单参考下出真图且金纹换袍成功(E3 实弹+云端视觉终审);多参考全效恒=直出40步档)。"),
    ("直出支路 [7010].positive=宿主 positive(多参考至多三图=「1 · 直出40步」档官方路零改动,1010 三槽收口=viggle 官方 1-3 张口径)/viggle 档 [7012] 段=宿主 positive(1014 回切多参考:σ表挂正后色彩真源=参考图继承)/Fun-Acc 档 [7013].positive=宿主 positive_single(单参考)——正源差异内聚进各支路(0929 S3 起正源经加速子图边界槽分线直入,语义零改动)。",
     "直出支路 [7010].positive=宿主 positive(多参考至多三图=「1 · 直出40步」档官方路零改动,1010 三槽收口=viggle 官方 1-3 张口径)/viggle·Fun-Acc 两加速档=宿主 positive_single(单参考;1014 定谳:少步×多参考=黑,双加速档恒单参考)——正源差异内聚进各支路(0929 S3 起正源经加速子图边界槽分线直入,语义零改动)。"),
]


def fail(m, code=2):
    print(f"[resrc] FAIL: {m}")
    sys.exit(code)


def main():
    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if "加速" in s["name"])
    ns = {n["id"]: n for n in sg["nodes"]}
    ls = {l["id"]: l for l in sg["links"]}
    for nid in (7019, 7022):
        if nid not in ns or ns[nid]["type"] != "BasicGuider":
            fail(f"[{nid}] 非 BasicGuider(术前态不符)")
    conds = []
    for nid in (7019, 7022):
        inp = next(i for i in ns[nid]["inputs"] if i["name"] == "conditioning")
        conds.append(ls[inp["link"]])
    if all(c["origin_slot"] == 3 for c in conds):
        print("[resrc] 已是单参考正源,幂等拦停")
        sys.exit(3)
    if not all(c["origin_id"] == -10 and c["origin_slot"] == 1 for c in conds):
        fail(f"术前 conditioning 非边界 positive 槽:{[(c['origin_id'], c['origin_slot']) for c in conds]}")

    # 切槽:线 24/33 origin_slot 1→3(positive→positive_single;linkIds 同步)
    for c, lid in zip(conds, (24, 33)):
        c["origin_slot"] = 3
    for k, io in enumerate(sg["inputs"]):
        want = sorted(l["id"] for l in sg["links"] if l["origin_id"] == -10 and l["origin_slot"] == k)
        io["linkIds"] = want

    note = next(n for n in wf["nodes"] if n["id"] == 402)["widgets_values"]
    for old, new in NOTE_EDITS:
        if old not in note[0]:
            fail(f"[402] 锚缺失:{old[:50]}…")
        note[0] = note[0].replace(old, new)

    # 终验
    reread = lambda: json.loads(WF.read_text(encoding="utf-8"))
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    d = reread()
    s2 = next(s for s in d["definitions"]["subgraphs"] if "加速" in s["name"])
    n2 = {n["id"]: n for n in s2["nodes"]}
    l2 = {l["id"]: l for l in s2["links"]}
    for nid in (7019, 7022):
        inp = next(i for i in n2[nid]["inputs"] if i["name"] == "conditioning")
        c = l2[inp["link"]]
        assert c["origin_id"] == -10 and c["origin_slot"] == 3, f"[{nid}] 回读未落槽3"
    assert s2["inputs"][1]["linkIds"] and s2["inputs"][3]["linkIds"], "边界槽 linkIds 失衡"
    print("[resrc] 完成:段A/B conditioning→positive_single(槽3);σ链9步双段保留;[402] 定谳句两段随刀。")


if __name__ == "__main__":
    main()
