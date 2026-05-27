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
