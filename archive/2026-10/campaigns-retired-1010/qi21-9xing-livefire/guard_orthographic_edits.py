#!/usr/bin/env python3
"""正交机位轮守卫:幂等保八处(四型×正负)。--check 只验;--apply 缺则补。
只碰四型的 positive_text/negative_text,其余字段(含他会话的 system_prompt_zh 等)一律不碰。"""
import json,sys
J="apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
PLAN={
 "道具":("机位正侧面平视，器物各面平行于画面，轮廓比例忠实可量。","透视变形，角度歪斜，俯视仰视，透视缩短，镜头倾斜"),
 "多视图":("各视图正交平视，正、侧、背面平行于画面，比例逐面一致。","透视，视角歪斜，俯仰机位，各面比例漂移"),
 "高清人脸":("正面平视机位，视线直视镜头。","透视变形，仰拍俯拍，头部歪斜，广角畸变"),
 "表情差分":("正脸平视机位，九格机位一致，仅表情变化。","机位漂移，透视，头颈歪斜，俯仰"),
}
d=json.loads(open(J,encoding="utf-8").read())
missing=[]
for t in d["types"]:
    zh=t.get("zh")
    if zh not in PLAN: continue
    pos,neg=PLAN[zh]
    if pos not in t["positive_text"]: missing.append(zh+"·正向")
    if neg not in t["negative_text"]: missing.append(zh+"·负向")
if "--check" in sys.argv:
    print("OK 八处在位" if not missing else "MISSING: "+",".join(missing)); sys.exit(0 if not missing else 1)
if missing:
    for t in d["types"]:
        zh=t.get("zh")
        if zh not in PLAN: continue
        pos,neg=PLAN[zh]
        body=t["positive_text"]
        if pos not in body:
            i=body.find("。"); t["positive_text"]=body[:i+1]+pos+body[i+1:]
        if neg not in t["negative_text"]:
            t["negative_text"]=t["negative_text"]+("，" if t["negative_text"] and not t["negative_text"].endswith("，") else "")+neg
    open(J,"w",encoding="utf-8").write(json.dumps(d,ensure_ascii=False,indent=2))
    print("自愈完成,补回:",",".join(missing))
else:
    print("无需自愈,八处在位")
