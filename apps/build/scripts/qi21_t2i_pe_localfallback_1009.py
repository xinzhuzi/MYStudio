#!/usr/bin/env python3
"""qi21 [4013] AI扩写 本地回落手术(1009 用户令「按建议做」).

背景:Windows 9B 单点挂=整链挂→裸透传(脏图)。1007夜令曾把 Mac 本机
27B 从链上除名;本手术按 1009 新令把本地回落加回**控件层**(零改码):
  api_url = http://192.168.0.101:1234,http://127.0.0.1:1234
  model   = qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx
节点按索引配对逐目标下发(my_qi21_api_pe.py pair()/payload["model"]=_m),
Windows 主路在前,挂了(3s 探活跳过/空答/HTTP错)自动落 Mac 27B MLX。

落位(蓝图→宿主单向同步定谳后修正):**蓝图是子图定义钦定真源**
(qi21_blueprint_sync_1001.py 恒 蓝图→工作流,先改工作流会被洗回)——
双值先落蓝图,再跑同步刷宿主工作流;两文件本脚本都断言式处理。

纪律:fail-closed 断言(计数不对即中止不改);幂等(已改过=skip);
文本级替换保全格式;只动 t2i 链(i2i/edit 蓝图另候令)。
"""
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui")
TARGETS = [
    REPO / "my_nodes/subgraphs/qi21-提示词类型优化子图.json",  # 蓝图(钦定真源)
    REPO / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",  # 宿主工作流
]

URL_OLD = '"http://192.168.0.101:1234"'
URL_NEW = '"http://192.168.0.101:1234,http://127.0.0.1:1234"'
MODEL_OLD = '"qwen3.5-9b-uncensored-hauhaucs-aggressive"'
MODEL_NEW = '"qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx"'
EXPECT_TAIL = [0.7, 12000, 600, "关闭"]  # 温度/max_tokens/超时/思考档——不得被殃及


def md5(t: str) -> str:
    return hashlib.md5(t.encode("utf-8")).hexdigest()[:12]


def operate(path: Path) -> None:
    raw = path.read_text(encoding="utf-8")

    if URL_NEW in raw and MODEL_NEW in raw:
        print(f"[skip] {path.name} 已改过(幂等命中),md5={md5(raw)}")
        return

    n_url, n_model = raw.count(URL_OLD), raw.count(MODEL_OLD)
    assert n_url == 1, f"{path.name}: api_url 旧串出现 {n_url} 次(应=1),中止"
    assert n_model == 1, f"{path.name}: model 旧串出现 {n_model} 次(应=1),中止"

    out = raw.replace(URL_OLD, URL_NEW, 1).replace(MODEL_OLD, MODEL_NEW, 1)
    doc = json.loads(out)  # 解析失败=格式打坏,不落盘
    hits = [n for sg in doc.get("definitions", {}).get("subgraphs", [])
            for n in sg.get("nodes", []) if n.get("type") == "MyQi21ApiPE"]
    assert len(hits) == 1, f"{path.name}: MyQi21ApiPE 节点数≠1({len(hits)}),中止"
    wv = hits[0]["widgets_values"]
    assert wv[0] == URL_NEW.strip('"'), f"{path.name}: api_url 改后不符 {wv[0]!r}"
    assert wv[1] == MODEL_NEW.strip('"'), f"{path.name}: model 改后不符 {wv[1]!r}"
    assert wv[2:] == EXPECT_TAIL, f"{path.name}: 尾部四控件被殃及 {wv[2:]!r}"

    path.write_text(out, encoding="utf-8")
    print(f"[done] {path.name}: md5 {md5(raw)} -> {md5(out)};尾部四控件不动 {wv[2:]}")


for t in TARGETS:
    operate(t)
print("手术完成:t2i 蓝图+宿主工作流 双值已落")
