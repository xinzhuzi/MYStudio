import type {
  ContinuityAssetApproval,
  ContinuityAssetVersion,
  HumanContinuityAssetApprovalInput,
  HumanVisualReviewInput,
  ShotContinuityState,
  StoryboardItem,
  StoryboardOrderedReference,
  VisualReviewResult,
} from "@/types/studio";

export interface VisualContinuityIssue {
  storyboardId: string;
  code:
    | "references.missing"
    | "references.order"
    | "references.version"
    | "references.approval"
    | "scene.primary"
    | "continuity.missing"
    | "continuity.previous"
    | "continuity.stale"
    | "review.missing"
    | "review.rejected"
    | "review.human"
    | "review.timestamp"
    | "review.evidence"
    | "review.checks"
    | "review.stale";
  message: string;
}

export interface VisualContinuityAudit {
  ok: boolean;
  issues: VisualContinuityIssue[];
  approved: number;
  pending: number;
  rejected: number;
  stale: number;
}

export function continuityAssetContentFingerprint(version: ContinuityAssetVersion) {
  return stableSerialize(compactNullishFields({
    assetId: version.assetId,
    versionId: version.versionId,
    assetKind: version.assetKind,
    label: version.label,
    referenceImagePaths: version.referenceImagePaths,
    referenceImageSha256: version.referenceImageSha256,
    referenceViewTypes: version.referenceViewTypes,
    identityAnchors: version.identityAnchors,
    negativePrompt: version.negativePrompt,
    wardrobeVersion: version.wardrobeVersion,
    sceneViewpointId: version.sceneViewpointId,
    spatialLayout: version.spatialLayout,
    lightingDesign: version.lightingDesign,
    colorPalette: version.colorPalette,
    validFromStoryboardIndex: version.validFromStoryboardIndex,
    validToStoryboardIndex: version.validToStoryboardIndex,
    source: version.source,
  }));
}

export function continuityAssetApprovalFingerprint(
  version: ContinuityAssetVersion,
  approval: ContinuityAssetApproval,
) {
  return stableSerialize(compactNullishFields({
    assetId: version.assetId,
    versionId: version.versionId,
    contentFingerprint: approval.contentFingerprint,
    status: approval.status,
    reviewer: approval.reviewer,
    reviewedAt: approval.reviewedAt,
    reason: approval.reason,
    evidencePaths: approval.evidencePaths,
    reviewEvidenceSha256: version.reviewEvidenceSha256,
    reviewEvidenceVerifiedAt: version.reviewEvidenceVerifiedAt,
  }));
}

export function isContinuityAssetStructurallyComplete(version: ContinuityAssetVersion) {
  const imageHashes = version.referenceImageSha256;
  const hasBaseFields = Boolean(
    version.assetId.trim()
    && version.versionId.trim()
    && version.label.trim()
    && version.source.trim()
    && version.referenceImagePaths.length > 0
    && version.referenceImagePaths.every((path) => path.trim())
    && (!imageHashes || (
      imageHashes.length === version.referenceImagePaths.length
      && imageHashes.every((hash) => /^[a-f0-9]{64}$/i.test(hash))
    )),
  );
  if (!hasBaseFields || (version.missingFields?.length ?? 0) > 0) return false;
  if (version.assetKind === "character") {
    const viewTypes = version.referenceViewTypes ?? [];
    return Boolean(
      version.wardrobeVersion?.trim()
      && version.identityAnchors
      && Array.isArray(version.identityAnchors.uniqueMarks)
      && version.negativePrompt?.avoid?.length
      && viewTypes.length >= 3
      && viewTypes.length === version.referenceImagePaths.length,
    );
  }
  if (version.assetKind === "scene") {
    return Boolean(
      version.sceneViewpointId?.trim()
      && version.spatialLayout?.trim()
      && version.lightingDesign?.trim()
      && version.colorPalette?.trim(),
    );
  }
  return true;
}

