#!/usr/bin/env python3
"""程序化烘焙 HaldCLUT 胶片风 LUT 集（Trellis 08-18-haldclut-grade）。

背景：交接文档建议的两个 LUT 源（cedeber/hald-clut=GPL-3.0 且内部含 Apple/
Pixelmator 专有条款；G'MIC 系=CECILL 系）均不过 D4 门槛（CC0/MIT/Apache/BSD/
CC-BY-4.0）——改自生成：胶片风调色数学烘焙为 HaldCLUT PNG，零许可风险。
命名标注 film-*-（灵感来自胶片风，非型号仿真），诚实口径。

LUT 排列（与 GLGradeLayer shader 采样公式配对，自洽即可）：
  512×512 PNG，8×8 块网格；块(bx,by) 选蓝色通道 b=(by*8+bx)/63 均匀 64 级；
  块内 64×64：行=绿色 g=row/63，列=红色 r=col/63。
  采样：lut(uv) → 块坐标=vec2(mod(uv.x*8,1), floor(uv.x*8)/8...) 见 shader 注释。

用法: python3 apps/build/scripts/generate-luts.py  # 幂等重烘
"""
import pathlib
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / "frontend/assets/luts"
GRID = 8      # 8×8 块
RES = 64      # 块内 64×64（即 RGB 各 64 级）
SIZE = GRID * RES  # 512


def clamp01(x):
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def smooth(x):
    # 平滑色彩曲线基底
    return x * x * (3 - 2 * x)


def lift_gain_gamma(rgb, lift=0.0, gain=1.0, gamma=1.0):
    return [clamp01((max(c, 0.0) + lift) * gain) ** gamma for c in rgb]


def mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def saturation(rgb, s):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return [clamp01(l + (c - l) * s) for c in rgb]


def split_tone(rgb, shadow_tint, highlight_tint, amount):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    tint = mix(shadow_tint, highlight_tint, smooth(l))
    return [clamp01(c + (t - 0.5) * amount * 2 * (0.4 + 0.6 * (1 - abs(l - 0.5) * 2)))
            for c, t in zip(rgb, tint)]


def make_teal_orange(rgb):
    c = lift_gain_gamma(rgb, lift=0.008, gain=1.04, gamma=0.96)
    c = split_tone(c, shadow_tint=(0.36, 0.50, 0.56), highlight_tint=(1.0, 0.94, 0.82), amount=0.22)
    return saturation(c, 1.12)


def make_fuji_cool(rgb):
    c = lift_gain_gamma(rgb, lift=0.012, gain=1.02, gamma=1.04)
    c = split_tone(c, shadow_tint=(0.42, 0.52, 0.62), highlight_tint=(0.94, 0.97, 1.0), amount=0.18)
    return saturation(c, 0.94)


def make_kodak_warm(rgb):
    c = lift_gain_gamma(rgb, lift=0.014, gain=1.05, gamma=0.92)
    c = split_tone(c, shadow_tint=(0.48, 0.42, 0.36), highlight_tint=(1.0, 0.9, 0.76), amount=0.24)
    return saturation(c, 1.08)


