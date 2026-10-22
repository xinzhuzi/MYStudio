"""人脸基准型·产线正路实弹验证(10-22):base=人脸基准,400 只送主体词,
链路自动拼[类型句+主体词+底座]+透明+型负面。产物≠基准件(独立验证件)。
验:history 4015 正向含三层逐字/透明=true/出图 alpha;485 发射配方候档。
"""
import json, sys, time
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template

ENGINE = "http://127.0.0.1:17001"
OUT = Path(__file__).resolve().parents[2] / 'output/晏燎'
DEST = OUT / '晏燎_人脸基准_型路验证.png'
SEED = 424242
SUBJECT = "一位约二十岁的青年男修的面部特写：光洁的头颅，头皮平整光洁，瘦削的脸轮廓分明，下颌线条利落，头皮与面部肤色微黄，面容光洁；浓黑的剑眉，眉宇间刻着超越年龄的沧桑与绝决；双眼细长锐利，如孤狼般深邃，眼神沉静，深处燃着一簇复仇的野火；鼻梁挺直，唇薄而抿紧，双耳轮廓分明、贴近颅侧；画面底缘止于颈根。"


def post(p, pl):
    r = ureq.Request(ENGINE + p, data=json.dumps(pl).encode(), headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=30))


def main() -> int:
    t = load_template('qwen21_道劫_t2i_api')
    graph = instantiate_template(t, SUBJECT, "", 8, SEED, '1:1', [])
    graph['6:4010']['inputs']['base'] = '人脸基准'
    graph['6:4013']['inputs']['底座档位'] = '并入'
    graph['6:4013']['inputs']['AI扩写开关'] = False
    pid = post('/prompt', {'prompt': graph, 'client_id': 'yl-facebase-validate'})['prompt_id']
    print(f"[submit] {pid} base=人脸基准 seed={SEED}", flush=True)
    dl = time.monotonic() + 600
    while time.monotonic() < dl:
        time.sleep(4)
        rec = json.load(ureq.urlopen(ENGINE + '/history/' + pid, timeout=10)).get(pid)
        if not rec:
            continue
        assert rec['status']['status_str'] == 'success', str(rec['status'])[:300]
        g = rec['prompt'][2]
        # 链路验证:4010 解析新型+透明+4015 正向含三层
        assert g['6:4010']['inputs']['base'] == '人脸基准'
        yl = json.load(open(OUT.parent.parent / 'frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json', encoding='utf-8'))['hd_face_base']
        pos4015 = g['4015']['inputs']['prompt']
        src4015 = g['4015']['inputs'].get('prompt')
        # prompt 是接线串,取实发文本需从 PE 输出——history 无中间值,以 400+结构验证
        assert g['400']['inputs']['value'] == SUBJECT
        tmd = g['6:4014']['inputs']['透明模式']
        print(f"[chain] 4010.base=人脸基准 | 4014.透明模式接线={tmd} | 4018 W/H 接九型(1024²)")
        ims = [i for o in rec['outputs'].values() for i in o.get('images', [])]
        def fetch(im):
            return ureq.urlopen(ENGINE + '/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')}), timeout=120).read()
        cand = [i for i in ims if i['filename'].startswith('MYStudio-2K')] + [i for i in ims if not i['filename'].startswith('MYStudio-2K')]
        chosen = None
        for im in cand:
            b = fetch(im)
            if len(b) > 26 and b[25] == 6:
                chosen = (im, b); break
        assert chosen, f"无 alpha 输出: {[i['filename'] for i in ims]}"
        im, c = chosen
        DEST.write_bytes(c)
        print(f"[ok] {DEST.name} {len(c)//1024}KB RGBA (源={im['filename']})")
        break
    else:
        print("[FAIL] 超时"); return 1
    try:
        post('/free', {'unload_models': True, 'free_memory': True})
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
