// B4 时长链复核 advisory 挂钩(2026-09-29 工单;默认关 MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW=1 才运行)。
// 形态照 A4 先例 runKeyframeMobilityPrecheck(automate-chapter001-video.mjs:174-200):
// spawnSync 跑 python3 review 脚本 → 解析 stdout 报告摘要登记 → 非零退出只记日志链不断
// (exit1=发现超限/失配,exit2=输入错误;advisory 非阻断铁律=任何退出码不得使 automate 链失败)。
// 预算输入位(工单②):MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET 环境变量指定,缺省回落
// apps/output/automation/chapter001-duration-budget.json 惯例位;存在才跑,缺位=登记跳过,
// 不代导演层造预算(工单约束⑤)。独立成模块(供 tests/test_duration_review_hook.mjs 场景驱动)
// 而非 mjs 内联,系为满足工单完成边界「一物一断」的可测性;接线形态仍逐行仿 A4。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function isDurationReviewEnabled(env = process.env) {
  return env.MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW === '1';
}

export function resolveDurationBudgetPath(env = process.env, { repoRoot } = {}) {
  const root = repoRoot ?? process.cwd();
  const fromEnv = (env.MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET ?? '').trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(root, 'apps', 'output', 'automation', 'chapter001-duration-budget.json');
}

export function parseDurationReviewSummary(stdout) {
  try {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) return ' (report stdout unparsed)';
    const report = JSON.parse(stdout.slice(start, end + 1));
    const scenes = Array.isArray(report.scenes) ? report.scenes.length : '?';
    const violations = Array.isArray(report.violations) ? report.violations.length
      : (report.violations ?? '?');
    const budgetWithoutScript = Array.isArray(report.budgetWithoutScript)
      ? report.budgetWithoutScript.length : (report.budgetWithoutScript ?? '?');
    return ` scenes=${scenes} violations=${violations} budgetWithoutScript=${budgetWithoutScript}`;
  } catch {
    return ' (report stdout unparsed)';
  }
}

export function runDurationChainReview(options = {}) {
  const {
    env = process.env,
    repoRoot,
    scriptPath,
    spawn = spawnSync,
    log = (...args) => console.log(...args),
  } = options;
  try {
    if (!isDurationReviewEnabled(env)) {
      return { ran: false, reason: 'disabled' };
    }
    const budgetPath = resolveDurationBudgetPath(env, { repoRoot });
    if (!existsSync(budgetPath)) {
      log(
        `[video] duration chain review (advisory) skip: 预算 JSON 缺位(${budgetPath}),`
        + '登记跳过、不代导演层造预算(工单约束⑤)',
      );
      return { ran: false, reason: 'budget-missing', budgetPath };
    }
    const script = scriptPath
      ?? resolve(repoRoot ?? process.cwd(), 'build', 'chapter_video', 'review_chapter001_duration_chain.py');
    const result = spawn('python3', [script, budgetPath], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      timeout: 180_000,
    });
    const summary = parseDurationReviewSummary(result.stdout ?? '');
    log(`[video] duration chain review (advisory)${summary}`);
    if (result.status !== 0) {
      log(
        `[video] duration chain review exit=${result.status} (advisory, chain continues; 不拦不删): `
        + `${(result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' | ')}`,
      );
    }
    return { ran: true, exitCode: result.status, summary: summary.trim() };
  } catch (error) {
    // advisory 铁律(工单约束①):挂钩自身异常也只登记,绝不使 automate 链失败
    log(`[video] duration chain review hook error (advisory, chain continues): ${error}`);
    return { ran: false, reason: 'hook-error', error: String(error) };
  }
}
