#!/bin/zsh
# verify_split.sh —— 超线文件拆分的逐件验证(2026-11-24 任务 11-24-apps-architecture-restructure)。
#
#   build/scripts/campaigns/file_split_1124/verify_split.sh [--lint 文件 …] [--tests 模式 …] [--full]
#       在 apps/ 目录下运行。
#       --lint  对这些文件跑 ESLint(路径相对 apps/)
#       --tests 测试文件的匹配模式,可多个:以 path: 开头按路径匹配,以 content: 开头按文件内容匹配;
#               不写前缀按路径匹配。命中的前端测试文件用 vitest 跑
#       --full  另跑全量 vitest(约 2 分钟)
#       每次都跑:全项目类型检查、防复发门禁(层级与可达性)、文件尺寸门禁。
# 文件尺寸门禁只对本役文件判失败(封顶登记里的文件,或本次传给 --lint 的文件);
# 别的会话在途的超线文件只报告。任何一项不过就非零退出。
set -u
LINT=() ; TESTS=() ; FULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lint) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do LINT+=("$1"); shift; done ;;
    --tests) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do TESTS+=("$1"); shift; done ;;
    --full) FULL=1; shift ;;
    *) echo "不认识的参数: $1"; exit 2 ;;
  esac
done
OUT=/tmp/zcode-arch-audit/verify-split; mkdir -p $OUT
FAIL=0

echo "-- 1. 类型检查(全项目) --"
npm run typecheck > $OUT/typecheck.log 2>&1; rc=$?
n=$(grep -c -E 'error TS[0-9]+' $OUT/typecheck.log)
if [ $rc -eq 0 ]; then echo "   通过,0 错误"; else echo "   ✗ 退出码 $rc,$n 个错误:"; grep -E 'error TS[0-9]+' $OUT/typecheck.log | head -12 | cut -c1-200 | sed 's/^/      /'; FAIL=1; fi

if [ ${#LINT[@]} -gt 0 ]; then
  echo "-- 2. ESLint(${#LINT[@]} 个文件) --"
  npx eslint "${LINT[@]}" --max-warnings 0 > $OUT/eslint.log 2>&1; rc=$?
  if [ $rc -eq 0 ]; then echo "   通过"; else echo "   ✗ 退出码 $rc:"; grep -E "✖|^ +[0-9]+:[0-9]+|No files matching|Oops|Error" $OUT/eslint.log | head -14 | cut -c1-200 | sed 's/^/      /'; FAIL=1; fi
fi

if [ ${#TESTS[@]} -gt 0 ]; then
  echo "-- 3. 相关测试 --"
  python3 - "${TESTS[@]}" > $OUT/tests.txt <<'PY'
import os, re, sys
pats = []
for a in sys.argv[1:]:
    if a.startswith("content:"): pats.append(("content", a[8:]))
    elif a.startswith("path:"): pats.append(("path", a[5:]))
    else: pats.append(("path", a))
hits = set()
for root, dirs, files in os.walk("frontend"):
    dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", "out")]
    for f in files:
        if not re.search(r"\.test\.(ts|tsx)$", f): continue
        p = os.path.join(root, f)
        for kind, pat in pats:
            if kind == "path" and re.search(pat, p): hits.add(p); break
            if kind == "content":
                try: s = open(p, encoding="utf-8", errors="ignore").read()
                except OSError: continue
                if re.search(pat, s): hits.add(p); break
print("\n".join(sorted(hits)))
PY
  n=$(grep -c . $OUT/tests.txt)
  if [ "$n" = "0" ]; then echo "   没有匹配到测试文件"
  else
    echo "   匹配到 $n 个测试文件"
    npx vitest run --config frontend/config/vite.config.ts $(tr '\n' ' ' < $OUT/tests.txt) > $OUT/vitest.log 2>&1; rc=$?
    grep -E "Test Files|Tests " $OUT/vitest.log | sed 's/^/   /'
    if [ $rc -ne 0 ]; then echo "   ✗ 退出码 $rc:"; grep -a -E "^ FAIL |AssertionError|Error:" $OUT/vitest.log | head -12 | cut -c1-200 | sed 's/^/      /'; FAIL=1; fi
  fi
fi

if [ $FULL -eq 1 ]; then
  echo "-- 4. 全量 vitest --"
  npx vitest run --config frontend/config/vite.config.ts > $OUT/vitest-full.log 2>&1; rc=$?
  grep -E "Test Files|Tests " $OUT/vitest-full.log | sed 's/^/   /'
  if [ $rc -ne 0 ]; then echo "   ✗ 退出码 $rc:"; grep -a -E "^ FAIL " $OUT/vitest-full.log | sort -u | head -12 | cut -c1-200 | sed 's/^/      /'; FAIL=1; fi
fi

echo "-- 5. 防复发门禁(层级与可达性) --"
node build/scripts/arch_layer_gate.mjs > $OUT/gate.log 2>&1; rc=$?
grep -E "越层边|不可达|新增|结论|^ +- " $OUT/gate.log | cut -c1-160 | sed 's/^/   /'
if [ $rc -ne 0 ]; then FAIL=1; fi

echo "-- 6. 文件尺寸门禁 --"
python3 build/scripts/file_size_gate.py > $OUT/size.log 2>&1
python3 - "${LINT[@]}" <<'PY'
import json, re, sys
log = open("/tmp/zcode-arch-audit/verify-split/size.log", encoding="utf-8").read()
mine = set(json.load(open("build/scripts/file-size-gate-exemptions.json", encoding="utf-8"))["caps"]) | set(sys.argv[1:])
hard = re.findall(r"^\s+\d+\s+(\S+)\s*$", log.split("HARD(", 1)[1].split("WARN(", 1)[0]) if "HARD(" in log else []
hard = [h if not h.startswith("frontend/") else "apps/" + h for h in hard]
mine_hard = [h for h in hard if h in mine]
print("   本役文件超线:", mine_hard or "无", "| 他链在途的超线文件(不归本役):", [h for h in hard if h not in mine] or "无")
raise SystemExit(1 if mine_hard else 0)
PY
if [ $? -ne 0 ]; then FAIL=1; fi

echo "=============================="
if [ $FAIL -eq 0 ]; then echo "全部通过"; exit 0; else echo "有未通过的项,见上"; exit 1; fi
