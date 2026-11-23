#!/usr/bin/env python3
"""1109 t2i-皮肤-超分 生成器 v2(幂等,手排线零重编号)。"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/t2i-皮肤-超分.json"
PROMPT = ("Restore this photo to professional quality. "
          "Remove all blur, noise, and compression artifacts from every visible surface "
          "— face, neck, shoulders, arms, hands, torso, legs, and feet. "
          "Recover sharp natural detail across all body skin: fine delicate pores, "
          "clean smooth texture, naturally radiant and healthy skin, "
          "individually resolved hair strands on the scalp and body, "
          "defined lip texture, crisp nail edges, and clear iris detail. "
          "Every patch of skin should look naturally smooth, finely grained, and true to life. "
          "Keep the exact same composition, framing, identity, pose, clothing, "
          "lighting, and every person unchanged.")
NOTE = ("# t2i·皮肤修复+超分(1109 建)\n\n"
        "## 用法\n[1] 选旧照 → [7] 指令已预填(可微调,保持正向) → [8] 25步编辑档\n"
        "[10] 直出保存 → [13] SeedVR2 短边 2048(2K) → [14] 终版\n\n"
        "## 指令要点\n全身八部位逐一点名 + 细腻毛孔/通透健康(正向) + 七项保留句\n\n"
        "## 超分\nSeedVR2 7B sharp fp8 + ema VAE(tiled 512/160)")

def N(nid, ntype, pos, wv=None, ins=None, outs=None, title="", size=None):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size or [260,120],
         "flags": {}, "order": nid, "mode": 0,
         "inputs": ins or [], "outputs": outs or [],
         "properties": {"Node name for S&R": ntype}, "widgets_values": wv}
    if title: n["title"] = title
    return n

def I(name, ntype, link): return {"name": name, "type": ntype, "link": link}
def O(name, ntype, links): return {"name": name, "type": ntype, "links": links}
def L(lid, o_id, o_slot, t_id, t_slot, ntype): return [lid, o_id, o_slot, t_id, t_slot, ntype]

NODES = [
    N(1,"LoadImage",[60,140],["example.png"],outs=[O("IMAGE","IMAGE",[1])],title="[1] 输入旧照"),
    N(2,"UNETLoader",[60,320],["qwen_image_2.1_bf16.safetensors","default"],outs=[O("MODEL","MODEL",[2])],title="[2] 底模 bf16"),
    N(3,"CLIPLoader",[60,480],["qwen3vl_8b_bf16_heretic.safetensors","qwen_image","default"],outs=[O("CLIP","CLIP",[3])],title="[3] TE heretic"),
    N(4,"VAELoader",[60,640],["qwen_image_2.1_vae_bf16.safetensors"],outs=[O("VAE","VAE",[4,11])],title="[4] VAE"),
    N(5,"QwenImage21Cache",[380,320],["auto","default"],ins=[I("model","MODEL",2)],outs=[O("MODEL","MODEL",[6])],title="[5] 缓存加速"),
    N(6,"ImageScaleToTotalPixels",[380,140],["lanczos",1.0],ins=[I("image","IMAGE",1)],outs=[O("IMAGE","IMAGE",[5])],title="[6] 预缩 1.0MP"),
    N(7,"TextEncodeQwenImage21",[700,320],[PROMPT,"",1024],size=[340,260],
      ins=[I("clip","CLIP",3),I("vae","VAE",4),I("images.image_1","IMAGE",5)],
      outs=[O("positive","CONDITIONING",[7]),O("negative","CONDITIONING",[8]),O("latent","LATENT",[9])],
      title="[7] 修复指令(唯一手写位)"),
    N(8,"KSampler",[1100,320],[0,"fixed",25,1,"euler","simple",1],size=[300,260],
      ins=[I("model","MODEL",6),I("positive","CONDITIONING",7),I("negative","CONDITIONING",8),I("latent_image","LATENT",9)],
      outs=[O("LATENT","LATENT",[10])],title="[8] 编辑采样·25步 cfg1"),
    N(9,"VAEDecode",[1450,320],
      ins=[I("samples","LATENT",10),I("vae","VAE",11)],
      outs=[O("IMAGE","IMAGE",[12,13])],title="[9] 解码"),
    N(10,"SaveImage",[1450,540],["皮肤修复-直出"],ins=[I("images","IMAGE",12)],title="[10] 直出保存"),
    N(11,"SeedVR2LoadDiTModel",[1100,700],
      ["seedvr2_7b_sharp_fp8_e4m3fn.safetensors","sdpa",0,False,"none",False,"sdpa"],
      outs=[O("MODEL","MODEL",[14])],title="[11] SeedVR2 DiT(sharp 7B fp8)"),
    N(12,"SeedVR2LoadVAEModel",[1450,700],
      ["ema_vae_fp16.safetensors","sdpa",True,512,160,True,512,160,"false","none",False],
      outs=[O("VAE","VAE",[15])],title="[12] SeedVR2 VAE"),
    N(13,"SeedVR2VideoUpscaler",[1800,700],
      [42,"fixed",2048,4096,1,False,"lab",0,0,0,0,"none",False],
      ins=[I("model","MODEL",14),I("vae","VAE",15),I("image","IMAGE",13)],
      outs=[O("IMAGE","IMAGE",[16])],title="[13] SeedVR2 放大·短边2048(2K)"),
    N(14,"SaveImage",[1800,940],["皮肤修复-2K"],ins=[I("images","IMAGE",16)],title="[14] 终版保存(2K)"),
    N(15,"MarkdownNote",[60,900],[NOTE],size=[420,350],title="[15] 说明卡"),
]
LINKS = [
    L(1, 1,0, 6,0, "IMAGE"),
    L(2, 2,0, 5,0, "MODEL"),
    L(3, 3,0, 7,0, "CLIP"),
    L(4, 4,0, 7,1, "VAE"),
    L(5, 6,0, 7,2, "IMAGE"),
    L(6, 5,0, 8,0, "MODEL"),
    L(7, 7,0, 8,1, "CONDITIONING"),
    L(8, 7,1, 8,2, "CONDITIONING"),
    L(9, 7,2, 8,3, "LATENT"),
    L(10, 8,0, 9,0, "LATENT"),
    L(11, 4,0, 9,1, "VAE"),
    L(12, 9,0, 10,0, "IMAGE"),
    L(13, 9,0, 13,2, "IMAGE"),
    L(14, 11,0, 13,0, "MODEL"),
    L(15, 12,0, 13,1, "VAE"),
    L(16, 13,0, 14,0, "IMAGE"),
]

def main() -> int:
    doc = {"id":"skin-restore-sr-1109","revision":1,"last_node_id":15,"last_link_id":16,
           "nodes":NODES,"links":LINKS,"groups":[],"config":{},"extra":{},"version":0.4}
    OUT.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"已写 {OUT.relative_to(ROOT)}(15 节点/16 链)")
    return 0

if __name__=="__main__": sys.exit(main())
