---
name: art_character
description: 3D超精致建模 通用角色四视图标准手册
metaData: art_skills
---

---

# 3D超精致建模 通用角色四视图标准手册
---

一位【年龄（数字）】的【性别】，【详细身份】，【20个字的避开同模描述，防止不同提示出现一种脸】，【10个字角色设定】，【性格】，【五官】、【气质】、【4个字角色标签】3D超精致建模，无表情，正对镜头，超特写。
---

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

国风赛博3D渲染，Chinese cyber fantasy 3D，traditional silhouette with controlled futuristic accents，cinematic neon rim light，iridescent material，high precision model，layered atmosphere，best quality，high detail。
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性；补充 anatomy coherent, clean facial structure, consistent identity, complete head-to-toe framing。

### 反向规避提示词

low quality, generic western sci-fi, pure cyberpunk without Chinese design, flat 2D, photorealistic photography, neon overexposure, chaotic colors, cluttered detail, bad anatomy, watermark, text。
bad anatomy, deformed face, asymmetrical eyes, extra limbs, missing limbs, fused fingers, cropped head, cropped feet, inconsistent identity, inconsistent clothing, oversexualized outfit。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

