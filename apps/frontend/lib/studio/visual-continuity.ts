import type {
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
    if (!reference.versionId || reference.approved !== true) {
      throw new Error(`分镜 ${storyboardId} 参考资产 ${reference.assetId} 缺少已批准视觉版本`);
    }
    const stableKey = `${reference.assetId}:${reference.versionId}`;
    if (seenAssets.has(stableKey)) {
      throw new Error(`分镜 ${storyboardId} 重复引用视觉版本 ${stableKey}`);
    }
    seenAssets.add(stableKey);
  }
  return ordered;
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
      referenceViewTypes: reference.referenceViewTypes,
      referenceRole: reference.referenceRole,
      wardrobeVersion: reference.wardrobeVersion,
      sceneViewpointId: reference.sceneViewpointId,
    })),
    continuity: storyboard.continuityState
      ? compactNullishFields({ ...storyboard.continuityState, inputFingerprint: undefined })
      : undefined,
  });
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
  if (!review.evidencePaths.some((path) => path.trim().length > 0)) {
    add("review.evidence", `分镜 ${storyboard.id} 缺少审核证据路径`);
  }
  if (review.inputFingerprint !== visualReviewInputFingerprint(storyboard)) {
    add("review.stale", `分镜 ${storyboard.id} 审核输入已变化，必须重新审核`);
  }
  if (storyboard.stale) {
    add("review.stale", storyboard.staleReason || `分镜 ${storyboard.id} 已过期，不能批准`);
  }
  const failedCheck = [
    ...review.characterChecks,
    ...review.sceneChecks,
    ...review.transitionChecks,
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

export function auditVisualContinuity(storyboards: StoryboardItem[]): VisualContinuityAudit {
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
    if (!continuity) {
      issues.push({ storyboardId: storyboard.id, code: "continuity.missing", message: `分镜 ${storyboard.id} 缺少连续镜头状态` });
    } else {
      const expectedFingerprint = visualContinuityFingerprint(storyboard);
      if (continuity.inputFingerprint !== expectedFingerprint) {
        issues.push({ storyboardId: storyboard.id, code: "continuity.stale", message: `分镜 ${storyboard.id} 连续性输入指纹已失效` });
      }
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
      const approvalIssues = approvedVisualReviewIssues(storyboard, review);
      if (approvalIssues.length === 0) approved += 1;
      else {
        pending += 1;
        issues.push(...approvalIssues);
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

export function assertVisualContinuityApproved(storyboards: StoryboardItem[]) {
  const audit = auditVisualContinuity(storyboards);
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
    transitionChecks: [],
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
    const issues = approvedVisualReviewIssues(storyboard, review);
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
