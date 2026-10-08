#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1008 review-fix 批第0步·五树指纹扫描——node-graph ERRORS.md §6f 立宪:改多副本内容前必扫。
与 qi21_s3_fivetree_scan_1008.py 同法,本批指纹串=审核修复面(R 批旧术语漏网于 canon_lib/IP家
手册镜像 + canon_lib 死路径/死命令)。**五根口径=ERRORS §6f「引擎家/IP家」一根**:
④根取 IP家真身(/Users/zhengbingjin/Project/IP/漫影工作室,~/Library/Application Support/漫影工作室
软链指向处),comfyui 子树含于其内——S3 批实现只扫 comfyui 子树=结构性漏网(1008 复核坐实,
IP家 skills/ 手册镜像三件陈旧漏刷),本批修正。
用法:
  python3 qi21_reviewfix_scan_1008.py            # 改前扫描
  python3 qi21_reviewfix_scan_1008.py --post     # 改后复扫(终验):旧串应零命中(史档/台账/漂移区除外)
"""
import sys, os, subprocess, json

ROOT = "/Users/zhengbingjin/Project/Github/MYStudio"
TREES = {
    "①仓库": ROOT,
    "②装机": "/Applications/漫影工作室.app/Contents/Resources",
    "③构建产物": ROOT + "/apps/release/build",
    # ④=ERRORS §6f「引擎家/IP家」一根:IP家真身(引擎家软链的家);comfyui/skills 两子树皆在内
    "④引擎家/IP家": "/Users/zhengbingjin/Project/IP/漫影工作室",
    "⑤MA镜像": "/Users/zhengbingjin/Project/IP/MA",
}

# review-fix 批将触碰的旧串指纹(改后 --post 复扫应只剩史档/台账/已声明漂移区)
OLD_STRINGS = [
    ("R1-R批旧术语漏网", "通用锁层"),
    ("R2-R批旧术语漏网", "常量A"),
    ("R3-R批旧术语漏网", "常量 A"),
    ("R4-R批旧机读键", "lock_layer"),
    ("S3A-肯定式旧指纹", "而非有纹理的纸面"),
    ("S3B-肯定式旧指纹", "防机械勾边与矢量感"),
    ("D1-05库死命令句", "矩阵随文档同步再生成"),
    ("D2-canon_lib死路径", "my_nodes/nodes/daojie_bases.json"),
    ("D3-05库死链命令", "daojie_canon_lib.py && python3"),
]

# 已声明不碰的史档/漂移区/重二进制树(命中只注记不计漏网)
DECLARED_KEEP = [
    "/.git/", "/node_modules/", "/.trellis/tasks/", "/backups/",
    "ma_sync/LOCK_SNAPSHOT.md", "ma_sync/lock-anchors.json",
    "ma_sync/runtime-contract.json", "workflows.已并入",
    "/.zcode/",
    # IP家重二进制/应用数据树(非文本镜像面,rg 直跳)
    "/漫影工作室/Chromium", "/漫影工作室/python", "/漫影工作室/projects",
    "/漫影工作室/media", "/漫影工作室/self-media", "/漫影工作室/image-thumbs",
    "/漫影工作室/remotion-", "/漫影工作室/hyperframes-",
    "/漫影工作室/TTS", "/漫影工作室/SubtitleFonts", "/漫影工作室/logs",
    "/漫影工作室/assets.db", "/漫影工作室/storage-config.json",
    "/漫影工作室/window-state.json", "/漫影工作室/Singleton",
    "/漫影工作室/mcp-command-allowlist.json", "/漫影工作室/project-locations.json",
    "/漫影工作室/engine_e2e.log",
    # 引擎家重树(模型/venv/前端发行包)
    "/comfyui/models", "/comfyui/python", "/comfyui/web",
]

# 文本指纹面(ERRORS §6f 宪法模板 --include 族;二进制/媒体树不走内容读)
INCLUDES = ["*.json", "*.md", "*.py", "*.txt", "*.mjs", "*.js", "*.ts"]
# rg/grep 走查期即排除的重目录(防大树上超时→静默漏扫;两路同排除)
RG_EXCLUDES = [
    "Chromium", "models", "python", "web", "projects", "media", "self-media",
    "image-thumbs", "remotion-*", "hyperframes-*", "TTS", "SubtitleFonts",
    "logs", "assets", "node_modules", ".git",
]


def scan_tree(tree_name, tree_path, needle):
    """rg 优先(带隐藏文件+include 族+重目录排除),失败回退 grep -r(同排除;引擎家用户区
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
            if files or not note:
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
    print("\n===== 摘要 =====")
    for label, d in report.items():
        total = sum(len(v) for v in d["trees"].values())
        loc = {t: len(v) for t, v in d["trees"].items() if v}
        print(f"[{label}] {d['needle']!r}: {total} 文件 {loc if total else '(五树零命中)'}")


if __name__ == "__main__":
    main()
