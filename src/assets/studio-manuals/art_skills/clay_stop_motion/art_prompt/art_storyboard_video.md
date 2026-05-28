---
name: art_storyboard_video
description: 粘土定格动画 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 粘土定格动画

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `clay stop-motion animation, plasticine character, handmade miniature set, rounded clay expression, warm softbox light, tabletop shadow, gentle depth of field, visible fingerprints, soft clay dents, handmade imperfection, macro photography, tactile detail, frame-by-frame charm, high detail` |
| 通用首尾帧模式（英文） | `clay stop-motion animation, stable first frame and last frame, temporal continuity, warm softbox light, tabletop shadow, gentle depth of field, visible fingerprints, soft clay dents, handmade imperfection` |
| 中文模式 | `粘土定格动画，plasticine character, handmade miniature set, rounded clay expression，warm softbox light, tabletop shadow, gentle depth of field，visible fingerprints, soft clay dents, handmade imperfection，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, glossy plastic, smooth CGI, realistic human skin, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
