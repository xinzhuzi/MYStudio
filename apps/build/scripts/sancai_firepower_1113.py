#!/usr/bin/env python3
"""三采输入火力手术(1113,trellis 11-13-sancai-input-firepower)
A: 参考图 5→9 满配(ref_image_0..8;新卡锚 [114-117])
B: i2v 尾帧([118]→[220].last_frame,槽已在件)
C: r2v 参考视频([119] LoadVideo→[16].ref_videos.ref_video_0,槽已在件;max=3 本期接 1)
三步同步:links 表+inputs[].link+outputs[].links 三面一致;自检门不过不落盘。
用法: python3 sancai_firepower_1113.py [--verify]
"""
import copy, json, sys

UI_FILES = {
    'repo': '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json',
    'twin': '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.json',
}
API_FILE = '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.api.json'
CARD_IDS = [341, 342, 343, 344]          # 参考卡锚(ref_image_5..8;114-119 已被现役节点占用)
END_FRAME_ID, VIDEO_ID = 345, 346        # 尾帧锚 / 参考视频锚
SLOT_OF = {341: 5, 342: 6, 343: 7, 344: 8}

def surgery(d):
    nodes = {n['id']: n for n in d['nodes']}
    anchors = CARD_IDS + [END_FRAME_ID, VIDEO_ID]
    if all(i in nodes for i in anchors):
        return 0  # 幂等:已手术
    assert all(i not in nodes for i in anchors), "新锚 id 部分冲突"
    tpl_card = copy.deepcopy(nodes[110])   # 照抄现役 MUTED 图锚
    lid = max(l[0] for l in d['links'])
    nid = max(n['id'] for n in d['nodes'])
    new_links = []

    def add_link(src, dst, dst_slot_name, typ):
        nonlocal lid
        lid += 1
        dst_inputs = nodes[dst]['inputs']
        idx = next(i for i, e in enumerate(dst_inputs) if e['name'] == dst_slot_name)
        dst_inputs[idx]['link'] = lid
        nodes[src]['outputs'][0]['links'] = nodes[src]['outputs'][0].get('links') or []
        nodes[src]['outputs'][0]['links'].append(lid)
        new_links.append([lid, src, 0, dst, idx, typ])
        return lid

    # ── A: 四张新卡 → [16]/[208] ref_image_5..8(autogrow entry 照抄 ref_image_1 形态)
    tpl_entry = next(e for e in nodes[16]['inputs'] if e['name'] == 'ref_images.ref_image_1')
    for cid in CARD_IDS:
        card = copy.deepcopy(tpl_card)
        card['id'] = cid; card['order'] = cid
        card['pos'] = [100, 100]  # 布局 pass 重排
        card['outputs'] = [copy.deepcopy(card['outputs'][0])]
        card['outputs'][0]['links'] = []
        d['nodes'].append(card); nodes[cid] = card
        for dst in (16, 208):
            slot = f'ref_images.ref_image_{SLOT_OF[cid]}'
            entry = {'label': slot.split('.')[-1], 'name': slot, 'shape': tpl_entry['shape'],
                     'type': tpl_entry['type'], 'link': None}
            nodes[dst]['inputs'].append(entry)
            add_link(cid, dst, slot, 'IMAGE')

    # ── B: [118] 尾帧 → [220].last_frame(槽已在)
    endf = copy.deepcopy(tpl_card)
    endf['id'] = END_FRAME_ID; endf['order'] = END_FRAME_ID; endf['pos'] = [100, 100]
    endf['outputs'] = [copy.deepcopy(endf['outputs'][0])]; endf['outputs'][0]['links'] = []
    d['nodes'].append(endf); nodes[END_FRAME_ID] = endf
    add_link(END_FRAME_ID, 220, 'last_frame', 'IMAGE')

    # ── C: [119] LoadVideo(MUTED)→ [16].ref_videos.ref_video_0(槽已在;形态照 TESSERA[300])
    vid = {'id': VIDEO_ID, 'type': 'LoadVideo', 'pos': [100, 100], 'size': [340, 150], 'flags': {},
           'order': VIDEO_ID, 'mode': 4, 'inputs': [],
           'outputs': [{'name': 'VIDEO', 'type': 'VIDEO', 'links': []}],
           'properties': {'cnr_id': 'comfy-core', 'ver': '0.35.0', 'Node name for S&R': 'LoadVideo'},
           'widgets_values': ['', 'image']}
    d['nodes'].append(vid); nodes[VIDEO_ID] = vid
    add_link(VIDEO_ID, 16, 'ref_videos.ref_video_0', 'VIDEO')

    d['links'].extend(new_links)
    d['last_node_id'] = max(d.get('last_node_id', 0), nid)
    d['last_link_id'] = lid
    return len(new_links)

