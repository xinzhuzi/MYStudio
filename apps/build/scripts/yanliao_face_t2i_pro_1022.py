"""晏燎人脸基准·正式产线发图(10-22;用户令「类型词都做全了吗/人脸基准做了吗」).

与旧发(yanliao_face_t2i_1022.py)的差别=全链归口升级:
  - base=人脸基准(型注入全自动:1:1 1024²/透明开/型文自动并入;旧发 base=自由
    +手动透明+手动拼型文是型缺席期的过渡手法);
  - 400 输入=纯主体句(光头/五官锚;型文与透明声明由链自动拼,零手动复述);
  - 走重建后桥模板(qwen21-道劫-t2i-api,含洗底子图 7500:750x)——产物透明区
    RGB 由洗底链归黑(旧产物未过洗底=紫底隐患,即用户点名问题);
  - 落盘后 PIL α分区 RGB 均值统计(洗底效验:α=0 区应 ≈(0,0,0))。
seed=424242 复现锚;产物 apps/output/晏燎/晏燎_人脸基准_t2i_1022.png。
"""
import json, sys, time
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template

ENGINE = "http://127.0.0.1:17001"
OUT = Path(__file__).resolve().parents[2] / 'output/晏燎'
DEST = OUT / '晏燎_人脸基准_t2i_1022.png'
SEED = 424242

# 纯主体句(型文/透明声明/底座全由链拼;零手动复述参考图细节)
POSITIVE = ("一位约二十岁的青年男修的面部特写：光洁的头颅，头皮平整光洁，瘦削的脸轮廓分明，"
            "下颌线条利落，头皮与面部肤色微黄，面容光洁；浓黑的剑眉，眉宇间刻着超越年龄的沧桑与绝决；"
            "双眼细长锐利，如孤狼般深邃，眼神沉静，深处燃着一簇复仇的野火；鼻梁挺直，唇薄而抿紧，"
            "双耳轮廓分明、贴近颅侧；画面底缘止于颈根。")
NEGATIVE = ("模糊，水印，多手指，文字错误，全身像，半身像，躯干入画，四肢入画，手部入画，侧面视角，"
            "仰拍，俯拍，头部歪斜，头顶裁切，下颌裁切，广角畸变，透视变形，面容身份漂移，脸型漂移，"
            "发型漂移，发际线漂移，五官错位，眼睛畸形，鼻口扭曲，牙齿畸形，多余五官，面部融化，"
            "透明头皮，UI 界面，logo，头发，发型，发丝，鬓角，胡须，衣物，衣领，服装，配饰")


def gate_precheck():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'gg', Path(__file__).resolve().parents[2] /
        'backend/engines/comfyui/my_nodes/nodes/_gongbi_gate.py')
    gg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gg)
    v1 = gg.prompt_violations(POSITIVE, is_subject=True)
    assert not v1, f"主体句门禁红: {v1}"


def post(p, pl):
    r = ureq.Request(ENGINE + p, data=json.dumps(pl).encode(),
                     headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=30))


def alpha_stats(png_bytes: bytes, tag: str) -> str:
    from io import BytesIO
    from PIL import Image
    with Image.open(BytesIO(png_bytes)) as im:
        im.load()
        if im.mode != 'RGBA':
            return f"[{tag}] 非RGBA({im.mode})"
        r, g, b, a = im.split()
        hist = a.histogram()
        total = im.width * im.height
        zero = hist[0] / total
        import numpy as np
        arr = np.array(im)
        mz = arr[:, :, 3] == 0
        mo = arr[:, :, 3] == 255
        zmean = arr[mz][:, :3].mean(axis=0).round(1).tolist() if mz.any() else None
        omean = arr[mo][:, :3].mean(axis=0).round(1).tolist() if mo.any() else None
        return (f"[{tag}] {im.width}x{im.height} α=0占比{zero:.1%} "
                f"α0区RGB均值={zmean}(洗底应≈0,0,0) 实体区RGB均值={omean}")


def main() -> int:
    gate_precheck()
    log_path = OUT / 'face_t2i.log'

    def log(m):
        print(m, flush=True)
        with open(log_path, 'a') as f:
            f.write(m + '\n')

    q = post('/queue', None) if False else json.load(ureq.urlopen(ENGINE + '/queue', timeout=10))
    assert not q['queue_running'] and not q['queue_pending'], f"共享引擎忙: {q}"

    t = load_template('qwen21_道劫_t2i_api')
    graph = instantiate_template(t, POSITIVE, NEGATIVE, 8, SEED, '1:1', [])
    ov = {
        ('6:4010', 'base'): '人脸基准',
        ('6:4013', '底座档位'): '并入',
        ('6:4013', 'AI扩写开关'): False,
    }
    for (nid, key), v in ov.items():
        graph[nid]['inputs'][key] = v
    pid = post('/prompt', {'prompt': graph, 'client_id': 'yl-facebase-pro'})['prompt_id']
    log(f"[submit-pro] prompt_id={pid} seed={SEED} 覆写={ov}")
    dl = time.monotonic() + 900
    while time.monotonic() < dl:
        time.sleep(5)
        rec = json.load(ureq.urlopen(ENGINE + '/history/' + pid, timeout=10)).get(pid)
        if not rec:
            continue
        assert rec['status']['status_str'] == 'success', str(rec['status'])[:400]
        # 取证:引擎内实拼终稿(装配链活体输出)
        for k in ('4015', '171'):
            if k in rec['prompt'][2]:
                txt = rec['prompt'][2][k]['inputs'].get('prompt', '')
                if txt:
                    (OUT / 'face_t2i_pro_final_prompt.txt').write_text(txt)
                    log(f"[final-prompt] {k} 字数={len(txt)} 首行={txt.splitlines()[0][:60]}")
                    break
        ims = [i for o in rec['outputs'].values() for i in o.get('images', [])]
        log(f"[outputs] {[(i['filename']) for i in ims]}")

        def fetch(im):
            return ureq.urlopen(ENGINE + '/view?' + urlencode(
                {'filename': im['filename'], 'subfolder': im.get('subfolder', ''),
                 'type': im.get('type', 'output')}), timeout=180).read()

        def has_alpha(b):
            return len(b) > 26 and b[25] == 6

        cand = [i for i in ims if i['filename'].startswith('MYStudio-2K')] + \
               [i for i in ims if not i['filename'].startswith('MYStudio-2K')]
        chosen = None
        for im in cand:
            b = fetch(im)
            if has_alpha(b):
                chosen = (im, b)
                break
            log(f"[alpha-loss] {im['filename']} 无透明通道,试下一候选")
        assert chosen, f"全部输出均无透明通道: {[i['filename'] for i in ims]}"
        im, c = chosen
        DEST.write_bytes(c)
        log(f"[ok] {DEST.name} {len(c)//1024}KB RGBA透明 (源={im['filename']})")
        log(alpha_stats(c, '新产物·洗底桥'))
        old = OUT / '晏燎_高清人脸_t2i_基准.png'
        if old.exists():
            log(alpha_stats(old.read_bytes(), '旧产物·未洗底对照'))
        break
    else:
        log("[FAIL] 900s 超时")
        return 1
    try:
        post('/free', {'unload_models': True, 'free_memory': True})
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
