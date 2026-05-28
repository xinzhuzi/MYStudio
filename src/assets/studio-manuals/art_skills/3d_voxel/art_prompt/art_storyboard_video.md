---
name: art_storyboard_video
description: 3D方块世界 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 3D方块世界

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `voxel block world 3D art, cubic character, blocky trees, grid-based village, isometric readability, bright daylight, crisp shadow, cheerful atmosphere, voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition` |
| 通用首尾帧模式（英文） | `voxel block world 3D art, stable first frame and last frame, temporal continuity, bright daylight, crisp shadow, cheerful atmosphere, voxel cubes, pixel-like material, clean toy blocks` |
| 中文模式 | `3D方块世界，cubic character, blocky trees, grid-based village, isometric readability，bright daylight, crisp shadow, cheerful atmosphere，voxel cubes, pixel-like material, clean toy blocks，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避：(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, round organic forms, smooth realistic texture, blur, flicker, jitter, morphing face, identity drift, warped hands, broken motion, sudden scene jump |
