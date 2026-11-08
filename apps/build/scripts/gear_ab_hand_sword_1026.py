# -*- coding: utf-8 -*-
"""档位 A/B 实弹:有手/剑主体句下 档0(Turbo 8步) vs 档1(原生40步) vs 档3(混动40步+缓存)。

设计(1026 手/武器/姿势根因调研的落地对拍):
  - 主体句 = t2i API 画布自带「筑基女修·挂鞘剑·右手搭鞘」(左右手分工写法,手+剑双要素);
  - 校准发:完整 PE 链(AI扩写 LM Studio)跑一发 Turbo,从 history outputs[401].ui.positive
    捕获「终稿全文」+ 画幅 —— 之后全部对比发冻结该终稿(消 PE 温度0.7 随机性,单变量=档位);
  - 对比发:3 档 × 3 seed 轮转(seed 外层),同图裁掉 SeedVR2 超分臂(省时,档位效应在上游),
    补齐原生/E混动两臂(照搬仓库加速子图真源接线,LoRA 栈/步数/cfg 逐字一致);
  - 失败不重掷(A/B 里废片也是数据),逐发计时+空片门禁仅记录不拦截。

真源:加速子图 apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图.json(canvas)
      与 my_nodes/nodes/my_qi21_speed_select.py(档位字符串硬契约)。
用法:python3 apps/build/scripts/campaigns/gear_ab_hand_sword_1026.py
产物:apps/output/trial_档位AB_手剑_1026/{calib,T,N,E}_*.png + manifest.json + run.log
"""
from __future__ import annotations

import copy
import json
import sys
import time
import urllib.request as ureq
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'apps/build/scripts'))
import comfy_fire_core as fc  # noqa: E402

ENGINE = 'http://127.0.0.1:17001'
API_JSON = REPO / 'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json'
OUT_DIR = REPO / 'apps/output/trial_档位AB_手剑_1026'
CALIB_SEED = 111111
SEEDS = [424242, 20261026, 778899]
GEARS = [('0 · Turbo 8步', 'T'), ('1 · 原生出图', 'N'), ('3 · 混动 40步+缓存', 'E')]
SAVE_PREFIX = 'QI21道劫文生图_'
CLIENT = 'gear_ab_1026'
DETAIL_FIX = 'qwen2.1-detail-fix-2.0.safetensors'

LOG_LINES: list[str] = []


def log(msg: str):
    line = time.strftime('[%H:%M:%S] ') + msg
    print(line, flush=True)
    LOG_LINES.append(line)


def preflight(tr):
    assert fc.engine_alive(tr), '引擎 17001 未响应'
    oi = tr.get_json('/object_info', timeout=30)
    for need in ('MyQi21SpeedSelect', 'LazyCache', 'KSampler', 'SamplerCustomAdvanced',
                 'BasicScheduler', 'MyQi21FastEncode', 'MyQi21PromptPreview'):
        assert need in oi, f'引擎缺节点 {need}'
    loras = set(oi['LoraLoaderModelOnly']['input']['required']['lora_name'][0])
    for need in (DETAIL_FIX, 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors',
                 'qi21-mikkoani.safetensors'):
        assert need in loras, f'引擎缺 LoRA {need}'
    fe_out = oi['MyQi21FastEncode']['output']
    assert len(fe_out) >= 2, f'FastEncode 输出数异常: {fe_out}'
    log(f'预检绿:节点/LoRA 齐备, FastEncode 输出 {fe_out}')


def strip_seedvr2(g: dict) -> dict:
    for nid in ('503:501', '503:502', '503:7401', '503:7402', '504'):
        g.pop(nid, None)
    return g


def add_arms(g: dict) -> dict:
    """照加速子图真源补 原生臂(7026→7010) 与 E混动臂(7044→7040/7041→7042→7043)。"""
    g['7:7026'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {
        'lora_name': DETAIL_FIX, 'strength_model': 1.0, 'model': ['7:7034', 0]}}
    g['7:7010'] = {'class_type': 'KSampler', 'inputs': {
        'model': ['7:7026', 0], 'seed': ['7:7014', 0], 'steps': 40, 'cfg': 1,
        'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0,
        'positive': ['4015', 0], 'negative': ['4015', 1], 'latent_image': ['4', 0]}}
    g['7:7044'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {
        'lora_name': DETAIL_FIX, 'strength_model': 1.0, 'model': ['7:7028', 0]}}
    g['7:7040'] = {'class_type': 'LazyCache', 'inputs': {
        'model': ['7:7044', 0], 'reuse_threshold': 0.2, 'start_percent': 0.15,
        'end_percent': 0.95, 'verbose': False}}
    g['7:7041'] = {'class_type': 'BasicScheduler', 'inputs': {
        'model': ['7:7044', 0], 'scheduler': 'simple', 'steps': 40, 'denoise': 1.0}}
    g['7:7042'] = {'class_type': 'BasicGuider', 'inputs': {
        'model': ['7:7040', 0], 'conditioning': ['4015', 0]}}
    g['7:7043'] = {'class_type': 'SamplerCustomAdvanced', 'inputs': {
        'noise': ['7:7017', 0], 'guider': ['7:7042', 0], 'sampler': ['7:7018', 0],
        'sigmas': ['7:7041', 0], 'latent_image': ['4', 0]}}
    sel = g['7:7015']['inputs']
    sel['latent_turbo'] = ['7:7031', 0]
    sel['latent_direct'] = ['7:7010', 0]
    sel['latent_e'] = ['7:7043', 0]
    return g


