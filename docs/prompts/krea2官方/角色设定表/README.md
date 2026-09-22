# 角色设定表提示词资料库

> 2026-09-21 迁入。来源:~/Downloads/character-sheet-prompts(09-18 采集的 X 精选 + GitHub/HuggingFace 仓库)。
> 源目录保留未删;本目录为仓库内唯一权威存放位。主题:多视图/多姿势/表情的角色设定表(Character Sheet)提示词写法,Krea2 为主线。

## 目录结构

| 位置 | 内容 | 价值 |
|---|---|---|
| [X_角色设定图提示词精选.md](X_角色设定图提示词精选.md) | 总索引:X 中英圈提示词原文 + B站视频路线 + 本目录四大资产导览 | 先读这个,全貌入口 |
| [1_Krea2设定表LoRA/](1_Krea2设定表LoRA/) | Alissonerdx/CharacterSheet 全家桶:核心模板(2.4万字符,IDENTITY LOCKS 纪律)+ 4 个工作流 JSON(仅参考) | Krea2 本地设定表第一优先路线 |
| [2_krea2edit引擎件/](2_krea2edit引擎件/) | lbouaraba/comfyui-krea2edit(626★)的 README/CHANGELOG/样例工作流 | 身份保持编辑引擎件的参数手册(ref_boost 拨盘等) |
| [3_通用写法母版/](3_通用写法母版/) | Niji 母版 + GPT-Image2 身份锚点法 | 跨模型通用的设定表写法纪律 |
| [4_云端模型参考/](4_云端模型参考/) | Nano Banana 三份大全(162条中文全集/10.3k★英文精选/中文玩法) | 云端一致性模型的参考素材,与本地 K2 无关 |

## 写法纪律(2026-09-21 从全库提炼,写提示词前过一遍)

1. **身份与姿势分家**(GPT-Image2 锚点法明文):身份=名词锁(颜色/材质/位置/状态),姿势/情绪/场景=可变项,不混进身份描述。
2. **身份锁只写可验证名词**:确切颜色、标记、不对称处、配件形状、材质——"让另一个画师蒙眼也能复现",绝不发明看不见的东西(Krea2 模板 IDENTITY LOCKS 规则)。
3. **武器/道具=名词+属性+挂位+专属特写格**:如"左腰深青木鞘缠素白绦带,剑身完整收于鞘内";Niji 母版在 details 行点名武器后在 layout 行给 weapon close-up。只写"剑柄"不写"剑鞘"=鞘必丢。
4. **否定式无效**:"未拔/不要 X"模型基本不响应,且反向强化被否定的概念;一律改肯定式陈述("剑身完整收在剑鞘之中")。
5. **手+道具交互是弱项**:全库(含 162 条 Nano Banana 全集)没有一条示范"手按武器"微姿势,只有武器静物特写;手崩走修手流,别反复改词。

## 来源与许可

| 文件 | 来源 | 许可 |
|---|---|---|
| X_角色设定图提示词精选.md | 本仓整理(X 帖子原文+导览) | 自有 |
| 1_Krea2设定表LoRA/* | HF: Alissonerdx/CharacterSheet | 未标,仅参考 |
| 2_krea2edit引擎件/* | GitHub: lbouaraba/comfyui-krea2edit | 有 LICENSE(见上游) |
| 3_通用写法母版/niji-* 、anime-* | GitHub: SeOgi-Tsu/anime-character-sheet-prompter(1★) | 未标,仅参考 |
| 3_通用写法母版/gpt-image-2-* | GitHub: gpt-img-2/gpt-image-2-character-sheet | 有 LICENSE |
| 4_云端模型参考/Awesome-* | GitHub: PicoTrex/Awesome-Nano-Banana-images(23.7k★) | 未标,仅参考 |
| 4_云端模型参考/awesome-nanobanana-pro-* | GitHub: ZeroLu/awesome-nanobanana-pro(10.3k★) | CC BY 4.0 |
| 4_云端模型参考/nanobanana-prompt_* | GitHub: newaiproxy/nanobanana-prompt | 未标,仅参考 |

## 边界

- 工作流 JSON 一律**仅参考**:对应 LoRA 权重未装机,不得拷入引擎工作流库(工作流落位见 docs/comfyui-kb);引擎实际使用的 krea2edit 插件以引擎家 custom_nodes 内版本为准,本目录只作参数文档。
- Nano Banana/GPT-Image 是云端模型,与本地 K2 文生图无关;本地 K2 无跨图身份保持,设定表路线须走 krea2edit 编辑形态(见 X 精选"ComfyUI 本地工作流路线"一节)。
- Krea2 官方提示词口径见上级目录 [../prompting.md](../prompting.md) 与 [../风格提示词_官方采集.md](../风格提示词_官方采集.md);道劫落地现状见 [../../道劫_角色设定表出图逻辑_0919.md](../../道劫_角色设定表出图逻辑_0919.md)。
