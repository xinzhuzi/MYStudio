---
name: art_storyboard_video
description: 日式3D渲染2D · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 日式3D渲染2D

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `Japanese cel shaded 3D action render, sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose, hard rim light, high contrast stage lighting, motion streaks, crisp toon shader, clear line accents, stylized material breakups, sharp focus, detailed background, polished composition` |
| 通用首尾帧模式（英文） | `Japanese cel shaded 3D action render, stable first frame and last frame, temporal continuity, hard rim light, high contrast stage lighting, motion streaks, crisp toon shader, clear line accents, stylized material breakups` |
| 中文模式 | `日式3D渲染2D，sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose，hard rim light, high contrast stage lighting, motion streaks，crisp toon shader, clear line accents, stylized material breakups，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic rendering, dull flat color, western cartoon softness, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
