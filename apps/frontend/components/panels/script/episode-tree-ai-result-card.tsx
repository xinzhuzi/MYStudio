import type { ReactNode } from "react";
import { Check, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface EpisodeTreeAIResultCardProps {
  found: boolean;
  message: string;
  children?: ReactNode;
}

export function EpisodeTreeAIResultCard({
  found,
  message,
  children,
}: EpisodeTreeAIResultCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3",
        found
          ? "border-success/50 bg-success/15 dark:bg-success/20"
          : "border-warning/50 bg-warning/15 dark:bg-warning/20",
      )}
    >
      <div className="flex items-start gap-2">
        {found ? (
          <Check className="h-4 w-4 text-success mt-0.5" />
        ) : (
          <MessageSquare className="h-4 w-4 text-warning mt-0.5" />
        )}
        <p className="text-sm">{message}</p>
      </div>
      {children}
    </div>
  );
}
