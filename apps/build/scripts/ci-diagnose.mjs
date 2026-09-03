/**
 * 临时 CI 诊断脚本(仅本会话分支使用,定位后移除):
 * GitHub Actions 原始日志/artifact 在本沙箱不可下载(实测 EOF),
 * 因此通过 check-run 的 ::error:: 注解通道(api.github.com 可达)回传:
 *   1) quality-gate-report.json 的阶段摘要(一条注解);
 *   2) 失败阶段重新执行,提取失败样例(每条失败一条注解)。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const reportPath = "output/automation/quality-gate-report.json";

function annotate(message, file = ".github/workflows/build.yml", line = 114, title = "quality-gate") {
  const safe = String(message).replace(/[\r\n]+/g, " ").slice(0, 480);
  // 每条注解使用唯一的 file 参数,避免 GitHub 对相同注解去重。
  console.log(`::error file=${file},line=${line},title=${title}::${safe}`);
}

function loadReport() {
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

function runAndCapture(command) {
  const out = spawnSync(command, { cwd: process.cwd(), shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1", CI: "true" } });
  return { status: out.status ?? 1, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

function failureDigest(text) {
  const lines = text.split("\n");
  const fails = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^ FAIL\s+(\S+)\s+>\s+(.+)$/.exec(lines[i]);
    if (!match) continue;
    const file = match[1];
    const name = match[2].slice(0, 140);
    let detail = "";
    for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
      const d = lines[j].trim();
      if (/^(AssertionError|Error:|expected|Received|→)/.test(d)) {
        detail += " | " + d.slice(0, 180);
      }
      if (detail.length > 320) break;
    }
    fails.push({ file, name, detail });
    if (fails.length >= 6) break;
  }
  return fails;
}

const report = loadReport();
if (!report) {
  annotate("quality-gate-report.json 不存在或不可读");
} else {
  const summary = report.stages
    .map((s) => `${s.name}=${s.status === "skipped" ? "skip" : s.status === "passed" ? "ok" : "FAIL"}`)
    .join(" ");
  annotate(`platform=${report.platform} ok=${report.ok} | ${summary}`);
}

if (report) {
  for (const stage of report.stages) {
    if (stage.status !== "failed") continue;
    annotate(`stage ${stage.name} failed: rerunning command`, `.diag/stage-${stage.name}.1.log`, 1, stage.name);
    const { stdout, stderr } = runAndCapture(stage.command);
    const digest = failureDigest(`${stdout}\n${stderr}`);
    if (digest.length === 0) {
      annotate(`stage ${stage.name}: no vitest FAIL lines; tail:\n${`${stdout}\n${stderr}`.split("\n").slice(-6).join("\n")}`, `.diag/stage-${stage.name}.2.log`, 1, stage.name);
      continue;
    }
    digest.forEach((f, idx) => {
      annotate(`${f.file} │ ${f.name}${f.detail}`, `.diag/${stage.name}-${idx}.log`, 1, `fail-${stage.name}`);
    });
  }
}
