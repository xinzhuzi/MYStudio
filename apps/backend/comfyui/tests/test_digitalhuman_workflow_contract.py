#!/usr/bin/env python3
"""数字人/无限时长 UI 画布件契约测试(1111 嫁接役 Part C)。

锚定两件: 2_视频/H3视频/1_漫影自研/2_数字人/{数字人-音频驱动,无限时长-循环拼接}.json
生成器: apps/build/scripts/digitalhuman_ui_build_1111.py(幂等)
"""
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WF_DIR = os.path.normpath(os.path.join(HERE, '..', 'workflows', '2_视频', 'H3视频',
                                       '1_漫影自研', '2_数字人'))
AUDIO_WF = os.path.join(WF_DIR, '数字人-音频驱动.json')
UNLIM_WF = os.path.join(WF_DIR, '无限时长-循环拼接.json')

UNET = 'Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors'
LORA = 'pika_h3_flex_ref2va_comfy_bf16.safetensors'
SIGMAS = '1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0'
ALLOWED_CLASSES = {
    'LoadImage', 'LoadAudio', 'CLIPLoader', 'VAELoader', 'UNETLoader', 'LoraLoaderModelOnly',
    'PrimitiveStringMultiline', 'MiniMaxH3ReferenceToVideo', 'TrimAudioDuration',
    'MiniMaxH3NativeAudioLock', 'MiniMaxH3MotionContextLoadLatent', 'MiniMaxH3MotionContext',
    'MiniMaxH3MotionContextSaveLatent', 'MiniMaxH3MotionContextTrim', 'BasicGuider', 'RandomNoise',
    'SamplerCustomAdvanced', 'ManualSigmas', 'KSamplerSelect', 'VAEDecode', 'VAEDecodeAudio',
    'ImageFromBatch', 'CreateVideo', 'SaveVideo', 'AudioConcat', 'SaveAudio', 'Note',
}


def load(path):
    with open(path) as f:
        return json.load(f)


def by_type(wf, t):
    return [n for n in wf['nodes'] if n['type'] == t]


class TestBoth(unittest.TestCase):
    def test_files_exist_and_named(self):
        for p in (AUDIO_WF, UNLIM_WF):
            self.assertTrue(os.path.exists(p), p)
            self.assertNotIn('MY-', os.path.basename(p))
            self.assertNotIn('_', os.path.basename(p))

    def test_all_classes_allowed(self):
        for p in (AUDIO_WF, UNLIM_WF):
            wf = load(p)
            for n in wf['nodes']:
                self.assertIn(n['type'], ALLOWED_CLASSES, f"{p}:{n['id']} {n['type']}")

    def test_model_params_pinned(self):
        for p in (AUDIO_WF, UNLIM_WF):
            wf = load(p)
            self.assertEqual(by_type(wf, 'UNETLoader')[0]['widgets_values'][0], UNET)
            self.assertEqual(by_type(wf, 'LoraLoaderModelOnly')[0]['widgets_values'][0], LORA)
            self.assertEqual(by_type(wf, 'ManualSigmas')[0]['widgets_values'][0], SIGMAS)
            self.assertEqual(by_type(wf, 'CreateVideo')[0]['widgets_values'][0], 24)

    def test_links_no_dangling_no_overflow(self):
        for p in (AUDIO_WF, UNLIM_WF):
            wf = load(p)
            ids = {n['id'] for n in wf['nodes']}
            for lid, oid, oslot, iid, iidx, _ in wf['links']:
                self.assertIn(oid, ids, f'link{lid} 源缺失')
                self.assertIn(iid, ids, f'link{lid} 目标缺失')
                src = next(n for n in wf['nodes'] if n['id'] == oid)
                self.assertLess(oslot, len(src['outputs']), f'link{lid} 源slot越界')
                dst = next(n for n in wf['nodes'] if n['id'] == iid)
                self.assertLess(iidx, len(dst['inputs']), f'link{lid} 目标slot越界')
                self.assertEqual(dst['inputs'][iidx]['link'], lid)

    def test_groups_cover_members(self):
        """组框罩全立宪:与组框交叠的节点必须整罩(允许组外独立节点)。"""
        for p in (AUDIO_WF, UNLIM_WF):
            wf = load(p)
            for grp in wf['groups']:
                bx, by, bw, bh = grp['bounding']
                for n in wf['nodes']:
                    if n['type'] == 'Note':
                        continue
                    nx, ny = n['pos']
                    nw, nh = n['size']
                    overlap = not (nx + nw < bx or nx > bx + bw or ny + nh < by or ny > by + bh)
                    inside = (nx >= bx - 12 and ny >= by - 12 and
                              nx + nw <= bx + bw + 12 and ny + nh <= by + bh + 12)
                    self.assertFalse(overlap and not inside,
                                     f"组[{grp['title']}]交叠未罩全: 节点{n['id']}({n['type']})")


