/**
 * Legacy track/merge actions are intentionally unavailable.
 *
 * Chapter production is owned by the Remotion queue and the native Studio
 * ChapterVideo export.  This compatibility-shaped return value keeps old
 * callers from silently starting a second renderer while the migration
 * inventory is being closed.
 */
export function useProductionRenderActions() {
  return {
    renderingTrackId: null,
    merging: false,
    mergeOutput: null,
    handleRenderTrack: async () => {
      throw new Error("旧轨道渲染已停用，请使用 Remotion 分镜队列");
    },
    handleMergeEpisode: async () => {
      throw new Error("旧章节拼接已停用，请从原生 Remotion Studio 导出 ChapterVideo");
    },
  } as const;
}
