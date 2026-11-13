#!/usr/bin/env python3
"""导演台·批量编排(1112)——台账驱动多镜多参考,三段门控整章批量。

设计(役 11-12-director-console-batch):
- 台本 chapter-script.json(一章一份,真源):shots[] 每镜一行
  {id, frames:124, seed, prompt, refs:[本地图片路径…]} —— refs[0]=分镜帧(槽0),
  refs[1..4]=角色卡/场景卡(槽1-4);**每镜 refs 组合任意不同**(轮转自由)。
- 图形构造=复用导演台画布件(导演台.json)的镜①模板+SHARED,逐镜覆写
  (prompt/seed/prefix/参考图),参考槽按 refs 实数注入(110..113+k);
  转换核=director_console_livefire_1112.convert(object_info 活签名对齐)。
- 三段门控(整章):
  stage1 逐镜一采→p1-draft×N→ffmpeg 拼章草片 chapter-draft.mp4(审核门:看草片,
        台本改哪镜重掷哪镜,断点续跑只补未完成镜);
  stage2 逐镜(一采+二采;跨发缓存不可依赖=重算预算口径)→p2-final×N;
  stage3 /free 一次→逐镜三采(LoadVideo 文件化吃 p2)→p3-final×N→拼 chapter-final.mp4。
- 断点续跑:batch-state.json 逐镜记账(status/engine 文件名),重跑跳已完成镜。
- 产物:apps/output/director-console-batch-1112/。

用法:
  python3 director_console_batch_1112.py --stage 1|2|3
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import director_console_livefire_1112 as lf  # noqa: E402  (convert/http/fetch/ENGINE 复用)

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / 'apps/output/director-console-batch-1112'
SCRIPT = OUT / 'chapter-script.json'
STATE = OUT / 'batch-state.json'

ERCAI0 = {4, 100, 202, 203, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 223, 267}
SANCAI0 = {338, 339, 340, 3300}


def http_upload(path: Path) -> str:
    """上传图片到引擎 input/,返回引擎侧文件名(幂等:同名覆盖)。"""
    boundary = '----batch1112x' + 'z' * 10
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; '
            f'filename="{path.name}"\r\nContent-Type: image/jpeg\r\n\r\n').encode() \
        + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    req = lf.urllib.request.Request(f'{lf.ENGINE}/upload/image', data=body, method='POST',
                                    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with lf._OPENER.open(req, timeout=300) as r:
        return json.loads(r.read())['name']


def shot_graph(shot: dict, with_ercai: bool) -> dict:
    """镜①模板+SHARED 逐镜覆写;参考槽按 refs 实数注入。"""
    gui = json.loads(lf.WF.read_text())
    active = ({n['id'] for n in gui['nodes'] if n.get('mode', 0) == 0 and n['id'] < 1000}
              - {3000, 3001} - {110, 111, 112, 113})
    extra = [110 + i for i in range(len(shot['refs']) - 1)]
    active |= set(extra)
    if with_ercai:
        active |= ERCAI0
    ov = {
        14: {'value': shot['prompt']},
        129: {'noise_seed': shot['seed'], 'control_after_generate': 'fixed'},
        9: {'image': shot['_eng_refs'][0]},
        204: {'filename_prefix': f"video/director1112/batch/{shot['id']}/p1-draft"},
    }
    if with_ercai:
        # MyShot 法统(my_shot.py:71):prefix=video/漫影/{章}/{shot_id}/p2-final 且 parts[3]==shot_id
        ov[4] = {'filename_prefix': f"video/漫影/chapter-b001/{shot['id']}/p2-final"}
        ov[100] = {'shot_id': shot['id']}
    for i, nid in enumerate(extra):
        ov[nid] = {'image': shot['_eng_refs'][i + 1]}
    return lf.convert(active, ov)


def fire_one(prompt: dict, tag: str, timeout_s: int = 900, want: str = '') -> tuple[str, str]:
    """发一镜并等待;返回 (filename, subfolder)。want=产物名必含段(p1-draft/p2-final/p3-final),
    多 SaveVideo 同图时按名筛(不筛=outputs 顺序碰运气,1112 stage2 实踩 p1 冒充 p2)。"""
    for attempt in (1, 2):
        q = lf.http('GET', '/queue')
        while q['queue_running'] or q['queue_pending']:  # 共享引擎:候窗
            time.sleep(15)
            q = lf.http('GET', '/queue')
        pid = lf.http('POST', '/prompt', {'prompt': prompt, 'client_id': lf.CLIENT})['prompt_id']
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            h = lf.http('GET', f'/history/{pid}')
            if pid in h:
                rec = h[pid]
                if rec.get('status', {}).get('status_str') == 'error':
                    msg = str(rec['status'])[:300]
                    if attempt == 2:
                        raise RuntimeError(f'{tag} 两连败: {msg}')
                    print(f'  [{tag}] 第1发失败,重试: {msg[:120]}')
                    break
                picks = [img for o in rec.get('outputs', {}).values()
                         for img in o.get('images', [])
                         if img['filename'].endswith('.mp4')
                         and (not want or want in img['filename'])]
                if picks:
                    return picks[0]['filename'], picks[0].get('subfolder', '')
                raise RuntimeError(f'{tag} 完成但无 {want or "mp4"} 产物')
            time.sleep(5)
        else:
            raise RuntimeError(f'{tag} 超时 {timeout_s}s')
    raise RuntimeError(f'{tag} 不可达')


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {'uploaded': {}, 'stage1': {}, 'stage2': {}, 'stage3': {}}


def save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1))


def ensure_uploads(shots: list[dict], st: dict) -> None:
    seen: set[str] = set()
    for s in shots:
        s['_eng_refs'] = []
        for ref in s['refs']:
            p = Path(ref)
            if str(p) not in seen:
                seen.add(str(p))
                if str(p) not in st['uploaded']:
                    st['uploaded'][str(p)] = http_upload(p)
                    save_state(st)
            s['_eng_refs'].append(st['uploaded'][str(p)])


def concat(files: list[Path], out: Path, tag: str) -> None:
    lst = out.with_suffix('.txt')
    lst.write_text(''.join(f"file '{f.name}'\n" for f in files))
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0',
                    '-i', str(lst), '-c', 'copy', str(out)], check=True, cwd=out.parent)
    d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'csv=p=0', str(out)], capture_output=True, text=True).stdout.strip()
    print(f'[{tag}] {out.name} {float(d):.1f}s {out.stat().st_size / 1e6:.1f}MB')


def run_stage(stage: int) -> None:
    script = json.loads(SCRIPT.read_text())
    shots = script['shots']
    st = load_state()
    ensure_uploads(shots, st)
    key = f'stage{stage}'
    print(f'[stage{stage}] {len(shots)} 镜;已完成 {len(st[key])} 镜(断点续跑)')
    if stage == 3 and not st.get('freed'):
        lf.http('POST', '/free', {'unload_models': True})
        st['freed'] = True
        save_state(st)
        print('[stage3] /free 毕')
    for i, s in enumerate(shots):
        if s['id'] in st[key]:
            continue
        tag = f'stage{stage}-{i + 1}/{len(shots)}:{s["id"]}'
        if stage in (1, 2):
            want = 'p1-draft' if stage == 1 else 'p2-final'
            prompt = shot_graph(s, with_ercai=(stage == 2))
            fn, sub = fire_one(prompt, tag, want=want)
        else:
            p2 = OUT / f"{s['id']}_p2.mp4"
            lf.fetch(*[st['stage2'][s['id']]['fn'], st['stage2'][s['id']]['sub']]) \
                .rename(p2) if not p2.exists() else None
            up = http_upload(p2)
            gui = json.loads(lf.WF.read_text())
            active = SANCAI0
            ov = {3300: {'file': up},
                  340: {'filename_prefix': f"video/director1112/batch/{s['id']}/p3-final"}}
            prompt = lf.convert(active, ov)
            prompt['339']['inputs'] = {  # ReCaVSR 定妆(活签名对齐,livefire stage3 同款)
                'model': ['338', 0], 'video': ['3300', 0], 'scale': 2, 'color_fix': 'none',
                'seed': 42, 'decoder': 'flashdecoder', 'kernels': 'fast',
                'kv_offload': False, 'encoder': 'auto', 'fps': 30}
            fn, sub = fire_one(prompt, tag, want='p3-final')
            want = 'p3-final'
        st[key][s['id']] = {'fn': fn, 'sub': sub, 'want': want}
        save_state(st)
        print(f'  [{tag}] ✓ {sub}/{fn}')
    # 取件+拼章(lf.fetch 落 livefire 目录,搬回本役目录)
    locals_: dict[str, Path] = {}
    for s in shots:
        e = st[key][s['id']]
        flat = '_'.join(x for x in f"{e['sub']}\\{e['fn']}".replace('\\', '/').split('/') if x)
        dst = OUT / f"{s['id']}_{e['want']}.mp4"
        if not dst.exists():
            src = lf.fetch(e['fn'], e['sub'])
            src_path = src if src.exists() else (lf.OUT_DIR / flat)
            src_path.rename(dst)
        locals_[s['id']] = dst
    ordered = [locals_[s['id']] for s in shots]
    if stage == 1:
        concat(ordered, OUT / 'chapter-draft.mp4', '章草片')
    elif stage == 3:
        concat(ordered, OUT / 'chapter-final.mp4', '章终片')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', type=int, required=True, choices=(1, 2, 3))
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    run_stage(a.stage)
    return 0


if __name__ == '__main__':
    sys.exit(main())