export function isContinuityAssetVersionApproved(version: ContinuityAssetVersion) {
  const approval = version.approval;
  if (!approval || !isContinuityAssetStructurallyComplete(version)) return false;
  const currentContentFingerprint = continuityAssetContentFingerprint(version);
  const registeredEvidencePaths = (version.reviewEvidencePaths ?? [])
    .map((path) => path.trim())
    .filter(Boolean);
  const safeEvidencePaths = continuityAssetSafeReviewEvidencePaths(version);
  const approvalEvidencePaths = approval.evidencePaths.map((path) => path.trim()).filter(Boolean);
  const evidenceHashes = version.reviewEvidenceSha256 ?? [];
  return approval.status === "approved"
    && approval.reviewer === "human"
    && Number.isFinite(approval.reviewedAt)
    && (approval.reviewedAt ?? 0) > 0
    && registeredEvidencePaths.length === version.referenceImagePaths.length
    && safeEvidencePaths.length === registeredEvidencePaths.length
    && approvalEvidencePaths.length === safeEvidencePaths.length
    && approvalEvidencePaths.every((path, index) => path === safeEvidencePaths[index])
    && evidenceHashes.length === safeEvidencePaths.length
    && evidenceHashes.every((hash) => /^[a-f0-9]{64}$/i.test(hash))
    && Number.isFinite(version.reviewEvidenceVerifiedAt)
    && (version.reviewEvidenceVerifiedAt ?? 0) > 0
    && approval.contentFingerprint === currentContentFingerprint
    && version.contentFingerprint === currentContentFingerprint
    && version.approvalFingerprint === continuityAssetApprovalFingerprint(version, approval);
}

export function continuityAssetSafeReviewEvidencePaths(version: ContinuityAssetVersion) {
  return (version.reviewEvidencePaths ?? [])
    .map((path) => path.trim())
    .filter((path) => /_thumb\.png$/i.test(path));
}

export function normalizeContinuityAssetVersion(version: ContinuityAssetVersion): ContinuityAssetVersion {
  const normalized: ContinuityAssetVersion = {
    ...version,
    referenceImagePaths: version.referenceImagePaths.map((path) => path.trim()).filter(Boolean),
    referenceImageSha256: version.referenceImageSha256?.map((hash) => hash.trim().toLowerCase()).filter(Boolean),
    reviewEvidencePaths: version.reviewEvidencePaths?.map((path) => path.trim()).filter(Boolean),
    reviewEvidenceSha256: version.reviewEvidenceSha256?.map((hash) => hash.trim().toLowerCase()).filter(Boolean),
    referenceViewTypes: version.referenceViewTypes ? [...version.referenceViewTypes] : undefined,
    missingFields: version.missingFields ? [...version.missingFields] : undefined,
    approval: version.approval
      ? {
          ...version.approval,
          evidencePaths: version.approval.evidencePaths.map((path) => path.trim()).filter(Boolean),
          reason: version.approval.reason?.trim() || undefined,
        }
      : undefined,
    structurallyComplete: false,
    contentFingerprint: "",
    approved: false,
  };
  normalized.structurallyComplete = isContinuityAssetStructurallyComplete(normalized);
  normalized.contentFingerprint = continuityAssetContentFingerprint(normalized);
  normalized.approved = isContinuityAssetVersionApproved(normalized);
  return normalized;
}

