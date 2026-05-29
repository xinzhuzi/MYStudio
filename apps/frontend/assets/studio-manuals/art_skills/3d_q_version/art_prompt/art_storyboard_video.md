---
name: art_storyboard_video
description: 3DQ版 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 3DQ版

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `chibi collectible 3D toy render, super deformed body, oversized head, cute face, miniature scene, soft studio lighting, gentle rim light, clean shadow, smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition` |
| 通用首尾帧模式（英文） | `chibi collectible 3D toy render, stable first frame and last frame, temporal continuity, soft studio lighting, gentle rim light, clean shadow, smooth toy material, rounded surface, tactile miniature detail` |
| 中文模式 | `3DQ版，super deformed body, oversized head, cute face, miniature scene，soft studio lighting, gentle rim light, clean shadow，smooth toy material, rounded surface, tactile miniature detail，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, realistic adult proportion, rough material, scary mood, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
