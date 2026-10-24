"""晏燎十境正视图量产(1023 用户令:复刻其验证过的双参考配方,3·混动40步+缓存)。

模板=用户实弹成功图(/tmp/user_fire_graph.json, 图生图 43880064): <image1>=基底(画布/人物)
+ <image2>=境界正视图(衣物源), 指令=官方 <imageN> 标签文体; 出图链内含 SeedVR2 2K(超分2K)。
产物=apps/output/晏燎/trial_基准/晏燎_{境}期_正视图_v1.png(练气=用户样张保留,本脚本跑筑基→共主九境)。
纪律(10-24 迁移 comfy_fire_core): 串行单发+发间查内存; 失败分类重掷(空片内容判废/瞬时→换 seed+1000
重掷一次且先过队列清零闸, 门禁拒单类确定性失败不重掷直报); deadline 可配(--deadline/env);
日志=apps/output/晏燎/stage_fronts_1023.log。
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ROLE = Path('/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎')
OUT = ROOT / 'apps/output/晏燎/trial_基准'
LOG = ROOT / 'apps/output/晏燎/stage_fronts_1023.log'
TEMPLATE = Path('/tmp/user_fire_graph.json')
ENGINE = 'http://127.0.0.1:17001'

# 稳定出图核心(10-24 stable-fire-core): 失败分类重掷/队列清零闸/可配 deadline/边界环锚
# /上传三层防线/内存纪律(单一实现, 两入口共用)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import comfy_fire_core as firecore  # noqa: E402

# 九境提示词真源=apps/output/晏燎/stage_prompts_1023.json(衣物段取自晏燎.json逐境描述)
STAGES = {}
PROMPT_TMPL = ('保持<image1>中人物与站姿不变，把<image2>中人物所穿的整套衣物穿在这名人物身上：{cloth}；'
               '衣物合身自然，衣料垂坠，结构褶疏落二至四条；'
               '保留<image1>原有面部特征、发型、身形与体型，保持<image1>的取景、构图与人物在画面中的大小和位置完全不变，'
               '保留<image1>的米白底背景，整体画风与色调与<image1>一致，其余未提及之处保持原样。')


def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


PROMPTS = {}


def fire_stage(stage, ref2_name, graph, seed=None):
    g = json.loads(json.dumps(graph))
    g['400']['inputs']['value'] = PROMPTS[stage]
    g['11']['inputs']['image'] = ref2_name  # = 引擎返回名(三层防线②)
    if seed is not None:
        g['7:7014']['inputs']['value'] = seed  # 重掷换 seed(旧实现重跑同图, 无意义)
    tr = firecore.UrllibTransport(ENGINE)
    firecore.maybe_free_memory(tr, log)  # 每次尝试(含重掷)同受检, 失败吞错
    pid = firecore.submit(tr, g, f'stage-{stage}')
    log(f'{stage} 提交 {pid}' + (f' (seed={seed})' if seed is not None else ''))
    b = firecore.await_output(tr, pid, stage, filename_prefix='MYStudio-2K')
    # 空片门禁(1023 用户令: 参考图必须完整): 单一实现=firecore.blank_gates(阈值不变)
    s = firecore.blank_gates(b, stage, min_bytes=400_000, min_fg=0.08)
    dest = OUT / f'晏燎_{stage}_正视图_v1.png'
    dest.write_bytes(b)
    log(f'{stage} 完成 → {dest.name} {s["kb"]}KB 内容占比{s["fg"] * 100:.0f}%')
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--stage', action='append', help='只跑指定境(可多次传); 缺省=全部')
    ap.add_argument('--seed', type=int, help='显式基础 seed(缺省=模板默认; 重掷=+1000)')
    ap.add_argument('--force', action='store_true', help='目标已存在仍重发(显式重做通道)')
    ap.add_argument('--deadline', type=float,
                    help='单发轮询 deadline 秒(缺省 900 / env MYSTUDIO_FIRE_DEADLINE_S)')
    args = ap.parse_args()
    if args.deadline is not None:
        os.environ['MYSTUDIO_FIRE_DEADLINE_S'] = str(args.deadline)
    for _n, (_f, _c, _p) in json.loads(
            (ROOT / 'apps/output/晏燎/stage_prompts_1023.json').read_text()).items():
        STAGES[_n] = (_f, _c)
        PROMPTS[_n] = _p
    if args.stage:
        unknown = [s for s in args.stage if s not in STAGES]
        if unknown:
            ap.error(f'未知境名: {unknown}(可选: {list(STAGES)})')
        for s in list(STAGES):
            if s not in args.stage:
                STAGES.pop(s)
    assert TEMPLATE.exists(), '模板图缺失(/tmp/user_fire_graph.json)'
    tr = firecore.UrllibTransport(ENGINE)
    # 引擎在驾守卫(预上传前): 未起则收官退出, 不裸 traceback(grill 1024 R2 观察项)
    if not firecore.wait_engine(tr, deadline_s=30):
        log('=== 引擎未在驾(30s 探活失败), 收官退出: 请按引擎重启配方拉起后续发 ===')
        return 1
    graph = json.loads(TEMPLATE.read_text())
    # 预上传衣物参考: 三层防线(overwrite+引擎返回名+md5 回拉), 图里用引擎实载名
    engine_names = {}
    for stage, (fname, _) in STAGES.items():
        engine_names[stage] = firecore.upload_image(tr, ROLE / fname)
        log(f'upload 三层防线过: {fname} → 引擎实载 {engine_names[stage]}')
    log(f'参考上传完毕×{len(STAGES)} | 模板=用户实弹43880064 | 逐境串行开跑')
    ok, fail = [], []
    for stage, (fname, _) in STAGES.items():
        dest = OUT / f'晏燎_{stage}_正视图_v1.png'
        if dest.exists() and not args.force:
            log(f'{stage} 已存在, 跳过(显式重做加 --force)')
            ok.append(stage)
            continue
        base_seed = args.seed if args.seed is not None else 0  # 0=模板默认(seed=None)
        rc, cls = firecore.fire_with_discipline(
            lambda s, st=stage: fire_stage(st, engine_names[st], graph,
                                           seed=(s if s else None)),
            base_seed, stage, tr, log)
        if rc == 0:
            ok.append(stage)
            continue
        fail.append(stage)
        # 停线判据(grill 1024 R2-N1): 瞬时类或队列忙=引擎健康未知/并发在途 → 全线停
        if 'transient' in cls or 'queue-busy' in cls:
            log(f'=== {stage} 瞬时/队列忙失败[{cls}], 全线停线(并发在途防线, 12 连败教训): '
                f'未跑境不再发包, 人工核查引擎/队列后续发 ===')
            break
    log(f'=== 收官: 成功 {len(ok)} {ok} | 失败 {len(fail)} {fail} ===')
    return 0 if not fail else 1


if __name__ == '__main__':
    sys.exit(main())
