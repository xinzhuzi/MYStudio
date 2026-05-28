---
name: art_storyboard_video
description: 3D写实 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 3D写实

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `photorealistic 3D cinematic render, highly detailed texture, realistic skin shader, complex fabric, accurate scale, ray-traced lighting, cinematic depth of field, controlled contrast, micro surface detail, natural imperfections, realistic material response, sharp focus, detailed background, polished composition` |
| 通用首尾帧模式（英文） | `photorealistic 3D cinematic render, stable first frame and last frame, temporal continuity, ray-traced lighting, cinematic depth of field, controlled contrast, micro surface detail, natural imperfections, realistic material response` |
| 中文模式 | `3D写实，highly detailed texture, realistic skin shader, complex fabric, accurate scale，ray-traced lighting, cinematic depth of field, controlled contrast，micro surface detail, natural imperfections, realistic material response，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, cartoon, anime, flat illustration, low poly, plastic skin, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
