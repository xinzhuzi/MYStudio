"""晏燎高清人脸 文生图基准脸(10-22 用户令「就用这个…使用api进行生图」)。

送法=按链路归口:400 送[主体句(含五官)+头颈型文手术版](过主体句门,零画风词);
底座段由 底座档位=并入 从真源 4032 自动拼(=草案段3 逐字);base=自由=零类型句注入
(真源人脸型文带头发/衣领句,与光头意图打架,故不入链)。
首发射训诫:t2i 全路门禁把 400 输入整段按主体句查,预拼底座段撞画风词禁令
(工笔/白描/连环画)——i2i negation_only 豁免路在 t2i 无,各层必须归口送。
产物=apps/output/晏燎/晏燎_高清人脸_t2i_基准.png(取 MYStudio-2K SeedVR2 2K 输出)。
seed=424242 固定(复现锚;用户不满则换 seed 重掷)。
"""
import json, sys, time, uuid
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template

ENGINE = "http://127.0.0.1:17001"
OUT = Path(__file__).resolve().parents[2] / 'output/晏燎'
DEST = OUT / '晏燎_高清人脸_t2i_基准.png'
SEED = 424242

# 400 输入=主体句+型文手术版(含透明声明行;底座归 4032 并入,404 只带型负面+光头专项)
POSITIVE = "\n".join([
    "一位约二十岁的青年男修的面部特写：光洁的头颅，头皮平整光洁，瘦削的脸轮廓分明，下颌线条利落，头皮与面部肤色微黄，面容光洁；浓黑的剑眉，眉宇间刻着超越年龄的沧桑与绝决；双眼细长锐利，如孤狼般深邃，眼神沉静，深处燃着一簇复仇的野火；鼻梁挺直，唇薄而抿紧，双耳轮廓分明、贴近颅侧；画面底缘止于颈根。",
    "单一角色的正面头颈特写素材：正面平视机位，视线直视镜头，取景为头部与颈部；头顶、头颅外轮廓与下颌完整，面部是画面焦点，五官按角色年龄与身份作动漫式概括，面部以线条与简洁色块造型。画面仅含该角色的头部与颈部，独占画面。面部细节密度最高，五官与眉眼轮廓清晰锐利。面部肤色与角色设定一致；图为带透明通道的RGBA透明底图，背景透明；设定图采用便于辨认结构的均匀漫射光。",
])
NEGATIVE = ("模糊，水印，多手指，文字错误，全身像，半身像，躯干入画，四肢入画，手部入画，侧面视角，仰拍，俯拍，头部歪斜，头顶裁切，下颌裁切，广角畸变，透视变形，面容身份漂移，脸型漂移，发型漂移，发际线漂移，五官错位，眼睛畸形，鼻口扭曲，牙齿畸形，多余五官，面部融化，透明头皮，UI 界面，logo，头发，发型，发丝，鬓角，胡须，衣物，衣领，服装，配饰")


def gate_precheck():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'gg', Path(__file__).resolve().parents[2] / 'backend/engines/comfyui/my_nodes/nodes/_gongbi_gate.py')
    gg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gg)
    v1 = gg.prompt_violations(POSITIVE.split('\n')[0], is_subject=True)
    vf = gg.prompt_violations(POSITIVE, is_subject=False)
    assert not v1 and not vf, f"门禁红: {v1} {vf}"


def post(p, pl):
    r = ureq.Request(ENGINE + p, data=json.dumps(pl).encode(), headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=30))


def main() -> int:
    gate_precheck()
    log_path = OUT / 'face_t2i.log'
    def log(m):
        print(m, flush=True)
        with open(log_path, 'a') as f:
            f.write(m + '\n')

    t = load_template('qwen21_道劫_t2i_api')
    graph = instantiate_template(t, POSITIVE, NEGATIVE, 8, SEED, '1:1', [])
    ov = {
        ('6:4010', 'base'): '自由',
        ('6:4010', '透明覆盖'): True,
        ('6:4013', '底座档位'): '并入',
        ('6:4013', 'AI扩写开关'): False,
        ('4018', '手动宽'): 1024,
        ('4018', '手动高'): 1024,
    }
    for (nid, key), v in ov.items():
        graph[nid]['inputs'][key] = v
    pid = post('/prompt', {'prompt': graph, 'client_id': 'yl-face-t2i'})['prompt_id']
    log(f"[submit] prompt_id={pid} seed={SEED} 覆写={ov}")
    dl = time.monotonic() + 600
    while time.monotonic() < dl:
        time.sleep(4)
        rec = json.load(ureq.urlopen(ENGINE + '/history/' + pid, timeout=10)).get(pid)
        if not rec:
            continue
        assert rec['status']['status_str'] == 'success', str(rec['status'])[:300]
        ims = [i for o in rec['outputs'].values() for i in o.get('images', [])]

        def fetch(im):
            return ureq.urlopen(ENGINE + '/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')}), timeout=120).read()

        def has_alpha(b):
            return len(b) > 26 and b[25] == 6  # PNG IHDR color type 6 = RGBA

        # 透明底版:优先 SeedVR2 2K,若其丢 alpha 则回退 1024 原生输出;两者皆无 alpha=硬失败
        cand = [i for i in ims if i['filename'].startswith('MYStudio-2K')] + \
               [i for i in ims if not i['filename'].startswith('MYStudio-2K')]
        chosen = None
        for im in cand:
            b = fetch(im)
            if has_alpha(b):
                chosen = (im, b); break
            log(f"[alpha-loss] {im['filename']} 无透明通道,试下一候选")
        assert chosen, f"全部输出均无透明通道: {[i['filename'] for i in ims]}"
        im, c = chosen
        DEST.write_bytes(c)
        log(f"[ok] {DEST.name} {len(c)//1024}KB RGBA透明 (源={im['filename']})")
        break
    else:
        log("[FAIL] 600s 超时"); return 1
    try:
        post('/free', {'unload_models': True, 'free_memory': True})
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