def make_bleach_bypass(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    c = mix(rgb, [l, l, l], 0.55)
    c = lift_gain_gamma(c, lift=-0.02, gain=1.28, gamma=0.88)
    return saturation(c, 0.62)


def make_sepia_ink(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    sep = [clamp01(l * 1.02), clamp01(l * 0.88), clamp01(l * 0.66)]
    return mix(rgb, sep, 0.8)


def make_cyan_mist(rgb):
    c = lift_gain_gamma(rgb, lift=0.02, gain=0.98, gamma=1.06)
    c = mix(c, [c[0] * 0.9 + 0.06, c[1] * 0.98 + 0.05, c[2] * 1.0 + 0.09], 0.7)
    return saturation(c, 0.86)


def make_mute_sage(rgb):
    c = lift_gain_gamma(rgb, lift=0.01, gain=0.97, gamma=1.02)
    c = split_tone(c, shadow_tint=(0.38, 0.44, 0.40), highlight_tint=(0.92, 0.95, 0.88), amount=0.16)
    return saturation(c, 0.78)


def make_noir_contrast(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    l = clamp01((l - 0.5) * 1.35 + 0.5)
    return [l, l, l]


LUTS = {
    "film-teal-orange": (make_teal_orange, "经典电影橙青对比（暗部青、亮部暖橙）"),
    "film-fuji-cool": (make_fuji_cool, "富士冷调（青蓝阴影、柔和高光）"),
    "film-kodak-warm": (make_kodak_warm, "柯达暖调（琥珀高光、暖褐阴影）"),
    "film-bleach-bypass": (make_bleach_bypass, "漂白旁路（低饱和高对比）"),
    "film-sepia-ink": (make_sepia_ink, "旧纸墨棕（宣纸陈色，道劫向）"),
    "film-cyan-mist": (make_cyan_mist, "青雾（低对比冷雾感）"),
    "film-mute-sage": (make_mute_sage, "灰绿低饱和（水墨淡彩向）"),
    "film-noir-contrast": (make_noir_contrast, "黑白高对比"),
}




# ── 24 张中国风传统色卡（08-19 扩集,总 32 张）─────────────────────────────
# 参数化变换:lift/gain/gamma + 分离色调(暗部/亮部 tint+强度) + 饱和度 + 可选单色混入。
# 命名 cn-*(传统色);描述=情绪+场景,供 AI 选卡参考(LUT_GUIDE 自动派生)。
CN_LUTS = {
  "cn-yuebai":       (0.018, 1.05, 1.02, 0.86, (0.44, 0.52, 0.62), (0.96, 0.98, 1.02), 0.20, 0.0,
                      "月白:清冷月光色,微蓝近白——孤寂月下/仙侠夜景/诀别清辉,情绪清冷纯净"),
  "cn-daiqing":      (0.006, 1.00, 1.05, 0.88, (0.34, 0.44, 0.52), (0.90, 0.95, 0.98), 0.24, 0.0,
                      "黛青:深青带黑的沉静色——庭院文戏/忧郁沉思/雨夜,情绪内敛克制"),
  "cn-yuanshandai":  (0.026, 0.96, 1.06, 0.78, (0.40, 0.47, 0.52), (0.90, 0.93, 0.94), 0.18, 0.0,
                      "远山黛:雾霭青灰,层次退淡——山水远景/苍茫大势/前路未卜,情绪辽远怅惘"),
  "cn-yaqing":       (-0.008, 0.98, 1.06, 0.82, (0.28, 0.36, 0.46), (0.84, 0.90, 0.96), 0.28, 0.0,
                      "鸦青:深郁冷暗的鸦羽色——夜行/阴谋暗流/压抑对峙,情绪沉郁警觉"),
  "cn-zhuqing":      (0.012, 1.02, 1.00, 0.95, (0.36, 0.50, 0.42), (0.94, 1.00, 0.92), 0.20, 0.0,
                      "竹青:清雅竹叶青绿——竹林打斗/春夏生机/闲适清谈,情绪轻快疏朗"),
  "cn-tianshuibi":   (0.030, 1.03, 0.98, 0.90, (0.44, 0.56, 0.54), (0.97, 1.02, 1.00), 0.16, 0.0,
                      "天水碧:雨后浅碧如水——晨光初照/少女轻盈/新芽初绽,情绪明净希望"),
  "cn-qingmei":      (0.018, 1.04, 0.97, 1.00, (0.46, 0.48, 0.30), (1.04, 0.98, 0.74), 0.24, 0.0,
                      "青梅:微酸的青黄果子色——初夏悸动/青春萌动/酸涩初恋,情绪青涩微甜"),
  "cn-qiuxiang":     (0.014, 1.01, 1.00, 0.88, (0.40, 0.42, 0.32), (1.00, 0.96, 0.80), 0.22, 0.0,
                      "秋香:秋叶黄绿相间——秋日庭园/迟暮温情/收获时节,情绪温厚感怀"),
  "cn-xiangse":      (0.022, 1.02, 0.97, 0.84, (0.44, 0.42, 0.36), (1.00, 0.94, 0.82), 0.20, 0.0,
                      "缃色:浅黄帛书之色——古籍书香/师徒传道/温暖回忆,情绪质朴安然"),
  "cn-tenghuang":    (0.020, 1.06, 0.95, 1.05, (0.46, 0.42, 0.30), (1.02, 0.96, 0.78), 0.24, 0.0,
                      "藤黄:明亮的中国画黄——盛夏骄阳/炽热争夺/金光法阵,情绪浓烈灼热"),
  "cn-zhusha":       (0.012, 1.04, 0.98, 1.02, (0.42, 0.34, 0.34), (1.02, 0.90, 0.82), 0.26, 0.0,
                      "朱砂:正红矿石色,热烈而不俗——宗门大典/拜堂喜庆/血性觉醒,情绪庄重炽盛"),
  "cn-yanzhi":       (0.024, 1.03, 0.98, 0.98, (0.46, 0.36, 0.40), (1.00, 0.90, 0.88), 0.24, 0.0,
                      "胭脂:红蓝花妆色——红妆旖旎/情愫暗生/镜前梳妆,情绪妩媚柔艳"),
  "cn-jiangzi":      (0.008, 0.99, 1.04, 0.86, (0.36, 0.32, 0.44), (0.94, 0.88, 0.98), 0.26, 0.0,
                      "绛紫:华贵深沉之紫——权贵殿堂/神秘仪式/暮年威仪,情绪威严莫测"),
  "cn-ouhe":         (0.028, 1.01, 1.00, 0.84, (0.44, 0.40, 0.48), (0.98, 0.94, 1.00), 0.18, 0.0,
                      "藕荷:淡紫粉灰如荷花根——温柔梦境/淡淡愁绪/闺中私语,情绪轻柔怅然"),
  "cn-mushanzi":     (0.016, 0.99, 1.04, 0.82, (0.34, 0.36, 0.50), (0.94, 0.88, 1.00), 0.26, 0.0,
                      "暮山紫:暮霭映山的紫蓝——黄昏离别/苍茫远望/尘埃落定,情绪苍茫不舍"),
  "cn-shiyangjin":   (0.014, 1.04, 0.97, 1.10, (0.42, 0.36, 0.34), (1.02, 0.94, 0.84), 0.22, 0.0,
                      "十样锦:织锦彩缎的饱和典雅——繁华市井/盛会游街/锦绣华服,情绪热闹富丽"),
  "cn-huanglu":      (0.012, 1.00, 1.02, 0.90, (0.40, 0.36, 0.28), (0.98, 0.90, 0.74), 0.24, 0.0,
                      "黄栌:深秋红叶赭黄——深秋萧瑟/孤雁南飞/叶落归根,情绪苍凉中带暖"),
  "cn-zheshi":       (0.004, 0.99, 1.03, 0.86, (0.38, 0.34, 0.30), (0.96, 0.90, 0.80), 0.24, 0.0,
                      "赭石:土赭沉稳如岩——古道西风/岩壁洞府/苍劲老者,情绪坚忍厚重"),
  "cn-laolv":        (0.006, 0.98, 1.04, 0.84, (0.30, 0.40, 0.34), (0.90, 0.96, 0.88), 0.26, 0.0,
                      "苍绿:老树深苔的沉绿——古刹钟声/密林深处/岁月静守,情绪幽深宁谧"),
  "cn-chenxiang":    (0.010, 1.01, 1.03, 0.84, (0.36, 0.32, 0.28), (0.98, 0.90, 0.76), 0.26, 0.0,
                      "沉香:乌金暗褐之色——古物陈酿/内敛奢华/故人重逢,情绪深沉绵长"),
  "cn-shuimo":       (0.020, 1.02, 1.02, 0.30, (0.40, 0.42, 0.44), (0.97, 0.97, 0.96), 0.10, 0.72,
                      "水墨:近黑白而保微彩的写意——水墨回忆/超然物外/画中世界,情绪空灵超脱"),
  "cn-xuanzhi":      (0.042, 0.97, 1.02, 0.72, (0.46, 0.46, 0.44), (0.99, 0.98, 0.95), 0.10, 0.0,
                      "宣纸:泛白宣纸底色,画面淡化——梦境留白/仙气缥缈/回忆滤镜,情绪飘逸清淡"),
  "cn-boshi":        (0.024, 1.02, 0.99, 0.92, (0.44, 0.38, 0.34), (1.00, 0.92, 0.84), 0.22, 0.0,
                      "薄柿:淡熟的柿子橙——夕照温情/人间烟火/久别问候,情绪柔和慰藉"),
  "cn-tianqing":     (0.026, 1.02, 1.00, 0.88, (0.42, 0.52, 0.56), (0.98, 1.00, 1.00), 0.16, 0.0,
                      "天青:汝窑雨过天青,淡青泛蓝灰——雨霁初晴/禅意空镜/久候终至,情绪澄澈安宁"),
  "cn-doulu":        (0.020, 1.00, 1.00, 0.86, (0.40, 0.46, 0.38), (0.96, 0.98, 0.90), 0.18, 0.0,
                      "豆绿:青豆浅绿,朴素无华——田园劳作/粗布日常/市井烟火,情绪平实温润"),
  "cn-shiliu":       (-0.004, 1.12, 0.94, 1.14, (0.40, 0.24, 0.28), (1.06, 0.86, 0.76), 0.34, 0.0,
                      "石榴红:浓烈的石榴花红——怒放情愫/高潮爆发/红衣烈焰,情绪炽烈张扬"),
  "cn-songhua":      (0.024, 1.03, 0.98, 0.94, (0.44, 0.48, 0.34), (1.00, 1.00, 0.84), 0.18, 0.0,
                      "松花:松花粉的嫩黄绿——春晨新绿/少年意气/初入江湖,情绪清新稚嫩"),
  "cn-dailan":       (0.004, 0.99, 1.04, 0.86, (0.30, 0.38, 0.52), (0.90, 0.94, 1.00), 0.26, 0.0,
                      "黛蓝:黛石之蓝,深靛沉稳——深院夜读/临帖抚琴/沉静笃定,情绪安定深隽"),
  "cn-ziitan":       (0.006, 0.98, 1.05, 0.82, (0.34, 0.30, 0.38), (0.94, 0.88, 0.86), 0.28, 0.0,
                      "紫檀:紫檀木深褐紫——古木法器/岁月包浆/长辈威仪,情绪沉穆持重"),
  "cn-tuoyan":       (0.030, 1.02, 1.00, 0.90, (0.46, 0.38, 0.30), (1.04, 0.92, 0.76), 0.26, 0.0,
                      "酡颜:醉后双颊的酡红——酒酣耳热/失态真言/暧昧升温,情绪醺然微醺"),
  "cn-yingcao":      (0.032, 1.06, 0.95, 0.98, (0.48, 0.44, 0.30), (1.04, 1.00, 0.72), 0.20, 0.0,
                      "樱草:樱草嫩黄,明媚娇柔——暖春少女/娇憨嬉闹/闺中春色,情绪明快娇嫩"),
  "cn-luoqing":      (-0.006, 0.95, 1.08, 0.80, (0.20, 0.28, 0.50), (0.80, 0.86, 1.04), 0.34, 0.0,
                      "螺青:深蓝近墨的海螺色——深夜庙堂/海上孤舟/沉郁决断,情绪庄重孤绝"),
}

def make_cn(params):
    lift, gain, gamma, sat, st, ht, amount, mono = params
    def fn(rgb):
        c = lift_gain_gamma(rgb, lift=lift, gain=gain, gamma=gamma)
        c = split_tone(c, shadow_tint=st, highlight_tint=ht, amount=amount)
        c = saturation(c, sat)
        if mono > 0:
            l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            c = mix(c, [l, l, l], mono)
        return c
    return fn

for _lid, _v in CN_LUTS.items():
    LUTS[_lid] = (make_cn(_v[:8]), _v[8])

def bake(fn):
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    for by in range(GRID):
        for bx in range(GRID):
            b = (by * GRID + bx) / (RES - 1)
            for row in range(RES):
                g = row / (RES - 1)
                for col in range(RES):
                    r = col / (RES - 1)
                    out = fn([r, g, b])
                    x = bx * RES + col
                    y = by * RES + row
                    px[x, y] = tuple(int(clamp01(c) * 255 + 0.5) for c in out)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["# 自生成胶片风 HaldCLUT 许可清单", "",
             "> 生成源:`apps/build/scripts/generate-luts.py`（本仓库自有代码，MIT 随仓库）。"
             "原建议源 cedeber/hald-clut 为 GPL-3.0 且含 Apple/Pixelmator 专有条款、G'MIC 系为 CECILL——"
             "均不过 D4 门槛（2026-08-18 核查），故改为程序化烘焙；命名 film-* 为胶片风灵感，非型号仿真。", "",
             "| LUT id | 文件 | 说明 |", "|---|---|---|"]
    for name, (fn, desc) in sorted(LUTS.items()):
        img = bake(fn)
        path = OUT / f"{name}.png"
        img.save(path, optimize=True)
        lines.append(f"| `{name}` | `{path.name}` | {desc} |")
        print(f"baked {name}: {path.stat().st_size // 1024}KB")
    (OUT / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("LICENSES.md written")


if __name__ == "__main__":
    main()
