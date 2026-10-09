#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S3 批第0步·五树指纹扫描(1008)——node-graph INVOCATION 立宪:改多副本内容前必扫。
扫描旧串×五树(仓库/装机/构建产物/引擎家/MA 镜像)产全落点清单;同句多变体逐处取原文。
用法:
  python3 qi21_s3_fivetree_scan_1008.py            # 改前扫描
  python3 qi21_s3_fivetree_scan_1008.py --post     # 改后复扫(终验):旧串应零命中(台账/史档除外)
"""
import sys, os, subprocess, json

ROOT = "/Users/zhengbingjin/Project/Github/MYStudio"
TREES = {
    "①仓库": ROOT,
    "②装机": "/Applications/漫影工作室.app/Contents/Resources",
    "③构建产物": ROOT + "/apps/release/build",
    # 1008 review-fix:④根=ERRORS §6f「引擎家/IP家」一根——IP家真身(~/Library/Application
    # Support/漫影工作室 软链指向处),comfyui/skills 两子树皆在内。S3 批实现只扫 comfyui 子树
    # =结构性漏网(1008 复核坐实:IP家 skills/ 手册镜像三件陈旧漏刷,宪法与实现缺口就此封闭)。
    "④引擎家/IP家": "/Users/zhengbingjin/Project/IP/漫影工作室",
    "⑤MA镜像": "/Users/zhengbingjin/Project/IP/MA",
}

# S3 批将触碰的旧串指纹(改后 --post 复扫期全部应零命中;命中=漏网或史档)
OLD_STRINGS = [
    ("A-底座肯定式改写", "而非有纹理的纸面"),
    ("B-底座肯定式改写", "防机械勾边与矢量感"),
    ("D-头身比统一", "七头半"),
    ("E-底座负槽追加锚", "AI 伪影，泥糊噪点，过锐光晕"),
    ("F-人物负槽追加锚", "异装鞋靴"),
    ("G-场景负槽追加锚", "写实油画，厚涂，照片质感，3D渲染"),
    ("H-三型差异化旧首句", "主体的单人立绘，全身入画，头身比约七头半，解剖比例写实。"),
    ("I-底座句身副本探针", "画面保持干净平滑"),
    ("J-底座句身副本探针", "墨线带手绘笔性"),
    ("K-美宣差异化探针", "画面疏朗有呼吸"),
]

# 已声明不碰的史档/漂移区(命中只注记不计漏网)
DECLARED_KEEP = ["/.git/", "/node_modules/", "/.trellis/tasks/", "/backups/",
                 "ma_sync/LOCK_SNAPSHOT.md", "ma_sync/lock-anchors.json",
                 "ma_sync/runtime-contract.json", "workflows.已并入",
                 # 1008 review-fix:④根扩至 IP家真身后,重二进制/应用数据树列入不碰面
                 "/漫影工作室/Chromium", "/漫影工作室/python", "/漫影工作室/projects",
                 "/漫影工作室/media", "/漫影工作室/self-media", "/漫影工作室/image-thumbs",
                 "/漫影工作室/remotion-", "/漫影工作室/hyperframes-",
                 "/漫影工作室/TTS", "/漫影工作室/SubtitleFonts", "/漫影工作室/logs",
                 "/漫影工作室/assets.db", "/漫影工作室/assets/", "/漫影工作室/storage-config.json",
                 "/漫影工作室/window-state.json", "/漫影工作室/Singleton",
                 "/comfyui/models", "/comfyui/python", "/comfyui/web"]

# 文本指纹面(ERRORS §6f 宪法模板 --include 族)+走查期排除重目录(防大树超时→静默漏扫)
INCLUDES = ["*.json", "*.md", "*.py", "*.txt", "*.mjs", "*.js", "*.ts"]
RG_EXCLUDES = ["Chromium", "models", "python", "web", "projects", "media", "self-media",
               "image-thumbs", "remotion-*", "hyperframes-*", "TTS", "SubtitleFonts",
               "logs", "assets", "node_modules", ".git"]


def scan_tree(tree_name, tree_path, needle):
    """rg 优先(隐藏文件+include 族+重目录排除),失败回退 grep -r(同排除;引擎家用户区
    rg 忽略规则漏扫先例)。超时/异常如实标记,不冒充零命中。"""
    note = ""
    files = []
    try:
        cmd = ["rg", "-l", "--hidden", "--no-ignore", "-F", needle]
        for inc in INCLUDES:
            cmd += ["-g", inc]
        for exc in RG_EXCLUDES:
            cmd += ["-g", "!" + exc]
        cmd.append(tree_path)
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        files = [f for f in r.stdout.splitlines() if f.strip()]
    except Exception as e:
        note = f"<rg 异常:{type(e).__name__}>"
    if not files:  # grep 直查兜底(BSD grep --exclude-dir 支持 glob)
        try:
            cmd = ["grep", "-rl", "-F", needle]
            for inc in INCLUDES:
                cmd += ["--include", inc]
            for exc in RG_EXCLUDES:
                cmd += ["--exclude-dir", exc.rstrip("*")]
            cmd.append(tree_path)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            files = [f for f in r.stdout.splitlines() if f.strip()]
            note = note or "<grep 兜底>"
        except Exception as e:
            note = note or f"<grep 亦异常:{type(e).__name__},该树本串扫描未完成>"
    hits = []
    for f in files:
        if any(k in f for k in DECLARED_KEEP):
            continue
        hits.append(f)
    if note and not hits:
        hits = [note]
    return hits


def main():
    post = "--post" in sys.argv
    report = {}
    for label, needle in OLD_STRINGS:
        report[label] = {"needle": needle, "trees": {}}
        for tname, tpath in TREES.items():
            if not os.path.exists(tpath):
                report[label]["trees"][tname] = ["<树缺席>"]
                continue
            hits = scan_tree(tname, tpath, needle)
            if hits:
                report[label]["trees"][tname] = hits
    print(json.dumps(report, ensure_ascii=False, indent=1))
    # 摘要行
    print("\n===== 摘要 =====")
    for label, d in report.items():
        total = sum(len(v) for v in d["trees"].values())
        loc = {t: len(v) for t, v in d["trees"].items() if v}
        print(f"[{label}] {d['needle']!r}: {total} 文件 {loc if total else '(五树零命中)'}")


if __name__ == "__main__":
    main()
