#!/usr/bin/env python3
"""Small, reviewed docs updates; preserves the task's original backups."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/09-20-docs-current-alignment'


def update(relative, replacements):
    p = ROOT / relative
    original = p.read_text()
    text = original
    for before, after in replacements:
        if before not in text:
            if after in text:
                continue
            raise ValueError(f'Anchor not found: {relative}: {before[:80]}')
        text = text.replace(before, after)
    if text != original:
        p.write_text(text)
        print(relative)


if __name__ == '__main__':
    update('docs/prompts/portrait_aesthetics/README.md', [('../comfyui-kb/', '../../comfyui-kb/')])
    files = list((ROOT / 'docs/comfyui-kb').glob('*.md')) + list((ROOT / 'docs/prompts').glob('*.md'))
    node_edits = {
        'LoRA库存台账-0919.md': [( '[164](本轮路径修复后入列)', '`[164]`（本轮路径修复后入列）'), ('[87](wv+named)', '`[87]`（wv+named）')],
        '道劫_九型配方_0919.md': [('[66](九型×配方矩阵,脚本生成)', '`[66]`（九型×配方矩阵，脚本生成）'), ('[61](画幅)', '`[61]`（画幅）'), ('[90](LoRA 组)', '`[90]`（LoRA 组）')],
        '道劫_底座节点_0918.md': [('[47]([64]→[65].text)', '`[47]`（`[64]→[65].text`）')],
    }
    for p in files:
        if p.name in node_edits:
            update(p.relative_to(ROOT), node_edits[p.name])
    p = next((ROOT/'docs/prompts').glob('*/prompting.md'))
    src = p.read_text()
    replacements = []
    for match in re.finditer(r'<img src="([^"]+)" alt="([^"]+)"/>', src):
        target, alt = match.groups()
        if not (p.parent/target).exists():
            replacements.append((match.group(), f'示例图 `{alt}`：原文路径 `{target}`；此摘录未附该图片。'))
    replacements.append(('# Prompting guidelines\n', '# Prompting guidelines\n\n> 外部提示词资料摘录。保留原文示例提示词；原仓库示例图未随文档收录，以下保留图名与来源相对路径，不作为本地图片链接。MYStudio 的当前入口见 [本地模型页](../../panels/LOCAL_MODELS_GUIDE.md)。\n'))
    update(p.relative_to(ROOT), replacements)
    update('docs/README.md', [
        ('| [assets/](./assets/) |', '| [prompts/](./prompts/README.md) | 提示词模板、风格参考、实验记录与素材索引 |\n| [assets/](./assets/) |'),
        ('## 高阶指南（guides/）', '## 提示词与实验素材（prompts/）\n\n[提示词资料索引](./prompts/README.md)按生产说明、实验记录、外部摘录和风格素材区分用途。实验日期、种子、模型与参数共同限定结论，不能作为所有工作流的通用默认值。\n\n[Krea2 本地生图指南](./krea2.md)用于查询当前工作流和入口；旧节点图说明保留历史适用标记。\n\n## 高阶指南（guides/）'),
        ('工作流库全量盘点（仓库真源 37 个=K2图像18+分镜模板1+H3视频17+音乐1，一律 `MY-` 前缀；**分镜域零实体**——09-15 裁定,无写入位,模板注入直开），含快查表；「ComfyUI 里有哪些漫影工作流」先读它', '工作流库分类、只读仓库模板与用户副本边界；09-18 已废弃 `MY-` 前缀。文件清单以当前仓库及引擎工作流列表为准，历史数量不作为恒定值'),
        ('> 缺口（2026-09-13 记）：设置→本地配置 中 ComfyUI 引擎卡（引擎状态、「模型」页签、插件台账、存储四目录）尚无专门用户文档；引擎操作技能见仓库 `.agents/skills/comfyui/machine.md`。', '> 用户操作见 [ComfyUI 引擎指南](./settings/COMFYUI_ENGINE_GUIDE.md)与[本地模型页](./panels/LOCAL_MODELS_GUIDE.md)；开发运维再查定制代码地图。'),
        ('本目录为 2026-05 前后的历史规划/调查存档，其中涉及生成链路现状的描述已被 ComfyUI 架构取代（见 `engineering/` 与 `comfyui-kb/`）；仅作来龙去脉参考。', '本目录混合早期规划、后续裁定、外部调查与实现记录，应按各篇日期和状态阅读。当前操作优先查 `workflow/`、`settings/` 和 `engineering/`；ComfyUI 接管本地生成并不等于替代章节编辑与最终渲染的全部职责。'),
    ])
    prompt_root = ROOT/'docs/prompts'
    rows=[]
    for doc in sorted(prompt_root.rglob('*.md')):
        if doc == prompt_root/'README.md': continue
        title=next((s[2:] for s in doc.read_text().splitlines() if s.startswith('# ')),doc.stem)
        section='外部摘录/素材' if any(s in str(doc.relative_to(prompt_root)) for s in ('krea2官方','portrait_aesthetics','2d_工笔画')) else '提示词说明/日期实验记录'
        rows.append(f'| [{title}]({doc.relative_to(prompt_root).as_posix()}) | {section} |')
    out=prompt_root/'README.md'
    if not out.exists():
        out.write_text('# 提示词资料索引\n\n本目录保存提示词、风格参考和实验记录。按文内日期、模型、工作流与参数使用；实验结论不等于当前所有模型的效果保证。\n\n生产入口：[本地模型页](../panels/LOCAL_MODELS_GUIDE.md) · [ComfyUI 参数速查](../comfyui-kb/参数速查.md) · [文档中心](../README.md)。\n\n## 阅读边界\n\n- 道劫底座、九型配方及角色设定说明需对照当前 `my_nodes/nodes/daojie_bases.json`、LoRA 栈和对应工作流；默认值以节点实际输入为准。\n- 带日期的对拍记录保留当时证据，不据其旧计数、旧路径或旧参数直接改现有工作流。\n- 官方/社区摘录与美学素材是参考文本，不是 MYStudio 功能承诺；原图未收录时会明确标记。\n\n## 文档\n\n| 文档 | 类型 |\n|---|---|\n'+'\n'.join(rows)+'\n')
        print(out.relative_to(ROOT))
