import type {
  RemotionChapterGateInputV1,
  RemotionChapterGateResult,
} from "@rendering/contracts/video-workflow";

export function evaluateRemotionChapterGate(
  input: RemotionChapterGateInputV1,
): RemotionChapterGateResult {
  const videoUse = input.videoUseArtifact;
  const videoUseInputSha256 = input.videoUseInputSha256 ?? input.inputSha256;
  if (!videoUse) {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-missing",
      message: "正式章节渲染前缺少 video-use artifact",
    };
  }
  if (videoUse.status !== "accepted" || videoUse.stage !== "ready") {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-not-accepted",
      message: "video-use artifact 必须是 ready/accepted",
    };
  }
  if (videoUse.projectId !== input.projectId || videoUse.chapterId !== input.chapterId || videoUse.revision !== input.revision) {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-identity-mismatch",
      message: "video-use artifact 的 project/chapter/revision 与当前章节不一致",
    };
  }
  if (videoUse.evidence.inputSha256 !== videoUseInputSha256) {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-input-drift",
      message: "video-use artifact 输入指纹已漂移",
    };
  }
  const review = videoUse.review;
  if (!review) {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-review-missing",
      message: "video-use accepted artifact 缺少用户确认 review sidecar",
    };
  }
  if (review.projectId !== input.projectId || review.chapterId !== input.chapterId || review.revision !== input.revision || review.decision !== "accepted" || review.artifactSha256 !== videoUse.evidence.artifactSha256 || typeof review.reviewer !== "string" || review.reviewer.length === 0 || !Number.isFinite(review.timestamp) || review.timestamp <= 0) {
    return {
      accepted: false,
      state: "blocked",
      code: "video-use-review-invalid",
      message: "video-use review sidecar 未绑定当前章节 artifact 或确认信息无效",
    };
  }

  const hyperFrames = input.hyperFramesArtifact;
  if (!hyperFrames) {
    return {
      accepted: false,
      state: "blocked",
      code: "hyperframes-missing",
      message: "正式章节渲染前缺少 HyperFrames overlay/no-op artifact",
    };
  }
  if (hyperFrames.status !== "accepted" && hyperFrames.status !== "noop") {
    return {
      accepted: false,
      state: "blocked",
      code: "hyperframes-not-accepted",
      message: "HyperFrames artifact 必须是 accepted 或 noop",
    };
  }
  if (hyperFrames.projectId !== input.projectId || hyperFrames.chapterId !== input.chapterId || hyperFrames.revision !== input.revision) {
    return {
      accepted: false,
      state: "blocked",
      code: "hyperframes-identity-mismatch",
      message: "HyperFrames artifact 的 project/chapter/revision 与当前章节不一致",
    };
  }
  if (hyperFrames.inputSha256 !== videoUseInputSha256 || hyperFrames.sourceArtifactSha256 !== videoUse.evidence.artifactSha256) {
    return {
      accepted: false,
      state: "blocked",
      code: "hyperframes-input-drift",
      message: "HyperFrames artifact 未绑定当前章节输入或 video-use artifact",
    };
  }
  return {
    accepted: true,
    mode: videoUse.mode,
    videoUseArtifactSha256: videoUse.evidence.artifactSha256,
    hyperFramesStatus: hyperFrames.status,
    ...(hyperFrames.outputPath ? { hyperFramesOutputPath: hyperFrames.outputPath } : {}),
    ...(hyperFrames.outputPath && hyperFrames.outputSha256 ? { hyperFramesOutputSha256: hyperFrames.outputSha256 } : {}),
    ...(hyperFrames.outputPath ? { hyperFramesAlphaFormat: hyperFrames.alphaFormat } : {}),
    ...(hyperFrames.outputPath ? { hyperFramesWindows: hyperFrames.windows } : {}),
    ...(videoUse.mode === "flat-shot-mp4" && videoUse.flatShotMp4Path
      ? { videoUseFlatShotMp4Path: videoUse.flatShotMp4Path }
      : {}),
    ...(videoUse.mode === "flat-shot-mp4" && videoUse.flatShotMp4Sha256
      ? { videoUseFlatShotMp4Sha256: videoUse.flatShotMp4Sha256 }
      : {}),
    ...(videoUse.derivedInputs ? { videoUseDerivedInputs: videoUse.derivedInputs } : {}),
  };
}
