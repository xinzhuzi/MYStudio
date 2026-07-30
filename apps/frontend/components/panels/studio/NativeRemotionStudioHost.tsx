import { useEffect, useState } from "react";
import type { RemotionStudioEnsureSessionReply } from "@/electron/ipc/studio/remotion-studio-ipc";
import { useEditingStore } from "@/stores/editing/editing-store";

type NativeRemotionStudioHostProps = {
  projectId?: string;
  chapterId?: string;
  revision?: number;
};

type HostState =
  | { status: "loading" }
  | { status: "blocked" | "failed"; message: string }
  | { status: "ready"; session: Extract<RemotionStudioEnsureSessionReply, { status: "ready" }> };

/** Thin Electron host for the native Remotion Studio page. */
export function NativeRemotionStudioHost({ projectId, chapterId, revision }: NativeRemotionStudioHostProps) {
  const [state, setState] = useState<HostState>(() => missingIdentity(projectId, chapterId, revision));

  useEffect(() => {
    const request = projectId && chapterId && Number.isInteger(revision) && revision! > 0
      ? { projectId, chapterId, revision: revision! }
      : null;
    if (!request) {
      setState(missingIdentity(projectId, chapterId, revision));
      return;
    }
    if (!window.remotionStudio) {
      setState({ status: "blocked", message: "原生 Remotion Studio 仅在桌面应用中可用" });
      return;
    }
    let canceled = false;
    setState({ status: "loading" });
    window.remotionStudio.ensureSession(request)
      .then((reply) => { if (!canceled) setState(reply.status === "ready" ? { status: "ready", session: reply } : reply); })
      .catch((error: unknown) => {
        if (!canceled) setState({ status: "failed", message: error instanceof Error ? error.message : "Studio 会话启动失败" });
      });
    return () => { canceled = true; };
  }, [projectId, chapterId, revision]);

  useEffect(() => {
    if (!window.remotionStudio?.onEditingUpdated) return;
    return window.remotionStudio.onEditingUpdated((event) => {
      if (event.projectId !== projectId || event.chapterId !== chapterId) return;
      void useEditingStore.persist.rehydrate();
    });
  }, [projectId, chapterId]);

  if (state.status === "ready") {
    return <iframe title="原生 Remotion Studio" src={state.session.url} className="h-[72vh] w-full rounded-lg border border-border bg-background" />;
  }
  return (
    <section aria-label="原生 Remotion Studio" className="rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="font-semibold">原生 Remotion Studio</h2>
      <p className="mt-2 text-muted-foreground">
        {state.status === "loading" ? "正在准备当前章节的原生 Studio 会话…" : state.message}
      </p>
    </section>
  );
}

function missingIdentity(projectId?: string, chapterId?: string, revision?: number): HostState {
  return projectId && chapterId && revision === 0
    ? { status: "blocked", message: "当前章节尚未生成可编辑 revision" }
    : { status: "blocked", message: "请先选择项目、章节并生成可编辑 revision" };
}
