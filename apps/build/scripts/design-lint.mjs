#!/usr/bin/env node
/**
 * design-lint — 前端设计规范违规扫描(gitnexus apple-hig-design-overhaul child1 交付)。
 *
 * 规则(R1-R6,规格见 .trellis/tasks/08-19-apple-hig-design-overhaul/design.md):
 *   R1 shadow-*      卡片/控件阴影(HIG 禁忌;弹层白名单外)
 *   R2 palette       Tailwind 调色板硬编码类(bg-green-500 等;应换语义 token)
 *   R3 gradient-btn  按钮上的渐变背景
 *   R4 scale-active  active:scale-* 按压反馈(HIG 禁忌)
 *   R5 pure-white    text-white / text-black 前景(应换 text-foreground)
 *   R6 白名单        allowPaths 跳过;severityOverrides 降级(桶B/待裁定)
 *
 * 用法:
 *   node apps/build/scripts/design-lint.mjs                    # 全前端扫描
 *   node apps/build/scripts/design-lint.mjs --files a.tsx b.tsx
 *   node apps/build/scripts/design-lint.mjs --out report.json  # 附 JSON 报告
 * 退出码:error>0 → 1;仅 warn → 0。
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const FRONTEND_ROOT = resolve(SCRIPT_DIR, "../../frontend");

const PALETTE_FAMILIES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink",
  "rose", "slate", "gray", "zinc", "neutral", "stone",
];

const RULES = {
  R1: { name: "shadow", desc: "shadow-* 阴影(弹层白名单外,HIG 用材质不用阴影)" },
  R2: { name: "palette", desc: "Tailwind 调色板硬编码(应换语义 token;桶B 数据可视化可降级 warn)" },
  R3: { name: "gradient-btn", desc: "按钮上的渐变背景(HIG 禁忌)" },
  R4: { name: "scale-active", desc: "active:scale-* 按压缩放(HIG 禁忌)" },
  R5: { name: "pure-white", desc: "text-white/text-black 前景(应换 text-foreground)" },
};

const RE_SHADOW = /(?<![-\w])(?:[a-z-]+:)?shadow-(?:sm|md|lg|xl|2xl)\b/g;
const RE_PALETTE = new RegExp(
  String.raw`(?<![-\w])(?:[a-z-]+:)?(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|decoration|divide|accent|caret|shadow)-(` +
    PALETTE_FAMILIES.join("|") + String.raw`)-(\d{2,3})(?![\w-])`,
  "g",
);
const RE_GRADIENT = /(?<![-\w])bg-(?:gradient|linear)-to-[a-z]{1,2}\b/g;
const RE_SCALE_ACTIVE = /(?<![-\w])(?:group-)?(?:active|pressed):scale-\d+(?:\.\d+)?/g;
const RE_PURE_FOREGROUND = /(?<![-\w])(?:[a-z-]+:)?text-(white|black)\b/g;

function loadWhitelist() {
  const whitelistPath = join(SCRIPT_DIR, "design-lint-whitelist.json");
  if (!existsSync(whitelistPath)) {
    return { allowPaths: [], severityOverrides: [] };
  }
  return JSON.parse(readFileSync(whitelistPath, "utf8"));
}

function pathMatches(pattern, relPath) {
  // 支持 "**" 后缀通配(目录级)与精确文件路径
  if (pattern.endsWith("/**")) {
    return relPath === pattern.slice(0, -3) || relPath.startsWith(pattern.slice(0, -3) + "/");
  }
  return relPath === pattern;
}

function isAllowed(whitelist, relPath) {
  return whitelist.allowPaths.some((pattern) => pathMatches(pattern, relPath));
}

function overrideSeverity(whitelist, relPath, rule) {
  const hit = (whitelist.severityOverrides || []).find(
    (entry) => entry.rule === rule && pathMatches(entry.path, relPath),
  );
  return hit ? hit.severity : null;
}

function collectSourceFiles(root, explicitFiles) {
  if (explicitFiles && explicitFiles.length > 0) {
    return explicitFiles.map((file) => ({
      abs: resolve(file),
      rel: relative(root, resolve(file)),
    }));
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        walk(abs);
      } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
        files.push({ abs, rel: relative(root, abs) });
      }
    }
  };
  walk(root);
  return files;
}

function matchAll(content, regex, relPath, rule, baseSeverity, whitelist) {
  const findings = [];
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    const re = new RegExp(regex.source, regex.flags);
    for (const match of line.matchAll(re)) {
      const severity = overrideSeverity(whitelist, relPath, rule) ?? baseSeverity;
      findings.push({
        rule,
        severity,
        file: relPath,
        line: index + 1,
        match: match[0],
        snippet: line.trim().slice(0, 160),
      });
    }
  }
  return findings;
}

export function scanDesignViolations({ root = FRONTEND_ROOT, files } = {}) {
  const whitelist = loadWhitelist();
  const scanRoot = resolve(root);
  const sources = collectSourceFiles(scanRoot, files);
  const findings = [];

  for (const { abs, rel } of sources) {
    if (isAllowed(whitelist, rel)) continue;
    const relNorm = rel.split("\\").join("/");
    if (isAllowed(whitelist, relNorm)) continue;
    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    findings.push(...matchAll(content, RE_SHADOW, relNorm, "R1", "error", whitelist));
    findings.push(...matchAll(content, RE_PALETTE, relNorm, "R2", "error", whitelist));

    // R3:渐变出现在 Button 语境(行含 <Button 或 variant=)才 error,装饰性渐变 warn
    const gradientFindings = matchAll(content, RE_GRADIENT, relNorm, "R3", "warn", whitelist);
    for (const finding of gradientFindings) {
      if (/<Button|variant=|buttonVariants/.test(finding.snippet)) {
        finding.severity = overrideSeverity(whitelist, relNorm, "R3") ?? "error";
      }
      findings.push(finding);
    }

    findings.push(...matchAll(content, RE_SCALE_ACTIVE, relNorm, "R4", "error", whitelist));
    findings.push(...matchAll(content, RE_PURE_FOREGROUND, relNorm, "R5", "error", whitelist));
  }

  const byFile = {};
  for (const finding of findings) {
    byFile[finding.file] ??= { error: 0, warn: 0 };
    byFile[finding.file][finding.severity] += 1;
  }
  return {
    root: scanRoot,
    scannedFiles: sources.length,
    totals: {
      error: findings.filter((f) => f.severity === "error").length,
      warn: findings.filter((f) => f.severity === "warn").length,
    },
    byFile,
    findings,
  };
}

function printReport(result) {
  const { totals, byFile } = result;
  console.log(`design-lint:${result.scannedFiles} 文件 | error ${totals.error} | warn ${totals.warn}`);
  const rows = Object.entries(byFile).sort(
    (a, b) => b[1].error - a[1].error || b[1].warn - a[1].warn || a[0].localeCompare(b[0]),
  );
  for (const [file, counts] of rows) {
    console.log(`  ${String(counts.error).padStart(4)}E ${String(counts.warn).padStart(4)}W  ${file}`);
  }
  if (rows.length === 0) console.log("  (无违规)");
}

function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--out");
  const filesIndex = argv.indexOf("--files");
  const rootIndex = argv.indexOf("--root");
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : FRONTEND_ROOT;
  const files = filesIndex >= 0 ? argv.slice(filesIndex + 1).filter((f) => !f.startsWith("--")) : undefined;

  const result = scanDesignViolations({ root, files });
  printReport(result);
  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`JSON 报告已写:${out}`);
  }
  process.exit(result.totals.error > 0 ? 1 : 0);
}

// 直接执行时跑 CLI;被 import 时不跑(测试用)
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname) ||
    process.argv[1]?.endsWith("design-lint.mjs")) {
  main();
}
