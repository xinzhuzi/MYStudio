"""晏燎十境正视图量产(1023 用户令:复刻其验证过的双参考配方,3·混动40步+缓存)。

模板=用户实弹成功图(/tmp/user_fire_graph.json, 图生图 43880064): <image1>=基底(画布/人物)
+ <image2>=境界正视图(衣物源), 指令=官方 <imageN> 标签文体; 出图链内含 SeedVR2 2K(超分2K)。
产物=apps/output/晏燎/trial_基准/晏燎_{境}期_正视图_v1.png(练气=用户样张保留,本脚本跑筑基→共主九境)。
纪律: 串行单发+发间查内存; 崩溃等守卫拉起后重试一次; 日志=apps/output/晏燎/stage_fronts_1023.log。
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request as ureq
from pathlib import Path
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parents[3]
ROLE = Path('/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎')
OUT = ROOT / 'apps/output/晏燎/trial_基准'
LOG = ROOT / 'apps/output/晏燎/stage_fronts_1023.log'
TEMPLATE = Path('/tmp/user_fire_graph.json')
ENGINE = 'http://127.0.0.1:17001'

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


def post_json(path, payload, timeout=30):
    r = ureq.Request(ENGINE + path, data=json.dumps(payload).encode(),
                     headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=timeout))


def upload(img_path: Path, name: str) -> str:
    body = (f'--STx\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f'Content-Type: image/png\r\n\r\n').encode() + img_path.read_bytes() + b'\r\n--STx--\r\n'
    r = ureq.Request(ENGINE + '/upload/image', data=body,
                     headers={'Content-Type': 'multipart/form-data; boundary=STx'})
    return json.load(ureq.urlopen(r, timeout=120))['name']


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


PROMPTS = {}


def fire_stage(stage, ref2_name, graph):
    g = json.loads(json.dumps(graph))
    g['400']['inputs']['value'] = PROMPTS[stage]
    g['11']['inputs']['image'] = ref2_name
    pid = post_json('/prompt', {'prompt': g, 'client_id': f'stage-{stage}'})['prompt_id']
    log(f'{stage} 提交 {pid}')
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
            raise RuntimeError(f'{stage} 引擎报错: {str(rec["status"])[:200]}')
        for im in [i for o in rec['outputs'].values() for i in o.get('images', [])]:
            if not im['filename'].startswith('MYStudio-2K'):
                continue
            b = ureq.urlopen(ENGINE + '/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''),
                 'type': im.get('type', 'output')}), timeout=300).read()
            dest = OUT / f'晏燎_{stage}_正视图_v1.png'
            # 空片门禁(1023 用户令: 参考图必须完整): 超小文件/纯黑纯白/内容占比<8% = 静默退化空片
            if len(b) < 400_000:
                raise RuntimeError(f'{stage} 空片嫌疑: 文件仅{len(b)//1024}KB(<400KB), 弃用')
            from PIL import Image
            import numpy as np
            _img = Image.open(__import__('io').BytesIO(b)).convert('RGB')
            _arr = np.asarray(_img, dtype=np.float32)
            _h, _w = _arr.shape[:2]
            _bg = _arr[20, 20]
            _fg = (np.abs(_arr - _bg).max(axis=2) > 20).mean()
            if _fg < 0.08:
                raise RuntimeError(f'{stage} 空片: 非背景占比{_fg*100:.1f}%(<8%), 弃用')
            dest.write_bytes(b)
            log(f'{stage} 完成 → {dest.name} {len(b)//1024}KB 内容占比{_fg*100:.0f}%')
            return dest
        raise RuntimeError(f'{stage} 无 2K 输出')
    raise TimeoutError(f'{stage} 超时')


def main() -> int:
    import json as _j
    for _n, (_f, _c, _p) in _j.loads((ROOT/'apps/output/晏燎/stage_prompts_1023.json').read_text()).items():
        STAGES[_n] = (_f, _c)
        PROMPTS[_n] = _p
    global PROMPT_TMPL
    assert TEMPLATE.exists(), '模板图缺失(/tmp/user_fire_graph.json)'
    graph = json.loads(TEMPLATE.read_text())
    # 预上传九境衣物参考(同名覆盖输入区, 基底图输入区已有)
    for stage, (fname, _) in STAGES.items():
        upload(ROLE / fname, fname)
    log(f'参考上传完毕×{len(STAGES)} | 模板=用户实弹43880064 | 逐境串行开跑')
    ok, fail = [], []
    for stage, (fname, _) in STAGES.items():
        dest = OUT / f'晏燎_{stage}_正视图_v1.png'
        if dest.exists():
            log(f'{stage} 已存在, 跳过')
            ok.append(stage)
            continue
        if mem_free_pct() < 30:
            log(f'内存<30%, 等引擎回收')
            post_json('/free', {'unload_models': True, 'free_memory': True})
            time.sleep(10)
        try:
            fire_stage(stage, fname, graph)
            ok.append(stage)
        except Exception as exc:
            log(f'{stage} 失败: {exc} → 等引擎复活重试一次')
            if wait_engine():
                time.sleep(20)
                try:
                    fire_stage(stage, fname, graph)
                    ok.append(stage)
                except Exception as exc2:
                    log(f'{stage} 重试仍失败: {exc2}')
                    fail.append(stage)
            else:
                fail.append(stage)
    log(f'=== 收官: 成功 {len(ok)} {ok} | 失败 {len(fail)} {fail} ===')
    return 0 if not fail else 1


if __name__ == '__main__':
    sys.exit(main())
