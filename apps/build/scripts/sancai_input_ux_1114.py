#!/usr/bin/env python3
"""三采输入区 UX v2(1114 用户斥「不合格」补全)
- [347] 桥出厂旁路化(修复手动直跑必填悬空雷:346旁路时347.video悬空=画布校验红)
- Note101 README v2:输入组逐节点操作详解 + 三种调用方式(App分镜/API直调/手动)
三面:repo+UI孪生;widgets参数零触碰。
"""
import json, sys

FILES = {
    'repo': '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json',
    'twin': '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.json',
}
TITLES = {
    9: "① 分镜帧(主图·必填·手动先取消旁路)",
    110: "② 参考图1", 111: "② 参考图2", 112: "② 参考图3", 113: "② 参考图4",
    341: "② 参考图5", 342: "② 参考图6", 343: "② 参考图7", 344: "② 参考图8",
    345: "④ 尾帧(可选·i2v首尾双锚)",
    346: "⑤ 参考视频(可选·须同画风)",
    14: "③ 提示词(必填·在此输入)",
    347: "⑤ 视频拆帧桥(与⑤联动)",
}
GUIDE = ("【在此输入提示词】\nintegrated_multimodal_description: <此处写镜头正文;"
         "引用参考图用 <Picture 2..9> 按挂接序;尾帧模式写「首帧→…→末帧」连续单镜头>\n"
         "overall_soundscape: <环境声>\nnon_diegetic_music: N/A\n"
         "——经漫影App派发时本栏自动注入,手动直跑才需填写")
README = """# 三采-单镜 · 使用说明

## 三种调用方式
**A. 分镜调用(App 正路,推荐)**:画布零操作——在漫影 App 分镜界面点生成,组装器自动注入①②③(参考清单≤8张自动截、装配提示词、五段前缀),三采段自动衔接。
**B. API 直调(开发)**:以 h3-three-stage-template.api.json 为底(段A=一二采/段B=三采)。注入点:[9].image 主图、[110-113/341-344].image 参考图、[14].value 提示词、[219].value(false=r2v/true=i2v)、[345].image 尾帧、[346].file 参考视频;阶梯直填 16/220/208/206 后删[22]。参考实现=frontend lib buildShotH3SancaiApiWorkflow。
**C. 手动直跑(画布调试)**:最简跑通=「①取消旁路并选图 + ③填正文」→ Queue,其余口保持旁路即合法。

## 输入组逐节点操作(手动视角;App/API 视角见括注)
| 节点 | 操作 |
|---|---|
| ① 分镜帧[9] | 取消旁路(选中 Ctrl+B)→「选择文件上传」选图。它是 r2v 的 Picture 1、i2v 的首帧。(App:自动注入分镜帧) |
| ② 参考图1-8[110-113/341-344] | 要几张开几张:各自取消旁路+选图,序号=挂接序 <Picture 2..9>;不开的保持旁路(悬空合法)。(App:按分镜引用清单自动填,≤8 超出截断) |
| ③ 提示词[14] | 点开替换骨架占位为正文(六段式已预置);参考图按挂接序引用。(App:装配文整体覆写本栏) |
| ④ 尾帧[345] | 仅 i2v 首尾双锚用:取消旁路+选「结束帧」,提示词写首→尾连续动作;不用保持旁路(合法) |
| ⑤ 参考视频[346]+拆帧桥[347] | 要用必须**两个一起**取消旁路,346 选 24fps、2-15 秒、同画风片段;只开 346 不开 347=桥悬空必跑红;都不用=都保持旁路(出厂态)。App:给了 videoRef 才注入,否则整链摘除 |
| 时长[20] Float(Duration) | 秒数,默认 5;帧数自动吸附 17k+5 网格(5s=124帧) |
| 画幅[22] Resolution Selector | 宽高比/百万像素/倍数;改画幅只动这里 |
| 种子[129] RandomNoise | seed=42 复现用;重摇改这里 |
| 帧数换算[131] 数学表达式 | 时长→帧数自动换算,勿动 |

## 输出
三档 mp4:p1 草稿 / p2 终档 / p3 超分终档;MyShot 回写台账。

## 为什么这样设计
三段阶梯=先快后精(8步起稿秒级出构图,3步精修出质感,超分到 2K);参考图走 TE 参考通道锁身份不占采样步;r2v/i2v 两臂经布尔开关懒切换。

## 注意点
1. 本链**无负向提示词口**——H3 视频体系不设负向通道,「避免什么」直接写进提示词正文
2. 参考图=超分+磨皮 4096 产物(图质越高视频越好);≥5张自动降参考尺寸(match)防显存崩,≤4张恒 max 高保真
3. 帧数恒落 17k+5 网格(默认124帧=5.17秒);seed=42 供复现
4. 模型/大节点勿动;三路调用均已实弹验证"""

def surgery(d):
    n = {x['id']: x for x in d['nodes']}
    for nid, title in TITLES.items():
        if nid in n:
            n[nid]['title'] = title
    # 347 桥出厂旁路化(手动路悬空雷根修)
    if 347 in n:
        n[347]['mode'] = 4
    n[14]['widgets_values'] = [GUIDE] + list(n[14]['widgets_values'][1:])
    if n[14].get('widgets_values_named'):
        for k in ('value', 'text'):
            if k in n[14]['widgets_values_named']:
                n[14]['widgets_values_named'][k] = GUIDE
    note = n[101]
    note['widgets_values'] = [README]
    if note.get('widgets_values_named') and 'text' in note['widgets_values_named']:
        note['widgets_values_named']['text'] = README
    note['size'] = [1650, 950]
    return True

if __name__ == '__main__':
    for tag, p in FILES.items():
        d = json.load(open(p, encoding='utf-8'))
        surgery(d)
        json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        n = {x['id']: x for x in d['nodes']}
        print(f"{tag}: README v2({len(README)}字) 347旁路化={n[347].get('mode')==4} ✅")
