import { useEffect, useState } from "react";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import type { EditingProjectV1 } from "@/types/editing";
import type { CompositionProps } from "@rendering/plugins/remotion/composition/composition-props";
import {
  createTimelineRenderRequest,
  type TimelineRendererId,
} from "@rendering/contracts/timeline-renderer";
import {
  routeTimelineRenderer,
  type TimelineRendererRouteDecision,
} from "@rendering/runtime/renderer-router";

export interface RemotionPlayerPreviewState {
  status: "idle" | "loading" | "ready" | "fallback" | "error";
  composition?: CompositionProps;
  decision?: TimelineRendererRouteDecision;
  error?: string;
}

const IDLE_STATE: RemotionPlayerPreviewState = { status: "idle" };

export function useRemotionPlayerPreview(
  project: EditingProjectV1 | undefined,
  requestedRenderer: TimelineRendererId,
): RemotionPlayerPreviewState {
  const [state, setState] = useState<RemotionPlayerPreviewState>(IDLE_STATE);

  useEffect(() => {
    if (!project || requestedRenderer !== "remotion") {
      setState(IDLE_STATE);
      return undefined;
    }
    const compiled = compileTimelineRenderPlan(project, {
      jobId: `preview-${project.id}-${project.revision}`,
      createdAt: project.updatedAt,
    });
    if (!compiled.success) {
      setState({
        status: "error",
        error: compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      });
      return undefined;
    }
    const route = routeTimelineRenderer(
      createTimelineRenderRequest(requestedRenderer, compiled.value),
    );
    if (!route.success) {
      setState({ status: "error", error: route.message });
      return undefined;
    }
    if (route.decision.actual !== "remotion") {
      setState({ status: "fallback", decision: route.decision });
      return undefined;
    }
    const bridge = window.remotionPreview;
    if (!bridge) {
      setState({ status: "error", error: "Remotion Player 预览仅在桌面应用中可用" });
      return undefined;
    }

    let disposed = false;
    let sessionId: string | undefined;
    setState({ status: "loading", decision: route.decision });
    void bridge.create(compiled.value).then((preview) => {
      sessionId = preview.sessionId;
      if (disposed) {
        void bridge.release(preview.sessionId).catch(() => undefined);
        return;
      }
      setState({
        status: "ready",
        composition: preview.composition,
        decision: route.decision,
      });
    }).catch((error: unknown) => {
      if (!disposed) {
        setState({
          status: "error",
          decision: route.decision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      disposed = true;
      if (sessionId) void bridge.release(sessionId).catch(() => undefined);
    };
  }, [project, requestedRenderer]);

  return state;
}
