#!/usr/bin/env python3
"""导演台 实弹三段门控(1112)——画布→API 转换+三发编排。

用法:
  python3 director_console_livefire_1112.py --stage 1   # 一发草片炮(r2v 三镜+ffmpeg 草片)
  python3 director_console_livefire_1112.py --stage 2   # 二发二采炮(验证一采缓存命中)
  python3 director_console_livefire_1112.py --stage 3   # 三发三采炮(/free 后独立,p2 拷 input/)

设计:
- 转换=活 object_info 逐类映射:widget 输入序(required+optional 保序)∩未连线名 ↔ widgets_values
  顺序 zip(control_after_generate 占双槽);链输入直接取 GUI inputs[].link 解引用。
- 排除集:110-113+k(参考图占位与提示词不匹配=矛盾信号,1108 铁律;全阶段一致剥除,9+k 单参考锚)
  + 3000/3001(ConcatenateVideo=COMFY_AUTOGROW_V3,API 直投有 AIMixer H 弹 GroupsCombine 丢参前科;
  草片=本机 ffmpeg 外拼,画布内草片拼组留给 GUI 用户)。
- stage1:一采×3+SHARED(mode==0 减排除集);锚=aimixer_anchor2/3/4.jpg(已在引擎 input/,
  H 弹三镜同源:夜码头/院塾/学堂,提示词沿用 H 弹严格匹配三段)。
- stage2:同图+二采×3;验收=execution_cached 含全部一采节点 id。
- stage3:三采独立图(338+339×3+340×3+LoadVideo×3);发前 POST /free;p2 产物拷 input/。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / 'apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/导演台.json'
OUT_DIR = REPO / 'apps/output/director-console-1112'
ENGINE = os.environ.get('DIRECTOR_ENGINE', 'http://192.168.0.101:17000')
CLIENT = 'director-console-livefire-1112'
PRIMITIVE = {'INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'}

# H 弹同源三镜(锚图已在引擎 input/:夜码头裁切帧/院塾 sb-009/学堂 sb-010)
PROMPTS = [
    ("Night stone dock: a boy kneels trembling with glowing cyan motes drifting; a burly man "
     "stands frozen gripping a rod; a pale python with glowing spots arcs overhead, head swaying, "
     "jaws open. Warm lantern flicker, distant ship lights on dark water. Slow subtle push-in. No cuts."),
    ("Night courtyard school: the wounded swordsman with white-streaked topknot stands still, "
     "chest slowly breathing, one soft blink; children sit in a circle around a small oil-lamp "
     "flame that flickers gently; a teacher with bamboo slips speaks quietly. Warm lamplight "
     "through lattice windows. Very slow push-in toward the lamp. No cuts."),
    ("Warm night-school interior: the grey-streaked elder adds one final faint brush stroke on "
     "the wooden board, ink glistening; slow breathing; a paper lantern breathes with soft warm "
     "flicker; two children watching from behind tilt their heads slightly. Very slow push-in "
     "toward the writing board. No cuts."),
]
ANCHORS = ['aimixer_anchor2.jpg', 'aimixer_anchor3.jpg', 'aimixer_anchor4.jpg']
EXCLUDE = {x + k for k in (0, 1000, 2000) for x in (110, 111, 112, 113)} | {3000, 3001}
二采 = {4, 100, 202, 203, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 223, 267}
三采 = {338, 339, 340, 3300, 3301, 3302}

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_OI: dict = {}


def http(method: str, path: str, body=None, timeout: int = 30) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(ENGINE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with _OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def oi(cls: str) -> dict:
    if cls not in _OI:
        with _OPENER.open(f'{ENGINE}/object_info/{urllib.parse.quote(cls)}', timeout=30) as r:
            _OI[cls] = json.loads(r.read())[cls]
    return _OI[cls]


def widget_order(cls: str) -> list[tuple[str, dict]]:  # 兼容旧名(未用,防外部 import 断)
    return [(name, {}) for name, _ in widget_slots(cls)]


DYN_COMBOS = {'COMFY_DYNAMICCOMBO_V3'}


def widget_slots(cls: str) -> list[tuple[str, bool, bool, bool, bool]]:
    """[(name, control_after_generate, is_dyncombo, hidden, required)] 可widget输入保序(含已转连线者)。"""
    out = []
    for section in ('required', 'optional'):
        for name, s in (oi(cls)['input'].get(section) or {}).items():
            t = s[0] if s else None
            meta = s[1] if len(s) > 1 and isinstance(s[1], dict) else {}
            dyn = isinstance(t, str) and t in DYN_COMBOS
            bd = t == "BDGROUP"  # AIMixer 雷#1:分组标题伪控件占 widgets_values 一位且为 required 输入
            if isinstance(t, list) or (isinstance(t, str) and t in PRIMITIVE) or dyn or bd:
                out.append((name, bool(meta.get('control_after_generate')), dyn,
                            bool(meta.get('hidden')), section == 'required'))
    return out


def dyn_subs(cls: str, slot: str, key: str) -> list[tuple[str, bool]]:
    """dyn 组合框选中 key 的子 widget 序 [(子名, control_after_generate)];无嵌套返回 []。"""
    spec = None
    for section in ('required', 'optional'):
        spec = (oi(cls)['input'].get(section) or {}).get(slot)
        if spec:
            break
    if not spec or len(spec) < 2 or not isinstance(spec[1], dict):
        return []
    opts = spec[1].get('options') or []
    entry = next((o for o in opts if isinstance(o, dict) and o.get('key') == key), None)
    if not entry:
        return []
    out: list[tuple[str, bool]] = []
    for sec in ('required', 'optional'):
        for nm, ss in ((entry.get('inputs') or {}).get(sec) or {}).items():
            t = ss[0] if ss else None
            meta = ss[1] if len(ss) > 1 and isinstance(ss[1], dict) else {}
            if isinstance(t, list) or (isinstance(t, str) and (t in PRIMITIVE or t in DYN_COMBOS)):
                if not meta.get('hidden'):
                    out.append((nm, bool(meta.get('control_after_generate'))))
    return out


def convert(active_ids: set[int], overrides: dict[int, dict[str, object]]) -> dict:
    gui = json.loads(WF.read_text())
    nodes = {n['id']: n for n in gui['nodes']}
    links = {l[0]: l for l in gui['links']}
    prompt: dict[str, dict] = {}
    for nid in sorted(active_ids):
        n = nodes[nid]
        if n['type'] in ('Note', 'MarkdownNote'):
            continue  # 前端件不执行不入 API 图
        connected = {i['name'] for i in n.get('inputs', []) if i.get('link') is not None}
        inputs: dict[str, object] = {}
        # 链输入:GUI inputs[].link 解引用(源不在激活集则剥除该口——如被排除的参考图槽)
        for inp in n.get('inputs', []):
            lid = inp.get('link')
            if lid is None:
                continue
            l = links[lid]
            if l[1] not in active_ids:
                continue
            inputs[inp['name']] = [str(l[1]), l[2]]
        # widget 槽:widgets_values 对「全部可widget输入」占序(连线槽存陈旧默认,跳过取链)
        wv = list(n.get('widgets_values') or [])
        slots = widget_slots(n['type'])
        vi = 0
        for name, ctrl, dyn, hid, _req in slots:
            if hid:
                continue  # hidden 槽不占序列化(服务端默认)
            if vi >= len(wv):
                break
            if name in connected:
                # 连线槽仍占序列(陈旧默认);dyn 连线槽无子参序列
                vi += 1 + (1 if ctrl else 0)
                continue
            val = wv[vi]
            vi += 1 + (1 if ctrl else 0)
            inputs[name] = val
            if dyn:  # 子参内联随键后(数字人役实证:API 点分扁平 selection.tau)
                for sub, sctrl in dyn_subs(n['type'], name, val):
                    if vi >= len(wv):
                        break
                    sval = wv[vi]
                    vi += 1 + (1 if sctrl else 0)
                    inputs[f'{name}.{sub}'] = sval
        # required 真参缺席=响亮报错;可选尾部缺席=服务端默认;多余全字符串尾巴=前端私有槽,弃
        missing_req = [nm for nm, _c, dyn, hid, req in slots
                       if req and not hid and not dyn and nm not in inputs and nm not in connected]
        assert not missing_req, f'[{nid}] {n["type"]} required 未赋值 {missing_req}: values={wv}'
        if vi != len(wv):
            pass  # 前端私有槽(服务端 schema 无此名):弃;required 已由上断言把守,POST 校验兜底
        # 定妆修偏:旧序列化缺省错位(数字人役实证 CreateVideo 尾值'none'=codec 非 format)
        if n['type'] == 'CreateVideo' and inputs.get('format') == 'none':
            inputs['format'], inputs['codec'] = 'auto', 'none'
        prompt[str(nid)] = {'class_type': n['type'], 'inputs': inputs}
    for nid, kv in overrides.items():
        assert str(nid) in prompt, f'override 节点 {nid} 不在激活图'
        prompt[str(nid)]['inputs'].update(kv)
    return prompt


def fire(prompt: dict, tag: str, timeout_s: int = 1200) -> dict:
    q = http('GET', '/queue')
    assert not q['queue_running'] and not q['queue_pending'], f'队列非空停发: {q}'
    pid = http('POST', '/prompt', {'prompt': prompt, 'client_id': CLIENT})['prompt_id']
    print(f'[fire-{tag}] nodes={len(prompt)} pid={pid}')
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        h = http('GET', f'/history/{pid}')
        if pid in h:
            rec = h[pid]
            (OUT_DIR / f'history-{tag}.json').write_text(json.dumps(rec, ensure_ascii=False)[:400000])
            if rec.get('status', {}).get('status_str') == 'error':
                for kind, p in rec['status']['messages']:
                    if kind == 'execution_error':
                        print(f'[FAIL-{tag}] {p.get("node_type")} {p.get("exception_message")}')
                sys.exit(1)
            if rec.get('status', {}).get('completed'):
                return rec
        time.sleep(6)
        if int(time.time() - t0) % 60 < 6:
            print(f'[wait-{tag}] {int(time.time() - t0)}s')
    print(f'[timeout-{tag}] pid={pid} 引擎侧续跑,凭 pid 补收')
    sys.exit(2)


def outputs_of(rec: dict) -> list[tuple[str, str]]:
    got = []
    for nid, o in rec.get('outputs', {}).items():
        for img in o.get('images', []):
            got.append((img['filename'], img.get('subfolder', '')))
    return got


def fetch(filename: str, subfolder: str) -> Path:
    url = (f'{ENGINE}/view?filename={urllib.parse.quote(filename)}'
           f'&subfolder={urllib.parse.quote(subfolder)}&type=output')
    flat = '_'.join(p for p in f'{subfolder}\\{filename}'.replace('\\', '/').split('/') if p)
    local = OUT_DIR / flat
    with _OPENER.open(url, timeout=300) as r, open(local, 'wb') as f:
        f.write(r.read())
    return local


def stage1() -> None:
    gui = json.loads(WF.read_text())
    active = {n['id'] for n in gui['nodes'] if n.get('mode', 0) == 0} - EXCLUDE
    ov = {}
    for k in (0, 1000, 2000):
        ov[14 + k] = {'value': PROMPTS[k // 1000]}       # recipes 实锚:PrimitiveStringMultiline 键=value
        ov[9 + k] = {'image': ANCHORS[k // 1000]}
        ov[204 + k] = {'filename_prefix': f'video/director1112/shot{k // 1000 + 1}/p1-draft'}
    prompt = convert(active, ov)
    rec = fire(prompt, 'stage1')
    (OUT_DIR / 'api-stage1.json').write_text(json.dumps(prompt, ensure_ascii=False, indent=1))
    outs = outputs_of(rec)
    print(f'[stage1] 一发毕 {outs}')
    locals_ = [fetch(p, s) for p, s in outs if p.endswith('.mp4')]
    if len(locals_) == 3:
        lst = OUT_DIR / 'concat.txt'
        lst.write_text(''.join(f"file '{p.name}'\n" for p in locals_))
        draft = OUT_DIR / 'p1-draft-concat.mp4'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0',
                        '-i', str(lst), '-c', 'copy', str(draft)], check=True, cwd=OUT_DIR)
        print(f'[stage1] 草片={draft} ({draft.stat().st_size / 1e6:.2f} MB)')


def stage2() -> None:
    gui = json.loads(WF.read_text())
    ercai = {x + k for x in 二采 for k in (0, 1000, 2000)}
    active = ({n['id'] for n in gui['nodes'] if n.get('mode', 0) == 0} | ercai) - EXCLUDE
    ov = {}
    for i, k in enumerate((0, 1000, 2000)):
        ov[14 + k] = {'value': PROMPTS[i]}
        ov[9 + k] = {'image': ANCHORS[i]}
        # 一采覆写逐字照 stage1(缓存命中的命门);二采前缀走 MyShot 法统路径(章节/分镜)
        ov[204 + k] = {'filename_prefix': f'video/director1112/shot{i + 1}/p1-draft'}
        ov[4 + k] = {'filename_prefix': f'video/漫影/chapter-001/sb-chapter-001-00{i + 1}/p2-final'}
    prompt = convert(active, ov)
    rec = fire(prompt, 'stage2')
    (OUT_DIR / 'api-stage2.json').write_text(json.dumps(prompt, ensure_ascii=False, indent=1))
    cached_ids = set()
    for kind, m in rec['status']['messages']:
        if kind == 'execution_cached':
            cached_ids |= set(m.get('nodes', []))
    yicai = {str(n['id']) for n in gui['nodes']
             if n['id'] not in EXCLUDE and n.get('mode', 0) == 0 and n['id'] not in ercai}
    hit = yicai & cached_ids
    print(f'[stage2] 一采缓存命中 {len(hit)}/{len(yicai)} {"全命中✓" if hit == yicai else "未全命中✗"}')
    if hit != yicai:
        print(f'[stage2] 未命中: {sorted(yicai - hit, key=int)[:20]}')
    outs = outputs_of(rec)
    print(f'[stage2] 产物 {outs}')
    for p, s in outs:
        if 'p2-final' in p:
            fetch(p, s)


def stage3() -> None:
    p2s = sorted(OUT_DIR.glob('*p2-final*.mp4'))
    assert len(p2s) == 3, f'需 3 件 p2 产物,现有 {p2s}'
    gui = json.loads(WF.read_text())
    active = ({x + k for k in (0, 1000, 2000) for x in (339, 340)} | {338, 3300, 3301, 3302}) - EXCLUDE
    ov = {}
    for i, k in enumerate((0, 1000, 2000)):
        ov[3300 + i] = {'file': p2s[i].name}
        ov[340 + k] = {'filename_prefix': f'video/director1112/shot{i + 1}/p3-final'}
    # p2 拷引擎 input/(LoadVideo 读 input/)
    for f in p2s:
        with open(f, 'rb') as fh:
            data = fh.read()
        boundary = '----dw' + 'x' * 12
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{f.name}"\r\n'
                f'Content-Type: video/mp4\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        req = urllib.request.Request(f'{ENGINE}/upload/image', data=body, method='POST',
                                     headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
        with _OPENER.open(req, timeout=300) as r:
            print(f'[stage3] upload {f.name}: {json.loads(r.read())}')
    http('POST', '/free', {'unload_models': True})
    print('[stage3] /free 毕')
    prompt = convert(active, ov)
    # ReCaVSRUpscale 定妆重建:decoder 系 dyn 子参吞位致 zip 错位,按活签名整节点重写(值=克隆源逐字)
    for i, k in enumerate((0, 1000, 2000)):
        prompt[str(339 + k)]['inputs'] = {
            'model': ['338', 0], 'video': [str(3300 + i), 0],
            'scale': 2, 'color_fix': 'none', 'seed': 42, 'decoder': 'flashdecoder',
            'kernels': 'fast', 'kv_offload': False, 'encoder': 'auto', 'fps': 30,
        }
    rec = fire(prompt, 'stage3', timeout_s=1800)
    (OUT_DIR / 'api-stage3.json').write_text(json.dumps(prompt, ensure_ascii=False, indent=1))
    print(f'[stage3] 三采产物 {outputs_of(rec)}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', type=int, required=True, choices=(1, 2, 3))
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    {1: stage1, 2: stage2, 3: stage3}[a.stage]()
    return 0


if __name__ == '__main__':
    sys.exit(main())
