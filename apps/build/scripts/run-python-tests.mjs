// run-python-tests.mjs — Python 测试六域统一入口(R1.1/R1.5)
// 出处:.trellis/tasks/09-28-process-formalization(S2,design §2 契约)
// 域表=唯一权威命令集(S0 2026-09-28 实测定谳,含 chapter_video 口径修正:
//   cwd=仓库根 + PYTHONPATH=.;trellis 域显式 -o cache_dir 兜底,见 S1 已知边界)。
// 行为:逐域串行 fail-fast;--domain <name> 单跑;--platform darwin|linux(默认
//   process.platform 自动探测)按域平台表过滤;--json 报告落
//   apps/output/automation/python-tests-report.json(durable-json-report 原语);
//   逐域时长超 S0 基线 ×2 打 WARN 行不拦门(防测试腐化膨胀)。
// build_scripts 域用显式文件清单,件缺失即 RED(S6 后扩 test_commit_gate.py,
//   S6.5 后扩 test_preflight_gate.py——届时改 BUILD_SCRIPT_TEST_FILES 一处)。

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeDurableJsonReport } from "../shared/durable-json-report.mjs";

const appsRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const REPORT_PATH = resolve(appsRoot, "output/automation/python-tests-report.json");

// build_scripts 域显式清单(件缺失即 RED)。
const BUILD_SCRIPT_TEST_FILES = [
  "build/scripts/test_build_voice_clone_library.py",
  "build/scripts/test_daojie_ma_sync_check.py",
  "build/scripts/test_mix_voice_audio.py",
];

// S0 基线(2026-09-28 darwin/arm64,Python 3.14.4 / pytest 9.0.3;implement.md 执行记录)。
// 逐域时长超 ×2 出 WARN 行,不拦门。
const BASELINE_SECONDS = {
  engines: 19.33,
  my_nodes: 1.52,
  chapter_video: 2.53,
  build_scripts: 1.01,
  backend_unittest: 6.961,
  trellis: 0.77,
};

// chapter_video 域旧债出域(S0 裁定「记旧债暂出域」,理由随域表入库):
// 两用例死于 STORE=build_chapter001_workflow.py:53 模块级 resolve_project_dir()
// 解析到仓库外用户机器数据(/Users/.../IP/MA/studio-workflow-store.json,现已不存在);
// 修复须钉 MYSTUDIO_PROJECT_DIR+构造最小项目 fixture,超出本任务边界。
// 旧债名:chapter_video pilot ledger 机器数据绑定。双平台一致 deselect(CI 行为可预测)。
const CHAPTER_VIDEO_DESELECT = {
  reason:
    "旧债「chapter_video pilot ledger 机器数据绑定」暂出域(S0 裁定):STORE 解析到仓库外用户机器数据",
  // nodeid 相对 rootdir(=apps/,pytest.ini 所在;实测 --collect-only 口径)。
  nodeids: [
    "build/chapter_video/tests/test_continuity_pilot_attempt_ledger.py::ContinuityPilotAttemptLedgerTest::test_full_chapter_dry_run_reports_all_43_blocked_without_network",
    "build/chapter_video/tests/test_continuity_pilot_attempt_ledger.py::ContinuityPilotAttemptLedgerTest::test_paid_attempt_metadata_reaches_the_gpt_request_config",
  ],
};

