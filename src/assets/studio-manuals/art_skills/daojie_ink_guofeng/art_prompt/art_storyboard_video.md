# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, muted cyan-green palette, rice paper texture, cinematic composition, atmospheric depth` |
| **通用首尾帧模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, muted cyan-green palette, rice paper texture, cinematic composition, atmospheric depth, shallow depth of field` |
| **Seedance 2.0（中文）** | `水墨国风修仙，工笔线描，写意泼墨，青绿淡彩，宣纸质感，墨色层次丰富，连环画叙事感，电影构图` |
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
---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

水墨国风修仙，Chinese ink wash xianxia，gongbi linework，rice paper texture，muted cyan-green palette，layered ink wash，spiritual aura as ink diffusion，cinematic composition，best quality，high detailed。
视频提示词必须补充镜头运动、主体运动、起承转合、景深变化、光影连续性和首尾帧一致性；补充 cinematic motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, 3D render, CGI, photorealistic, cel-shaded anime, high saturation neon, western fantasy, sci-fi, modern city, plastic texture, messy ink, bad anatomy, watermark, text, signature。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