def sweep_dangling(d):
    """清悬空登记(链表已删但 outputs[].links/inputs[].link 残留)——孪生件陈年账"""
    link_ids = {l[0] for l in d['links']}
    n = 0
    for nd in d['nodes']:
        for o in nd.get('outputs', []):
            keep = [x for x in (o.get('links') or []) if x in link_ids]
            if len(keep) != len(o.get('links') or []):
                n += len(o['links']) - len(keep); o['links'] = keep
        for e in nd.get('inputs', []):
            if e.get('link') is not None and e['link'] not in link_ids:
                e['link'] = None; n += 1
    return n

def verify(d):
    nodes = {n['id']: n for n in d['nodes']}
    link_ids = {l[0] for l in d['links']}
    probs = []
    # 三面一致
    for l in d['links']:
        lid, s, ss, t, ts, typ = l
        if s not in nodes or t not in nodes: probs.append(f"链{l} 端点悬空"); continue
        if nodes[t]['inputs'][ts]['link'] != lid: probs.append(f"链{l} 目标未登记")
        if lid not in (nodes[s]['outputs'][ss].get('links') or []): probs.append(f"链{l} 源未登记")
    for n in d['nodes']:
        for e in n.get('inputs', []):
            if e.get('link') is not None and e['link'] not in link_ids: probs.append(f"[{n['id']}] 悬空inputs")
        for o in n.get('outputs', []):
            for x in (o.get('links') or []):
                if x not in link_ids: probs.append(f"[{n['id']}] 悬空outputs")
    # 槽满配
    for dst in (16, 208):
        slots = [e['name'] for e in nodes[dst]['inputs'] if e['name'].startswith('ref_images.ref_image_')]
        if len(slots) != 9: probs.append(f"[{dst}] 图槽{len(slots)}≠9")
    if nodes[220]['inputs'][next(i for i,e in enumerate(nodes[220]['inputs']) if e['name']=='last_frame')]['link'] is None:
        probs.append("[220] 尾帧未接")
    if nodes[16]['inputs'][next(i for i,e in enumerate(nodes[16]['inputs']) if e['name']=='ref_videos.ref_video_0')]['link'] is None:
        probs.append("[16] 参考视频未接")
    # 新锚 mode=4
    for i in CARD_IDS + [END_FRAME_ID, VIDEO_ID]:
        if nodes[i].get('mode') != 4: probs.append(f"[{i}] 非MUTED")
    return probs

def api_surgery(a):
    n110 = a['110']
    for cid in CARD_IDS + [END_FRAME_ID]:
        a[str(cid)] = {'class_type': 'LoadImage', 'inputs': {'image': n110['inputs']['image']}}
    a[str(VIDEO_ID)] = {'class_type': 'LoadVideo', 'inputs': {'file': ''}}
    for cid in CARD_IDS:
        slot = f'ref_images.ref_image_{SLOT_OF[cid]}'
        a['16']['inputs'][slot] = [str(cid), 0]
        a['208']['inputs'][slot] = [str(cid), 0]
    a['220']['inputs']['last_frame'] = [str(END_FRAME_ID), 0]
    a['16']['inputs']['ref_videos.ref_video_0'] = [str(VIDEO_ID), 0]

def api_verify(a):
    probs = []
    ids = set(a)
    for k, n in a.items():
        for f, v in n['inputs'].items():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0].isdigit():
                if v[0] not in ids: probs.append(f"API {k}.{f} 死引用")
    for slot_n in range(5, 9):
        for dst in ('16', '208'):
            if a[dst]['inputs'].get(f'ref_images.ref_image_{slot_n}') is None: probs.append(f"API[{dst}] 缺槽{slot_n}")
    if a['220']['inputs'].get('last_frame') != [str(END_FRAME_ID), 0]: probs.append("API 尾帧未接")
    if a['16']['inputs'].get('ref_videos.ref_video_0') != [str(VIDEO_ID), 0]: probs.append("API 视频未接")
    return probs

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'apply'
    ok = True
    for tag, path in UI_FILES.items():
        d = json.load(open(path, encoding='utf-8'))
        if mode != '--verify':
            sweep = sweep_dangling(d)
            if sweep: print(f"{tag}: 清悬空登记 {sweep} 处")
            n = surgery(d)
            json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            print(f"{tag}: +{n}链")
        probs = verify(d)
        print(f"{tag}: {len(d['nodes'])}节点/{len(d['links'])}链 → {'✅' if not probs else '❌ ' + '; '.join(probs[:5])}")
        ok &= not probs
    a = json.load(open(API_FILE, encoding='utf-8'))
    if mode != '--verify':
        api_surgery(a)
        json.dump(a, open(API_FILE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    aprobs = api_verify(a)
    print(f"apitwin: {len(a)}节点 → {'✅' if not aprobs else '❌ ' + '; '.join(aprobs[:5])}")
    sys.exit(0 if ok and not aprobs else 1)
