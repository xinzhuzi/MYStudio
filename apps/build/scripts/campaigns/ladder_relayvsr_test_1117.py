#!/usr/bin/env python3
"""1117 探顶测试件:克隆 三采-单镜-RelayVSR.json,剥 TaoMate 二采段,
一采 VAEDecode 直连 RelayVSR 内置臂(X2),分辨率钮(ResolutionSelector)保留=阶梯入口。"""
import json, copy, pathlib

SRC = pathlib.Path('apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-RelayVSR.json')
DST = pathlib.Path('apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/一采探顶-RelayVSR-2K.json')

d = json.loads(SRC.read_text(encoding='utf-8'))
nodes = {n['id']: n for n in d['nodes']}

DROP = (3001,3002,3003,3011,3021,3031,3041,3042,3043,3044,3051,3052,3053,3061,3071)
drop_links = set()
for nid in DROP:
    n = nodes[nid]
    for i in n.get('inputs', []):
        if i.get('link') is not None: drop_links.add(i['link'])
    for o in n.get('outputs', []):
        for l in (o.get('links') or []): drop_links.add(l)
d['links'] = [l for l in d['links'] if l[0] not in drop_links]
d['nodes'] = [n for n in d['nodes'] if n['id'] not in DROP]
nodes = {n['id']: n for n in d['nodes']}
for n in d['nodes']:
    for o in n.get('outputs', []):
        if o.get('links'): o['links'] = [l for l in o['links'] if l not in drop_links]

# 一采 2041 VAEDecode IMAGE 直连 4013.images / 4019.images(原吃 3051)
nl = max(l[0] for l in d['links']) + 1
out2041 = nodes[2041]['outputs'][0]
for dst, slot in ((4013, 1), (4019, 2)):
    d['links'].append([nl, 2041, 0, dst, slot, 'IMAGE'])
    out2041.setdefault('links', []); out2041['links'].append(nl)
    nodes[dst]['inputs'][slot]['link'] = nl
    nl += 1
# 一采预览 p1 保留(2061);终档 4003 前缀 p2-relayvsr(本件二采=RelayVSR)
w = nodes[4003]['widgets_values']
w[w.index(next(x for x in w if isinstance(x, str) and 'p3-' in x))] = 'video/漫影/chapter-001/sb-chapter-001-001/p2-relayvsr'

# 组框:剥二采组,RelayVSR 组改题
d['groups'] = [g for g in d.get('groups', []) if '二阶段' not in g.get('title','')]
for g in d.get('groups', []):
    if 'RelayVSR' in g.get('title',''):
        g['title'] = '二采超分(RelayVSR 内置臂·X2·无音轨·探顶测试)'
    if '三采' in g.get('title',''):
        g['title'] = '出片(p2=2K)'
# 节点移位:RelayVSR 段左移贴住一采段(x4170→x3000 区),消除二采空位
SHIFT = -1170
for n in d['nodes']:
    if 4003 in (n['id'],) or 4011 <= n['id'] <= 4020:
        n['pos'][0] += SHIFT

live = {l[0] for l in d['links']}
for n in d['nodes']:
    for i in n.get('inputs', []):
        assert i.get('link') in live or i.get('link') is None, f"死连线 {n['id']}.{i.get('name')}"
    for o in n.get('outputs', []):
        for l in (o.get('links') or []):
            assert l in live, f"死输出 {n['id']}.{o.get('name')}"
DST.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"OK {DST.name}: {len(d['nodes'])} nodes / {len(d['links'])} links; 二采段剥除,2041→4013/4019 直连")
