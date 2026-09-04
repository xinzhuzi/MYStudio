/**
 * 为 Windows 安装包准备捆绑的 sqlite3.exe。
 *
 * 资产库依赖 SQLite CLI;Windows 无系统 sqlite3,必须随安装包分发
 * (macOS/CI Linux runner 自带,旧版 Windows 安装包因此存在运行时缺口)。
 *
 * 来源优先级:
 *   1. 目标文件已存在(前一次构建/手动放置)→ 直接复用;
 *   2. 本机已安装 Chocolatey 的 sqlite 包 → 复制其 sqlite3.exe;
 *   3. 从 SQLite 官方 https://www.sqlite.org 下载固定版本 zip 并校验 SHA-256。
 *
 * 用法: node build/packaging/fetch-sqlite3.mjs
 * 目标: apps/frontend/assets/sqlite3/bin/win-x64/sqlite3.exe
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const destDir = resolve(projectRoot, "frontend", "assets", "sqlite3", "bin", "win-x64");
const destExe = join(destDir, "sqlite3.exe");
const cacheDir = resolve(projectRoot, ".cache", "sqlite3-tools");
const zipPath = join(cacheDir, "sqlite-tools-win-x64-3530400.zip");
// SQLite 3.53.4 (2026-04-25 发布周期);官方 zip 内 sqlite3.exe 无版本串,以 SHA-256 校验。
const DOWNLOAD_URL = "https://www.sqlite.org/2026/sqlite-tools-win-x64-3530400.zip";
const EXPECTED_SHA256 = "F46EE2475DE4CBE287E6E5F7D43C838796B14E7379CD216BDBB28D391429F9FC";

function sha256File(filePath) {
  const hash = createHash("sha256");
  return new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", rejectHash);
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], ...options });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").toString(), stderr: (result.stderr ?? "").toString() };
}

function findChocoSqlite3() {
  if (process.platform !== "win32") return null;
  // Chocolatey 安装的 sqlite 包路径: C:\ProgramData\chocolatey\lib\sqlite\tools\sqlite3.exe
  const candidates = [
    join(process.env.ProgramData ?? "C:\\ProgramData", "chocolatey", "lib", "sqlite", "tools", "sqlite3.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function extractZip(zip, destDirPath) {
  mkdirSync(destDirPath, { recursive: true });
  // Windows 10+ 自带 bsdtar 支持 zip;Linux/macOS 优先 unzip,回退 python3 -m zipfile。
  const tryTar = run("tar", ["-xf", zip, "-C", destDirPath]);
  if (tryTar.status === 0) return true;
  const tryUnzip = run("unzip", ["-o", zip, "-d", destDirPath]);
  if (tryUnzip.status === 0) return true;
  const tryPython = run("python3", ["-m", "zipfile", "-e", zip, destDirPath]);
  return tryPython.status === 0;
}

export async function prepareBundledSqlite3({ force = false } = {}) {
  if (existsSync(destExe) && !force) {
    console.log(`[sqlite3] 已存在,复用: ${destExe}`);
    return { executable: destExe, source: 'existing' };
  }

  const chocoExe = findChocoSqlite3();
  if (chocoExe) {
    mkdirSync(destDir, { recursive: true });
    const copy = run(process.platform === "win32" ? "cmd.exe" : "cp", process.platform === "win32"
      ? ["/d", "/s", "/c", `copy /y "${chocoExe}" "${destExe}"`]
      : [chocoExe, destExe]);
    if (copy.status !== 0 || !existsSync(destExe)) {
      throw new Error(`从 Chocolatey 复制 sqlite3.exe 失败: ${copy.stderr || copy.stdout}`);
    }
    console.log(`[sqlite3] 已从 Chocolatey 复制: ${chocoExe}`);
    return { executable: destExe, source: "choco" };
  }

  // 官方下载(缓存命中则跳过下载,仍校验 SHA-256)。
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(zipPath)) {
    console.log(`[sqlite3] 下载 ${DOWNLOAD_URL}`);
    const response = await fetch(DOWNLOAD_URL, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`下载 sqlite-tools 失败: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(zipPath, buffer);
  }
  const actualSha = await sha256File(zipPath);
  if (actualSha !== EXPECTED_SHA256) {
    rmSync(zipPath, { force: true });
    throw new Error(`sqlite-tools zip SHA-256 校验失败: ${actualSha}(期望 ${EXPECTED_SHA256})`);
  }
  if (!extractZip(zipPath, destDir)) {
    throw new Error("解压 sqlite-tools 失败(需要 tar/unzip/python3 之一)");
  }
  if (!existsSync(destExe)) {
    throw new Error(`解压后未找到 ${destExe}`);
  }
  console.log(`[sqlite3] 已就绪: ${destExe}`);
  return { executable: destExe, source: "download" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareBundledSqlite3().catch((error) => {
    console.error(`[sqlite3] 准备失败: ${error instanceof Error ? error.message : String(error)}`);
    console.error("请手动下载 https://www.sqlite.org/download.html 的 sqlite-tools-win-x64 zip,将其中的 sqlite3.exe 放到:");
    console.error(`  ${destExe}`);
    process.exitCode = 1;
  });
}
