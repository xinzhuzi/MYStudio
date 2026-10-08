#!/usr/bin/env bash
# r3_package_1008.sh — qi21 第三轮删词刀·打包壳(1008)
# 纪律:先 queue 门(引擎在跑任务即让路,exit 3 零打扰),再以 AGENTS.md 铁律唯一入口
#       apps/build/packaging/build-mac.sh 打包+覆盖安装+installed smoke。
# 前置:python3 apps/build/scripts/qi21_r3_check_1008.py 须已全绿。
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"  # apps/build/scripts → 仓库根(三级上溯)
MANIFEST="$HOME/Library/Application Support/漫影工作室/comfyui/manifest.json"

# ── queue 门:manifest.json 读账本口 → GET /queue → running+pending 非 0 即让路 ──
# 注(1008 修复):清单腿弃 curl file:// ——安装路径含空格(Application Support)与非ASCII,
# curl 按 RFC-3986 拒收「Malformed input to a URL function」;本地文件 python3 直读即稳。
PORT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["engine"]["port"])' "${MANIFEST}")"
QUEUE="$(curl -sS --fail --max-time 10 "http://127.0.0.1:${PORT}/queue" 2>/dev/null || echo '{}')"
RUNNING="$(printf '%s' "${QUEUE}" | python3 -c 'import json,sys
try: q=json.load(sys.stdin)
except Exception: q={}
print(len(q.get("queue_running") or []))')"
PENDING="$(printf '%s' "${QUEUE}" | python3 -c 'import json,sys
try: q=json.load(sys.stdin)
except Exception: q={}
print(len(q.get("queue_pending") or []))')"
echo "[r3] 引擎账本口=${PORT} running=${RUNNING} pending=${PENDING}"
if [ "${RUNNING}" -ne 0 ] || [ "${PENDING}" -ne 0 ]; then
  echo "[r3] queue 有在途任务(running=${RUNNING} pending=${PENDING}),打包让路 → exit 3" >&2
  exit 3
fi

# ── 打包覆盖安装(唯一入口;MANYYING_ALLOW_APP_LAUNCH=1 授权装机后 Launch 开验) ──
MANYYING_ALLOW_APP_LAUNCH=1 exec bash "${ROOT}/apps/build/packaging/build-mac.sh"
