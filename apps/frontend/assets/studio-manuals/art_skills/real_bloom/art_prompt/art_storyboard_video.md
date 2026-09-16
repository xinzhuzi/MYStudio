---
name: art_storyboard_video
description: 真实光晕 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 真实光晕

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `dreamy backlit live-action photography, real person, glowing rim light, soft focus portrait, airy environment, strong bloom, lens flare, warm backlight, shallow depth of field, film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail` |
| 通用首尾帧模式（英文） | `dreamy backlit live-action photography, stable first frame and last frame, temporal continuity, strong bloom, lens flare, warm backlight, shallow depth of field, film softness, skin texture retained, optical glow` |
| 中文模式 | `真实光晕，real person, glowing rim light, soft focus portrait, airy environment，strong bloom, lens flare, warm backlight, shallow depth of field，film softness, skin texture retained, optical glow，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避:(最差质量,低质量:1.4), 3D渲染, CGI, anime, 插画, 卡通, 塑料感皮肤, 过度磨皮的面孔, 解剖错误, 水印, 签名, 文字, 生硬高反差, 阴郁粗粝的暗黑氛围, 画面闪烁, 抖动, 面部融合变形, 身份漂移, 手部扭曲, 动作断裂, 场景突跳 |
