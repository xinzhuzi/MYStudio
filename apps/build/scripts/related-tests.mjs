// test:related 裸跑守卫 + vitest related 转发器(2026-09-29,09-28 任务 AC13 根修)。
//
// 为什么需要 wrapper(vitest 1.6.1 实证缺陷,两个假绿形态 + 一个恒崩):
// 1. 裸跑假绿:`vitest related --run` 不带源文件时输出「No test files found,
//    exiting with code 0」——零测试退出 0,必须在入口处非零拦截并给出用法。
// 2. 死路径假绿:related 对「解析不到的 source 文件」同样静默 exit 0(脚本层门禁
//    实测:cwd=apps/ 时传仓库相对路径 apps/frontend/... 即触发)。守卫=三锚点
//    路径自适应(INIT_CWD/npm 调用方原始 cwd → process.cwd() → 仓库根)+
//    存在性校验(不存在=非零)+ `--passWithNoTests=false`(vitest 1.6.1 实测
//    可把「零相关测试」从 exit 0 翻成 exit 1,零测试绝不假绿)。
// 3. 恒崩历史:S9(92fe0eb)记档 related PARSE_ERROR blockers;根因=related 的
//    模块图分析把 `.md?raw` 解析成裸 .md 路径(query 剥失),vite-node 1.6.1
//    server.mjs web 分支再对模块内容无条件 ssrTransform,裸 .md 无插件兜底 →
//    markdown 原文被 rollup 当 JS parse → em dash PARSE_ERROR。修法=
//    apps/frontend/config/vite.config.ts 顶层 `assetsInclude: ['**/*.md']`
//    (仅 vitest 消费该 config,不影响 electron-vite 打包链)。若该修法被移除,
//    related 会回到恒崩,本 wrapper 不吞错、如实透传退出码。
//
// 行为契约:
// - 无参数 → stderr 用法提示 + exit 2(绝不假绿);
// - 参数按三锚点自适应解析,解析不到的文件名如实列出 + exit 2;
// - 全部命中 → 转发 `vitest related --run --passWithNoTests=false
//   --config frontend/config/vite.config.ts <绝对路径…>`(cwd 恒锚定 apps/),
//   透传 vitest 退出码;exit 1 时提示「No test files found = 该文件当前没有任何
//   测试依赖它(零测试=非绿,不假绿)」;
// - 咨询性语义不变:不进 quality-gate stages、不进 .husky/pre-commit。
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = resolve(appsRoot, "..");
const rawSources = process.argv.slice(2);

if (rawSources.length === 0) {
  console.error(
    "[related-tests] 缺少目标源文件:裸跑 vitest related 会静默「No test files found」退出 0(假绿),已拦截。\n" +
      "用法: npm run test:related -- <改动文件> [<更多文件>...]   (cwd=apps/)\n" +
      "例:   npm run test:related -- frontend/lib/utils/concurrency.ts\n" +
      "      (apps 相对路径与仓库相对路径 apps/frontend/... 均可,wrapper 自适应)",
  );
  process.exit(2);
}

// 路径口径自适应:npm run 恒把 cwd 切到 apps/,而调用方(门禁/人/CI)可能传
// apps 相对或仓库相对两种口径——锚点顺序=调用方原始 cwd(npm 的 INIT_CWD)
// → 当前 cwd → 仓库根;命中即止,全部未命中按死路径报非零。
function resolveSource(raw) {
  if (isAbsolute(raw)) {
    return existsSync(raw) && statSync(raw).isFile() ? raw : null;
  }
  const anchors = [
    ["npm 调用方原始 cwd (INIT_CWD)", process.env.INIT_CWD],
    ["当前 cwd", process.cwd()],
    ["仓库根", repoRoot],
  ];
  for (const [, anchor] of anchors) {
    if (!anchor) continue;
    const candidate = resolve(anchor, raw);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const missing = [];
const sources = rawSources.map((raw) => {
  const resolved = resolveSource(raw);
  if (resolved === null) missing.push(raw);
  return resolved;
});

if (missing.length > 0) {
  console.error(
    "[related-tests] 目标源文件不存在(已按 npm 调用方 cwd / 当前 cwd / 仓库根 三锚点尝试):\n  " +
      missing.join("\n  "),
  );
  console.error(
    "用法: npm run test:related -- <改动文件> [...](apps 相对或仓库相对路径均可)",
  );
  process.exit(2);
}

let vitestCli;
try {
  // vitest 的 exports 白名单不含 ./cli(bin 实为包根的 vitest.mjs),从 package.json 锚定
  const vitestPkgRoot = dirname(
    createRequire(resolve(appsRoot, "package.json")).resolve("vitest/package.json"),
  );
  vitestCli = resolve(vitestPkgRoot, "vitest.mjs");
} catch (error) {
  console.error(`[related-tests] 解析 vitest CLI 失败(依赖未安装?): ${error.message}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    vitestCli,
    "related",
    "--run",
    "--passWithNoTests=false",
    "--config",
    "frontend/config/vite.config.ts",
    ...sources,
  ],
  { cwd: appsRoot, stdio: "inherit" },
);

if (result.error) {
  console.error(`[related-tests] 启动 vitest 失败: ${result.message}`);
  process.exit(1);
}
const status = result.status ?? 1;
if (status !== 0) {
  console.error(
    "[related-tests] vitest related 非零退出(如实透传)。若上方输出为「No test files found」:" +
      "目标文件当前没有任何测试依赖它(新文件无测试属此态)——零测试=非绿,不假绿。",
  );
}
process.exit(status);
