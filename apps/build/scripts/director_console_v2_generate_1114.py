# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台新形态件生成器(11-13-director-console-remake 阶段2.5,1114 缺口①)。

PRD R1.3 终裁:``1_漫影自研/导演台.json`` 重生为**恰一条链(≤8 节点)**:
loader×4 → 导演台节点×1 → CreateVideo → SaveVideo(+1 张最小说明 Note)
——零镜头组/零克隆/零预留组,多镜/阶段勾选/素材管理全在面板内。

节点模板逐字段取自纯净化母本(三采-单镜.json,产线验证档):
- UNETLoader/CLIPLoader/VAELoader×2 的 widgets 钉值与
  my_nodes DIRECTOR_RECIPE 四件套同源(契约测试交叉核对);
- CreateVideo widgets [24, 8, "sRGB", "none"] 与母本 [130] 同值
  (fps 档为产线现行口径;阶段3 执行链若定 25fps 另有用户令,不在此改);
- SaveVideo widgets 前缀默认 ``video/导演台/章终片``(逐镜产物路径由
  执行链按 PRD 产物目录规范落,画布 SaveVideo=章级兜底出口)。

落位纪律(1113 design §4):本生成器入仓=新形态件真源;**库位落件与
旧 171 节点件删除同笔发生在阶段4**(阶段3 三镜实弹过审后),现在默认
产出暂存 apps/output/daoyan-v2/(不入库,本地检视);阶段4 用
``--out <库位>/导演台.json`` 落件并走连带账五条。

幂等:确定性输出(无时间戳/无随机),同参重跑字节级一致(契约测试钉)。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "apps/output/daoyan-v2/导演台.json"

# ── 钉值表(与 my_nodes DIRECTOR_RECIPE 同源;契约测试交叉核对)──────
UNET_NAME = "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
UNET_DTYPE = "default"
CLIP_NAME = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
CLIP_TYPE = "minimax"
CLIP_DEVICE = "default"
VAE_VIDEO = "minimax_h3_video_vae_int8_convrot.safetensors"
VAE_AUDIO = "minimax_h3_audio_vae_fp32.safetensors"
CREATE_VIDEO_WIDGETS = [24, 8, "sRGB", "none"]  # 母本 [130] 同值
SAVE_VIDEO_WIDGETS = ["video/导演台/章终片", "auto", "auto", "auto"]

NOTE_TEXT = "\n".join([
    "## 导演台(新形态)",
    "",
    "**恰一条链**:四 loader → 导演台 → CreateVideo → SaveVideo。",
    "多镜/阶段勾选(一采/二采/三采任意组合)/素材组/参数全在**节点面板**里,",
    "画布不出现任何多余的东西;面板=唯一交互真源。",
    "",
    "**运行法则(Note103 要点)**:",
    "- 勾啥跑啥:勾1=全镜一采草片;1+2=接二采;2单独=吃盘上p1;3单独=吃p2;",
    "  缺上游逐镜点名「第N镜无p1,先跑一采」,不静默跳过。",
    "- 产物链即检查点:每镜落 p1-draft/p2-final/p3-final,重跑跳过已完镜;",
    "  「重跑此镜」=强制覆盖该镜,两语义分离。",
    "- 三采前自动 /free 卸 H3;配方(LoRA/σ/采样器)焊死节点内,乱调即踩乱码红线。",
])


def _core_props(node_type: str) -> dict:
    return {"Node name for S&R": node_type, "cnr_id": "comfy-core"}


def _node(nid, ntype, pos, size, *, inputs=None, outputs=None, widgets=None,
          props=None):
    return {
        "id": nid, "type": ntype, "pos": pos, "size": size,
        "flags": {}, "order": nid, "mode": 0,
        "inputs": inputs or [], "outputs": outputs or [],
        "properties": props or _core_props(ntype),
        "widgets_values": widgets or [],
    }