export function buildDomains() {
  const chapterVideoArgs = ["-m", "pytest", "apps/build/chapter_video/tests", "-q"];
  for (const nodeid of CHAPTER_VIDEO_DESELECT.nodeids) {
    chapterVideoArgs.push("--deselect", nodeid);
  }
  return [
    {
      name: "engines",
      cwd: appsRoot,
      env: { PYTHONPATH: "backend" },
      executable: "python3",
      args: ["-m", "pytest", "backend/engines/comfyui/tests", "-q"],
      platforms: ["darwin", "linux"],
    },
    {
      name: "my_nodes",
      cwd: appsRoot,
      env: { PYTHONPATH: "backend" },
      executable: "python3",
      args: ["-m", "pytest", "backend/engines/comfyui/my_nodes/tests", "-q"],
      platforms: ["darwin", "linux"],
    },
    {
      name: "chapter_video",
      cwd: repoRoot,
      env: { PYTHONPATH: "." },
      executable: "python3",
      args: chapterVideoArgs,
      platforms: ["darwin", "linux"],
      deselected: CHAPTER_VIDEO_DESELECT,
    },
    {
      name: "build_scripts",
      cwd: appsRoot,
      executable: "python3",
      args: ["-m", "pytest", ...BUILD_SCRIPT_TEST_FILES, "-q"],
      platforms: ["darwin", "linux"],
      requiredFiles: BUILD_SCRIPT_TEST_FILES,
    },
    {
      name: "backend_unittest",
      cwd: appsRoot,
      env: { PYTHONPATH: "backend" },
      executable: "python3",
      args: ["-m", "unittest", "discover", "-s", "backend/tests"],
      platforms: ["darwin", "linux"],
    },
    {
      // trellis 域 args 向上寻不到 apps/pytest.ini(S1 已知边界),rootdir 不为 apps;
      // 显式 -o cache_dir(绝对路径)兜底,cache 收敛 apps/output/.pytest_cache。
      name: "trellis",
      cwd: repoRoot,
      executable: "python3",
      args: [
        "-m",
        "pytest",
        ".trellis/scripts/tests",
        "-q",
        "-o",
        `cache_dir=${resolve(appsRoot, "output/.pytest_cache")}`,
      ],
      platforms: ["darwin", "linux"],
    },
  ];
}

