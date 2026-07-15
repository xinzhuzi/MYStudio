import type { ReactNode } from "react";
import { LocalImage } from "@/components/ui/local-image";

export function ImageWorkflowPaletteSection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mb-4">
      <h4 className="mb-2 text-xs font-semibold text-card-foreground">{title}</h4>
      {hasChildren ? (
        <div className="grid grid-cols-2 gap-2">{children}</div>
      ) : (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      )}
    </section>
  );
}

export function ImageWorkflowPaletteImageButton({
  title,
  imageUrl,
  onClick,
}: {
  title: string;
  imageUrl: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group overflow-hidden rounded-md border border-border bg-muted/20 text-left hover:border-cyan-300/50"
      onClick={onClick}
    >
      <div className="aspect-video bg-muted/30">
        <LocalImage src={imageUrl} alt={title} className="h-full w-full object-cover" />
      </div>
      <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground group-hover:text-cyan-500">
        {title}
      </div>
    </button>
  );
}
