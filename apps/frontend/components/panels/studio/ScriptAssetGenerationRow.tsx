import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import type { RoleVoiceAssignableCharacter } from "@/components/panels/assets/RoleVoiceAssignDialog";
import { useTtsStore } from "@/stores/tts-store";
import type { TtsSpeakerId } from "@/types/tts";
import { Gem, MapPin, Mic, UserRound } from "lucide-react";
import {
  getRowDescription,
  getRowImage,
  type AssetRow,
} from "./script-asset-generation-model";

export function AssetGenerationRow({
  row,
  onOpenAsset,
  onVoiceAssign,
}: {
  row: AssetRow;
  onOpenAsset: (row: AssetRow) => void;
  onVoiceAssign: (character: RoleVoiceAssignableCharacter) => void;
}) {
  const Icon = row.type === "character" ? UserRound : row.type === "scene" ? MapPin : Gem;
  const image = getRowImage(row);
  const description = getRowDescription(row);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开资产 ${row.name}`}
      onClick={() => onOpenAsset(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenAsset(row);
        }
      }}
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border/80 bg-card/55 p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/40"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {image ? (
          <LocalImage src={image} alt={row.name} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <StatusBadge state={row.asset?.promptState} hasAsset={Boolean(row.asset)} hasImage={Boolean(image)} />
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {description || row.note || "暂无资产描述"}
        </span>
      </span>
      {row.type === "character" ? (
        <span className="flex shrink-0 items-center gap-2">
          <VoiceBadge characterId={row.asset?.id ?? row.id} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onVoiceAssign({
                id: row.asset?.id ?? row.id,
                name: row.name,
                gender: row.asset?.gender,
                age: row.asset?.age,
                personality: row.asset?.personality,
              });
            }}
          >
            <Mic className="h-4 w-4" />
            分配音频
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function VoiceBadge({ characterId }: { characterId: string }) {
  const activeProjectId = useTtsStore((state) => state.activeProjectId);
  const bindings = useTtsStore((state) =>
    activeProjectId ? (state.projects[activeProjectId]?.bindings ?? {}) : {},
  );
  const voiceProfiles = useTtsStore((state) => state.voiceProfiles);
  const speakerId = `character:${characterId}` as TtsSpeakerId;
  const binding = bindings[speakerId];
  const profile = binding ? voiceProfiles[binding.profileId] : undefined;
  if (!profile) return <Badge variant="outline">未分配</Badge>;
  return <Badge variant="secondary">{profile.type === "preset" ? "预设音色" : "音频样本"}</Badge>;
}

function StatusBadge({
  state,
  hasAsset,
  hasImage,
}: {
  state?: string;
  hasAsset: boolean;
  hasImage: boolean;
}) {
  if (!hasAsset) return <Badge variant="outline">待创建</Badge>;
  if (state === "ready" || hasImage) return <Badge variant="secondary">已就绪</Badge>;
  if (state === "polishing") return <Badge variant="outline">润色中</Badge>;
  if (state === "failed") return <Badge variant="outline">失败</Badge>;
  return <Badge variant="outline">待润色</Badge>;
}
