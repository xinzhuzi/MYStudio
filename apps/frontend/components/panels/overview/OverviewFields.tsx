import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NamedEntity } from "@/types/script";

export type EditableTextProps = {
  value: string | undefined;
  placeholder: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  className?: string;
};

export function EditableText({
  value,
  placeholder,
  onSave,
  multiline = false,
  className = "",
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const startEdit = () => {
    setDraft(value || "");
    setEditing(true);
  };

  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  if (editing) {
    const Comp = multiline ? Textarea : Input;
    return (
      <div className="flex items-start gap-1">
        <Comp
          value={draft}
          onChange={(
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => setDraft(event.target.value)}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Enter" && !multiline) save();
            if (event.key === "Escape") cancel();
          }}
          autoFocus
          className={`text-sm ${multiline ? "min-h-[80px]" : ""} ${className}`}
          placeholder={placeholder}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={save}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={cancel}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`group cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50 transition-colors ${className}`}
      onClick={startEdit}
    >
      <span
        className={`text-sm ${value ? "text-foreground" : "text-muted-foreground italic"}`}
      >
        {value || placeholder}
      </span>
      <Pencil className="h-3 w-3 ml-1 inline opacity-0 group-hover:opacity-50 transition-opacity" />
    </div>
  );
}

export type SectionCardProps = {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
};

export function SectionCard({
  icon: Icon,
  title,
  children,
}: SectionCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      {children}
    </div>
  );
}

export type NamedEntityListProps = {
  items: NamedEntity[] | undefined;
  emptyText: string;
  onUpdate: (items: NamedEntity[]) => void;
};

export function NamedEntityList({
  items,
  emptyText,
  onUpdate,
}: NamedEntityListProps) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-muted-foreground italic">{emptyText}</p>;
  }

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div
          key={`${item.name}-${index}`}
          className="flex items-start gap-2 text-xs"
        >
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {item.name}
          </Badge>
          <EditableText
            value={item.desc}
            placeholder="描述..."
            onSave={(desc) => {
              const next = [...items];
              next[index] = { ...item, desc };
              onUpdate(next);
            }}
            className="flex-1"
          />
        </div>
      ))}
    </div>
  );
}

export type FieldRowProps = {
  label: string;
  children: React.ReactNode;
};

export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-muted-foreground w-16 shrink-0 pt-1">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
