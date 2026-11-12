#!/usr/bin/env python3
"""三采-单镜(母本)两笔修复(1112 用户令「修」;导演台役已先行修正,母本跟进)。

①F1 开关倒挂:[219]=true 时 ComfySwitchNode 走 on_true,而母本 on_true 接 i2v 臂
  (218←251σshift/221·222←220),与 [219] title/Note103「√=r2v」全文案相反(1105 双模式
  臂引入即倒挂)。修=交换三开关 on_true/on_false 两槽的 link 引用(true→on_true=r2v 臂)。
  契约测试 test_single_source_mode_switch 原断言的槽位命名与物理 wiring 共谋(把 on_false
  槽读作 t_slot),随本修复改写为真实槽语义。
②audio_vae 陈旧线:引擎 0.45.2 的 MiniMaxH3ImageToVideo 已无 audio_vae 入参
  (object_info 实证),母本 [120]→[220](link564)=0.44 时代遗物,i2v 实弹必炸 TypeError。
  修=拔线+剥 220 输入槽+清 120.outputs 引用。

幂等:检测已修方向则跳过对应步。母本其余内容(Note103 运行法则等)零改动。
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / 'apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json'
SWITCHES = (218, 221, 222)
R2V_SRC = {16, 140}          # r2v 臂源(kitchen 140 / ReferenceToVideo 16)
I2V_SRC = {217, 220, 251}    # i2v 臂源(kitchen 217 / ImageToVideo 220 / σshift 251)


def main() -> int:
    d = json.loads(WF.read_text())
    nodes = {n['id']: n for n in d['nodes']}
    links = {l[0]: l for l in d['links']}

    # ① F1:交换三开关两臂——定方向(√=r2v)+节点侧引用与 links tslot 强制对齐(幂等)
    # (只换节点侧=links tslot 残留旧槽位,双向一致性必失配;1112 实踩 574/758)
    swapped = 0
    for sw in SWITCHES:
        ins_list = nodes[sw]['inputs']
        slot_of = {i['name']: j for j, i in enumerate(ins_list)}
        ins = {i['name']: i for i in ins_list}
        lt, lf = ins['on_true'].get('link'), ins['on_false'].get('link')
        st = links[lt][1] if lt in links else None
        sf = links[lf][1] if lf in links else None
        assert {st, sf} <= (R2V_SRC | I2V_SRC) and (st in R2V_SRC) != (sf in R2V_SRC), \
            f'[{sw}] 两臂源识别失败: {st}/{sf},人工核'
        if st in I2V_SRC:  # 倒挂态(或半应用态):记一次换
            swapped += 1
        l_r2v, l_i2v = (lt, lf) if st in R2V_SRC else (lf, lt)
        ins['on_true']['link'], ins['on_false']['link'] = l_r2v, l_i2v
        links[l_r2v][4] = slot_of['on_true']
        links[l_i2v][4] = slot_of['on_false']

    # ② audio_vae 陈旧线拔除
    n220 = nodes[220]
    av = next((i for i in n220['inputs'] if i['name'] == 'audio_vae'), None)
    dropped = 0
    if av is not None:
        lid = av.get('link')
        if lid is not None and lid in links:
            del links[lid]
            dropped += 1
        n220['inputs'] = [i for i in n220['inputs'] if i['name'] != 'audio_vae']
        n120 = nodes[120]
        for o in n120.get('outputs', []):
            if lid in (o.get('links') or []):
                o['links'] = [x for x in o['links'] if x != lid]
        d['links'] = [l for l in d['links'] if l[0] != lid]
    d['last_link_id'] = max(l[0] for l in d['links'])

    # 终态断言
    links2 = {l[0]: l for l in d['links']}
    for sw in SWITCHES:
        ins = {i['name']: i for i in nodes[sw]['inputs']}
        st = links2[ins['on_true']['link']][1]
        sf = links2[ins['on_false']['link']][1]
        assert st in R2V_SRC and sf in I2V_SRC, f'[{sw}] 修后 on_true={st}(应 r2v) on_false={sf}(应 i2v)'
    assert all(i['name'] != 'audio_vae' for i in nodes[220]['inputs']), '220 仍声明 audio_vae'
    live = {l[0] for l in d['links']}
    dangling = [i.get('link') for n in d['nodes'] for i in n.get('inputs', [])
                if i.get('link') is not None and i['link'] not in live]
    assert not dangling, f'拔线后悬空引用: {dangling[:5]}'

    # ③ MyShot shot_id 法统失配:母本 [100] shot_id=S00(克隆残留) vs [4] p2 前缀
    # parts[3]=sb-chapter-001-001——画布默认态跑二采必炸(my_shot.py:71;1112 母本 i2v
    # 验证弹实踩;历史 dwfrun 走 API 直投剥 MyShot 才未炸)。修=对齐 shot_id。
    n100 = nodes[100]
    prefix = next(w for n in d['nodes'] if n['id'] == 4 for w in [n['widgets_values'][0]])
    parts = prefix.split('/')
    shot_fixed = 0
    if n100.get('widgets_values', [None])[0] != parts[3]:
        n100['widgets_values'][0] = parts[3]
        shot_fixed = 1
    assert n100['widgets_values'][0] == parts[3], 'MyShot shot_id 仍未对齐'

    WF.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n')
    print(f'OK 母本修复: F1 换接线 {swapped}/3, audio_vae 拔线 {dropped} 条, '
          f'MyShot shot_id 对齐 {shot_fixed}; nodes={len(d["nodes"])} links={len(d["links"])}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
