#!/usr/bin/env python3
"""SeedVR2 尾档调优(2026-10-17,用户令:temp 42→1;t2i ⑤组维持默认旁路+确认手动/API 开)。

[503] temp=42→1(官方低温口径:轻退化 AIGC 输入防过度生成/脑补纹路;
两件同改;i2i ⑤组本来默认开(用户既有用法),t2i ⑤组确认默认旁路=用户手动 Ctrl+B
或 fire --upscale2k 传参打开)。
fail-closed:术前锚 temp=42;回读;幂等 exit 3。
"""
import json, shutil, sys
from pathlib import Path
REPO = Path('/Users/zhengbingjin/Project/Github/MYStudio')
FILES = [
    REPO / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json',
    REPO / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json',
]
def main():
    changed = False
    for p in FILES:
        d = json.loads(p.read_text(encoding='utf-8'))
        n = next(n for n in d['nodes'] if n['id'] == 503)
        if n['widgets_values'][0] == 1:
            continue
        if n['widgets_values'][0] != 42:
            print(f'[sv2] FAIL: {p.name} 术前 temp={n["widgets_values"][0]} 非 42'); sys.exit(2)
        bak = p.with_suffix('.json.bak-1017sv2')
        if not bak.exists(): shutil.copy2(p, bak)
        n['widgets_values'][0] = 1
        if n.get('widgets_values_named'):
            for k in ('temp','temperature'):
                if k in n['widgets_values_named']: n['widgets_values_named'][k] = 1
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
        r = json.loads(p.read_text(encoding='utf-8'))
        assert next(x for x in r['nodes'] if x['id']==503)['widgets_values'][0] == 1
        changed = True
        print(f'[sv2] {p.name} [503].temp 42→1')
    if not changed:
        print('[sv2] 已术后形态,幂等拦停'); sys.exit(3)
    # t2i ⑤组旁路态确认(不改动,只报告)
    d = json.loads(FILES[0].read_text(encoding='utf-8'))
    modes = {i: next(n for n in d['nodes'] if n['id']==i).get('mode',0) for i in (501,502,503,504)}
    print(f'[sv2] t2i ⑤组 mode 现状:{modes}(旁路=4,手动 Ctrl+B 或 fire --upscale2k 打开)')
if __name__ == '__main__':
    main()
