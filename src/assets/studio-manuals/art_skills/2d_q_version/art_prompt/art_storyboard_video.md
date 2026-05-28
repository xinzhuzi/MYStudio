---
name: art_storyboard_video
description: 2DQ版 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 2DQ版

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `kawaii chibi 2D illustration, super deformed body, cute face, tiny hands, adorable costume, soft pastel light, gentle highlight, clean background, rounded line, simple cel shadow, candy color, clean composition, readable silhouette, high detail, finished illustration` |
| 通用首尾帧模式（英文） | `kawaii chibi 2D illustration, stable first frame and last frame, temporal continuity, soft pastel light, gentle highlight, clean background, rounded line, simple cel shadow, candy color` |
| 中文模式 | `2DQ版，super deformed body, cute face, tiny hands, adorable costume，soft pastel light, gentle highlight, clean background，rounded line, simple cel shadow, candy color，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, realistic adult proportion, horror mood, harsh dark lighting, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