def build_graph() -> dict:
    """8 节点一条链(N1 说明 Note 左上;N2-N5 loader 左列;N6 导演台中;N7/N8 出片右列)。"""
    console_inputs = [
        {"name": "model", "type": "MODEL", "link": 1},
        {"name": "video_vae", "type": "VAE", "link": 2},
        {"name": "audio_vae", "type": "VAE", "link": 3},
        {"name": "clip", "type": "CLIP", "link": 4},
    ]
    nodes = [
        _node(1, "MarkdownNote", [100, 100], [420, 200],
              widgets=[NOTE_TEXT], props={"Node name for S&R": "MarkdownNote",
                                          "cnr_id": "comfy-core"}),
        _node(2, "UNETLoader", [100, 340], [640, 148],
              outputs=[{"name": "MODEL", "type": "MODEL", "links": [1],
                        "slot_index": 0}],
              widgets=[UNET_NAME, UNET_DTYPE]),
        _node(3, "VAELoader", [100, 520], [640, 118],
              outputs=[{"name": "VAE", "type": "VAE", "links": [2],
                        "slot_index": 0}],
              widgets=[VAE_VIDEO]),
        _node(4, "VAELoader", [100, 670], [640, 118],
              outputs=[{"name": "VAE", "type": "VAE", "links": [3],
                        "slot_index": 0}],
              widgets=[VAE_AUDIO]),
        _node(5, "CLIPLoader", [100, 820], [640, 178],
              outputs=[{"name": "CLIP", "type": "CLIP", "links": [4],
                        "slot_index": 0}],
              widgets=[CLIP_NAME, CLIP_TYPE, CLIP_DEVICE]),
        _node(6, "MyDirectorConsole", [830, 340], [1040, 700],
              inputs=console_inputs,
              outputs=[{"name": "IMAGE", "type": "IMAGE", "links": [5],
                        "slot_index": 0}],
              # timeline_data 隐藏单通道:面板接管,默认空串(新台本空态)
              widgets=[""],
              props={"Node name for S&R": "MyDirectorConsole"}),
        _node(7, "CreateVideo", [1940, 380], [270, 232],
              inputs=[{"name": "images", "type": "IMAGE", "link": 5},
                      # audio 口空悬:阶段3 执行链若出 AUDIO 再接(现 IMAGE 单出)
                      {"name": "audio", "type": "AUDIO", "link": None}],
              outputs=[{"name": "VIDEO", "type": "VIDEO", "links": [6],
                        "slot_index": 0}],
              widgets=list(CREATE_VIDEO_WIDGETS)),
        _node(8, "SaveVideo", [1940, 670], [283, 564],
              inputs=[{"name": "video", "type": "VIDEO", "link": 6},
                      {"name": "filename_prefix", "type": "STRING", "link": None},
                      {"name": "format", "type": "COMFY_DYNAMICCOMBO_V3",
                       "link": None},
                      {"name": "format.codec", "type": "COMFY_DYNAMICCOMBO_V3",
                       "link": None},
                      {"name": "codec", "type": "COMFY_DYNAMICCOMBO_V3",
                       "link": None}],
              outputs=[{"name": "video", "type": "VIDEO", "links": [],
                        "slot_index": 0}],
              widgets=list(SAVE_VIDEO_WIDGETS)),
    ]
    links = [
        [1, 2, 0, 6, 0, "MODEL"],   # UNETLoader → 导演台.model
        [2, 3, 0, 6, 1, "VAE"],     # VAELoader(视频) → 导演台.video_vae
        [3, 4, 0, 6, 2, "VAE"],     # VAELoader(音频) → 导演台.audio_vae
        [4, 5, 0, 6, 3, "CLIP"],    # CLIPLoader → 导演台.clip
        [5, 6, 0, 7, 0, "IMAGE"],   # 导演台 → CreateVideo.images
        [6, 7, 0, 8, 0, "VIDEO"],   # CreateVideo → SaveVideo.video
    ]
    return {
        "last_node_id": 8, "last_link_id": 6,
        "nodes": nodes, "links": links,
        "groups": [], "config": {}, "extra": {}, "version": 0.4,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="导演台新形态件生成(≤8 节点一条链)")
    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help="输出路径(默认暂存 apps/output/daoyan-v2/;"
                             " 阶段4 库位落件 --out <库位>/导演台.json)")
    parser.add_argument("--stdout", action="store_true",
                        help="打印 JSON 不落盘")
    args = parser.parse_args(argv)

    graph = build_graph()
    text = json.dumps(graph, ensure_ascii=False, indent=2) + "\n"
    if args.stdout:
        sys.stdout.write(text)
        return 0
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"OK 新形态件已生成:{out}(8 节点/6 链一条线)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
