#!/usr/bin/env python3
"""Apply reviewed documentation closeout edits with snapshot guards."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/09-20-docs-current-alignment'
rows = json.loads((TASK / 'research/cross-review-doc-baseline.json').read_text())
changed = []
for row in rows:
    path = ROOT / row['path']
    if path.parent.name != 'comfyui-kb':
        continue
    original = path.read_text()
    if hashlib.sha256(path.read_bytes()).hexdigest() != row['before']:
        raise RuntimeError(f'Changed since review: {path}')
    lines = original.splitlines()
    if path.stem == '参数速查':
        indexes = [i for i, line in enumerate(lines) if line.startswith('| 漫影单镜模板 |')]
        assert len(indexes) == 1
        lines[indexes[0]] = '| 漫影单镜模板 | `apps/frontend/lib/assist/image-studio/MY-h3-shot-template.json`=I2V 单段直出；Ref2VA 变体为同目录 `MY-h3-shot-template_ref2va.json`。2026-09-21 已校准两模板 ResolutionSelector 的按位/具名字段，均为 `megapixels=0.98`、`multiple=32`；I2V 的 `tiny_vae` 两处均为 `none`。Ref2VA 两处仍为 `taeh3.safetensors`，使用前需核对当前引擎 `object_info` 的可选模型。双表示一致性已由组装器回归测试验证，未重跑媒体生成。两段式精修与 SeedVR2 已摘除(09-14 裁定超分不进工作流)；**单段 1344×768 实测 21m07s/5s 片**是 09-14 的历史结果(冷启动含装载,连续 ~17-18min；详见[分镜×H3 视频产线](./分镜H3视频产线.md)§八) | 【代码核验 09-21 / 历史实测 09-14】 |'
    elif path.stem == '分镜H3视频产线':
        indexes = [i for i, line in enumerate(lines) if line.startswith('| `ModelPreviewOverrideKJ`')]
        assert len(indexes) == 1
        lines[indexes[0]] = '| `ModelPreviewOverrideKJ` 的 `tiny_vae=\'taeh3.safetensors\'` | 2026-09-14 引擎模型列表只有 `[\'none\']`，导致 /prompt 验证整图打回(Output will be ignored) | 2026-09-21 已将 I2V 按位/具名值统一为 `none`，两模板分辨率也已校准并通过双表示回归。Ref2VA 仍保留一致的 taeh3 值；本轮未重跑引擎模型校验或媒体生成，使用前核对当前 `object_info`。详见参数速查 |'
        index = next(i for i, line in enumerate(lines) if line.startswith('- **首跑实弹'))
        lines.insert(index, '- 仓库视频库另保留 `单镜视频 · chapter-001 · S01.json` 作为历史追溯样本（见[工作流清单](./漫影工作流清单.md)）；它不是组装器模板，也不是当前逐镜写入位置。')
    elif path.stem == '定制代码地图':
        index = next(i for i, line in enumerate(lines) if line.startswith('- **分镜产线通用化'))
        lines.insert(index, '- **历史样本例外**：仓库视频库保留 `单镜视频 · chapter-001 · S01.json` 供追溯（见[工作流清单](./漫影工作流清单.md)）；当前组装器不读取该样本，也不会据此创建逐章/逐镜文件。')
    else:
        raise RuntimeError(path)
    revised = '\n'.join(lines) + '\n'
    path.write_text(revised)
    assert path.read_text() == revised
    changed.append({'path': row['path'], 'before': row['before'], 'after': hashlib.sha256(path.read_bytes()).hexdigest(), 'backup': row['backup']})
(TASK / 'research/cross-review-comfy-edits.json').write_text(json.dumps(changed, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(changed, ensure_ascii=False, indent=2))
