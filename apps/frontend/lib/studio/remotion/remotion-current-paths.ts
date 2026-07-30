import type {
  RemotionCurrentSlotPathsV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";

export function remotionCurrentSlotPaths(target: RemotionRenderJobTarget): RemotionCurrentSlotPathsV1 {
  if (target.kind === "shot") {
    return {
      jobPath: `jobs/shot/${target.chapterId}/${target.shotId}/current.json`,
      evidencePath: `evidence/shots/${target.chapterId}/${target.shotId}/current.json`,
      outputPath: `outputs/shots/${target.chapterId}/${target.shotId}/current.mp4`,
    };
  }
  return {
    jobPath: `jobs/chapter/${target.chapterId}/current.json`,
    evidencePath: `evidence/chapters/${target.chapterId}/current.json`,
    outputPath: `outputs/chapters/${target.chapterId}/current.mp4`,
  };
}
