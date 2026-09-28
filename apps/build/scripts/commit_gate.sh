#!/usr/bin/env bash
# commit_gate —— 提交纪律门:显式 pathspec → staged 双向对账 → commit → HEAD 抽验
# 出处:2026-09-28 任务 09-28-process-formalization S6(R3;design §6;prd AC4)。
# 用法:bash commit_gate.sh -m "<提交信息>" -- <pathspec>...
#   pathspec 相对当前 cwd,语义同 git add(支持目录/精确文件;绝不 -A/-u)。
# 流程:
#   ① 跑前 staged 集存证(git diff --cached --name-only;unborn 分支同样可用)
#   ② git add -- <pathspec>(只加显式清单)
#   ③ 双向对账:staged 集 ⊆ pathspec 解析集(git ls-files 解析;防吸走——staged
#      出现清单外之件=既有无关暂存或并行会话窗口内塞入)且 pathspec 件全 staged
#      (防漏加——清单件有改动却未入暂存;与 HEAD 无差异的清单件记 no-op 不拦门)
#   ④ 对账失败=RED 输出差集,不 commit;既有暂存一律原样保留(绝不 unstage/reset)
#   ⑤ 通过=git commit -m(husky pre-commit 照常);提交后再核一笔:实际入库文件集
#      ==对账时 staged 集(commit 窗口内被并行塞入=RED 如实报,处置由人裁定)
#   ⑥ git show HEAD --stat 自动输出(抽验)
# 边界:不 push;不做 GitNexus detect_changes(MCP 环节由 AI 执行,流程文档指认);
#      退出码 0=提交成立,非 0=RED(未提交或须人工处置)。
set -euo pipefail

TAG="[commit-gate]"
die() { echo "$TAG RED $*" >&2; exit 1; }
info() { echo "$TAG $*"; }

# 多行字符串 → C 序列逐行(set 运算用 comm 需两侧同序)
sorted_lines() {
  if [ -n "$1" ]; then printf '%s\n' "$1" | LC_ALL=C sort; fi
}

# ── 参数解析 ────────────────────────────────────────────────────────────────
MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m)
      [ $# -ge 2 ] || die "-m 需要提交信息参数"
      MSG="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      die "未知参数:$1(用法:commit_gate.sh -m \"<信息>\" -- <pathspec>...)"
      ;;
  esac
done
[ -n "$MSG" ] || die "-m 提交信息必填且非空"
[ $# -ge 1 ] || die "-- 后须至少一个 pathspec(本门只认显式清单,绝不 git add -A/-u)"
PATHSPECS=("$@")

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "不在 git 工作树内(本门只服务 git 仓库提交)"

# ── ① 跑前存证 ──────────────────────────────────────────────────────────────
S0="$(git diff --cached --name-only)"
HEAD_BEFORE="$(git rev-parse --verify HEAD 2>/dev/null || echo "(unborn)")"
if [ -n "$S0" ]; then
  info "跑前 staged 存证:$(printf '%s\n' "$S0" | wc -l | tr -d ' ') 件(HEAD=$HEAD_BEFORE)"
else
  info "跑前 staged 存证:0 件(HEAD=$HEAD_BEFORE)"
fi

# ── ② 显式 add ──────────────────────────────────────────────────────────────
if ! git add -- "${PATHSPECS[@]}"; then
  die "git add 失败(pathspec 不匹配/被 .gitignore 挡等);既有暂存未动,人工核查后重试"
fi

# ── ③ 双向对账 ──────────────────────────────────────────────────────────────
S1="$(git diff --cached --name-only)"
P_SET="$(git ls-files -- "${PATHSPECS[@]}")"

UNEXPECTED="$(comm -23 <(sorted_lines "$S1") <(sorted_lines "$P_SET"))"
MISSING="$(comm -13 <(sorted_lines "$S1") <(sorted_lines "$P_SET"))"

LEAK=""
NOOP=""
if [ -n "$MISSING" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ -n "$(git status --porcelain -- "$f")" ]; then
      LEAK="${LEAK}${f}"$'\n'
    else
      NOOP="${NOOP}${f}"$'\n'
    fi
  done <<<"$MISSING"
fi

if [ -n "$UNEXPECTED" ]; then
  PRE="$(comm -12 <(sorted_lines "$UNEXPECTED") <(sorted_lines "$S0"))"
  WIN="$(comm -23 <(sorted_lines "$UNEXPECTED") <(sorted_lines "$S0"))"
  echo "$TAG RED staged 集含 pathspec 清单外之件——防吸走(09-28 事故族③),拒绝提交" >&2
  if [ -n "$PRE" ]; then
    echo "$TAG   既有无关暂存(跑前存证中已在,提交会吸入):" >&2
    printf '%s\n' "$PRE" | sed 's/^/       /' >&2
  fi
  if [ -n "$WIN" ]; then
    echo "$TAG   窗口新增(跑前存证后出现=并行会话可能正在场):" >&2
    printf '%s\n' "$WIN" | sed 's/^/       /' >&2
  fi
  echo "$TAG   既有暂存一律原样保留(本门绝不 unstage);请先处置差集再重试" >&2
  exit 1
fi

if [ -n "$LEAK" ]; then
  echo "$TAG RED pathspec 件有改动却未入暂存——防漏加(排除 WIP 后 HEAD 死路径事故):" >&2
  printf '%s' "$LEAK" | sed 's/^/       /' >&2
  echo "$TAG   暂存区保持 add 后状态(既有暂存未动);核查后重试" >&2
  exit 1
fi

if [ -n "$NOOP" ]; then
  info "no-op pathspec 件(与 HEAD 无差异,提交自然不含;如非预期请核查):$(printf '%s' "$NOOP" | tr '\n' ' ')"
fi
info "对账 PASS:staged 与 pathspec 双向一致;提交(pre-commit 钩子照常)"

# ── ⑤ 提交 + 提交后再核 ─────────────────────────────────────────────────────
if ! git commit -m "$MSG"; then
  die "git commit 失败(钩子拒绝/空提交等);暂存区保持对账后状态,人工核查"
fi
HEAD_AFTER="$(git rev-parse --verify HEAD 2>/dev/null || echo "(unborn)")"
if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
  die "HEAD 未前移(commit 未成立),人工核查"
fi
COMMITTED="$(git show --name-only --format= HEAD)"
EXTRA="$(comm -23 <(sorted_lines "$COMMITTED") <(sorted_lines "$S1"))"
GONE="$(comm -13 <(sorted_lines "$COMMITTED") <(sorted_lines "$S1"))"
if [ -n "$EXTRA" ] || [ -n "$GONE" ]; then
  echo "$TAG RED 提交已发生,但入库文件集 ≠ 对账时 staged 集(commit 窗口内有并行写入):" >&2
  [ -n "$EXTRA" ] && { echo "$TAG   窗口内被吸入:" >&2; printf '%s\n' "$EXTRA" | sed 's/^/       /' >&2; }
  [ -n "$GONE" ] && { echo "$TAG   对账后又被移出:" >&2; printf '%s\n' "$GONE" | sed 's/^/       /' >&2; }
  echo "$TAG   处置(reset/amend)由人裁定;本门只如实报告,不代执行" >&2
  exit 1
fi

# ── ⑥ HEAD 抽验 ─────────────────────────────────────────────────────────────
info "提交成立($HEAD_BEFORE → $HEAD_AFTER);HEAD 抽验:"
git show HEAD --stat
exit 0
