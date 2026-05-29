# 视频提示词 · 视觉风格约束

生成3D国风赛博风格视频时，必须完整注入以下对应模式的视觉风格标签（核心基础标签不可删减）：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `Chinese traditional 3D render, PBR materials, volumetric lighting, oriental aesthetic, elegant and grand, cinematic, cyberpunk fusion, Chinese-style cyber neon aesthetics, holographic traditional Chinese elements, futuristic oriental cyber cityscape, traditional Chinese architecture with cybernetic retrofitting, rain-slicked reflective surfaces, neon glow atmosphere, high contrast dynamic lighting, seamless integration of classical Chinese culture and futuristic technology` |
| **通用首尾帧模式（英文）** | `Chinese traditional 3D render, PBR materials, volumetric lighting, oriental aesthetic, elegant and grand, cinematic, shallow depth of field, cyberpunk fusion, cinematic cyber-oriental framing, holographic Chinese calligraphy & pattern elements, neon-lit traditional Chinese pavilions, bokeh neon light effects, atmospheric depth, strong visual impact, retro-futuristic Chinese style` |
| **Seedance 2.0（中文）** | `国风3D渲染，PBR材质，体积光，东方美学，典雅大气，电影风格，国风赛博朋克，新中式未来科技，霓虹全息中式元素，赛博化传统中式建筑，雨幕反光路面，霓虹氛围光效，高对比动态光影，东方古韵与未来科技深度融合，赛博国风场景，超写实3D质感` |

---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

国风赛博3D渲染，Chinese cyber fantasy 3D，traditional silhouette with controlled futuristic accents，cinematic neon rim light，iridescent material，high precision model，layered atmosphere，best quality，high detail。
视频提示词必须补充镜头运动、主体运动、起承转合、景深变化、光影连续性和首尾帧一致性；补充 cinematic motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, generic western sci-fi, pure cyberpunk without Chinese design, flat 2D, photorealistic photography, neon overexposure, chaotic colors, cluttered detail, bad anatomy, watermark, text。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

