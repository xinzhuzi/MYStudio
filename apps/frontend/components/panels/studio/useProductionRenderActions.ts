import { useCallback, useMemo, useState } from "react";
import {
  createEpisodeMergePlan,
  createTrackRenderPlan,
} from "@/lib/studio/production";
import { useStudioStore } from "@/stores/studio-store";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import { toast } from "sonner";
import { resolveProductionEpisodeId } from "./workflow-helpers";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

export function useProductionRenderActions({
  productionTracks,
  storyboards,
  videoCandidates,
  addVideoCandidate,
  updateVideoCandidate,
  selectVideoCandidate,
  saveAgentWorkData,
}: {
  productionTracks: ProductionTrack[];
  storyboards: StoryboardItem[];
  videoCandidates: VideoCandidate[];
  addVideoCandidate: StudioStore["addVideoCandidate"];
  updateVideoCandidate: StudioStore["updateVideoCandidate"];
  selectVideoCandidate: StudioStore["selectVideoCandidate"];
  saveAgentWorkData: StudioStore["saveAgentWorkData"];
}) {
  const [renderingTrackId, setRenderingTrackId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeOutput, setMergeOutput] = useState<string | null>(null);

  const selectedCandidates = useMemo(
    () =>
      productionTracks
        .map((track) =>
          videoCandidates.find(
            (candidate) => candidate.id === track.selectedVideoId,
          ),
        )
        .filter((candidate): candidate is VideoCandidate =>
          Boolean(candidate),
        ),
    [productionTracks, videoCandidates],
  );

  const handleRenderTrack = useCallback(
    async (trackId: string) => {
      const track = productionTracks.find((item) => item.id === trackId);
      if (!track) return;

      let candidateId = "";
      try {
        const plan = createTrackRenderPlan(track, storyboards);
        candidateId = addVideoCandidate({
          trackId,
          provider: "ffmpeg-local",
          state: "rendering",
        });
        setRenderingTrackId(trackId);

        const result = await window.studioRenderer?.renderTrackCandidate(plan);
        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || "本地 FFmpeg 合成失败");
        }

        updateVideoCandidate(candidateId, {
          state: "ready",
          filePath: result.filePath,
        });
        selectVideoCandidate(trackId, candidateId);
        toast.success("候选片段已生成");
      } catch (error) {
        if (candidateId) {
          updateVideoCandidate(candidateId, {
            state: "failed",
            errorReason: error instanceof Error ? error.message : String(error),
          });
        }
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setRenderingTrackId(null);
      }
    },
    [
      addVideoCandidate,
      productionTracks,
      selectVideoCandidate,
      storyboards,
      updateVideoCandidate,
    ],
  );

  const handleMergeEpisode = useCallback(async () => {
    try {
      setMerging(true);
      const plan = createEpisodeMergePlan(selectedCandidates);
      const result = await window.studioRenderer?.mergeEpisode(plan);
      if (!result?.success || !result.filePath) {
        throw new Error(result?.error || "成片拼接失败");
      }
      setMergeOutput(result.filePath);
      const episodeId =
        productionTracks.find((track) =>
          selectedCandidates.some(
            (candidate) => candidate.trackId === track.id,
          ),
        )?.episodeId ?? resolveProductionEpisodeId(useStudioStore.getState());
      saveAgentWorkData(
        "productionPlan",
        `本地成片输出: ${result.filePath}`,
        episodeId,
      );
      toast.success("成片已拼接完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMerging(false);
    }
  }, [productionTracks, saveAgentWorkData, selectedCandidates]);

  return {
    renderingTrackId,
    merging,
    mergeOutput,
    handleRenderTrack,
    handleMergeEpisode,
  };
}
