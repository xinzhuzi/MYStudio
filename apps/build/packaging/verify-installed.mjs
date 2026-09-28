// verify-installed —— 装机独立复核(R4/design §7:双向 shasum + exec smoke:installed + 汇总报告)。
//
// 出处:2026-09-28 任务 09-28-process-formalization S7。此前「装机独立复核」只是散在
// SKILL.md / PACKAGING 文档里的文字配方(research/02 §二.3);本件零修改 build-mac.sh
// 与 install-and-smoke.mjs,只组合:
//   ① 双向 shasum:打包产物 app.asar vs /Applications 装机 app.asar,两方向打印+
//      a==b 断言。路径常量从 install-and-smoke.mjs 文本解析对齐(不复制魔数;解析
//      失败=RED 绝不回退手抄路径,防两处漂移)。须在 apps/ 下运行(npm 入口保证,
//      与被对齐件 process.cwd() 同语义)。
//   ② exec `npm run smoke:installed`(install-and-smoke.mjs 全链:ditto 覆盖安装+
//      装机冒烟;注意它会清理运行中的漫影实例与 detached 引擎——有状态副作用)。
//   ③ 汇总报告落 apps/output/automation/verify-installed-report.json(durable 原语)。
// --shasum-only:只跑段①(纯只读零改写),不 exec 冒烟——冒烟留给终局门禁/人工裁定。
// 退出码:0=全绿;1=任一段红(含常量解析失败/产物缺失/哈希不等/冒烟非零)。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeDurableJsonReport } from "../shared/durable-json-report.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const INSTALL_AND_SMOKE = resolve(scriptDir, "install-and-smoke.mjs");
const REPORT_PATH = resolve(
  scriptDir, "..", "..", "output", "automation", "verify-installed-report.json",
);
// 只解析本件真正用到的四个路径常量;installedBin 等其余常量留给 install-and-smoke 自用。
const PATH_CONSTS = ["packagedApp", "installedApp", "packagedAsar", "installedAsar"];
const TAG = "[verify-installed]";

// ── 段① 路径常量解析(对齐 install-and-smoke.mjs,零魔数) ─────────────────────

function splitTopLevelArgs(text) {
  const parts = [];
  let current = "";
  let inQuote = false;
  for (const ch of text) {
    if (ch === "'") {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "," && !inQuote) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parsePathConstants(source) {
  const resolvedConsts = new Map();
  const evaluateExpr = (expr) => {
    const trimmed = expr.trim();
    const literal = /^'([^']*)'$/.exec(trimmed);
    if (literal) return literal[1];
    const call = /^resolve\(([\s\S]*)\)$/.exec(trimmed);
    if (!call) {
      throw new Error(`无法识别的路径常量表达式:${trimmed}`);
    }
    const parts = splitTopLevelArgs(call[1]).map((part) => {
      if (part === "process.cwd()") return process.cwd();
      const str = /^'([^']*)'$/.exec(part);
      if (str) return str[1];
      if (resolvedConsts.has(part)) return resolvedConsts.get(part);
      throw new Error(`resolve() 参数不可解析(非字面量/已解析常量/process.cwd()):${part}`);
    });
    return resolve(...parts);
  };
  const parsed = {};
  for (const name of PATH_CONSTS) {
    const match = new RegExp(`^const\\s+${name}\\s*=\\s*(.+);$`, "m").exec(source);
    if (!match) {
      throw new Error(
        `install-and-smoke.mjs 缺路径常量 ${name}——两件对齐漂移,人工核对后再跑`,
      );
    }
    parsed[name] = evaluateExpr(match[1]);
    resolvedConsts.set(name, parsed[name]);
  }
  return parsed;
}

// 流式哈希:asar ~255MB,避免 readFileSync 整读的内存尖峰。
function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

// ── 编排 ─────────────────────────────────────────────────────────────────────

async function main() {
  const shasumOnly = process.argv.includes("--shasum-only");
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "verify-installed",
    ok: false,
    shasumOnly,
    paths: null,
    shasum: null,
    smoke: null,
  };
  const finish = (ok, summary) => {
    report.ok = ok;
    console.log(`${TAG} 汇总:${ok ? "GREEN" : "RED"}(${summary})`);
    const { filePath, archivePath } = writeDurableJsonReport(REPORT_PATH, report);
    console.log(`${TAG} 报告落 ${filePath}${archivePath ? `(旧报告归档 ${archivePath})` : ""}`);
    process.exit(ok ? 0 : 1);
  };

  const paths = parsePathConstants(readFileSync(INSTALL_AND_SMOKE, "utf8"));
  report.paths = paths;
  console.log(`${TAG} 路径常量(解析自 install-and-smoke.mjs,零魔数):`);
  for (const name of PATH_CONSTS) {
    console.log(`${TAG}   ${name} = ${paths[name]}`);
  }

  // 段①:双向 shasum(只读)
  const missing = PATH_CONSTS.filter((n) => n.endsWith("Asar") && !existsSync(paths[n]));
  if (missing.length > 0) {
    report.shasum = { status: "failed", missing: missing.map((n) => `${n}=${paths[n]}`) };
    console.error(`${TAG} RED 无产物可比对:${missing.join("、")} 不存在`);
    console.error(`${TAG} 打包一律走 build-mac.sh 唯一入口(AGENTS.md 铁律),勿绕开补打包`);
    finish(false, `shasum=MISSING(${missing.join(",")}), smoke=skipped`);
  }
  const [packagedHash, installedHash] = await Promise.all([
    sha256File(paths.packagedAsar),
    sha256File(paths.installedAsar),
  ]);
  const equal = packagedHash === installedHash;
  report.shasum = {
    status: equal ? "passed" : "failed",
    packaged: { path: paths.packagedAsar, sha256: packagedHash },
    installed: { path: paths.installedAsar, sha256: installedHash },
    equal,
  };
  console.log(`${TAG} packaged  sha256 = ${packagedHash}  (${paths.packagedAsar})`);
  console.log(`${TAG} installed sha256 = ${installedHash}  (${paths.installedAsar})`);
  console.log(`${TAG} 双向对拍:packaged → installed ${equal ? "EQUAL" : "MISMATCH"}`);
  console.log(`${TAG} 双向对拍:installed → packaged ${installedHash === packagedHash ? "EQUAL" : "MISMATCH"}`);

  // 段②:exec npm run smoke:installed(install-and-smoke 全链;--shasum-only 跳过)
  if (shasumOnly) {
    report.smoke = { status: "skipped", reason: "--shasum-only:冒烟不在此跑(留给终局门禁/人工裁定)" };
    console.log(`${TAG} ${report.smoke.reason}`);
  } else {
    console.log(`${TAG} exec npm run smoke:installed(会清理运行中实例并覆盖安装——有状态副作用)`);
    const result = spawnSync("npm", ["run", "smoke:installed"], { stdio: "inherit" });
    report.smoke = { status: result.status === 0 ? "passed" : "failed", exitCode: result.status };
  }

  const smokeGreen = shasumOnly || report.smoke.status === "passed";
  finish(equal && smokeGreen, `shasum=${equal ? "EQUAL" : "MISMATCH"}, smoke=${report.smoke.status}`);
}

main().catch((error) => {
  console.error(`${TAG} RED ${error instanceof Error ? error.message : String(error)}`);
  console.error(`${TAG} 常量解析失败=两件对齐漂移,绝不回退手抄路径`);
  process.exit(1);
});