def freeze_prompt(g: dict, final_text: str, w: int, h: int) -> dict:
    """删除 PE 簇(401 预览是 OUTPUT_NODE 会拖起 ApiPE),终稿/画幅改静态注入。"""
    for nid in ('401', '6:4014', '6:4013', '6:4030', '6:4031', '6:4032'):
        g.pop(nid, None)
    g['900'] = {'class_type': 'PrimitiveStringMultiline', 'inputs': {'value': final_text}}
    g['4015']['inputs']['prompt'] = ['900', 0]
    g['4015']['inputs']['negative_prompt'] = ''
    wh = g['4018']['inputs']
    wh.pop('九型WIDTH', None)
    wh.pop('九型HEIGHT', None)
    wh['手动宽'] = w
    wh['手动高'] = h
    return g


def build(mode: str, seed: int, frozen: tuple[str, int, int] | None = None) -> dict:
    g = copy.deepcopy(json.loads(API_JSON.read_text())['graph'])
    strip_seedvr2(g)
    add_arms(g)
    if frozen is not None:
        freeze_prompt(g, *frozen)
    g['7:7015']['inputs']['mode'] = mode
    g['7:7014']['inputs']['value'] = seed
    return g


def fire(tr, graph: dict, tag: str, want_ui_text: bool = False):
    fc.maybe_free_memory(tr, log)
    t0 = time.monotonic()
    pid = fc.submit(tr, graph, CLIENT)
    img = fc.await_output(tr, pid, tag, filename_prefix=SAVE_PREFIX)
    secs = time.monotonic() - t0
    ui_text = None
    if want_ui_text:
        rec = tr.get_json('/history/' + pid, timeout=15).get(pid, {})
        out401 = rec.get('outputs', {}).get('401', {})
        # 引擎 0.42:文本载荷在 outputs 顶层键(非 ui 子键)
        ui_text = (out401.get('positive') or [None])[0]
    try:
        stats = fc.blank_gates(img, tag)
    except Exception as exc:  # 门禁只记录,A/B 废片也是数据
        stats = {'gate_fail': str(exc)[:120]}
    return pid, img, secs, ui_text, stats


def save(out: Path, name: str, img: bytes) -> Path:
    p = out / name
    p.write_bytes(img)
    return p


def main():
    out = OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    tr = fc.UrllibTransport(ENGINE)
    preflight(tr)
    if not fc.wait_queue_clear(tr, deadline_s=60):
        log('引擎队列非空,停线');  return 1
    manifest = {'engine': ENGINE, 'calib_seed': CALIB_SEED, 'seeds': SEEDS, 'shots': []}

    # ── 校准发:完整 PE 链(Turbo),捕获终稿+画幅 ──────────────────────
    log(f'校准发:完整PE链 Turbo seed={CALIB_SEED}(LM Studio 扩写中,耗时不计入对比)')
    pid, img, secs, ui_text, stats = fire(
        tr, build('0 · Turbo 8步', CALIB_SEED), f'calib_T_seed{CALIB_SEED}', want_ui_text=True)
    from PIL import Image
    import io as _io
    w, h = Image.open(_io.BytesIO(img)).size
    save(out, f'calib_T_seed{CALIB_SEED}.png', img)
    log(f'校准发完成 {secs:.0f}s {w}x{h} 终稿{len(ui_text or "")}字')
    if not ui_text:
        log('未能捕获终稿文本(outputs[401].ui),停线排查');  return 1
    (out / 'frozen_final_prompt.txt').write_text(ui_text)
    frozen = (ui_text, w, h)

    # ── 对比矩阵:seed 外层轮转,9 发 ─────────────────────────────────
    for seed in SEEDS:
        for mode, tag in GEARS:
            name = f'{tag}_seed{seed}.png'
            log(f'→ {mode} seed={seed}')
            try:
                pid, img, secs, ui_text, stats = fire(tr, build(mode, seed, frozen), name)
                save(out, name, img)
                manifest['shots'].append({'gear': mode, 'tag': tag, 'seed': seed,
                                          'secs': round(secs, 1), 'pid': pid, **stats})
                log(f'  完成 {secs:.0f}s {stats.get("kb")}KB fg={stats.get("fg", "?")}')
            except Exception as exc:
                manifest['shots'].append({'gear': mode, 'tag': tag, 'seed': seed,
                                          'error': str(exc)[:300]})
                log(f'  失败: {str(exc)[:200]}')
                if not fc.wait_queue_clear(tr, deadline_s=900):
                    log('  队列卡死,停线');  break
            time.sleep(5)

    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    (out / 'run.log').write_text('\n'.join(LOG_LINES))
    log(f'全部落盘 {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
