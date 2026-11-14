#!/usr/bin/env python3
"""三采全节点千位段编号(1114 用户令:按 1,1000,2000... 分组标号,组内十步留插入位)
三面:repo真源+UI孪生+API孪生;widgets/连线拓扑零变,仅 id 与引用重映射。"""
import json, sys

M = {
    # 输入组 1-99: 1=参考图1主图 11-18=参考图2-9 21=提示词 31=尾帧 41/42=视频+桥 51-54=时长/表达式/画幅/种子
    9:1, 110:11, 111:12, 112:13, 113:14, 341:15, 342:16, 343:17, 344:18,
    14:21, 345:31, 346:41, 347:42, 20:51, 131:52, 22:53, 129:54,
    # 加载模型 1000-1099
    127:1001, 128:1002, 119:1003, 120:1004, 145:1011, 216:1012, 202:1021,
    260:1031, 262:1032, 267:1033, 261:1034, 263:1035, 217:1041, 140:1042,
    251:1051, 219:1061, 218:1062, 266:1071,
    # 一阶段采样 2000-2099
    16:2001, 220:2002, 221:2011, 222:2012, 250:2021, 123:2022,
    126:2031, 125:2032, 122:2041, 121:2042, 130:2051, 204:2061,
    # 二阶段放大 3000-3099
    205:3001, 206:3002, 207:3003, 223:3011, 203:3021, 208:3031,
    209:3041, 210:3042, 211:3043, 215:3044, 212:3051, 213:3052, 214:3053,
    100:3061, 4:3071,
    # 三采超分 4000-4099
    338:4001, 339:4002, 340:4003,
    # README(组外)
    101:9999,
}
assert len(M) == 66, len(M)
assert len(set(M.values())) == 66

UI = {
    'repo': '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json',
    'twin': '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.json',
}
API = '/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/assist/image-studio/h3-three-stage-template.api.json'

def renumber_ui(d):
    for n in d['nodes']:
        n['id'] = M[n['id']]
        n['order'] = M.get(n.get('order', n['id']), n['id'])
    for l in d['links']:
        l[1] = M[l[1]]; l[3] = M[l[3]]
    d['last_node_id'] = max(M.values())

for tag, p in UI.items():
    d = json.load(open(p, encoding='utf-8'))
    before = len(d['nodes'])
    renumber_ui(d)
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    # 自检: 连线端点全在集内+无旧id残留
    ids = {n['id'] for n in d['nodes']}
    assert all(l[1] in ids and l[3] in ids for l in d['links'])
    print(f"{tag}: {before}→{len(d['nodes'])} 节点重编号毕,链端点闭合✅")

a = json.load(open(API, encoding='utf-8'))
for legacy in ("264", "265"):  # 监控死端残留(UI主线1113已删,API孪生漏网)顺手清
    a.pop(legacy, None)
new_a = {}
for k, v in a.items():
    new_a[str(M[int(k)])] = v
for v in new_a.values():
    for f, val in v['inputs'].items():
        if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str) and val[0].isdigit():
            val[0] = str(M[int(val[0])])
json.dump(new_a, open(API, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
ids = set(new_a)
bad = [(k, f, v) for k, n in new_a.items() for f, v in n['inputs'].items()
       if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0].isdigit() and v[0] not in ids]
assert not bad, bad
print(f"apitwin: {len(new_a)} 键重编号毕,零死引用✅")
print("映射样例: 9→1 | 110-113/341-344→11-18 | 14→21 | 16→2001 | 4→3071 | 338→4001 | 101→9999")
