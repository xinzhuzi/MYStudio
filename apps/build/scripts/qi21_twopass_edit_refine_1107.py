#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1107 二采精修·Edit 模式施工:t2i API 模板接「同尺寸修图」二采段。

用户裁定(1107):
- 二采 = Qwen 2.1 Edit 模式(指令编辑,reference_latents 注入),非 KSampler 重采样;
- 出图尺寸 = 一采原尺寸(resolution=0,latent 画幅跟输入走,零放大零缩小);
- 二采只修图(手指/兵器等结构缺陷),挂「二采启用?」开关默认开。

接线(照产线 qi21-edit.json 官方 Edit 语义 + 1107 实弹验证配方):
  5  VAEDecode(一采) ──┬──────────────────────────────┐
  8100 修图指令(可编辑默认=通用修图句)                        │
  8101 MyQi21FinalOutput(透明模式=[6:4013,2] → RGBA 句包装)   │
  8102 MyQi21FastEncode(image_1=[5,0], resolution=0)  ← 一采图│
  8103 KSampler(model=[9]裸底模, 40步 cfg=1, seed=[7:7014,0]) │
  8104 VAEDecode                                            │
  8105 PrimitiveBoolean「二采启用?」default true               │
  8106 ComfySwitchNode(on_true=[8104], on_false=[5,0]) ←──────┘
  7500:7506 SplitImageWithAlpha.image 改吃 [8106,0]
  (SeedVR2 腿吃 7500:7510 出口,自动获得修后图,零改动)

幂等:8106 已在场则跳过。DRY_RUN=1 只验不写。
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TPL = os.path.join(
    REPO, 'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json')

# 通用修图指令(1107 人物海报实弹验证句的泛化;兵器件逐型可覆写 8100)
FIX_INSTRUCTION = (
    '保持<image1>的整体画面不变:人物五官、发型、服饰、姿态、构图、色彩与背景均保持原样。'
    '修复画面中的结构缺陷:人物手部每只手五指完整、逐指分明、解剖结构正确;'
    '兵器与物件结构连贯完整、比例合理。'
    '只做上述局部修复,不作重新构图或整体重绘。'
)


def build_nodes() -> dict:
    return {
        '8100': {'class_type': 'PrimitiveStringMultiline',
                 'inputs': {'value': FIX_INSTRUCTION}},
        '8101': {'class_type': 'MyQi21FinalOutput',
                 'inputs': {'透明模式': ['6:4013', 2],
                            '正向提示词': ['8100', 0],
                            '负向提示词': ''}},
        '8102': {'class_type': 'MyQi21FastEncode',
                 'inputs': {'prompt': ['8101', 0],
                            'negative_prompt': '',
                            'resolution': 0,
                            'clip': ['2', 0],
                            'vae': ['3', 0],
                            'images.image_1': ['5', 0]}},
        '8107': {'class_type': 'QwenImage21Cache',
                 'inputs': {'device': 'auto', 'dtype': 'default', 'model': ['1', 0]}},
        '8103': {'class_type': 'KSampler',
                 'inputs': {'seed': ['7:7014', 0],
                            'steps': 40, 'cfg': 1.0,
                            'sampler_name': 'euler', 'scheduler': 'simple',
                            'denoise': 1.0,
                            'model': ['8107', 0],
                            'positive': ['8102', 0],
                            'negative': ['8102', 1],
                            'latent_image': ['8102', 2]}},
        '8104': {'class_type': 'VAEDecode',
                 'inputs': {'samples': ['8103', 0], 'vae': ['3', 0]}},
        '8105': {'class_type': 'PrimitiveBoolean',
                 'inputs': {'value': True}},
        '8106': {'class_type': 'ComfySwitchNode',
                 'inputs': {'switch': ['8105', 0],
                            'on_true': ['8104', 0],
                            'on_false': ['5', 0]}},
    }


def main() -> int:
    dry = os.environ.get('DRY_RUN') == '1'
    doc = json.load(open(TPL, encoding='utf-8'))
    g = doc['graph']

    # 前置锚:依赖节点必须在场
    for anchor in ('1', '5', '2', '3', '6:4013', '7:7014', '7500:7506'):
        assert anchor in g, f'前置锚缺失: {anchor}'

    if '8106' in g:
        already = g['7500:7506']['inputs']['image'] == ['8106', 0]
        print(f'[幂等] 8106 已在场,alpha 链入口已接修图开关: {already}')
        return 0

    g.update(build_nodes())
    old_src = g['7500:7506']['inputs']['image']
    g['7500:7506']['inputs']['image'] = ['8106', 0]
    print(f'[接线] 7500:7506.image: {old_src} -> ["8106", 0]')
    print(f'[节点] 新增 8100-8106 共 7 件,模板节点数 {len(g) - 7} -> {len(g)}')

    if dry:
        print('[DRY_RUN] 未写盘')
        return 0
    with open(TPL, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'[写盘] {os.path.relpath(TPL, REPO)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
