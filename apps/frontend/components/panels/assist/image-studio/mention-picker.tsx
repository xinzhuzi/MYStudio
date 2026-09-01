import { useEffect, useRef } from "react";
import { Image as ImageIcon, Type } from "lucide-react";
import { LocalImage } from "@/components/ui/local-image";
import { withThumbVariant } from "@/lib/media/preview-src";
import { filterMentionCandidates, type MentionCandidate } from "@/lib/studio/image-workflow/mention-token";

/**
 * @引用浮层(09-02-at-mention-refs):输入 @ 触发,列出连线资源;
 * 图片真缩略图;键盘 ↑↓/Enter/ESC。交互形态参考对方,实现从零(AGPL)。
 */
export function MentionPicker({
  x,
  y,
  query,
  candidates,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  query: string;
  candidates: readonly MentionCandidate[];
  onPick: (candidate: MentionCandidate) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const filtered = filterMentionCandidates(candidates, query);

  useEffect(() => {
    firstRef.current?.focus();
  }, [filtered.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label="引用资源"
      className="absolute z-50 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg backdrop-blur-md"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-option]"),
        );
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        buttons[(current + delta + buttons.length) % buttons.length]?.focus();
      }}
    >
      {filtered.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected
          data-option
          ref={index === 0 ? firstRef : undefined}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
          onClick={() => onPick(candidate)}
        >
          {candidate.thumbUrl ? (
            <LocalImage
              src={withThumbVariant(candidate.thumbUrl)}
              alt={candidate.title}
              className="h-9 w-9 shrink-0 rounded-md object-cover"
              eager
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted/50">
              {candidate.type === "generated" ? <ImageIcon className="h-4 w-4 text-muted-foreground" /> : <Type className="h-4 w-4 text-muted-foreground" />}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-popover-foreground">{candidate.title}</span>
            {candidate.summary ? (
              <span className="block truncate text-xs text-muted-foreground">{candidate.summary}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
