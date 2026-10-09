import fs from "node:fs";

/**
 * 数据级修补：把 chapter manifest 的 sourceSnapshotHash 对齐到当前
 * EditingProject 的快照哈希（Studio 渲染桥的 identity 校验要求两者一致），
 * 并按全部渲染字段重算 manifestFingerprint。
 *
 * 用法：vite-node --config build/timeline/vite-node.config.ts \
 *   build/scripts/patch-chapter-manifest-snapshot.ts <manifest.json> <snapshotHash>
 */
async function main(): Promise<void> {
  const [manifestPath, snapshotHash] = process.argv.slice(2);
  if (!manifestPath || !/^[a-f0-9]{64}$/.test(snapshotHash ?? "")) {
    throw new Error("用法: patch-chapter-manifest-snapshot.ts <manifest.json> <64位snapshotHash>");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const previousRevision = Number(manifest.revision ?? 0);
  fs.writeFileSync(`${manifestPath}.bak-snapshot-heal`, fs.readFileSync(manifestPath));
  manifest.sourceSnapshotHash = snapshotHash;
  manifest.revision = previousRevision + 1;
  manifest.updatedAt = Date.now();
  const { createRemotionChapterManifestFingerprint } = await import(
    "../../frontend/lib/studio/remotion/remotion-audio-fingerprint"
  );
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(
    manifest as Parameters<typeof createRemotionChapterManifestFingerprint>[0],
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`patched: revision ${previousRevision} -> ${manifest.revision}, snapshot ${snapshotHash.slice(0, 12)}…\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
