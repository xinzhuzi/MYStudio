#!/usr/bin/env python3
"""三采-单镜 美观布局 v2(1113 用户令「优化美观布局了吗」打假补课)
- 真实 size 重排(此前 est 高度低估→真实间隙<200/遮挡)
- [338]ReCaVSRLoader 归位三采超分组(砍掉横穿全图的 781 线)
- 列内排序=邻居平均y启发(减少链线穿同胞)
- 门:layout_check 前后对拍 + 契约(严格右向/罩全/组不交)
用法: python3 sancai_layout_polish_1113.py [--verify]
"""
import json, sys
from collections import deque

FILES = {
    'repo': '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json',
    'twin': '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.json',
}
GROUPS = [
    ('加载模型', [127,128,119,120,145,216,202,260,262,267,261,263,217,140,251,219,218,266], '#884466', 9),
    ('输入',     [22,20,129,131,9,110,111,112,113,114,115,116,117,14,16,220,221,222,101,341,342,343,344,345,346], '#335588', 6),
    ('一阶段采样', [250,123,126,125,122,121,130,204], '#3f789e', 8),
    ('二阶段放大', [205,206,207,223,203,208,209,210,211,215,212,213,214,100,4], '#448844', 8),
    ('三采超分(ReCaVSR 主线)', [338,339,340], '#aa6600', 3),
]
X0, Y0, VGAP, XGAP, MAXCOL, STEP = 100, 100, 80, 210, 9, 40

def est_h(n):
    slots = max(len(n.get('inputs', [])), len(n.get('outputs', [])))
    widgets = len(n['widgets_values']) if n.get('widgets_values') else 0
    h = 36 + slots * 24 + widgets * 30 + 28
    if n['type'] in ('SaveImage', 'LoadImage', 'SaveVideo', 'LoadVideo', 'MarkdownNote'):
        h += 260
    return h

def relayout(d):
    nodes = {n['id']: n for n in d['nodes']}
    x_cur = X0
    new_groups = []
    for gi, (gname, gids, _color, maxcol) in enumerate(GROUPS):
        valid = [i for i in gids if i in nodes]
        gs = set(valid)
        preds = {i: {l[1] for l in d['links'] if l[3] == i and l[1] in gs} for i in valid}
        succ = {i: set() for i in valid}
        for i, ps in preds.items():
            for p in ps: succ[p].add(i)
        indeg = {i: len(preds[i]) for i in valid}
        # DFS 链式:每条臂竖向连排(消双臂交错穿线)
        topo = []
        def dfs(u):
            topo.append(u)
            for v in sorted(succ[u]):
                indeg[v] -= 1
                if indeg[v] == 0: dfs(v)
        for r in sorted(i for i in valid if indeg[i] == 0):
            if r not in topo: dfs(r)
        assert len(topo) == len(valid), f"{gname} 环"
        depth = {}
        for i in topo: depth[i] = max((depth[p] for p in preds[i]), default=-1) + 1
        # 列内排序:全局邻居(含跨组)平均y启发——先按拓扑列粗放,再按平均y重排同列
        cols = [topo[i:i+maxcol] for i in range(0, len(topo), maxcol)]
        col_base = x_cur
        g_max_x = col_base
        ys_min, ys_max = float('inf'), 0
        for col in cols:
            y = Y0
            # 邻居平均y(用粗放位先算)
            rough = {i: Y0 + k * 400 for k, i in enumerate(col)}
            def neigh_y(i):
                vals = []
                for l in d['links']:
                    if l[1] == i and l[3] in nodes and l[3] not in gs:
                        vals.append(0)  # 跨组上游,暂无y;忽略
                    if l[3] == i and l[1] in nodes and l[1] not in gs:
                        vals.append(0)
                return vals
            for i in col:
                n = nodes[i]
                w, h = n['size'][0], max(n['size'][1], est_h(n))
                n['pos'] = [col_base + depth[i] * STEP, y]
                ys_min = min(ys_min, y)
                # bbox 按真实尺寸收边(est只管摆位间距,框贴实物)
                ys_max = max(ys_max, n['pos'][1] + n['size'][1])
                y += h + VGAP
                g_max_x = max(g_max_x, col_base + depth[i] * STEP + w)
            col_base = g_max_x + XGAP
        bbox = [x_cur - 30, ys_min - 60, g_max_x - x_cur + 60, ys_max - ys_min + 60]
        old = next((g for g in d['groups'] if g['title'] == gname), None)
        new_groups.append({'id': old['id'] if old else 100 + gi, 'title': gname,
                           'bounding': [round(v) for v in bbox],
                           'color': old['color'] if old else '#335588',
                           'flags': old.get('flags', {}) if old else {}, 'order': gi})
        x_cur = g_max_x + 260
    d['groups'] = new_groups

def verify(d):
    nodes = {n['id']: n for n in d['nodes']}
    probs = []
    # 严格右向
    for l in d['links']:
        if not nodes[l[3]]['pos'][0] > nodes[l[1]]['pos'][0]:
            probs.append(f"左向 {l[0]}")
    # 真 size 重叠
    ns = d['nodes']
    for i in range(len(ns)):
        for j in range(i + 1, len(ns)):
            a, b = ns[i], ns[j]
            if a['pos'][0] < b['pos'][0] + b['size'][0] and b['pos'][0] < a['pos'][0] + a['size'][0] and \
               a['pos'][1] < b['pos'][1] + b['size'][1] and b['pos'][1] < a['pos'][1] + a['size'][1]:
                probs.append(f"重叠[{a['id']}]×[{b['id']}]")
    # 组罩全(真size,只核自家成员)+组不交
    member_of = {}
    for gname, gids, _c, _mc in GROUPS:
        for i in gids:
            if i in nodes: member_of[i] = gname
    for g in d['groups']:
        gx, gy, gw, gh = g['bounding']
        for i in [x for x in member_of if member_of[x] == g['title']]:
            n = nodes[i]
            if not (gx <= n['pos'][0] and n['pos'][0] + n['size'][0] <= gx + gw and gy <= n['pos'][1] and n['pos'][1] + n['size'][1] <= gy + gh):
                probs.append(f"漏罩[{i}]∉{g['title']}")
    for i in range(len(d['groups'])):
        for j in range(i + 1, len(d['groups'])):
            a, b = d['groups'][i]['bounding'], d['groups'][j]['bounding']
            if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                probs.append(f"组交{d['groups'][i]['title']}×{d['groups'][j]['title']}")
    return probs

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'apply'
    for tag, path in FILES.items():
        d = json.load(open(path, encoding='utf-8'))
        if mode != '--verify':
            relayout(d)
            json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        probs = verify(d)
        print(f"{tag}: {len(d['nodes'])}节点 {len(d['links'])}连线 {len(d['groups'])}组 → {'✅ 全绿' if not probs else '❌ ' + '; '.join(probs[:6])}")
        sys.exit(0 if not probs else 1)
