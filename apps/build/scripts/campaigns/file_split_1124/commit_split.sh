#!/bin/zsh
# commit_split.sh —— 按路径清单一步完成暂存与提交(2026-11-24 超线文件拆分)。
#
#   build/scripts/campaigns/file_split_1124/commit_split.sh <提交说明文件> <路径清单文件>
#       在 apps/ 目录下运行。路径清单里每行一个路径(相对仓库根)。
#       暂存与提交在同一条命令里一步完成:本仓库的暂存区由二十来个会话共用,
#       分两步做的话,中间的空档会被别的会话的整库提交带走(11-24 上午的教训)。
#       已跟踪文件落在被忽略的目录里是常态(campaigns/),所以一律加 -f。
#       提交后核对:本提交的文件数 = 清单去重后的条数;暂存区为空;清单里的路径无未提交改动。
set -u
MSG=$1; LIST=$2
[ -f "$MSG" ] && [ -f "$LIST" ] || { echo "用法: commit_split.sh <提交说明文件> <路径清单文件>"; exit 2; }
REPO=$(git rev-parse --show-toplevel)
SORTED=$(mktemp); sort -u "$LIST" > "$SORTED"; want=$(grep -c . "$SORTED")
# 清单里的每个路径此刻都要存在(旧路径删除不算——本役不涉及)
while IFS= read -r p; do
  [ -e "$REPO/$p" ] || { echo "✗ 清单里的路径不存在: $p"; rm -f "$SORTED"; exit 2; }
done < "$SORTED"
H0=$(git rev-parse HEAD)
git -C "$REPO" add -f --pathspec-from-file="$SORTED" && git -C "$REPO" commit --only -F "$MSG" --pathspec-from-file="$SORTED" > /tmp/zcode-arch-audit/commit-split.log 2>&1
rc=$?
if [ $rc -ne 0 ]; then
  echo "✗ 提交没成功(退出码 $rc)。钩子输出:"
  grep -v -E "^\s*$|CRLF will be replaced" /tmp/zcode-arch-audit/commit-split.log | tail -25 | cut -c1-200 | sed 's/^/     /'
  echo "   暂存区现有 $(git -C "$REPO" diff --cached --name-only | wc -l | tr -d ' ') 条;属于本清单的: $(git -C "$REPO" diff --cached --name-only | grep -c -F -x -f "$SORTED") 条"
  rm -f "$SORTED"; exit 1
fi
got=$(git -C "$REPO" show --name-only --format= HEAD | sort -u | wc -l | tr -d ' ')
left=$(git -C "$REPO" status --short --pathspec-from-file="$SORTED" | wc -l | tr -d ' ')
echo "✓ $(git -C "$REPO" log -1 --format='%h %s' | cut -c1-150)"
echo "    提交前 $(git rev-parse --short $H0) → 现在 $(git -C "$REPO" rev-parse --short HEAD) | 本提交 $got 个文件(清单 $want)$( [ "$got" != "$want" ] && echo ' ✗ 不一致' ) | 清单路径下未提交改动 $left 条 | 暂存区 $(git -C "$REPO" diff --cached --name-only | wc -l | tr -d ' ') 条"
grep -E "Pre-commit passed|files? changed" /tmp/zcode-arch-audit/commit-split.log | cut -c1-120 | sed 's/^/    /'
rm -f "$SORTED"
[ "$got" = "$want" ] && [ "$left" = "0" ]
