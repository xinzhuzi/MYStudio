#!/usr/bin/env python3
"""Reproduce the 2026-09-20 hands-image audit without using the engine.

Creates new evidence files under the existing task's research directory.
The protected image is an offline composite of two historical PNGs, not a
new inference result or a repair to the shared ComfyUI workflow.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, PngImagePlugin

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/09-17-daojie-k2-hands-pose'
ROI = (570, 390, 670, 490)
SOURCE_HASH = '9667e732f3a112147386f62dfaca790b29c45ddeea279f1b6dde9c9f7f985020'
RENDER_HASH = 'd3250c57835da2575f8d9f22ffbf3c473283d8c0b7b1efecf23c664e8e8120d3'


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def delta(a: Image.Image, b: Image.Image) -> dict:
    assert a.size == b.size and a.mode == b.mode == 'RGB'
    r, g, blue = ImageChops.difference(a, b).split()
    maximum = ImageChops.lighter(ImageChops.lighter(r, g), blue)
    total = sum(maximum.histogram()[1:])
    inside = sum(maximum.crop(ROI).histogram()[1:])
    return {'changed_pixels': total, 'hand_roi_changed': inside,
            'outside_hand_roi_changed': total - inside,
            'changed_bbox': maximum.getbbox()}


def run_check(args: list[str]) -> dict:
    completed = subprocess.run(args, cwd=REPO, text=True, capture_output=True)
    result = {'command': args, 'exit_code': completed.returncode,
              'stdout': completed.stdout, 'stderr': completed.stderr}
    if completed.returncode:
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    return result


def main() -> None:
    app_data = next(p for p in (Path.home() / 'Library/Application Support').iterdir()
                    if p.name == '漫影工作室')
    home = app_data / 'comfyui'
    source = next(p for p in (home / 'input').iterdir()
                  if p.name == 'daojie_hands_00005.png')
    render = next(p for p in (home / 'output').iterdir()
                  if p.name == 'K2道劫修手__00001_.png')
    assert sha(source) == SOURCE_HASH, 'Source image changed; re-audit first.'
    assert sha(render) == RENDER_HASH, 'Historical render changed; re-audit first.'
    workflows = list((REPO / 'apps/backend/engines/comfyui/workflows').rglob('K2-道劫修手.json'))
    assert len(workflows) == 1
    workflow = workflows[0]
    app = next(p for p in Path('/Applications').iterdir() if p.name == '漫影工作室.app')
    installed_files = list((app / 'Contents/Resources/backend/engines/comfyui/workflows').rglob(workflow.name))
    assert len(installed_files) == 1
    installed = installed_files[0]
    observed = [source, render, workflow, installed, TASK / 'prd.md', TASK / 'task.json']
    before_hashes = {str(p): sha(p) for p in observed}
    assert workflow.read_bytes() == installed.read_bytes(), 'Installed workflow differs.'
    checks = [run_check(['python3', '-B', 'apps/backend/engines/comfyui/tests/test_daojie_handsfix_contract.py', '-v']),
              run_check(['python3', '-B', 'apps/build/scripts/workflow_graph_lint.py', str(workflow)])]
    with Image.open(source) as image:
        original = image.convert('RGB')
    with Image.open(render) as image:
        historical = image.convert('RGB')
        prompt = json.loads(image.info['prompt'])
    assert original.size == historical.size == (1024, 1024)
    assert prompt['1']['inputs']['image'] == source.name
    assert prompt['1']['is_changed'] == [SOURCE_HASH]
    sampler = prompt['18']['inputs']
    assert (sampler['seed'], sampler['steps'], sampler['cfg'], sampler['denoise']) == (20260917, 4, 1.0, 0.65)
    old_delta = delta(original, historical)
    assert old_delta['outside_hand_roi_changed'] == 2935
    assert old_delta['hand_roi_changed'] == 3469
    # The rectangle was checked visually; it is NOT the original FASHN mask.
    for edge in ((570, 390, 670, 408), (570, 482, 670, 490),
                 (570, 390, 585, 490), (657, 390, 670, 490)):
        assert original.crop(edge).tobytes() == historical.crop(edge).tobytes()
    protected = original.copy()
    protected.paste(historical.crop(ROI), ROI[:2])
    new_delta = delta(original, protected)
    assert new_delta['outside_hand_roi_changed'] == 0
    assert new_delta['hand_roi_changed'] == 3469
    assert protected.crop(ROI).tobytes() == historical.crop(ROI).tobytes()
    out = TASK / 'research' / ('hands_evidence_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    out.mkdir(parents=True, exist_ok=False)
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('provenance', json.dumps({'operation': 'offline_roi_composite',
                      'source_sha256': SOURCE_HASH, 'historical_render_sha256': RENDER_HASH,
                      'roi_xyxy_exclusive': ROI, 'new_inference': False}, ensure_ascii=False))
    image_path = out / 'hands_protected.png'
    with image_path.open('xb') as handle:
        protected.save(handle, format='PNG', pnginfo=metadata)
    with Image.open(image_path) as saved:
        assert delta(original, saved.convert('RGB')) == new_delta
    preview = Image.new('RGB', (768, 300), '#f5f2e9')
    drawing = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=18)
    for index, (label, image) in enumerate((('ORIGINAL', original), ('OLD RENDER', historical), ('PROTECTED COPY', protected))):
        drawing.text((index * 256 + 10, 8), label, fill='#242424', font=font)
        crop = image.crop((565, 390, 680, 500)).resize((240, 230), Image.Resampling.NEAREST)
        preview.paste(crop, (index * 256 + 8, 42))
    thumb = out / 'hands_comparison_thumb.png'
    with thumb.open('xb') as handle:
        preview.save(handle, format='PNG', optimize=True)
    assert thumb.stat().st_size < 1_000_000
    for p in observed:
        assert sha(p) == before_hashes[str(p)], f'Concurrent change detected: {p}'
    evidence = {'generated_at': datetime.now().astimezone().isoformat(),
                'task': str(TASK), 'scope': 'historical-image audit and offline composite only',
                'roi_xyxy_exclusive': ROI, 'roi_is_segmentation_mask': False,
                'before': old_delta, 'after': new_delta,
                'protected_png': str(image_path), 'protected_sha256': sha(image_path),
                'preview_png': str(thumb), 'source_hashes': before_hashes,
                'observed_files_unchanged': True, 'installed_workflow_byte_identical': True,
                'checks': checks, 'new_engine_run': False, 'workflow_changed': False,
                'pipeline_root_cause_verified': False, 'user_visual_acceptance': False}
    with (out / 'evidence.json').open('x', encoding='utf-8') as handle:
        json.dump(evidence, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    report = f'''# 修手旧任务独立复验（2026-09-20）

本轮只新增审计证据及离线合成副本，未修改任务状态、PRD、源码、工作流、装机或引擎。没有新推理。

## 当前可复现结论

- 本轮修手契约测试 11/11 通过，graph lint 退出 0；完整命令和输出见 evidence.json。
- 仓库/已安装修手工作流逐字节一致，SHA256 `{sha(workflow)}`。
- 历史成图的 PNG 元数据载明输入 00005，input hash 与现存原图一致；seed=20260917，steps=4，cfg=1，denoise=0.65。
- 历史成图相对原图变动 6404 像素；手部人工审核矩形 ROI={ROI} 内 3469，外 2935。ROI 仅用于本张图审核，不是实际 FASHN 掩码。
- 新离线合成图只取历史成图的手部矩形，其余使用原图：手外变动=0，手内3469像素保留，裁切边界原本相同，重新读取保存PNG后验证通过。
- 此结果仅证明本张离线成图的背景保护，不证明共享工作流已根治，也不构成用户审美验收。原图、旧成图与所有已观察文件哈希均保持不变。

## 旧任务尚不能关闭的项目

1. PRD:56 写00009，PRD:63/73与实际成图是00005；验收样张口径未统一。
2. PRD:73 的「脸/发/衣/背景零改动」不能原样用于历史成图：下摆/右下角检测到手部ROI外差异。实际生成掩码未留档，不能仅由像素差断言 FASHN 误检根因。
3. PRD:5/44/46/70 仍为旧MY-名称或旧分类；当前工作流真实路径为 `{workflow.relative_to(REPO)}`。本轮不覆盖共享文档。
4. PRD:58 的53+全集门禁未跑；本轮仅证明11项修手契约与单图lint、装机字节一致。
5. 拢袖/负手批量对照、00009握持验证、用户肉眼验收仍未完成；不得勾选全任务完成或归档。

## 交付

- `hands_protected.png`：无新推理的手部离线合成副本。
- `hands_comparison_thumb.png`：原图/旧修手/保护副本的同区域对照。
- `evidence.json`：哈希、坐标、逐像素结果、测试原始输出。
- 复现：`python3 -B apps/build/scripts/daojie_hands_evidence_20260920.py`（每次新建独立证据目录，不覆盖）。

## 并行隔离

本轮开始前已确认其他近期会话为 K2-美术风格测试、角色设定bug修复、Yue2 音乐；它们的共享源文件与出图队列未动。三路只读 Terra 子代理均因403模型权限被拒，最终核验由主线程和本地并发命令完成。
'''
    with (out / 'report.md').open('x', encoding='utf-8') as handle:
        handle.write(report)
    print(json.dumps({'output_directory': str(out), 'before': old_delta, 'after': new_delta,
                      'checks': [c['exit_code'] for c in checks], 'source_files_unchanged': True,
                      'preview_bytes': thumb.stat().st_size}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
