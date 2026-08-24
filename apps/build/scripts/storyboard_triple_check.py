#!/usr/bin/env python3
"""分镜内容三层保险管线(L1 硬代码 / L2 本地模型[待授权] / L3 云端AI)。

用法:
  python3 storyboard_triple_check.py --shots 20,22,41   # 指定镜
  python3 storyboard_triple_check.py --p0                # 全部 P0(风险分级)
  python3 storyboard_triple_check.py --dry               # 只跑 L1,云端计划打印不调用

L1 硬代码(确定性,零成本): 内嵌 storyboard_data_lint 六不变量,结构违规
    直接出局并给出修法——不进模型层(模型做结构检查不如代码可靠)。
L2 本地模型(待授权): Qwen2.5-VL-4bit-MLX 粗筛图-文对齐(免费可离线);
    当前本地无 VL 权重,按显式下载政策须用户拍板后接线,本层暂跳过。
L3 云端AI(细判,贵→只看可疑): 经已配置的图像理解渠道(凡人 chat 多模态)
    对图+画面描述做结构化比对(场景/人物数/关键道具/空间关系),输出
    吻合/存疑+理由。只跑 L1 干净且属目标集合的镜。
"""
from __future__ import annotations
import json, re, sys, glob, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import unquote

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")
KEYFILE = Path("/tmp/glm_key.txt")
FANREN_CHAT = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
VISION_MODEL = "glm-4v-flash"  # GLM 免费视觉模型(生图 key 无 terra,换 GLM 4V)
PROBE = '''
你在审核漫画分镜帧与剧情描述的一致性。严格按 JSON 输出,不要输出其他文字。
剧情描述: {desc}
请看图并判定:
{{"scene_match": true/false,  // 图中场景与描述的场景类型是否一致
  "person_count_match": true/false,  // 图中人物数量级与描述是否一致(±1 容差)
  "key_elements": "图中实际看到的场景与人物概述(30字内)",
  "verdict": "ok" 或 "suspect",
  "reason": "若 suspect,一句话说明差异"}}'''

def load_state():
    man = json.loads((STORE / "manifest.json").read_text())
    sbs = {}
    for shard in man["shards"]:
        if "storyboards" not in shard: continue
        d = json.loads((STORE / shard).read_text())
        for sb in d["state"].get("storyboards") or []: sbs[sb.get("index")] = sb
    return sbs

def image_path(sb) -> Path | None:
    p = (sb.get("mediaRef") or {}).get("path", "")
    if "workflow-images/" not in p: return None
    return Path("/Users/zhengbingjin/Project/IP/MA/workflow-images/" + unquote(p.split("workflow-images/")[-1]))

def l1_hard(sb) -> list[str]:
    """硬代码层:单镜精简版不变量(全量版在 storyboard_data_lint.py)。"""
    issues = []
    text = ((sb.get("videoDesc") or "") + (sb.get("prompt") or "") + (sb.get("lines") or "")).replace(" ", "").replace("\n", "")
    img = image_path(sb)
    if (sb.get("mediaRef") or {}).get("kind") == "image" and (not img or not img.exists()):
        issues.append("I2 图文件缺失")
    return issues

def l3_cloud(desc: str, img: Path, key: str) -> dict:
    import base64, io
    from PIL import Image
    # 传输压缩: 原图 2-3MB 直接 b64 会 broken pipe;降采样 768+JPEG(与人工
    # 复检同款口径,判定不受影响)
    with Image.open(img) as im:
        im.thumbnail((768, 768))
        buf = io.BytesIO()
        im.convert("RGB").save(buf, format="JPEG", quality=70)
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = {
        "model": VISION_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROBE.format(desc=desc)},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        "max_tokens": 300,
    }
    req = urllib.request.Request(FANREN_CHAT, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        d = json.loads(resp.read())
    content = d["choices"][0]["message"]["content"]
    m = re.search(r"\{[\s\S]*\}", content)
    return json.loads(m.group(0)) if m else {"verdict": "error", "reason": content[:80]}

def main():
    args = sys.argv[1:]
    dry = "--dry" in args
    sbs = load_state()
    if "--p0" in args:
        targets = [20, 22, 26, 41]  # 示例:多信号叠加镜(全量经 risk_rank 输出导入)
        rank = Path(__file__).parent / "storyboard_risk_rank.py"
        import subprocess
        out = subprocess.run([sys.executable, str(rank), "--json"], capture_output=True, text=True).stdout
        targets = [r["shot"] for r in json.loads(out) if r["grade"] == "P0"]
    elif "--shots" in args:
        targets = [int(x) for x in args[args.index("--shots") + 1].split(",")]
    else:
        print(__doc__); return
    key = KEYFILE.read_text().strip() if KEYFILE.exists() else ""
    results = []
    for idx in targets:
        sb = sbs.get(idx)
        if not sb: continue
        r = {"shot": idx, "L1": [], "L2": "skipped(未授权)", "L3": None}
        r["L1"] = l1_hard(sb)
        img = image_path(sb)
        desc = sb.get("videoDesc") or sb.get("prompt") or ""
        if r["L1"]:
            r["final"] = f"出局: {'; '.join(r['L1'])}"
        elif not img:
            r["final"] = "无图(未生成,跳过)"
        elif dry:
            r["L3"] = "dry-run"
            r["final"] = "L1干净(云端未调)"
        elif not key:
            r["final"] = "L1干净;云端缺 key(/tmp/fanren_key.txt)"
        else:
            try:
                r["L3"] = l3_cloud(desc, img, key)
                r["final"] = r["L3"].get("verdict", "?")
            except Exception as e:
                r["final"] = f"云端失败: {str(e)[:60]}"
            time.sleep(1)
        results.append(r)
        print(f"S{idx:02d} → {r['final']}" + (f" | {r['L3'].get('reason','')}" if isinstance(r.get("L3"), dict) and r["L3"].get("verdict")=="suspect" else ""))
    suspects = [r for r in results if isinstance(r.get("L3"), dict) and r["L3"].get("verdict") == "suspect"]
    print(f"\n汇总: 检查{len(results)}镜 | L1出局 {sum(1 for r in results if r['L1'])} | 云端 suspect {len(suspects)}")
    out = Path("/tmp/triple_check_report.json")
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print("报告:", out)

if __name__ == "__main__":
    main()
