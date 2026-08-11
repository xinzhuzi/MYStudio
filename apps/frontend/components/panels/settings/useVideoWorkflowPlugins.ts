import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  VideoWorkflowActionReplyV1,
  VideoWorkflowPluginActionRequestV1,
  VideoWorkflowReviewReplyV1,
  VideoWorkflowReviewRequestV1,
  VideoWorkflowStatusReplyV1,
} from "@rendering/contracts/video-workflow-ipc";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";

type PluginAction = "prepare" | "update" | "repair" | "rollback";

function caughtMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useVideoWorkflowPlugins() {
  const [status, setStatus] = useState<VideoWorkflowStatusReplyV1>();
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<{ pluginId: VideoWorkflowPluginId; action: PluginAction }>();
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const applyReply = useCallback((reply: VideoWorkflowStatusReplyV1 | VideoWorkflowActionReplyV1) => {
    if (!mountedRef.current) return;
    setStatus(reply);
    setError("success" in reply && reply.success === false ? reply.message ?? "视频工作流插件操作未完成" : undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!bridge || loadingRef.current) return undefined;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const next = await bridge.status();
      applyReply(next);
      return next;
    } catch (errorValue) {
      if (mountedRef.current) setError(caughtMessage(errorValue));
      return undefined;
    } finally {
      if (mountedRef.current) setIsLoading(false);
      loadingRef.current = false;
    }
  }, [applyReply, bridge]);

  const runAction = useCallback(async (pluginId: VideoWorkflowPluginId, action: PluginAction) => {
    if (!bridge || busyAction) return undefined;
    setBusyAction({ pluginId, action });
    try {
      const request: VideoWorkflowPluginActionRequestV1 = { pluginId };
      const reply = action === "prepare"
        ? await bridge.prepare(request)
        : action === "update"
          ? await bridge.update(request)
          : action === "repair"
            ? await bridge.repair(request)
            : await bridge.rollback(request);
      applyReply(reply);
      return reply;
    } catch (errorValue) {
      if (mountedRef.current) setError(caughtMessage(errorValue));
      return undefined;
    } finally {
      if (mountedRef.current) setBusyAction(undefined);
    }
  }, [applyReply, bridge, busyAction]);

  const prepareCurrentWorkflow = useCallback(async () => {
    // video-use remains the first workflow stage. Remotion's explicit browser
    // preparation runs before HyperFrames only because HyperFrames first tries
    // to reuse that already-verified Headless Shell; formal ChapterVideo
    // rendering still happens after HyperFrames artifacts are accepted.
    const ordered: VideoWorkflowPluginId[] = ["video-use", "remotion", "hyperframes"];
    let latest: VideoWorkflowActionReplyV1 | undefined;
    for (const pluginId of ordered) {
      const reply = await runAction(pluginId, "prepare");
      if (!reply || !reply.success) break;
      latest = reply;
    }
    return latest;
  }, [runAction]);

  const review = useCallback(async (request: VideoWorkflowReviewRequestV1): Promise<VideoWorkflowReviewReplyV1 | undefined> => {
    if (!bridge?.review) {
      if (mountedRef.current) setError("当前环境不支持 video-use 用户确认");
      return undefined;
    }
    try {
      const reply = await bridge.review(request);
      if (mountedRef.current) setError(reply.success ? undefined : reply.message ?? "video-use 用户确认未完成");
      return reply;
    } catch (errorValue) {
      if (mountedRef.current) setError(caughtMessage(errorValue));
      return undefined;
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

// eslint-disable-next-line react-hooks/exhaustive-deps
  const plugins = status?.plugins ?? [];
  const pluginById = useMemo(() => new Map(plugins.map((plugin) => [plugin.pluginId, plugin])), [plugins]);
  const getPlugin = useCallback((pluginId: VideoWorkflowPluginId): VideoWorkflowPluginStatusV1 | undefined => pluginById.get(pluginId), [pluginById]);

  return {
    plugins,
    getPlugin,
    status,
    error,
    isLoading,
    isBusy: isLoading || Boolean(busyAction),
    busyAction,
    refresh,
    prepare: (pluginId: VideoWorkflowPluginId) => runAction(pluginId, "prepare"),
    update: (pluginId: VideoWorkflowPluginId) => runAction(pluginId, "update"),
    repair: (pluginId: VideoWorkflowPluginId) => runAction(pluginId, "repair"),
    rollback: (pluginId: VideoWorkflowPluginId) => runAction(pluginId, "rollback"),
    review,
    prepareCurrentWorkflow,
  };
}
