import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { RoleVoicePreviewButton } from "../assets/RoleVoicePreviewButton";
import { useTtsStore } from "@/stores/tts-store";
import { Gem, Loader2, MapPin, PackagePlus, UserRound } from "lucide-react";
import {
  getRowDescription,
  getRowImage,
  hasRowAsset,
  typeLabel,
  type AssetRow,
  type AssetGenerationType,
} from "./script-asset-generation-model";
import {
  getRoleVoiceSpeakerIds,
  resolveRoleVoiceBinding,
} from "./script-asset-voice-binding";

export function AssetGenerationRow({
  row,
  onOpenAsset,
  onStoreAsset,
  isStoringAssetLibrary,
}: {
  row: AssetRow;
  onOpenAsset: (row: AssetRow) => void;
  onStoreAsset?: (row: AssetRow) => void;
  isStoringAssetLibrary?: boolean;
}) {
  const Icon = row.type === "character" ? UserRound : row.type === "scene" ? MapPin : Gem;
  const image = getRowImage(row);
  const description = getRowDescription(row);
  const roleVoiceSpeakerIds = getRoleVoiceSpeakerIds(row);

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
          <StatusBadge
            type={row.type}
            state={row.asset?.promptState}
            hasAsset={hasRowAsset(row)}
            hasAssetLibrary={Boolean(row.assetLibrary)}
            hasImage={Boolean(image)}
          />
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {description || row.note || "暂无资产描述"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {!row.assetLibrary && onStoreAsset ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5"
            disabled={isStoringAssetLibrary}
            onClick={(event) => {
              event.stopPropagation();
              onStoreAsset(row);
            }}
          >
            {isStoringAssetLibrary ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackagePlus className="h-3.5 w-3.5" />
            )}
            {isStoringAssetLibrary ? "入库中" : "放入资产库"}
          </Button>
        ) : null}
        {row.type === "character" ? (
          <>
            <VoiceBadge speakerIds={roleVoiceSpeakerIds} />
            <RoleVoicePreviewControl speakerIds={roleVoiceSpeakerIds} characterName={row.name} />
          </>
        ) : null}
      </span>
    </div>
  );
}

function VoiceBadge({ speakerIds }: { speakerIds: ReturnType<typeof getRoleVoiceSpeakerIds> }) {
  const activeProjectId = useTtsStore((state) => state.activeProjectId);
  const bindings = useTtsStore((state) =>
    activeProjectId ? (state.projects[activeProjectId]?.bindings ?? {}) : {},
  );
  const voiceProfiles = useTtsStore((state) => state.voiceProfiles);
  const resolution = resolveRoleVoiceBinding(speakerIds, bindings, voiceProfiles);
  if (resolution.state === "unassigned") {
    return (
      <Badge
        variant="outline"
        className="border-destructive/60 bg-destructive/10 text-destructive"
      >
        未分配音色
      </Badge>
    );
  }
  if (resolution.state === "missing-profile") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        title={`音色绑定指向不存在的 profile：${resolution.profileId}`}
      >
        音色异常
      </Badge>
    );
  }
  return <Badge variant="secondary">{resolution.profile.type === "preset" ? "预设音色" : "参考音频"}</Badge>;
}

function RoleVoicePreviewControl({
  speakerIds,
  characterName,
}: {
  speakerIds: ReturnType<typeof getRoleVoiceSpeakerIds>;
  characterName: string;
}) {
  const activeProjectId = useTtsStore((state) => state.activeProjectId);
  const bindings = useTtsStore((state) =>
    activeProjectId ? (state.projects[activeProjectId]?.bindings ?? {}) : {},
  );
  const voiceProfiles = useTtsStore((state) => state.voiceProfiles);
  const resolution = resolveRoleVoiceBinding(speakerIds, bindings, voiceProfiles);
  if (resolution.state !== "assigned") return null;
  return (
    <RoleVoicePreviewButton
      profileId={resolution.profile.id}
      characterName={characterName}
      defaultEngine={resolution.binding.defaultEngine}
      defaultModelSize={resolution.binding.defaultModelSize}
      className="mt-0 h-7 w-auto px-2.5"
      stopPropagation
    />
  );
}

function StatusBadge({
  type,
  state,
  hasAsset,
  hasAssetLibrary,
  hasImage,
}: {
  type: AssetGenerationType;
  state?: string;
  hasAsset: boolean;
  hasAssetLibrary: boolean;
  hasImage: boolean;
}) {
  if (!hasAsset) {
    return (
      <Badge
        variant="outline"
        className="border-destructive/60 bg-destructive/10 text-destructive"
      >
        缺少{typeLabel(type)}资产
      </Badge>
    );
  }
  if (hasAssetLibrary) return <Badge variant="secondary">资产库已存在</Badge>;
  if (state === "ready" || hasImage) return <Badge variant="secondary">已就绪</Badge>;
  if (state === "polishing") return <Badge variant="outline">润色中</Badge>;
  if (state === "failed") return <Badge variant="outline">失败</Badge>;
  return <Badge variant="outline">待润色</Badge>;
}