export function createHumanContinuityAssetApproval(
  version: ContinuityAssetVersion,
  input: HumanContinuityAssetApprovalInput,
) {
  if (input.status === "pending") throw new Error("人工资产审核不能提交 pending 状态");
  const current = normalizeContinuityAssetVersion(version);
  const evidencePaths = input.evidencePaths.map((path) => path.trim()).filter(Boolean);
  const safeEvidencePaths = continuityAssetSafeReviewEvidencePaths(current);
  const reviewedAt = input.reviewedAt ?? Date.now();
  if (input.status === "approved" && !current.structurallyComplete) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 结构不完整，不能批准`);
  }
  if (input.status === "approved" && evidencePaths.length === 0) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 缺少人工审核证据`);
  }
  if (input.status === "approved" && !current.reviewEvidenceVerifiedAt) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 必须先通过本地缩略图文件与 SHA-256 安全校验`);
  }
  if (
    input.status === "approved"
    && (
      safeEvidencePaths.length !== current.referenceImagePaths.length
      || evidencePaths.length !== safeEvidencePaths.length
      || evidencePaths.some((path, index) => path !== safeEvidencePaths[index])
    )
  ) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 必须使用逐图安全缩略证据批准`);
  }
  if (input.status === "rejected" && !input.reason?.trim()) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 驳回时必须填写原因`);
  }
  if (!Number.isFinite(reviewedAt) || reviewedAt <= 0) {
    throw new Error(`连续性资产 ${current.assetId}/${current.versionId} 缺少有效人工审核时间`);
  }
  const approval: ContinuityAssetApproval = {
    status: input.status,
    reviewer: "human",
    reviewedAt,
    reason: input.reason?.trim() || undefined,
    evidencePaths,
    contentFingerprint: current.contentFingerprint,
  };
  return normalizeContinuityAssetVersion({
    ...current,
    approval,
    approvalFingerprint: continuityAssetApprovalFingerprint(current, approval),
  });
}

export function normalizeOrderedReferences(
  references: StoryboardOrderedReference[] | undefined,
): StoryboardOrderedReference[] {
  return [...(references ?? [])].sort((left, right) => left.order - right.order);
}

export function assertOrderedReferences(
  storyboardId: string,
  references: StoryboardOrderedReference[] | undefined,
) {
  const ordered = normalizeOrderedReferences(references);
  if (ordered.length === 0) {
    throw new Error(`分镜 ${storyboardId} 缺少有序视觉参考清单`);
  }
  const seenAssets = new Set<string>();
  for (const [index, reference] of ordered.entries()) {
    if (reference.order !== index + 1) {
      throw new Error(`分镜 ${storyboardId} 参考图顺序必须从 1 连续递增`);
    }
    if (!reference.assetId || !reference.imagePath || reference.missing) {
      throw new Error(`分镜 ${storyboardId} 第 ${reference.order} 个参考图不可用`);
    }
    if (!reference.versionId) {
      throw new Error(`分镜 ${storyboardId} 参考资产 ${reference.assetId} 缺少视觉版本`);
    }
    const stableKey = `${reference.assetId}:${reference.versionId}`;
    if (seenAssets.has(stableKey)) {
      throw new Error(`分镜 ${storyboardId} 重复引用视觉版本 ${stableKey}`);
    }
    seenAssets.add(stableKey);
  }
  return ordered;
}

export function storyboardReferenceApprovalIssues(
  storyboard: StoryboardItem,
  assetVersions: ContinuityAssetVersion[],
): VisualContinuityIssue[] {
  const issues: VisualContinuityIssue[] = [];
  const versionsByKey = new Map(
    assetVersions.map((version) => [`${version.assetId}:${version.versionId}`, version]),
  );
  const references = normalizeOrderedReferences(storyboard.orderedReferenceManifest);
  for (const reference of references) {
    if (reference.referenceRole === "previous-approved-frame") continue;
    const key = `${reference.assetId}:${reference.versionId ?? ""}`;
    const version = versionsByKey.get(key);
    if (!version) {
      issues.push({
        storyboardId: storyboard.id,
        code: "references.approval",
        message: `分镜 ${storyboard.id} 参考资产 ${key} 缺少资产级批准记录`,
      });
      continue;
    }
    if (!isContinuityAssetVersionApproved(version)) {
      issues.push({
        storyboardId: storyboard.id,
        code: "references.approval",
        message: `分镜 ${storyboard.id} 参考资产 ${key} 尚未通过有效人工批准`,
      });
      continue;
    }
    if (
      reference.contentFingerprint !== version.contentFingerprint
      || reference.approvalFingerprint !== version.approvalFingerprint
    ) {
      issues.push({
        storyboardId: storyboard.id,
        code: "references.approval",
        message: `分镜 ${storyboard.id} 参考资产 ${key} 的批准指纹已失效`,
      });
    }
  }
  return issues;
}

export function storyboardPrimarySceneIssues(storyboard: StoryboardItem): VisualContinuityIssue[] {
  const continuity = storyboard.continuityState;
  if (!continuity) return [];
  const sceneReferences = normalizeOrderedReferences(storyboard.orderedReferenceManifest)
    .filter((reference) => reference.assetKind === "scene" || reference.referenceRole === "scene-viewpoint" || reference.referenceRole === "secondary-scene");
  const primary = sceneReferences.filter((reference) => reference.referenceRole === "scene-viewpoint");
  const matchingPrimary = primary.filter((reference) => (
    reference.versionId === continuity.sceneVersionId
    && reference.sceneViewpointId === continuity.sceneViewpointId
  ));
  const invalidSecondary = sceneReferences.filter((reference) => (
    reference.referenceRole !== "scene-viewpoint"
    && reference.referenceRole !== "secondary-scene"
  ));
  if (primary.length === 1 && matchingPrimary.length === 1 && invalidSecondary.length === 0) return [];
  return [{
    storyboardId: storyboard.id,
    code: "scene.primary",
    message: `分镜 ${storyboard.id} 主场景必须且只能有一个 scene-viewpoint，且匹配 ${continuity.sceneVersionId}/${continuity.sceneViewpointId}；其他场景只能标记为 secondary-scene`,
  }];
}

export function buildContinuityPrompt(state: ShotContinuityState): string {
  const characters = state.characters.map((character) => [
    `${character.characterId}使用${character.versionId}`,
    `位置${character.position}`,
    `朝向${character.orientation}`,
    `承接动作${character.actionIn}`,
    `镜尾动作${character.actionOut}`,
  ].join("，"));
  return [
    `【连续镜头组】${state.groupId}`,
    state.previousStoryboardId ? `承接上一镜${state.previousStoryboardId}` : "本组首镜",
    `【场景锁】${state.sceneVersionId}/${state.sceneViewpointId}，${state.lighting}，${state.palette}`,
    `【动作承接】${state.actionIn}；镜尾：${state.actionOut}`,
    characters.length ? `【人物状态】${characters.join("；")}` : "",
    `【出镜人数锁】本镜出镜角色总数：${characters.length}；每个连续性角色版本各出现 1 次。`
      + `前景、中景、远景和背景合计只能出现上述 ${characters.length} 个角色实例；`
      + "不得出现路人、工人、剪影、倒影或模糊人影。禁止重复、克隆或因多视图参考新增人物。",
  ].filter(Boolean).join(" ");
}

export function visualContinuityFingerprint(storyboard: Pick<
  StoryboardItem,
  "prompt" | "orderedReferenceManifest" | "continuityState"
>) {
  return stableSerialize({
    prompt: storyboard.prompt,
    references: normalizeOrderedReferences(storyboard.orderedReferenceManifest).map((reference) => compactNullishFields({
      order: reference.order,
      assetId: reference.assetId,
      versionId: reference.versionId,
      imagePath: reference.imagePath,
      referenceImagePaths: reference.referenceImagePaths,
      referenceImageSha256: reference.referenceImageSha256,
      referenceViewTypes: reference.referenceViewTypes,
      referenceRole: reference.referenceRole,
      wardrobeVersion: reference.wardrobeVersion,
      sceneViewpointId: reference.sceneViewpointId,
      contentFingerprint: reference.contentFingerprint,
    })),
    continuity: storyboard.continuityState
      ? compactNullishFields({ ...storyboard.continuityState, inputFingerprint: undefined })
      : undefined,
  });
}

export function storyboardContinuityStateIssues(storyboard: StoryboardItem): VisualContinuityIssue[] {
  const continuity = storyboard.continuityState;
  if (!continuity) {
    return [{
      storyboardId: storyboard.id,
      code: "continuity.missing",
      message: `分镜 ${storyboard.id} 缺少连续镜头状态`,
    }];
  }
  if (continuity.inputFingerprint !== visualContinuityFingerprint(storyboard)) {
    return [{
      storyboardId: storyboard.id,
      code: "continuity.stale",
      message: `分镜 ${storyboard.id} 连续性输入指纹已失效`,
    }];
  }
  return [];
}

export function visualReviewInputFingerprint(storyboard: Pick<
  StoryboardItem,
  | "prompt"
  | "orderedReferenceManifest"
  | "continuityState"
  | "mediaRef"
  | "imageWorkflowId"
  | "imageWorkflowNodeId"
  | "outputVersion"
>) {
  return stableSerialize({
    continuity: visualContinuityFingerprint(storyboard),
    mediaRef: storyboard.mediaRef
      ? compactNullishFields({
          kind: storyboard.mediaRef.kind,
          path: storyboard.mediaRef.path,
          contentSha256: storyboard.mediaRef.contentSha256,
          imageWorkflowId: storyboard.mediaRef.imageWorkflowId,
          imageWorkflowNodeId: storyboard.mediaRef.imageWorkflowNodeId,
        })
      : undefined,
    imageWorkflowId: storyboard.imageWorkflowId,
    imageWorkflowNodeId: storyboard.imageWorkflowNodeId,
    outputVersion: storyboard.outputVersion,
  });
}

export function approvedVisualReviewIssues(
  storyboard: StoryboardItem,
  review = storyboard.visualReview,
  assetVersions: ContinuityAssetVersion[] = [],
): VisualContinuityIssue[] {
  if (!review || review.status !== "approved") return [];
  const issues: VisualContinuityIssue[] = [];
  const add = (code: VisualContinuityIssue["code"], message: string) => {
    issues.push({ storyboardId: storyboard.id, code, message });
  };
  if (review.reviewer !== "human") {
    add("review.human", `分镜 ${storyboard.id} 必须由人工审核批准`);
  }
  if (!Number.isFinite(review.reviewedAt) || (review.reviewedAt ?? 0) <= 0) {
    add("review.timestamp", `分镜 ${storyboard.id} 缺少有效人工审核时间`);
  }
  const evidencePaths = review.evidencePaths.map((path) => path.trim()).filter(Boolean);
  if (evidencePaths.length === 0) {
    add("review.evidence", `分镜 ${storyboard.id} 缺少审核证据路径`);
  } else if (
    !storyboard.mediaRef?.path
    || evidencePaths.length !== 1
    || evidencePaths[0] !== storyboard.mediaRef.path
  ) {
    add("review.evidence", `分镜 ${storyboard.id} 的审核证据必须精确绑定当前画面`);
  }
  if (review.inputFingerprint !== visualReviewInputFingerprint(storyboard)) {
    add("review.stale", `分镜 ${storyboard.id} 审核输入已变化，必须重新审核`);
  }
  if (storyboard.stale) {
    add("review.stale", storyboard.staleReason || `分镜 ${storyboard.id} 已过期，不能批准`);
  }
  issues.push(...storyboardContinuityStateIssues(storyboard));
  const failedCheck = [
    ...review.characterChecks,
    ...review.sceneChecks,
    ...(review.propChecks ?? []),
    ...review.transitionChecks,
    review.textWatermarkCheck ?? { passed: false },
  ].find((check) => !check.passed);
  if (failedCheck) {
    add("review.checks", `分镜 ${storyboard.id} 仍有未通过的视觉检查`);
  }
  const continuity = storyboard.continuityState;
  if (continuity) {
    for (const character of continuity.characters) {
      if (!review.characterChecks.some((check) => check.characterId === character.characterId && check.passed)) {
        add("review.checks", `分镜 ${storyboard.id} 缺少角色 ${character.characterId} 的通过检查`);
      }
    }
    if (!review.sceneChecks.some((check) => check.sceneVersionId === continuity.sceneVersionId && check.passed)) {
      add("review.checks", `分镜 ${storyboard.id} 缺少场景 ${continuity.sceneVersionId} 的通过检查`);
    }
    if (
      continuity.previousStoryboardId
      && !review.transitionChecks.some(
        (check) => check.previousStoryboardId === continuity.previousStoryboardId && check.passed,
      )
    ) {
      add("review.checks", `分镜 ${storyboard.id} 缺少与上一镜 ${continuity.previousStoryboardId} 的相邻镜头通过检查`);
    }
  }
  for (const reference of normalizeOrderedReferences(storyboard.orderedReferenceManifest)) {
    if (
      reference.referenceRole === "prop-state"
      && !(review.propChecks ?? []).some((check) => (
        check.assetId === reference.assetId
        && (!check.versionId || check.versionId === reference.versionId)
        && check.passed
      ))
    ) {
      add("review.checks", `分镜 ${storyboard.id} 缺少道具 ${reference.assetId}/${reference.versionId ?? "未设置"} 的通过检查`);
    }
  }
  if (review.textWatermarkCheck?.passed !== true) {
    add("review.checks", `分镜 ${storyboard.id} 缺少文字与水印通过检查`);
  }
  issues.push(...storyboardPrimarySceneIssues(storyboard));
  issues.push(...storyboardReferenceApprovalIssues(storyboard, assetVersions));
  return issues;
}

export function markContinuityDependentsStale(
  storyboards: StoryboardItem[],
  changedStoryboardId: string,
  staleSince = Date.now(),
) {
  const changed = storyboards.find((item) => item.id === changedStoryboardId);
  if (!changed?.continuityState) return storyboards;
  const downstreamIds = new Set(
    storyboards
      .filter((storyboard) => (
        storyboard.index > changed.index
        && storyboard.continuityState?.groupId === changed.continuityState?.groupId
      ))
      .map((storyboard) => storyboard.id),
  );
  return storyboards.map((storyboard) => {
    if (!downstreamIds.has(storyboard.id)) return storyboard;
    return {
      ...storyboard,
      stale: true,
      staleReason: `上游连续镜头 ${changedStoryboardId} 已变化`,
      staleSince,
      visualReview: storyboard.visualReview
        ? { ...storyboard.visualReview, status: "pending" as const, reasons: ["上游连续镜头已变化，必须重新审核"] }
        : storyboard.visualReview,
    };
  });
}

export function auditVisualContinuity(
  storyboards: StoryboardItem[],
  assetVersions: ContinuityAssetVersion[] = [],
): VisualContinuityAudit {
  const issues: VisualContinuityIssue[] = [];
  const byId = new Map(storyboards.map((storyboard) => [storyboard.id, storyboard]));
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let stale = 0;
  for (const storyboard of [...storyboards].sort((left, right) => left.index - right.index)) {
    try {
      assertOrderedReferences(storyboard.id, storyboard.orderedReferenceManifest);
    } catch (error) {
      issues.push({
        storyboardId: storyboard.id,
        code: String(error).includes("顺序") ? "references.order" : String(error).includes("版本") ? "references.version" : "references.missing",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const continuity = storyboard.continuityState;
    issues.push(...storyboardContinuityStateIssues(storyboard));
    if (continuity) {
      issues.push(...storyboardPrimarySceneIssues(storyboard));
      if (continuity.previousStoryboardId) {
        const previous = byId.get(continuity.previousStoryboardId);
        if (!previous || previous.continuityState?.groupId !== continuity.groupId || previous.index >= storyboard.index) {
          issues.push({ storyboardId: storyboard.id, code: "continuity.previous", message: `分镜 ${storyboard.id} 上一镜连续关系无效` });
        }
      }
    }
    if (storyboard.stale) {
      stale += 1;
      issues.push({ storyboardId: storyboard.id, code: "continuity.stale", message: storyboard.staleReason || `分镜 ${storyboard.id} 已过期` });
    }
    const review = storyboard.visualReview;
    if (!review) {
      pending += 1;
      issues.push({ storyboardId: storyboard.id, code: "review.missing", message: `分镜 ${storyboard.id} 尚未完成视觉审核` });
    } else if (review.status === "approved") {
      const approvalIssues = approvedVisualReviewIssues(storyboard, review, assetVersions);
      if (approvalIssues.length === 0) approved += 1;
      else {
        pending += 1;
        issues.push(...approvalIssues.filter((approvalIssue) => !issues.some((existingIssue) => (
          existingIssue.storyboardId === approvalIssue.storyboardId
          && existingIssue.code === approvalIssue.code
          && existingIssue.message === approvalIssue.message
        ))));
      }
    } else if (review.status === "rejected") {
      rejected += 1;
      issues.push({ storyboardId: storyboard.id, code: "review.rejected", message: review.reasons.join("；") || `分镜 ${storyboard.id} 视觉审核未通过` });
    } else {
      pending += 1;
      issues.push({ storyboardId: storyboard.id, code: "review.missing", message: `分镜 ${storyboard.id} 等待视觉审核` });
    }
  }
  return { ok: issues.length === 0, issues, approved, pending, rejected, stale };
}

export function assertVisualContinuityApproved(
  storyboards: StoryboardItem[],
  assetVersions: ContinuityAssetVersion[] = [],
) {
  const audit = auditVisualContinuity(storyboards, assetVersions);
  if (!audit.ok) {
    const preview = audit.issues.slice(0, 5).map((issue) => `${issue.storyboardId}: ${issue.message}`).join("；");
    throw new Error(`分镜视觉连续性未通过（${audit.issues.length} 项）：${preview}`);
  }
  return audit;
}

export function approvedVisualReview(overrides: Partial<VisualReviewResult> = {}): VisualReviewResult {
  return {
    status: "approved",
    reasons: [],
    characterChecks: [],
    sceneChecks: [],
    propChecks: [],
    transitionChecks: [],
    textWatermarkCheck: { passed: false },
    reviewer: "human",
    reviewedAt: Date.now(),
    evidencePaths: [],
    inputFingerprint: "",
    ...overrides,
  };
}

export function createHumanVisualReview(
  storyboard: StoryboardItem,
  input: HumanVisualReviewInput,
  assetVersions: ContinuityAssetVersion[] = [],
): VisualReviewResult {
  if (input.status === "rejected" && !input.reasons.some((reason) => reason.trim().length > 0)) {
    throw new Error(`分镜 ${storyboard.id} 驳回时必须填写原因`);
  }
  const review: VisualReviewResult = {
    ...input,
    reasons: input.reasons.map((reason) => reason.trim()).filter(Boolean),
    evidencePaths: input.evidencePaths.map((path) => path.trim()).filter(Boolean),
    reviewer: "human",
    reviewedAt: input.reviewedAt ?? Date.now(),
    inputFingerprint: visualReviewInputFingerprint(storyboard),
  };
  if (review.status === "approved") {
    const issues = approvedVisualReviewIssues(storyboard, review, assetVersions);
    if (issues.length > 0) throw new Error(issues[0]!.message);
  }
  return review;
}

function stableSerialize(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function compactNullishFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested != null));
}
