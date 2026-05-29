# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `live-action urban cinema, real human actors photography, contemporary Chinese urban setting, cinematic color science, natural light and practical lighting, shallow depth of field, handheld camera breathing, smooth Steadicam movement, film grain texture, motion blur for video, cinematic frame rate, non-CGI non-rendered` |
| **通用首尾帧模式（英文）** | `live-action urban cinema, real human actors photography, contemporary Chinese urban setting, cinematic color science, natural light and practical lighting, rack focus, focal plane locking, shallow depth of field, cinematic bokeh, film grain texture, non-CGI non-rendered` |
| **Seedance 2.0（中文）** | `真人都市电影摄影，真人实拍质感，当代中国都市，电影级色彩科学，自然光与实用光源调度，浅景深，手持呼吸感或稳定器流动，电影颗粒质感，视频动态优化，非CG非渲染` |

---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

真人都市电影摄影，live-action modern Chinese urban cinematic still，35mm full-frame photography，natural light logic，real skin pores，worn fabric texture，lived-in environment，clean focus，best quality，ultra detailed。
视频提示词必须补充镜头运动、主体运动、起承转合、景深变化、光影连续性和首尾帧一致性；补充 cinematic motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, 3D render, CGI, anime, illustration, cartoon, ancient costume, xianxia, sci-fi, generic foreign city, plastic skin, over-smoothing, bad anatomy, watermark, text, signature。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

