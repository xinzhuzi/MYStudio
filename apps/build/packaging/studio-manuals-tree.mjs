// studio-manuals-tree —— F6 刀2(1115 补完役):studio-manuals 树级 SHA 对账共享真身。
//
// 病根:electron-builder extraResources 对已存在目录的陈留不刷新(终报第⑥项),
// 「装机 Resources/studio-manuals = 仓源」此前无机械门——陈留静默上线。
// 本件供 install-and-smoke.mjs(装机后立即对账)与 verify-installed.mjs(独立复核)
// 共用:按 electron-builder.yml extraResources studio-manuals 同款滤除
// (story_skills/Daojie_xianxia/**、**/.DS_Store、**/.zcode/**)收集
// 相对路径→sha256 清单,两树各自归并成树哈希后比对;不等即 RED(差异逐文件列出)。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** electron-builder.yml:77-88 studio-manuals filter 的同款滤除(改动须两处同步)。 */
export function isExcludedStudioManualsEntry(relativePosixPath) {
  if (relativePosixPath === "story_skills/Daojie_xianxia" ) return true;
  return relativePosixPath.startsWith("story_skills/Daojie_xianxia/")
    || relativePosixPath.split("/").includes(".DS_Store")
    || relativePosixPath.split("/").includes(".zcode");
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/** 收集滤除后的树清单:Map<relativePosixPath, sha256>(路径排序稳定)。 */
export function collectStudioManualsTree(root) {
  const entries = new Map();
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const entryPath = join(current, name);
      const relativePath = relative(root, entryPath).split(sep).join("/");
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        if (isExcludedStudioManualsEntry(relativePath)) continue;
        walk(entryPath);
        continue;
      }
      if (!stat.isFile()) continue;
      if (isExcludedStudioManualsEntry(relativePath)) continue;
      entries.set(relativePath, sha256File(entryPath));
    }
  };
  walk(root);
  return new Map([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/** 树哈希 = sha256(逐行 "path:hash\n" 归并)。 */
export function studioManualsTreeHash(entries) {
  const hash = createHash("sha256");
  for (const [path, fileHash] of entries) {
    hash.update(`${path}:${fileHash}\n`);
  }
  return hash.digest("hex");
}

/**
 * 对账仓源 vs 装机树。返回 null=一致;否则返回 { repoHash, installedHash, missing,
 * extra, changed }(missing=装机缺,extra=装机多,changed=同路径内容异)。
 */
export function diffStudioManualsTrees(repoRoot, installedRoot) {
  const repo = collectStudioManualsTree(repoRoot);
  const installed = collectStudioManualsTree(installedRoot);
  const missing = [];
  const changed = [];
  for (const [path, fileHash] of repo) {
    if (!installed.has(path)) missing.push(path);
    else if (installed.get(path) !== fileHash) changed.push(path);
  }
  const extra = [...installed.keys()].filter((path) => !repo.has(path));
  if (missing.length === 0 && changed.length === 0 && extra.length === 0) return null;
  return {
    repoHash: studioManualsTreeHash(repo),
    installedHash: studioManualsTreeHash(installed),
    missing,
    extra,
    changed,
  };
}
