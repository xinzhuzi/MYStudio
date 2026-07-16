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
          ? "border-green-500/50 bg-green-50 dark:bg-green-950/20"
          : "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20",
      )}
    >
      <div className="flex items-start gap-2">
        {found ? (
          <Check className="h-4 w-4 text-green-500 mt-0.5" />
        ) : (
          <MessageSquare className="h-4 w-4 text-amber-500 mt-0.5" />
        )}
        <p className="text-sm">{message}</p>
      </div>
      {children}
    </div>
  );
}
