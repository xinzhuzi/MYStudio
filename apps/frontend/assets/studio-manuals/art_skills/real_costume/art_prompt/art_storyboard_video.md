---
name: art_storyboard_video
description: 真人古装 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 真人古装

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `live-action Chinese period drama still, period costume, embroidered fabric, ancient interior, elegant posture, soft lantern light, daylight through lattice, cinematic haze, real silk folds, hair ornament detail, natural skin texture, real lens optics, natural skin texture, cinematic framing, high detail` |
| 通用首尾帧模式（英文） | `live-action Chinese period drama still, stable first frame and last frame, temporal continuity, soft lantern light, daylight through lattice, cinematic haze, real silk folds, hair ornament detail, natural skin texture` |
| 中文模式 | `真人古装，period costume, embroidered fabric, ancient interior, elegant posture，soft lantern light, daylight through lattice, cinematic haze，real silk folds, hair ornament detail, natural skin texture，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, modern clothes, glasses, watch, 3D render, anime, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
