---
name: art_storyboard_video
description: 2D运动写实漫画 · 视频提示词约束
metaData: art_skills
---

# 视频提示词 · 2D运动写实漫画

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|---|---|
| 通用多参模式（英文） | `realistic sports manga animation, athletic body proportion, sweat detail, court atmosphere, intense eye focus, gymnasium top light, hard rim light, action freeze frame, inked muscle line, textured shading, energetic motion, clean composition, readable silhouette, high detail, finished illustration` |
| 通用首尾帧模式（英文） | `realistic sports manga animation, stable first frame and last frame, temporal continuity, gymnasium top light, hard rim light, action freeze frame, inked muscle line, textured shading, energetic motion` |
| 中文模式 | `2D运动写实漫画，athletic body proportion, sweat detail, court atmosphere, intense eye focus，gymnasium top light, hard rim light, action freeze frame，inked muscle line, textured shading, energetic motion，画面连续，主体稳定` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 保持主体身份、服装、场景和光影连续 |
| V2 | 镜头运动服务叙事，不为了炫技改变风格 |
| V3 | 动作需有起承转合，避免瞬间变形和身份漂移 |
| V4 | 首尾帧构图保持稳定，过渡自然 |
| V5 | 负向规避:(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, Q版可爱体型, 奇幻长袍, 解剖结构松散, 画面闪烁, 抖动, 面部融合变形, 身份漂移, 手部扭曲, 动作断裂, 场景突跳 |
