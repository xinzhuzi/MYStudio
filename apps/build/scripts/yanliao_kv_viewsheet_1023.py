"""晏燎十境 KV(海报+三视图)单发量产 1023(②路=产物不透明米白底)。

CLI: --stage <境名> --kind poster|viewsheet 单发; --check 只预检全部门禁不发包。
外层串行驱动逐发调用(本脚本无全量 for 循环); 幂等=目标文件已存在即 exit 0 跳过。

指令真源=apps/output/晏燎/kv_prompts_1023.json(②路修正版: 三视图指令尾句
「去掉米白底衬底，四周留出空边」→「背景为干净的米白底衬底」, 因原①路透明产物
与本役产品门禁「产物必须不透明米白底, alpha 全透占比>10% 判失败重掷」硬冲突,
按原计划【立场否决·②路】协议修文回写; 不透明强制点=[6:180] MyQi21RgbaSelect
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

引擎纪律沿 yanliao_stage_fronts_1023.py: 串行单发; 发前 memory_pressure 空闲
<30% 先 POST /free; 崩溃等守卫 wait_engine(≤180s) 后重试一次(重掷 seed+1000);
空片门禁(文件<400KB 或 非背景占比<8% 弃用) + alpha 门禁(全透占比>10% 判失败
重掷, 与参考图口径一致) + 画幅门禁(宽高比 1.78±0.05, SeedVR2 短边2048量化
浮动容差); 取片锚=[504] 前缀 MYStudio-2K; deadline 900s; 日志=apps/output/
晏燎/stage_poster_viewsheet_1023.log; 图片只进 apps/output/晏燎/trial_基准。

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
import io as _io
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request as ureq
from pathlib import Path
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/晏燎/trial_基准'
LOG = ROOT / 'apps/output/晏燎/stage_poster_viewsheet_1023.log'
TEMPLATE = ROOT / 'apps/output/晏燎/user_fire_template_1023.json'
TEMPLATE_SRC = Path('/tmp/user_fire_graph.json')  # 仓内模板缺档时自愈来源(仅 cp, 不出图)
KV = ROOT / 'apps/output/晏燎/kv_prompts_1023.json'
ENGINE = 'http://127.0.0.1:17001'
OVERLAP = ROOT / 'apps/build/scripts/daojie_subject_overlap.py'

ORDER = ['1.炼气期', '2.筑基期', '3.金丹期', '4.元婴期', '5.化神期',
         '6.炼虚期', '7.合体期', '8.渡劫期', '9.大乘期', '10.共主期']
KIND_ZH = {'poster': '海报', 'viewsheet': '三视图'}
KIND_BASE = {'poster': '美宣', 'viewsheet': '人物多视图'}

# 门禁真身=my_nodes 产线常跑门(装配节点同款 import)
sys.path.insert(0, str(ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes'))
from _gongbi_gate import prompt_violations  # noqa: E402

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
    stages = data['stages']
    assert [s['stage'] for s in stages] == ORDER, 'kv_prompts stages 序与十境 ORDER 不符'
    return data


def stage_base(stage: str) -> str:
    """「1.炼气期」→「炼气期」(产物名/参考名用去序基名)。"""
    return stage.split('.', 1)[1]


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
def post_json(path, payload, timeout=30):
    r = ureq.Request(ENGINE + path, data=json.dumps(payload).encode(),
                     headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=timeout))


def mem_free_pct() -> float:
    out = subprocess.run(['memory_pressure', '-Q'], capture_output=True, text=True).stdout
    for ln in out.splitlines():
        if 'free percentage' in ln:
            return float(ln.split(':')[-1].strip().rstrip('%'))
    return 100.0


def engine_alive() -> bool:
    try:
        ureq.urlopen(ENGINE + '/system_stats', timeout=3)
        return True
    except Exception:
        return False


def wait_engine(deadline_s=180):
    t0 = time.monotonic()
    while time.monotonic() - t0 < deadline_s:
        if engine_alive():
            return True
        time.sleep(5)
    return False


def upload_threelayer(img_path: Path) -> str:
    """三层防线: ①overwrite=true ②捕获返回名 ③md5 回拉比对。"""
    raw = img_path.read_bytes()
    md5_local = hashlib.md5(raw).hexdigest()
    body = (b'--STkv\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
            b'--STkv\r\nContent-Disposition: form-data; name="image"; filename="'
            + img_path.name.encode('utf-8')
            + b'"\r\nContent-Type: image/png\r\n\r\n' + raw + b'\r\n--STkv--\r\n')
    r = ureq.Request(ENGINE + '/upload/image', data=body,
                     headers={'Content-Type': 'multipart/form-data; boundary=STkv'})
    name = json.load(ureq.urlopen(r, timeout=120))['name']
    back = ureq.urlopen(ENGINE + '/view?' + urlencode(
        {'filename': name, 'subfolder': '', 'type': 'input'}), timeout=60).read()
    md5_back = hashlib.md5(back).hexdigest()
    if md5_back != md5_local:
        raise RuntimeError(f'upload 三层防线③: 引擎实载 md5 不一致({name} '
                           f'local={md5_local[:8]} engine={md5_back[:8]})——停线')
    log(f'upload 三层防线过: {img_path.name} → 引擎实载 {name} (md5 {md5_local[:8]}≈)')
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
    """空片+alpha+画幅三门禁; 过则落盘。"""
    from PIL import Image
    import numpy as np
    if len(b) < 400_000:
        raise RuntimeError(f'{tag} 空片嫌疑: 文件仅{len(b) // 1024}KB(<400KB), 弃用')
    im = Image.open(_io.BytesIO(b)).convert('RGBA')
    w, h = im.size
    ratio = w / h
    if abs(ratio - 1.78) > 0.05:
        raise RuntimeError(f'{tag} 画幅门禁: {w}×{h} 比{ratio:.3f} 出 1.78±0.05')
    a = np.asarray(im, dtype=np.float32)
    alpha = a[..., 3]
    full_trans = float((alpha == 0).mean())
    if full_trans > 0.10:
        raise RuntimeError(f'{tag} alpha 门禁: 全透占比{full_trans * 100:.1f}%(>10%) '
                            '判失败重掷(产物必须不透明米白底)')
    wa = alpha[..., None] / 255.0
    comp = a[..., :3] * wa + 255.0 * (1 - wa)  # 白底合成后量非背景
    bg = comp[20, 20]
    fg = float((np.abs(comp - bg).max(axis=2) > 20).mean())
    if fg < 0.08:
        raise RuntimeError(f'{tag} 空片: 非背景占比{fg * 100:.1f}%(<8%), 弃用')
    dest.write_bytes(b)
    log(f'{tag} 完成 → {dest.name} {len(b) // 1024}KB 内容占比{fg * 100:.0f}% '
        f'全透{full_trans * 100:.1f}% 画幅{w}×{h}')
    return dest


def fire_once(stage: str, kind: str, seed: int) -> Path:
    base = stage_base(stage)
    ref = OUT / f'晏燎_{base}_正视图_v1.png'
    assert ref.exists(), f'参考正视图缺档: {ref}(外层须先过该境验收/补件)'
    assert_ref_background(ref)
    if mem_free_pct() < 30:
        log('内存空闲<30%, POST /free 回收')
        post_json('/free', {'unload_models': True, 'free_memory': True})
        time.sleep(10)
    tag = f'{stage}-{kind}'
    instruction = prompt_of(load_kv(), stage, kind)
    ref_name = upload_threelayer(ref)
    g = build_graph(kind, instruction, seed, ref_name)
    pid = post_json('/prompt', {'prompt': g, 'client_id': f'kv-{base}-{kind}'})['prompt_id']
    log(f'{tag} 提交 {pid} (seed={seed} base={KIND_BASE[kind]} 指令{len(instruction)}字)')
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        time.sleep(15)
        try:
            rec = json.load(ureq.urlopen(ENGINE + '/history/' + quote(pid), timeout=10)).get(pid)
        except Exception:
            time.sleep(20)
            continue
        if rec is None:
            continue
        if rec['status']['status_str'] != 'success':
            raise RuntimeError(f'{tag} 引擎报错: {str(rec["status"])[:200]}')
        for im in [i for o in rec['outputs'].values() for i in o.get('images', [])]:
            if not im['filename'].startswith('MYStudio-2K'):
                continue
            b = ureq.urlopen(ENGINE + '/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''),
                 'type': im.get('type', 'output')}), timeout=300).read()
            return gates_and_save(b, OUT / f'晏燎_{base}_{KIND_ZH[kind]}_v1.png', tag)
        raise RuntimeError(f'{tag} 无 MYStudio-2K 输出')
    raise TimeoutError(f'{tag} 超时(900s)')


def fire_shot(stage: str, kind: str) -> int:
    dest = OUT / f'晏燎_{stage_base(stage)}_{KIND_ZH[kind]}_v1.png'
    if dest.exists():
        log(f'{stage}-{kind} 已存在, 幂等跳过 → {dest.name}')
        return 0
    seed = seed_for(stage, kind)
    try:
        fire_once(stage, kind, seed)
        return 0
    except Exception as exc:
        log(f'{stage}-{kind} 失败: {exc} → 等引擎复活重试一次(重掷 seed={seed + 1000})')
        if wait_engine():
            time.sleep(20)
            try:
                fire_once(stage, kind, seed + 1000)
                return 0
            except Exception as exc2:
                log(f'{stage}-{kind} 重试仍失败: {exc2}')
                return 1
        log(f'{stage}-{kind} 引擎未复活, 放弃')
        return 1


# ── --check: 只预检全部门禁, 不发包不碰引擎 ──────────────────────────
def run_check() -> int:
    kv = load_kv()
    fails = 0
    fp_vals = []
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
            fp_vals.append(text)
    # 指纹复算(发射一致性背书)
    fp = hashlib.sha256(''.join(fp_vals).encode('utf-8')).hexdigest()[:12]
    want = kv['fingerprint']['route2_corrected']
    if fp != want:
        fails += 1
        print(f'❌ 指纹复算 {fp} ≠ kv 锚 {want}')
    else:
        print(f'✅ 指纹复算 = {fp} (②路锚一致)')
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
    ap.add_argument('--stage', help='境名(全名「1.炼气期」或基名「炼气期」)')
    ap.add_argument('--kind', choices=['poster', 'viewsheet'])
    ap.add_argument('--check', action='store_true', help='只预检全部门禁, 不发包')
    args = ap.parse_args()
    if args.check:
        return run_check()
    if not (args.stage and args.kind):
        ap.error('--stage 与 --kind 成对必填(单发), 或用 --check')
    load_kv()  # 指令真源在位校验
    full = args.stage if args.stage in ORDER else next(
        (st for st in ORDER if stage_base(st) == args.stage), None)
    if full is None:
        ap.error(f'未知境名: {args.stage}(可选: {ORDER})')
    return fire_shot(full, args.kind)


if __name__ == '__main__':
    sys.exit(main())
