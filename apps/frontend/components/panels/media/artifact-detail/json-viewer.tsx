// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/app/theme-store";

// Shared scroll/typography theme — mirrors RefPreview.tsx so JSON blocks across
// the artifact panel and the content-preview tab render identically.
const editorScrollTheme = EditorView.theme({
  ".cm-scroller": { overflowY: "auto" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});

export interface JsonViewerProps {
  /** Value to render. Objects/arrays are pretty-printed; primitives are stringified. */
  value: unknown;
  /** Max height of the editor (e.g. "12rem"). Passed to CodeMirror's maxHeight,
   *  which correctly caps the .cm-editor and enables internal scrolling.
   *  CSS max-height on the wrapper alone is a no-op for CodeMirror. */
  maxHeight?: string;
  className?: string;
}

/**
 * Read-only JSON viewer built on the project's CodeMirror stack
 * (@uiw/react-codemirror + @codemirror/lang-json). Use for structured values
 * (arrays/objects) only — scalar UUIDs/enums should stay in plain <code>.
 */
export function JsonViewer({ value, maxHeight, className }: JsonViewerProps) {
  const theme = useThemeStore((state) => state.theme);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-muted/40", className)}>
      <CodeMirror
        className="w-full"
        value={text}
        maxHeight={maxHeight}
        theme={theme === "dark" ? "dark" : "light"}
        extensions={[jsonLang(), EditorView.lineWrapping, editorScrollTheme]}
        readOnly
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLineGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
