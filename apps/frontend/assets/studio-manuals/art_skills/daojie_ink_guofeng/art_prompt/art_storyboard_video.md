# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, restrained mineral-color palette, rice paper texture, clear layered composition, ink-wash atmospheric perspective` |
| **通用首尾帧模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, restrained mineral-color palette, rice paper texture, clear layered composition, ink-wash atmospheric perspective` |
| **Seedance 2.0（中文）** | `水墨国风修仙，工笔线描，写意泼墨，矿物淡彩，宣纸质感，墨色层次丰富，连环画叙事感，清楚前中远景构图` |
| **Seedance 1.5（中文）** | `水墨国风，工笔线描，写意晕染，青绿淡彩，宣纸肌理，修仙题材，灵气流转，动态张力` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 动作方向保持一致（左→右前进，右→左对抗） |
| V2 | 灵气效果以水墨晕染+对应颜色淡彩表现，禁止粒子特效 |
| V3 | 剑光以银白线条+墨色残影表现速度感 |
| V4 | 场景转换以墨色晕染过渡，禁止硬切 |
| V5 | 人物动态保持连环画叙事感，动作有起承转合 |
| V6 | 背景与角色层次分明，远景淡墨虚化 |

## 严禁

| 编号 | 严禁内容 |
|---|---|
| X1 | 3D渲染/CG动画质感 |
| X2 | 赛璐璐平涂/日式动漫风 |
| X3 | 高饱和荧光色/霓虹粒子特效 |
| X4 | 现代/科幻/西方奇幻元素 |
| X5 | 无质感的纯色平面背景 |

## 3D 纵深构图（水墨版 · 2.5D 渲染管线必需）

> 分镜帧图会进入「深度估计 → 2.5D 相机运镜」管线（推拉摇移等 35 种运镜）。水墨画同样需要纵深结构 — **构图纵深 ≠ 3D 写实渲染**：本节要求的层次与留白是构图法则，与 X1（严禁 3D 渲染质感）不冲突；深度运镜由渲染管线施加，不改变水墨媒介质感。受 `styleContractVersion=daojie-gongbi-v2` 约束：本节构图条款不得引入电影式布光或景深虚化。通用规则见 `production_skills/depth_friendly_3d.md`。

### 水墨纵深 Token（生成分镜帧提示词时注入）

| 模式 | 水墨纵深标签 |
|------|--------------|
| **通用多参模式（英文）** | `clear layered composition with foreground, midground and background separation, overlapping ink-wash depth layers, distant mountains in pale ink wash, ink-wash atmospheric perspective, foreground framing elements like branches or eaves, deep focus with crisp gongbi linework throughout` |
| **通用首尾帧模式（英文）** | 同上 |
| **Seedance 2.0（中文）** | `前中远景三层分明，近景枝叶或檐角入框，远山淡墨晕染，墨色近浓远淡，全画面笔意清晰` |
| **Seedance 1.5（中文）** | `前中远三层构图，远山淡墨，近浓远淡，画面清晰` |

### 水墨纵深规则

| 编号 | 规则 |
|------|------|
| DV1 | 构图三层分离：近景（枝叶/檐角/山石/人物肩背等入框元素）、中景（主体）、远景（淡墨山水/云雾留白），三层各自可辨 |
| DV2 | 优先安排近景遮挡元素入画框 — 水墨折枝构图天然适配，是视差感的最大放大器 |
| DV3 | 透视引导：山径/石阶/溪流/宫廊延伸至画面深处，用墨色浓淡渐变表现纵深（近浓远淡） |
| DV4 | 大气透视 = 墨分五色的近浓远淡 + 远景留白晕染；**主体工笔线条全程锐利**，禁止全图雾化（遵守通用画质禁用词） |
| DV5 | **景别虚化覆盖**：进入 2.5D 管线的分镜，任何「背景虚化/浅景深」描述一律改写为「远景淡墨、全画面笔意清晰」— 景深由渲染阶段按深度图施加 |
| DV6 | 主体轮廓以墨线/留白与背景分离明确，避免主体融入背景墨色 |
| DV7 | 禁止：正面平面化构图、无层次的平涂背景、大面积无结构宣纸空白（留白须有形 — 云气/水面/远山轮廓）
---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

水墨国风修仙，Chinese ink wash xianxia，gongbi linework，rice paper texture，restrained mineral-color palette，layered ink wash，spiritual aura as ink diffusion，clear layered composition，clean finished image，readable detail。
视频提示词必须补充镜头运动、主体运动、起承转合、淡墨空气透视变化、光影连续性和首尾帧一致性；补充 ink-wash motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, 3D render, CGI, photorealistic, cel-shaded anime, high saturation neon, western fantasy, sci-fi, modern city, plastic texture, messy ink, bad anatomy, watermark, text, signature。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。
