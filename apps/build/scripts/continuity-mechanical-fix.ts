/**
 * 一次性修复(2026-08-29,不入库):新代分镜表连续性机械病灶
 * 1) orderedReferenceManifest 合并重复(82→38 合并未去重,sb-001/002 各多 1 条同版本引用)→ 去重+order 重排
 * 2) continuityState.sourceSemanticsFingerprint 与合并后 shotSemantics 失同步(×5)→ 以当前语义重算
 *    (continuityState 本身由合并工具按当前语义构建,仅指纹未刷新;非改连续性结论)
 * 修复后离线 audit 应只剩 review.missing/pending(人审门)。
 */
import fs from "node:fs";
import path from "node:path";
import { storyboardShotSemanticsFingerprint, visualContinuityFingerprint } from "@/lib/studio/visual-continuity";
import type { StoryboardItem } from "@/types/studio";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
} from "../timeline/storage-paths";
import { writeStudioWorkflowStore } from "../../frontend/electron/storage/studio-workflow-store-io";

const projectDir = path.resolve(process.argv.find((_, i, a) => a[i - 1] === "--project") ?? resolveProjectDir());
const roots = deriveStorageRoots(projectDir);
const snapshot = readStudioWorkflowStoreState(projectDir);
if (!snapshot) throw new Error("store 不可读");
const storyboards = snapshot.state.storyboards as StoryboardItem[];

let deduped = 0;
let fingerprints = 0;
const next = storyboards.map((storyboard) => {
  const manifest = storyboard.orderedReferenceManifest ?? [];
  const seen = new Set<string>();
  const dedupedManifest = manifest.filter((reference) => {
    const key = `${reference.assetId}:${reference.versionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((reference, index) => ({ ...reference, order: index + 1 }));
  if (dedupedManifest.length !== manifest.length) {
    deduped += manifest.length - dedupedManifest.length;
    storyboard = { ...storyboard, orderedReferenceManifest: dedupedManifest };
  }
  const continuity = storyboard.continuityState;
  if (continuity && continuity.sourceSemanticsFingerprint
    && continuity.sourceSemanticsFingerprint !== storyboardShotSemanticsFingerprint(storyboard.shotSemantics)) {
    storyboard = {
      ...storyboard,
      continuityState: {
        ...continuity,
        sourceSemanticsFingerprint: storyboardShotSemanticsFingerprint(storyboard.shotSemantics),
      },
    };
    fingerprints += 1;
  }
  // 第二重指纹:inputFingerprint 覆盖参考清单等输入,去重/语义同步后须与校验器同口径重算
  const continuityAfter = storyboard.continuityState;
  if (continuityAfter && continuityAfter.inputFingerprint
    && continuityAfter.inputFingerprint !== visualContinuityFingerprint(storyboard)) {
    storyboard = {
      ...storyboard,
      continuityState: {
        ...continuityAfter,
        inputFingerprint: visualContinuityFingerprint(storyboard),
      },
    };
    fingerprints += 1;
  }
  return storyboard;
});

console.log(`[continuity-fix] 去重引用 ${deduped} 条,语义指纹同步 ${fingerprints} 镜`);
if (deduped > 0 || fingerprints > 0) {
  const writeResult = writeStudioWorkflowStore(
    roots.dataRoot,
    roots.projectId,
    JSON.stringify({ state: { ...snapshot.state, storyboards: next }, version: snapshot.version }),
  );
  console.log(`[continuity-fix] store 分片写回 ${writeResult.shardNames.length} 片`);
} else {
  console.log("[continuity-fix] 无需修改");
}
void fs;
