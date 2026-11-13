#!/usr/bin/env python3
"""三采输入区 UX 手术(1114 用户投诉实弹:输入节点被线犁/无引导/Note埋组内)
1. 输入锚打序号标题(客户一眼识输入口)
2. [14] 提示词注入引导占位文(App派发时覆写,双面同步)
3. Note101 → README(功能/输入/输出/设计/好处/注意/使用)并移出所有组框
三面:repo真源+UI孪生;标题/占位属显示层,widgets参数零触碰。
"""
import json, sys

FILES = {
    'repo': '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json',
    'twin': '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.json',
}
TITLES = {
    9: "① 分镜帧(主图·必填)",
    110: "② 参考卡1", 111: "② 参考卡2", 112: "② 参考卡3", 113: "② 参考卡4",
    341: "② 参考卡5", 342: "② 参考卡6", 343: "② 参考卡7", 344: "② 参考卡8",
    345: "④ 尾帧(可选·i2v首尾双锚)",
    346: "⑤ 参考视频(可选·须同画风)",
    14: "③ 提示词(必填·在此输入)",
    347: "视频拆帧桥(参考视频→帧)",
}
GUIDE = ("【在此输入提示词】\nintegrated_multimodal_description: <此处写镜头正文;"
         "引用参考卡用 <Picture 2..9> 按挂接序;尾帧模式写「首帧→…→末帧」连续单镜头>\n"
         "overall_soundscape: <环境声>\nnon_diegetic_music: N/A\n"
         "——经漫影App派发时本栏自动注入,手动直跑才需填写")
README = """# 三采-单镜 · 使用说明
## 功能
单镜头三段链出片:一采 960×544 快出运动构图 → 二采 1440×832 TaoMate 精修 → 三采 ReCaVSR 超分 2880×1664 终档;图生视频双模(多参考 r2v / 首尾帧 i2v),原生音轨。

## 输入(按序号)
- ① 分镜帧(主图,必填):出厂旁路,漫影App自动注入;手动直跑=取消旁路并选图
- ② 参考卡 1-8(可选,身份锁):按序对应 <Picture 2..9>;引擎异图上限 8,超出自适应截断
- ③ 提示词(必填):六段式/integrated_multimodal_description;参考引用按挂接序编号
- ④ 尾帧(可选):i2v 首尾双锚,提示词写首→尾连续路径
- ⑤ 参考视频(可选):动作/节奏参考,务必同画风(写实视频会把成片带成写实)

## 输出
三档 mp4:p1 草稿 / p2 终档 / p3 超分终档;MyShot 回写台账。

## 为什么这样设计
三段阶梯=先快后精(8步起稿秒级出构图,3步精修出质感,超分出2K);参考卡走 TE 参考通道锁身份不占采样步;一采两臂(r2v/i2v)经布尔开关懒切换。

## 注意点
1. 本链**无负向提示词口**——H3 视频体系不设负向通道,「避免什么」直接写进提示词正文
2. 参考图=超分+磨皮 4096 产物(图质越高视频越好);≥5张自动降参考尺寸(match)防显存崩,≤4张恒 max 高保真
3. 帧数恒落 17k+5 网格(默认124帧=5.17秒);seed=42 供复现
4. 模型/大节点勿动;改提示词与选图即可出片"""

def surgery(d):
    n = {x['id']: x for x in d['nodes']}
    for nid, title in TITLES.items():
        if nid in n:
            n[nid]['title'] = title
    # [14] 引导占位(双面)
    n[14]['widgets_values'] = [GUIDE] + list(n[14]['widgets_values'][1:])
    if n[14].get('widgets_values_named'):
        n[14]['widgets_values_named']['value'] = GUIDE
        if 'text' in n[14]['widgets_values_named']:
            n[14]['widgets_values_named']['text'] = GUIDE
    # Note101 → README + 移出组(位置由布局pass定,此处先给默认)
    note = n[101]
    note['widgets_values'] = [README]
    if note.get('widgets_values_named') and 'text' in note['widgets_values_named']:
        note['widgets_values_named']['text'] = README
    note['size'] = [1500, 780]
    return True

if __name__ == '__main__':
    for tag, p in FILES.items():
        d = json.load(open(p, encoding='utf-8'))
        surgery(d)
        json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        n = {x['id']: x for x in d['nodes']}
        print(f"{tag}: 标题{len(TITLES)}件 [14]引导注入 Note101=README({len(README)}字) ✅")
