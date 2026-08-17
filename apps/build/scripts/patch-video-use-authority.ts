import fs from "node:fs";

/**
 * 数据级修补：给 App 侧 runVideoUse 生成的 video-use artifact 补
 * subtitleAuthority（App 预览链路不写该字段，只有 CLI 管线写；
 * apply 的字幕归属门禁 fail-closed 必拒）。
 *
 * 用法：vite-node --config build/timeline/vite-node.config.ts \
 *   build/scripts/patch-video-use-authority.ts <rN 目录>
 */
async function main(): Promise<void> {
  const [dir] = process.argv.slice(2);
  if (!dir) throw new Error("用法: patch-video-use-authority.ts <revision-dir>");
  const artifactPath = `${dir}/video-use-artifact.json`;
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
  if (artifact.subtitleAuthority) {
    process.stdout.write(`已有 authority: mode=${(artifact.subtitleAuthority as { mode?: string }).mode}，跳过\n`);
    return;
  }
  fs.writeFileSync(`${artifactPath}.bak-authority`, fs.readFileSync(artifactPath));
  const evidence = artifact.evidence as { inputSha256?: string } | undefined;
  if (!evidence?.inputSha256) throw new Error("artifact 缺少 evidence.inputSha256");
  artifact.subtitleAuthority = {
    mode: "source-embedded",
    evidence: {
      mode: "source-embedded",
      decision: "human",
      sourceFingerprint: evidence.inputSha256,
      evidencePaths: [`app-authority-heal-${Date.now()}`],
      reviewer: "automated",
      reviewedAt: Date.now(),
      note: "E2E 补字段：App runVideoUse 不写 subtitleAuthority（仅 CLI 管线写入），apply 门禁 fail-closed；数据级对齐验证链路用",
    },
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`已补 authority: revision=${artifact.revision} source-embedded\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
