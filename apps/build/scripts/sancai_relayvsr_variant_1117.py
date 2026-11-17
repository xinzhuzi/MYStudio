#!/usr/bin/env python3
"""1117 对拍役:克隆三采-单镜.json,三采组(ReCaVSR)换内置 RelayVSR 臂。
外科三步同步:删节点同步清 links+inputs[].link+outputs[].links;新臂输入槽位
结构逐字克隆自主线既有同类节点(#1001/#1003/#54/#3041/#2022/#3042/#3043/#3053)。
"""
import json, copy, sys, pathlib

SRC = pathlib.Path('apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json')
DST = pathlib.Path('apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-RelayVSR.json')
UNET, VAE = 'relayvsr_x2_lightx2v_bf16.safetensors', 'relayvsr_flash_x2.safetensors'

d = json.loads(SRC.read_text(encoding='utf-8'))
nodes = {n['id']: n for n in d['nodes']}
by_type = {}
for n in d['nodes']:
    by_type.setdefault(n['type'], []).append(n)

def clone_inputs_from(tid):
    """克隆某节点 inputs 槽位结构(name/type),link 置 None"""
    src = nodes[tid]
    out = []
    for i in copy.deepcopy(src.get('inputs', [])):
        i['link'] = None
        out.append(i)
    return out, copy.deepcopy(src.get('outputs', []))

# --- 1) 删 4001/4002(三步同步) ---
drop = (4001, 4002)
drop_links = set()
for nid in drop:
    n = nodes[nid]
    for i in n.get('inputs', []):
        if i.get('link') is not None: drop_links.add(i['link'])
    for o in n.get('outputs', []):
        for l in (o.get('links') or []): drop_links.add(l)
d['links'] = [l for l in d['links'] if l[0] not in drop_links]
d['nodes'] = [n for n in d['nodes'] if n['id'] not in drop]
nodes = {n['id']: n for n in d['nodes']}
# 清他节点 outputs[].links 里的死引用
for n in d['nodes']:
    for o in n.get('outputs', []):
        if o.get('links'): o['links'] = [l for l in o['links'] if l not in drop_links]

# --- 2) 新臂节点 ---
x0, y0 = nodes[4003]['pos'][0] - 260, nodes[4003]['pos'][1] - 120
def mk(nid, ntype, title, y, widgets, inputs_from=None, w=270):
    n = {'id': nid, 'type': ntype, 'title': title, 'pos': [x0, y], 'size': [w, 90],
         'flags': {}, 'order': 100, 'mode': 0, 'inputs': [], 'outputs': [], 'properties': {'ttNbg': '#335533'},
         'widgets_values': widgets}
    if inputs_from:
        n['inputs'], n['outputs'] = clone_inputs_from(inputs_from)
    d['nodes'].append(n); nodes[nid] = n
    return n

mk(4011, 'UNETLoader', f'RelayVSR X2 底模({UNET[:22]}…)', y0, [UNET, 'default'], inputs_from=1001)
mk(4012, 'VAELoader', 'RelayVSR Flash VAE', y0+110, [VAE], inputs_from=1003)
mk(4013, 'RelayVSRConditioning', 'RelayVSR 条件(每15帧中继)', y0+210, [],
   inputs_from=None)  # 手工:model/images
nodes[4013]['inputs'] = [{'name': 'model', 'type': 'MODEL', 'link': None},
                         {'name': 'images', 'type': 'IMAGE', 'link': None}]
nodes[4013]['outputs'] = [{'name': 'positive', 'type': 'CONDITIONING', 'links': []},
                          {'name': 'latent', 'type': 'LATENT', 'links': []}]
