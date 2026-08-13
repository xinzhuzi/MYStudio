import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileWarning, Loader2 } from "lucide-react";
import type { PhysicalRef } from "@/types/artifacts";
import { useThemeStore } from "@/stores/app/theme-store";
import { resolveRefPreview, toFileUrl, type ResolvedRefPreview } from "@/lib/artifacts/ref-preview-loader";

const editorScrollTheme = EditorView.theme({
  ".cm-scroller": { overflowY: "auto" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});

/**
 * Render a PhysicalRef's content inline based on its preview mode.
 *
 * Loads the resolved preview descriptor via resolveRefPreview (IPC) and renders
 * the appropriate viewer: <img> for images, ReactMarkdown for .md, CodeMirror
 * readOnly for .json/.text, <audio>/<video> for media, or a binary fallback.
 */
export interface RefPreviewProps {
  /** The physical reference to preview. Named `physicalRef` (not `ref`) because
   *  `ref` is a React reserved prop — using it here would cause React to attach
   *  the value to the fiber as a DOM ref instead of passing it through props,
   *  silently dropping it (the original "无效的物理文件引用" bug). */
  physicalRef: PhysicalRef;
  projectId: string;
  className?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; result: ResolvedRefPreview }
  | { status: "error"; message: string };

export function RefPreview({ physicalRef, projectId, className }: RefPreviewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const theme = useThemeStore((state) => state.theme);

  const safePath = physicalRef?.path;
  const safeType = physicalRef?.type;

  useEffect(() => {
    // Defensive: a caller may pass an undefined ref (e.g. a malformed
    // physicalRefs entry or a state race). Dereferencing physicalRef.path in
    // the deps array below would throw "reading 'path'" during render and
    // crash the whole renderer. Guard here so the component degrades to an
    // error UI instead of taking down the app.
    if (!physicalRef || typeof safePath !== "string") {
      setState({ status: "error", message: "无效的物理文件引用" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    resolveRefPreview(physicalRef, projectId)
      .then((result) => { if (!cancelled) setState({ status: "ready", result }); })
      .catch(() => {
        // resolveRefPreview already has a catch-all that returns binary mode,
        // so reaching this catch is truly unexpected. Degrade calmly instead
        // of showing a red error UI.
        if (!cancelled) {
          setState({ status: "ready", result: { mode: "binary", message: "该内容为二进制格式,无法预览" } });
        }
      });
    return () => { cancelled = true; };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePath, safeType, projectId]);

  if (state.status === "loading") {
    return (
      <div className={className ?? "flex h-full items-center justify-center text-muted-foreground"}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">加载预览…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={className ?? "flex h-full items-center justify-center text-muted-foreground"}>
        <div className="text-center">
          <FileWarning className="mx-auto mb-2 h-8 w-8" />
          <p className="text-sm">{state.message}</p>
        </div>
      </div>
    );
  }

  const result = state.result;
  const containerClass = className ?? "h-full overflow-auto scrollbar-thin";

  if (result.mode === "binary") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileWarning className="mx-auto mb-2 h-8 w-8" />
          <p className="text-sm">{result.message}</p>
        </div>
      </div>
    );
  }

  if (result.mode === "image") {
    return (
      <div className="flex h-full items-center justify-center bg-black/5 p-4 dark:bg-black/20">
        <img
          src={result.dataUrl}
          alt={safePath ?? ""}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  if (result.mode === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <audio controls src={toFileUrl(result.absolutePath)} className="w-full max-w-md" />
        <p className="truncate text-xs text-muted-foreground" title={safePath ?? ""}>{safePath}</p>
      </div>
    );
  }

  if (result.mode === "video") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <video
          controls
          src={toFileUrl(result.absolutePath)}
          className="max-h-full max-w-full"
        />
        <p className="truncate text-xs text-muted-foreground" title={safePath ?? ""}>{safePath}</p>
      </div>
    );
  }

  if (result.mode === "markdown") {
    return (
      <div className={`${containerClass} p-5 text-sm leading-7`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-2 text-lg font-semibold">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 text-base font-semibold">{children}</h3>,
            p: ({ children }) => <p className="mb-3 text-foreground/90">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
            code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
            pre: ({ children }) => <pre className="mb-3 overflow-auto rounded bg-muted p-3 text-xs">{children}</pre>,
          }}
        >
          {result.text}
        </ReactMarkdown>
        {result.truncated && (
          <p className="mt-4 text-xs italic text-muted-foreground">内容过长已截断(仅显示前 256KB)。</p>
        )}
      </div>
    );
  }

  if (result.mode !== "json" && result.mode !== "text") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileWarning className="mx-auto mb-2 h-8 w-8" />
          <p className="text-sm">该文件类型暂不支持文本预览</p>
        </div>
      </div>
    );
  }

  // json | text — CodeMirror readOnly
  const isJson = result.mode === "json";
  return (
    <div className={containerClass}>
      <div className="h-full min-h-0 overflow-hidden rounded-md border border-border">
        <CodeMirror
          className="h-full"
          value={result.text}
          height="100%"
          theme={theme === "dark" ? "dark" : "light"}
          extensions={[isJson ? jsonLang() : [], EditorView.lineWrapping, editorScrollTheme]}
          readOnly
          editable={false}
        />
      </div>
      {result.truncated && (
        <p className="px-3 py-2 text-xs italic text-muted-foreground">内容过长已截断(仅显示前 256KB)。</p>
      )}
    </div>
  );
}
