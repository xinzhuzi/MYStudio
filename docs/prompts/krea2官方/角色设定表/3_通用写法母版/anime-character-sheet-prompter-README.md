# Anime Character Sheet Prompter

用于编写 **Niji 7 / Midjourney 动漫角色设定图提示词**的可复用 Agent Skill。适合探索不同角色，并为动画项目统一角色三视图、表情、服装和装备设计。

这是提示词编写 skill；实际出图需要在支持的图像生成服务中完成。

## 能做什么

- 根据角色定位、阵营、性格与故事作用，组织完整的角色设计提示词。
- 设计正面、侧面、背面三视图，以及头部、眼睛、表情和服装装备细节面板。
- 用轮廓、发色、瞳色和服装语言区分不同角色，保持项目整体画风一致。
- 提供通用母模板、冷峻女军官模板、装甲士兵模板及迭代诊断清单。

## 安装

将本仓库克隆到你的 Agent skills 目录。例如在 Codex 中：

```bash
git clone https://github.com/SeOgi-Tsu/anime-character-sheet-prompter.git ~/.codex/skills/anime-character-sheet-prompter
```

如果本地已经安装了同名 skill，可先克隆到其他目录进行比较。也可以把仓库中的 `SKILL.md` 与 `references/` 一起复制到现有工具的 skills 目录，保留目录结构。

## 使用示例

在支持 skills 的 Agent 中提出请求：

```text
使用 anime-character-sheet-prompter，为我的动画项目设计一位成年女性军官。
她属于极地监察局，外表冷静严厉，实际背负着保护同伴的压力。
请给出 Niji 7 角色设定图提示词，包含正侧背三视图、表情组、
领口、手套与腰部设备细节。白底，清晰线稿，二维赛璐璐风格。
```

探索多个角色时，可以提供阵营规则和已有角色信息，再要求分别输出提示词，并检查轮廓、配色和装备是否重复。

有项目视觉圣经、角色原案或参考图时，请一并提供，以便保持设计一致性。

## 文件

| 文件 | 内容 |
| --- | --- |
| [SKILL.md](SKILL.md) | 触发说明、工作流程、提示词结构和常见修正 |
| [references/niji-character-sheet-patterns.md](references/niji-character-sheet-patterns.md) | 参数起点、通用模板、女军官与装甲士兵模板 |

## 版本说明

2026-09-10 已按官方文档修正模型与参数说明：

- 区分 Niji 7 和 Midjourney V7：`--oref` 仅用于 Midjourney V7，Niji 7 不支持 `--cref`，也不能用 `--oref` 替代。
- Niji 7 可用普通 Image Prompt 辅助角色设计；`--iw` 范围为 0–2，默认 1。它不保证角色身份一致，`--sref` 则用于画风参考。
- 可运行提示词中的 `--s` 使用单个数值，不能填写区间。默认参数简化为 `--niji 7 --ar 16:9 --s 150`。
- Raw 和质量参数改为按目标模型支持情况选用，不再默认混用 Midjourney V7 设置。

官方来源见 [模板参考文档](references/niji-character-sheet-patterns.md#official-compatibility-sources)。模板为创作起点，尚未逐例验证出图效果。