mk(4014, 'RandomNoise', 'noise(1步定死)', y0+330, [42, 'fixed'], inputs_from=54)
mk(4015, 'BasicScheduler', '调度 simple/1步', y0+430, ['simple', 1, 1.0], inputs_from=3041)
mk(4016, 'KSamplerSelect', 'euler', y0+540, ['euler'], inputs_from=2022)
mk(4017, 'BasicGuider', 'cfg1引导', y0+640, [], inputs_from=3042)
mk(4018, 'SamplerCustomAdvanced', '1步采样', y0+730, [], inputs_from=3043)
mk(4019, 'VSRDecode', 'VSR Decode(detail 0.70)', y0+880, [0.70], inputs_from=None)
nodes[4019]['inputs'] = [{'name': 'vae', 'type': 'VAE', 'link': None},
                         {'name': 'samples', 'type': 'LATENT', 'link': None},
                         {'name': 'images', 'type': 'IMAGE', 'link': None}]
nodes[4019]['outputs'] = [{'name': 'IMAGE', 'type': 'IMAGE', 'links': []}]
mk(4020, 'CreateVideo', '成片24fps(无音轨)', y0+1010, copy.deepcopy(nodes[3053]['widgets_values']), inputs_from=3053)

# --- 3) 连线 ---
nl = max(l[0] for l in d['links']) + 1
def wire(src, sslot, dst, dslot, typ):
    global nl
    d['links'].append([nl, src, sslot, dst, dslot, typ])
    nodes[src]['outputs'][sslot].setdefault('links', [])
    nodes[src]['outputs'][sslot]['links'].append(nl)
    assert nodes[dst]['inputs'][dslot]['name'], f"slot名缺失 {dst}:{dslot}"
    nodes[dst]['inputs'][dslot]['link'] = nl
    nl += 1
wire(4011, 0, 4013, 0, 'MODEL');  wire(4011, 0, 4017, 0, 'MODEL')
wire(3051, 0, 4013, 1, 'IMAGE')
wire(4013, 0, 4017, 1, 'CONDITIONING')
wire(4014, 0, 4018, 0, 'NOISE');  wire(4017, 0, 4018, 1, 'GUIDER')
wire(4016, 0, 4018, 2, 'SAMPLER'); wire(4015, 0, 4018, 3, 'SIGMAS')
wire(4013, 1, 4018, 4, 'LATENT')
wire(4012, 0, 4019, 0, 'VAE');   wire(4018, 0, 4019, 1, 'LATENT')
wire(3051, 0, 4019, 2, 'IMAGE')
wire(4019, 0, 4020, 0, 'IMAGE')
wire(4020, 0, 4003, 0, 'VIDEO')
# 4003 前缀改 p3-relayvsr
w = nodes[4003]['widgets_values']
w[w.index(next(x for x in w if isinstance(x, str) and 'p3-' in x))] = 'video/漫影/chapter-001/sb-chapter-001-001/p3-relayvsr'

# --- 4) 组框罩全 ---
gkey = 'bounding' if any('bounding' in g for g in d.get('groups', [])) else 'boundingBox'
for g in d['groups']:
    if '三采' in g.get('title', ''):
        g['title'] = '三采超分(RelayVSR 内置臂·对拍)'
        ids = [4003] + list(range(4011, 4021))
        xs = [nodes[i]['pos'][0] for i in ids]; ys = [nodes[i]['pos'][1] for i in ids]
        x2 = [nodes[i]['pos'][0] + nodes[i]['size'][0] for i in ids]
        y2 = [nodes[i]['pos'][1] + nodes[i]['size'][1] for i in ids]
        g[gkey] = [min(xs)-40, min(ys)-60, max(x2)-min(xs)+80, max(y2)-min(ys)+100]

# --- 5) 自检断言 ---
live = {l[0] for l in d['links']}
for n in d['nodes']:
    for i in n.get('inputs', []):
        assert i.get('link') in live or i.get('link') is None, f"死连线 {n['id']}.{i['name']}"
    for o in n.get('outputs', []):
        for l in (o.get('links') or []):
            assert l in live, f"死输出引用 {n['id']}.{o['name']}"
assert nodes[4003]['inputs'][0]['link'] in live
assert 4001 not in nodes and 4002 not in nodes
DST.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"OK {DST.name}: {len(d['nodes'])} nodes / {len(d['links'])} links; 新臂 4011-4020; 源 {len(nodes)} ")
print("源片来源=#3051 二采VAEDecode → 4013/4019; 出片=#4003 prefix=p3-relayvsr")
