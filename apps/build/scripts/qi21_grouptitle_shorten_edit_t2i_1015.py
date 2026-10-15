#!/usr/bin/env python3
"""qi21 edit/t2i 组框标题缩短手术(1015 用户令「组标题不要小作文」,对齐 i2i 精简款)。
fail-closed 范式(同 qi21_i2i_alpha_wash_1015.py):术前 sha 字节锚→断言不满足 exit 2 零写入→
已全术后 exit 3 幂等拦停→部分术后拒续;/.bak-1015gt 备份留档(不入 commit,照 .bak-1015t5 先例)。
只改 groups[].title 十处,零触碰 nodes/links/bounding。
"""
import hashlib
import json
import sys

FILES = {
    "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json": {
        "Qwen-Image-2.1 ①加载器(bf16 三件套[1][2][3]+[28]VAE总线拐(PE-I2I 专属TE[4019] 住 [6] 子图内)→[29]→[5]解码)": "道劫·①加载器",
        "道劫·②图像·输入主链(1003甲案:图像输入列=合法先导列——双图[10][11]+双预缩[16][17]+缓存[9]+画幅开关[19]成列,先于装配列;[400]指令归位本带→[6]装配子图(双击进入;PE改写/编码在内,面板=指令/PE启用?);空潜[4]→[20]latent汇入③;采样=③加速子图;出图=④输出=终点)": "道劫·②图像·输入主链",
        "道劫·②指令外露带([400]原始用户词=指令①层唯一手写位→[6].指令;PE-I2I 改写链已收进[6]装配子图,开关=宿主面板「PE开关」;1003甲案归位②带不再掉底)": "道劫·②指令外露带",
        "道劫·③加速(加速子图宿主[7](双击进入;三支路+viggle LoRA+选择件+seed在内,面板=速度档位+seed);model=[9]缓存单线入/LATENT单线出→[5];寄居:[20]latent汇入/[29]VAE递送reroute)": "道劫·③加速",
        "道劫·④输出([5]解码→[8]保存;无⑤尾档=输出列即终点)": "道劫·④输出",
    },
    "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json": {
        "道劫·①加载器(UNET[1]/VAE[3]/主TE:[2]→[6];PE专属TE已迁装配子图(1002 ⑬))": "道劫·①加载器",
        "道劫·②提示词·装配([400]正向提示词=①层唯一手写位;[404]负向提示词;[6]装配子图(双击进入;主体句PE扩写+型底座+美术风格底座三层拼装全在内,面板=正向提示词/负向提示词/型选择/PE启用?);[401]正负双预览)": "道劫·②提示词·装配",
        "道劫·加速区·③([4]空潜→[7]加速子图(双击进入:并行三支路+viggle LoRA+seed单源+出图速度选择全在内;面板=速度档位/seed;未选支路懒执行零加载)→LATENT)": "道劫·加速区③",
        "道劫·④输出([5]VAEDecode→[8]直出保存;[5]另扇出→⑤放大尾档)": "道劫·④输出",
        "道劫·⑤SeedVR2放大尾档·2K([501]DiT+[502]VAE→[503]短边2048→[504]存MYStudio-2K;默认旁路(组员mode=4,1008用户令;启用=框选本组Ctrl+B→只出[8]直出图外的2K放大);适合1MP档,4.2MP≈纯插值建议旁路)": "道劫·⑤SeedVR2放大尾档·2K",
    },
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    # 术前快照+字节锚
    anchors = {}
    for path in FILES:
        raw = open(path, "rb").read()
        anchors[path] = sha(raw)

    states = {}
    for path, mapping in FILES.items():
        d = json.load(open(path))
        titles = [g.get("title", "") for g in d["groups"]]
        if all(t in mapping.values() for t in titles):
            states[path] = "done"
        elif all(t in mapping for t in titles):
            states[path] = "pending"
        else:
            extra = [t for t in titles if t not in mapping]
            print(f"[exit 2] {path}: 断言不满足(组外标题 {extra[:2]})——零写入")
            return 2

    if all(v == "done" for v in states.values()):
        print("[exit 3] 已全术后,幂等拦停")
        return 3
    pending = [p for p, v in states.items() if v == "pending"]
    done = [p for p, v in states.items() if v == "done"]
    if done:
        print(f"[exit 2] 部分术后 {done} 而待术 {pending}——拒续,人工核")
        return 2

    # 执行:逐文件 title 精准替换+.bak 备份
    for path, mapping in FILES.items():
        raw = open(path, "rb").read()
        open(path + ".bak-1015gt", "wb").write(raw)
        text = raw.decode("utf-8")
        for old, new in mapping.items():
            assert text.count(old) == 1, f"{path}: title 非唯一命中"
            text = text.replace(old, new, 1)
        open(path, "wb").write(text.encode("utf-8"))
        # 终验:JSON 可解析+新 title 在座+旧 title 清零+组数不变
        d = json.load(open(path))
        titles = [g.get("title", "") for g in d["groups"]]
        assert len(titles) == len(mapping)
        assert all(t in titles for t in mapping.values())
        assert not any(t in titles for t in mapping.keys())
        print(f"[OK] {path}: {len(mapping)} 组框标题已缩短")

    # 术后字节锚回报(供台账)
    for path in FILES:
        print(f"  post-sha {path.split('/')[-1]} = {sha(open(path,'rb').read())[:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