export function parseArgs(argv = []) {
  const options = { domain: null, jsonReport: false, platform: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--domain") {
      const value = argv[i + 1];
      if (!value) throw new Error("--domain 需要域名参数(engines|my_nodes|chapter_video|build_scripts|backend_unittest|trellis)");
      options.domain = value;
      i += 1;
    } else if (arg === "--json") {
      options.jsonReport = true;
    } else if (arg === "--platform") {
      const value = argv[i + 1];
      if (value !== "darwin" && value !== "linux") {
        throw new Error("--platform 需要 darwin 或 linux");
      }
      options.platform = value;
      i += 1;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function formatDomainCommand(domain) {
  const envPrefix = Object.entries(domain.env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return [envPrefix, domain.executable, ...domain.args].filter(Boolean).join(" ");
}

function cwdLabel(domain) {
  return domain.cwd === repoRoot ? "仓库根" : "apps/";
}

function createReport(platform, results) {
  return {
    generatedAt: new Date().toISOString(),
    ok: results.every((item) => item.status === "passed" || item.status === "skipped"),
    mode: "python-tests",
    platform,
    totalDurationMs: results.reduce((sum, item) => sum + item.durationMs, 0),
    domains: results,
  };
}

export function runPythonTests(options = {}) {
  // parseArgs 显式给 null(未指定),解构默认值只认 undefined,故用 ?? 收敛。
  const { domain = null, jsonReport = false } = options;
  const platform = options.platform ?? process.platform;
  let selected = buildDomains();
  if (domain) {
    const found = selected.find((item) => item.name === domain);
    if (!found) {
      throw new Error(
        `未知域: ${domain}(可选:${selected.map((item) => item.name).join("|")})`,
      );
    }
    selected = [found];
  }
  const results = [];
  let failFastReason = null;
  for (const domainConfig of selected) {
    const command = formatDomainCommand(domainConfig);
    const common = {
      name: domainConfig.name,
      command,
      cwd: cwdLabel(domainConfig),
      baselineSeconds: BASELINE_SECONDS[domainConfig.name] ?? null,
    };
    if (failFastReason) {
      // fail-fast 挡下的域记 blocked 入报告(结构恒定六域在,如实拦门不静默)。
      results.push({ ...common, status: "blocked", durationMs: 0, exitCode: null, reason: failFastReason });
      console.log(`[python-tests] blocked ${domainConfig.name}: ${failFastReason}`);
      continue;
    }
    if (!domainConfig.platforms.includes(platform)) {
      const reason = `${domainConfig.name} 不在 ${platform} 平台表(允许:${domainConfig.platforms.join("/")})`;
      results.push({ ...common, status: "skipped", durationMs: 0, exitCode: null, reason });
      console.log(`[python-tests] skipped ${domainConfig.name}: ${reason}`);
      continue;
    }
    if (domainConfig.requiredFiles) {
      const missing = domainConfig.requiredFiles.filter(
        (file) => !existsSync(resolve(domainConfig.cwd, file)),
      );
      if (missing.length > 0) {
        const error = `build_scripts 域显式清单件缺失即 RED:${missing.join(", ")}`;
        results.push({ ...common, status: "failed", durationMs: 0, exitCode: 1, error });
        console.error(`[python-tests] FAILED ${domainConfig.name}: ${error}`);
        failFastReason = `fail-fast:${domainConfig.name} 失败(件缺失),后续域未跑`;
        continue;
      }
    }
    console.log(`[python-tests] running ${domainConfig.name}: ${command} (cwd: ${cwdLabel(domainConfig)})`);
    const started = Date.now();
    const result = spawnSync(domainConfig.executable, domainConfig.args, {
      cwd: domainConfig.cwd,
      stdio: "inherit",
      env: { ...process.env, ...domainConfig.env },
    });
    const durationMs = Date.now() - started;
    const status = result.status === 0 ? "passed" : "failed";
    const entry = {
      ...common,
      status,
      durationMs,
      exitCode: result.status ?? 1,
    };
    if (domainConfig.deselected) {
      entry.deselected = domainConfig.deselected;
    }
    const baselineMs = (BASELINE_SECONDS[domainConfig.name] ?? 0) * 1000;
    if (baselineMs > 0 && durationMs > baselineMs * 2) {
      entry.warn = `用时 ${(durationMs / 1000).toFixed(2)}s 超 S0 基线×2(${BASELINE_SECONDS[domainConfig.name]}s→${(baselineMs * 2 / 1000).toFixed(2)}s)——不拦门,防测试腐化膨胀`;
      console.log(`[python-tests] WARN ${domainConfig.name} ${entry.warn}`);
    }
    if (status === "failed") {
      entry.error = result.error?.message || `exit code ${result.status}`;
      console.error(`[python-tests] FAILED ${domainConfig.name} (exit ${entry.exitCode}),fail-fast 停跑后续域`);
      results.push(entry);
      failFastReason = `fail-fast:${domainConfig.name} 失败(exit ${entry.exitCode}),后续域未跑`;
      continue;
    }
    console.log(`[python-tests] passed ${domainConfig.name} in ${(durationMs / 1000).toFixed(2)}s`);
    results.push(entry);
  }
  const report = createReport(platform, results);
  if (jsonReport) {
    const { filePath, archivePath } = writeDurableJsonReport(REPORT_PATH, report);
    console.log(`[python-tests] 报告已写 ${filePath}${archivePath ? `(旧报告归档 ${archivePath})` : ""}`);
  }
  return report;
}

function printUsage() {
  console.log("Usage: node run-python-tests.mjs [--domain <name>] [--platform darwin|linux] [--json]");
  console.log("域:engines | my_nodes | chapter_video | build_scripts | backend_unittest | trellis");
  console.log("默认:六域串行 fail-fast,--platform 缺省自动探测(process.platform),--json 落 apps/output/automation/python-tests-report.json");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      process.exit(0);
    }
    const report = runPythonTests(args);
    if (!report.ok) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
