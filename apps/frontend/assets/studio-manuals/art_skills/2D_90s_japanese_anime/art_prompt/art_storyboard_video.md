# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `90s Japanese anime, hand-drawn cel animation, soft warm tones, cinematic, clean line art, nostalgic aesthetic` |
| **通用首尾帧模式（英文）** | `90s Japanese anime, hand-drawn cel animation, soft warm tones, cinematic, clean line art, nostalgic aesthetic, shallow depth of field` |
| **Seedance 2.0（中文）** | `90年代日式动画，手绘赛璐璐，柔和暖调，电影风格，清晰线条，怀旧质感` |
---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

90年代日式动画电影质感，hand-drawn cel animation，clean lineart，painted background，soft rim light，subtle film grain，nostalgic warm palette，best quality，high detail，sharp but not digital-glossy。
视频提示词必须补充镜头运动、主体运动、起承转合、景深变化、光影连续性和首尾帧一致性；补充 cinematic motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, worst quality, blurry, muddy colors, modern glossy digital painting, 3D render, CGI, photorealistic, western cartoon, over-sharpened HDR, noisy artifacts, watermark, text, signature。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

