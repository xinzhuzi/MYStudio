"""晏燎十境 KV(海报+三视图)单发量产 1023(②路=产物不透明米白底)。

CLI: --stage <境名> --kind poster|viewsheet 单发; --check 只预检全部门禁不发包。
外层串行驱动逐发调用(本脚本无全量 for 循环); 幂等=目标文件已存在即 exit 0 跳过。

指令真源=apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json
(10-24 缺件重做役切换: 原 kv_prompts_1023.json ②路短文已废, 十境海报指令整卷重写为
长文版; 三视图指令新旧同文)。防篡改锚=本文件 FINGERPRINT_ANCHOR 冻结常量(--check
指纹漂移即红: 有意改源须同步改锚并复跑 --check); 不透明强制点=[6:180] MyQi21RgbaSelect
.mode='false', 真值表见 my_qi21_rgba_select.py:13-16, 装配器对透明型恒剥中文
透明声明、FinalOutput 透明关=装配全文原样——my_qi21_prompt_assembly.py:379)。

模板=apps/output/晏燎/user_fire_template_1023.json(/tmp/user_fire_graph.json
仓内落档, 用户实弹 43880064 验证图 62 节点); 单参考纪律=上传 trial_基准/
晏燎_{境}期_正视图_v1.png 进 [10], 删节点 11/17+摘 [4015].images.image_2 与
[6:25].images.image1(BatchImagesNode=Autogrow min=1, 摘后合法; 其唯一消费者
[6:4013] TextGenerate 在 PE lazy 支路, pe开关=false 不拉起)。

upload 三层防线(引擎 input 区同名旧件高危): ①multipart 加 overwrite=true;
②捕获响应返回名设 [10].inputs.image(引擎同名异容静默改名「名 (1).png」);
③GET /view?type=input 拉回字节 md5 与本地件比对, 不一致停线。

引擎纪律(10-24 迁移 comfy_fire_core 稳定核心): 串行单发; 发前 memory_pressure 空闲
<30% 先 POST /free; 失败分类重掷——空片/画幅/alpha 内容判废与超时断连→重掷 seed+1000
一次且先过队列清零闸(杀并发在途通道), 门禁拒单类确定性失败不重掷直报; deadline 可配
(--deadline / env MYSTUDIO_FIRE_DEADLINE_S, 缺省 900); 内容判废重做=--force --seed
显式通道(替代 import fire_once hack); 空片门禁(文件<400KB 或 非背景占比<8% 弃用,
背景锚=边界环中位, env MYSTUDIO_FIRE_ANCHOR=pixel 可回旧单像素口径) + alpha 门禁
(全透占比>10% 判失败, 与参考图口径一致) + 画幅门禁(宽高比 1.78±0.05, SeedVR2 短边
2048 量化浮动容差); 取片锚=[504] 前缀 MYStudio-2K; 日志=apps/output/晏燎/
stage_poster_viewsheet_1023.log; 图片只进 apps/output/晏燎/trial_基准。

--check 门禁(20 条指令, 全绿 exit 0): 门1=_gongbi_gate.prompt_violations
(is_subject=True, 道劫美术类型在 my_qi21_prompt_assembly.py:348-349 走的真实
主体句全查门) + 否定词正则(_NEG_EXTRA 族, 官方保留语「保持…不变/其余未提及
之处保持原样」先豁免; 运行时否定式族已含于门1)+ 门2=daojie_subject_overlap
--base 美宣/人物多视图(09 篇 §三.8 两门复跑纪律) + 指纹复算 + 模板结构断言;
不发包不碰引擎。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/晏燎/trial_基准'
LOG = ROOT / 'apps/output/晏燎/stage_poster_viewsheet_1023.log'
TEMPLATE = ROOT / 'apps/output/晏燎/user_fire_template_1023.json'
TEMPLATE_SRC = Path('/tmp/user_fire_graph.json')  # 仓内模板缺档时自愈来源(仅 cp, 不出图)
KV = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json'
ENGINE = 'http://127.0.0.1:17001'
OVERLAP = ROOT / 'apps/build/scripts/daojie_subject_overlap.py'

ORDER = ['1.炼气期', '2.筑基期', '3.金丹期', '4.元婴期', '5.化神期',
         '6.炼虚期', '7.合体期', '8.渡劫期', '9.大乘期', '10.共主期']
KIND_ZH = {'poster': '海报', 'viewsheet': '三视图'}
KIND_BASE = {'poster': '美宣', 'viewsheet': '人物多视图'}
# 真源防篡改锚(10-24 冻结; 同日随源收口重钉): 指纹=20 条指令 sha256 前 12 位。
# 晏燎.json 被改即漂移红; 有意改源(用户令)须同步改此常量并复跑 --check 全绿再发包。
# 锚账: e5f099923336=10-24 首冻 → 57a81bbce29c=10-24 二钉(真源「1024 终版」收口: 缺件
#   海报/三视图补齐+握剑三锁[五指实握贴柄/剑身一线贯通/剑尖屏幕左下]+共主海报扩写,
#   配套交付档 apps/output/晏燎/缺件出图指令_1024.md; 收口当日 09:37/09:43 两笔在途写,
#   锚钉 09:43 终值并经 5 分钟稳定窗核验。按契约④改真源→同步改锚→复跑 --check)。
FINGERPRINT_ANCHOR = '57a81bbce29c'

# 门禁真身=my_nodes 产线常跑门(装配节点同款 import)
sys.path.insert(0, str(ROOT / 'apps/backend/comfyui/my_nodes/nodes'))
from _gongbi_gate import prompt_violations  # noqa: E402

# 稳定出图核心(10-24 stable-fire-core):失败分类重掷/队列清零闸/可配 deadline/边界环锚
sys.path.insert(0, str(Path(__file__).resolve().parent))
import comfy_fire_core as firecore  # noqa: E402

# 否定词正则(门1 的 _NEG 运行时族之外补充扫; 官方保留语先豁免——
# 「保持…不变」=09 篇例二原文/「其余未提及之处保持原样」=官方模板 preserve 句)
_PRESERVE = re.compile(r'保持[^。；]{0,30}不变|其余未提及之处保持原样')
_NEG_EXTRA = re.compile(
    r'避免|切勿|无需|无须|没有|不穿|不戴|不持|不佩|未穿|未戴|未持|无衣|无饰|无物|无背景')

# 模板结构断言集(单发手术与覆写点全在位)
_NEED_NODES = {'10', '11', '16', '17', '20', '4', '171', '400', '4015', '6:25',
               '6:153', '6:180', '6:4010', '6:4011', '6:4014', '6:4018',
               '6:4022', '7:7014', '7:7015', '504', '503:7401'}


def log(msg):
    line = f'[{time.strftime("%m-%d %H:%M:%S")}] {msg}'
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def load_kv() -> dict:
    data = json.loads(KV.read_text(encoding='utf-8'))
    stages = [{'stage': k, 'posterPrompt': v['海报指令'], 'viewsheetPrompt': v['三视图指令']} for k, v in data['stages']['境界'].items()]
    assert [s['stage'] for s in stages] == ORDER, '晏燎.json stages.境界 序与十境 ORDER 不符'
    data['stages'] = stages
    return data


def stage_base(stage: str) -> str:
    """「1.炼气期」→「练气期」(去序基名; 1023 字符规约: 该境文件名随 store 七月件用「练」, 其余境字面)。"""
    base = stage.split('.', 1)[1]
    return '练气期' if base == '炼气期' else base


def prompt_of(kv: dict, stage: str, kind: str) -> str:
    s = next(x for x in kv['stages'] if x['stage'] == stage)
    return s['posterPrompt'] if kind == 'poster' else s['viewsheetPrompt']


def seed_for(stage: str, kind: str) -> int:
    """发序 seed 1..20(每境先海报后三视图); 重掷=+1000。"""
    i = ORDER.index(stage)
    return 2 * i + (1 if kind == 'poster' else 2)


def negative_hits(text: str) -> list[str]:
    """否定词正则(豁免官方保留语后扫 _NEG_EXTRA 补充族)。"""
    return list(dict.fromkeys(m.group(0) for m in _NEG_EXTRA.finditer(_PRESERVE.sub('', text))))


def fingerprint(kv: dict) -> str:
    vals = []
    for s in kv['stages']:
        vals.append(s['posterPrompt'])
        vals.append(s['viewsheetPrompt'])
    return hashlib.sha256(''.join(vals).encode('utf-8')).hexdigest()[:12]


# ── 模板 ─────────────────────────────────────────────────────────────
def ensure_template() -> dict:
    """仓内模板在位(缺则自 /tmp cp 落档)+结构断言; 返回模板图。"""
    if not TEMPLATE.exists():
        assert TEMPLATE_SRC.exists(), (
            f'模板缺档: {TEMPLATE} 与自愈源 {TEMPLATE_SRC} 均不在——'
            '请先按发车计划 cp /tmp/user_fire_graph.json 落档仓内')
        shutil.copyfile(TEMPLATE_SRC, TEMPLATE)
        log(f'模板自愈 cp: {TEMPLATE_SRC} → {TEMPLATE}')
    g = json.loads(TEMPLATE.read_text(encoding='utf-8'))
    missing = _NEED_NODES - set(g)
    assert not missing, f'模板缺节点: {sorted(missing)}'
    # 维持档断言(计划「维持」四点, 模板漂移即拒发)
    assert g['6:4014']['inputs']['pe开关'] is False, '模板 [6:4014] pe开关 应为 false'
    assert g['7:7015']['inputs']['mode'] == '3 · 混动 40步+缓存', '模板 [7:7015] 采样档漂移'
    assert g['6:4018']['inputs']['手动宽'] == 0 and g['6:4018']['inputs']['手动高'] == 0, \
        '模板 [6:4018] 手动宽/高应为 0(九型宽高直通)'
    assert g['503:7401']['inputs']['resolution'] == 2048, '模板 [503:7401] resolution 应为 2048'
    return g


# ── 单参考手术 + 覆写 ────────────────────────────────────────────────
def build_graph(kind: str, instruction: str, seed: int, ref_name: str) -> dict:
    g = json.loads(json.dumps(ensure_template()))
    # 单参考纪律: 删 11/17+摘下游引用(悬空链过不了 validate_inputs)
    for dead in ('11', '17'):
        g.pop(dead)
    g['4015']['inputs'].pop('images.image_2', None)
    g['6:25']['inputs'].pop('images.image1', None)
    # 防御性再扫: 残余引用 11/17 的输入一律摘除
    for n in g.values():
        for k in [k for k, v in n.get('inputs', {}).items()
                  if isinstance(v, list) and v and str(v[0]) in ('11', '17')]:
            n['inputs'].pop(k)
    # 覆写(按计划 firingConfig.overrides)
    g['400']['inputs']['value'] = instruction
    g['6:4010']['inputs']['base'] = KIND_BASE[kind]
    g['6:4010']['inputs']['透明覆盖'] = False
    g['6:4011']['inputs']['组装用途'] = '道劫美术类型'
    g['6:4022']['inputs']['组装用途'] = '道劫美术类型'
    g['6:180']['inputs']['mode'] = 'false'  # ②路强制不透明(手动权威恒 False)
    g['7:7014']['inputs']['value'] = seed
    g['10']['inputs']['image'] = ref_name  # 三层防线②: 引擎返回名
    return g


# ── 引擎纪律(沿 stage_fronts 骨架) ──────────────────────────────────
def mem_free_pct() -> float:
    """委托核心(单一实现); 留壳保既有导入面。"""
    return firecore.mem_free_pct()


def upload_threelayer(img_path: Path) -> str:
    """三层防线(单一实现=firecore.upload_image): overwrite+引擎返回名+md5 回拉。"""
    name = firecore.upload_image(firecore.UrllibTransport(ENGINE), img_path)
    log(f'upload 三层防线过: {img_path.name} → 引擎实载 {name}')
    return name


def assert_ref_background(img_path: Path):
    """参考背景态断言(09 篇 §三.5 去除锚实存证): 不透明占比≥80% 且 近白占比≥30%。"""
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(img_path).convert('RGBA'), dtype=np.uint8)
    opaque = float((a[..., 3] > 253).mean())
    near_white = float(((a[..., 3] > 253) & (a[..., :3] > 230).all(axis=2)).mean())
    if opaque < 0.80 or near_white < 0.30:
        raise RuntimeError(f'参考背景态断言不过: 不透明{opaque * 100:.1f}%(需≥80) '
                            f'近白{near_white * 100:.1f}%(需≥30) ——停线({img_path.name})')


def gates_and_save(b: bytes, dest: Path, tag: str):
    """空片+alpha+画幅三门禁(单一实现=firecore.blank_gates, 阈值不变, 锚=边界环中位); 过则落盘。"""
    s = firecore.blank_gates(b, tag, min_bytes=400_000, min_fg=0.08,
                             max_full_trans=0.10, want_ratio=1.78, ratio_tol=0.05)
    dest.write_bytes(b)
    log(f'{tag} 完成 → {dest.name} {s["kb"]}KB 内容占比{s["fg"] * 100:.0f}% '
        f'全透{s["full_trans"] * 100:.1f}% 画幅{s["w"]}×{s["h"]}')
    return dest


def fire_once(stage: str, kind: str, seed: int) -> Path:
    base = stage_base(stage)
    ref = OUT / f'晏燎_{base}_正视图_v1.png'
    assert ref.exists(), f'参考正视图缺档: {ref}(外层须先过该境验收/补件)'
    assert_ref_background(ref)
    tag = f'{stage}-{kind}'
    instruction = prompt_of(load_kv(), stage, kind)
    ref_name = upload_threelayer(ref)
    g = build_graph(kind, instruction, seed, ref_name)
    tr = firecore.UrllibTransport(ENGINE)
    firecore.maybe_free_memory(tr, log)  # 提交前内存纪律(每次尝试含重掷同受检, 失败吞错)
    pid = firecore.submit(tr, g, f'kv-{base}-{kind}')
    log(f'{tag} 提交 {pid} (seed={seed} base={KIND_BASE[kind]} 指令{len(instruction)}字)')
    b = firecore.await_output(tr, pid, tag, filename_prefix='MYStudio-2K')
    return gates_and_save(b, OUT / f'晏燎_{base}_{KIND_ZH[kind]}_v1.png', tag)


def fire_shot(stage: str, kind: str, seed: int = None, force: bool = False) -> int:
    dest = OUT / f'晏燎_{stage_base(stage)}_{KIND_ZH[kind]}_v1.png'
    if dest.exists() and not force:
        log(f'{stage}-{kind} 已存在, 幂等跳过 → {dest.name}(显式重做加 --force)')
        return 0
    if seed is None:
        seed = seed_for(stage, kind)
    tr = firecore.UrllibTransport(ENGINE)
    rc, _cls = firecore.fire_with_discipline(
        lambda s: fire_once(stage, kind, s), seed, f'{stage}-{kind}', tr, log)
    return rc


# ── --check: 只预检全部门禁, 不发包不碰引擎 ──────────────────────────
def run_check() -> int:
    kv = load_kv()
    fails = 0
    for s in kv['stages']:
        st = s['stage']
        for kind, key in (('poster', 'posterPrompt'), ('viewsheet', 'viewsheetPrompt')):
            text = s[key]
            tag = f'{st}-{kind}'
            v = prompt_violations(text, is_subject=True)  # 门1: 主体句全查门(运行时同款)
            if v:
                fails += 1
                print(f'❌ 门禁[{tag}]: {v}')
            neg = negative_hits(text)  # 否定词正则(保留语豁免后)
            if neg:
                fails += 1
                print(f'❌ 否定词[{tag}]: {neg}')
            r = subprocess.run([sys.executable, str(OVERLAP), '--base', KIND_BASE[kind],
                                '--subject', text], capture_output=True, text=True)
            out = (r.stdout + r.stderr).strip()
            if not (r.returncode == 0 and '零重复' in out):
                fails += 1
                print(f'❌ 预检[{tag}] rc={r.returncode}: {out[:400]}')
            else:
                print(f'✅ {tag}: 门禁零违规+否定词零+{out.splitlines()[0]}')
    # 指纹复算(发射一致性背书; 锚=本文件冻结常量, 漂移即红=晏燎.json 被改)
    fp = fingerprint(kv)
    if fp != FINGERPRINT_ANCHOR:
        fails += 1
        print(f'❌ 指纹复算 {fp} ≠ 冻结锚 {FINGERPRINT_ANCHOR}(真源被改: '
              '有意改源须同步更新 FINGERPRINT_ANCHOR 并复跑 --check)')
    else:
        print(f'✅ 指纹复算 = {fp} (= 冻结锚, 真源未漂移)')
    # 模板结构+手术演习
    try:
        g = build_graph('viewsheet', '检查用指令', 99, 'check.png')
        assert '11' not in g and '17' not in g
        dangling = [f'{nid}.{k}' for nid, n in g.items()
                    for k, v in n.get('inputs', {}).items()
                    if isinstance(v, list) and v and str(v[0]) in ('11', '17')]
        assert not dangling, f'手术后悬空引用: {dangling}'
        print('✅ 模板结构断言+单参考手术演习过(62 节点源, 维持档四点在位)')
    except Exception as exc:
        fails += 1
        print(f'❌ 模板/手术检查: {exc}')
    # 参考在位情况(信息项, 不判红——发车由外层按验收过的境界传 --stage)
    missing = [st for st in ORDER if not (OUT / f'晏燎_{stage_base(st)}_正视图_v1.png').exists()]
    print(f'ℹ️ 参考正视图在位 {len(ORDER) - len(missing)}/{len(ORDER)}'
          + (f', 缺: {missing}(外层补件/验收后发)' if missing else ''))
    print(f'=== --check 收官: 20 条指令, 失败 {fails} ===')
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--stage', help='境名(全名「1.炼气期」或基名; 注意第 1 境基名为「练气期」)')
    ap.add_argument('--kind', choices=['poster', 'viewsheet'])
    ap.add_argument('--check', action='store_true', help='只预检全部门禁, 不发包')
    ap.add_argument('--seed', type=int, help='显式 seed(缺省=发序 seed; 重做配 --force)')
    ap.add_argument('--force', action='store_true',
                    help='目标已存在仍重发(内容判废显式重做通道, 替代 import fire_once hack)')
    ap.add_argument('--deadline', type=float,
                    help='单发轮询 deadline 秒(缺省 900 / env MYSTUDIO_FIRE_DEADLINE_S)')
    args = ap.parse_args()
    if args.check:
        return run_check()
    if args.deadline is not None:
        os.environ['MYSTUDIO_FIRE_DEADLINE_S'] = str(args.deadline)
    if not (args.stage and args.kind):
        ap.error('--stage 与 --kind 成对必填(单发), 或用 --check')
    load_kv()  # 指令真源在位校验
    full = args.stage if args.stage in ORDER else next(
        (st for st in ORDER if stage_base(st) == args.stage), None)
    if full is None:
        ap.error(f'未知境名: {args.stage}(可选: {ORDER})')
    return fire_shot(full, args.kind, seed=args.seed, force=args.force)


if __name__ == '__main__':
    sys.exit(main())