class TestAudioVariant(unittest.TestCase):
    def test_audio_channels(self):
        wf = load(AUDIO_WF)
        self.assertEqual(len(by_type(wf, 'LoadAudio')), 1)
        self.assertEqual(len(by_type(wf, 'MiniMaxH3NativeAudioLock')), 3, '三段各一锁')
        self.assertEqual(len(by_type(wf, 'TrimAudioDuration')), 3)
        # 每段 R2V 的 ref_audios.ref_audio_0 已连
        for r2v in by_type(wf, 'MiniMaxH3ReferenceToVideo'):
            slot = next((s for s in r2v['inputs'] if s['name'] == 'ref_audios.ref_audio_0'), None)
            self.assertIsNotNone(slot)
            self.assertIsNotNone(slot['link'])
        self.assertEqual(by_type(wf, 'KSamplerSelect')[0]['widgets_values'][0], 'euler_ancestral')
        self.assertEqual(len(by_type(wf, 'ImageFromBatch')), 2, '段1/2 各跳22帧桥')

    def test_segment_lengths_grid(self):
        wf = load(AUDIO_WF)
        lens = sorted(n['widgets_values'][3] for n in by_type(wf, 'MiniMaxH3ReferenceToVideo'))
        self.assertEqual(lens, [73, 192, 192])
        for ln in lens:
            self.assertEqual(ln % 17, 5, f'{ln} 不在 H3 网格')


class TestUnlimitedVariant(unittest.TestCase):
    def test_unlimited_channels(self):
        wf = load(UNLIM_WF)
        self.assertEqual(len(by_type(wf, 'LoadAudio')), 0)
        self.assertEqual(len(by_type(wf, 'MiniMaxH3NativeAudioLock')), 0)
        self.assertEqual(len(by_type(wf, 'MiniMaxH3MotionContextTrim')), 2, '段1/2 各剪桥')
        self.assertEqual(len(by_type(wf, 'VAEDecodeAudio')), 3, '三段各解码自产音轨')
        self.assertEqual(len(by_type(wf, 'AudioConcat')), 2, '两两接力')
        self.assertEqual(len(by_type(wf, 'SaveAudio')), 1, '音轨收口一件')
        self.assertEqual(by_type(wf, 'KSamplerSelect')[0]['widgets_values'][0], 'lcm')
        self.assertEqual(len(by_type(wf, 'BlockSparseAttention')), 0, '默认裸链=作者保真')

    def test_bridge_pairing(self):
        """SaveLatent[i-1] → LoadLatent[i] latent_path 字符串链=执行序保证。"""
        wf = load(UNLIM_WF)
        saves = {n['widgets_values'][1]: n['id'] for n in by_type(wf, 'MiniMaxH3MotionContextSaveLatent')}
        loads = by_type(wf, 'MiniMaxH3MotionContextLoadLatent')
        self.assertEqual(len(loads), 2)
        for ld in loads:
            idx = ld['widgets_values'][1]
            self.assertIn(idx - 1, saves, f'LoadLatent[{idx}] 无配对 SaveLatent[{idx-1}]')


if __name__ == '__main__':
    unittest.main()
