import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Boxes, ChevronDown, FileText, WandSparkles } from "lucide-react";

export type AssetType = "character" | "scene" | "prop";
export type AssetStatus = "missing" | "exists" | "made";

type Chapter = {
  id: string;
  index: number;
  title: string;
};

type AssetBatch = {
  id: string;
  episodeId: string;
  characters: { characterId: string; name: string; aliases: string[]; note?: string }[];
  scenes: { sceneId: string; name: string; note?: string }[];
  props: { assetId: string; name: string; note?: string }[];
};

type AddingState = {
  episodeId: string;
  type: AssetType;
} | null;

export function AssetsBatchCard({
  mode,
  chapter,
  batch,
  script,
  open,
  extractingId,
  adding,
  addValue,
  onToggle,
  onRun,
  onCreateMissingAssets,
  onRemoveAsset,
  onSubmitAdd,
  onStartAdd,
  onCancelAdd,
  onAddValueChange,
  getAssetStatus,
}: {
  mode: "extract" | "manage";
  chapter: Chapter;
  batch?: AssetBatch;
  script?: string;
  open: boolean;
  extractingId: string | null;
  adding: AddingState;
  addValue: string;
  onToggle: (chapterId: string) => void;
  onRun: (chapterId: string) => void;
  onCreateMissingAssets: (batch: AssetBatch) => void;
  onRemoveAsset: (batch: AssetBatch, type: AssetType, id: string) => void;
  onSubmitAdd: (batch: AssetBatch) => void;
  onStartAdd: (episodeId: string, type: AssetType) => void;
  onCancelAdd: () => void;
  onAddValueChange: (value: string) => void;
  getAssetStatus: (type: AssetType, name: string, note?: string) => AssetStatus;
}) {
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  return (
    <Card className="rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
        <button
          type="button"
          aria-label={`${open ? "收起" : "展开"} ${chapter.index}. ${chapter.title}`}
          className="flex min-w-0 items-center gap-2 text-left rounded-md"
          onClick={() => onToggle(chapter.id)}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
          <CardTitle className="truncate text-sm">
            {chapter.index}. {chapter.title}
          </CardTitle>
          {batch ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              （角色 {batch.characters.length} / 场景 {batch.scenes.length} / 道具{" "}
              {batch.props.length}）
            </span>
          ) : !script ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              （暂无剧本）
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {mode !== "manage" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!script}
              onClick={() => setScriptDialogOpen(true)}
            >
              <FileText className="h-4 w-4" />
              剧本内容
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!script || extractingId !== null}
            onClick={() => onRun(chapter.id)}
          >
            <Boxes className="h-4 w-4" />
            {extractingId === chapter.id
              ? "提取中…"
              : batch && mode !== "manage"
                ? "重新提取资产"
                : mode === "manage"
                  ? "同步提取结果"
                  : "提取资产"}
          </Button>
          {mode === "manage" && batch ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onCreateMissingAssets(batch)}
            >
              <WandSparkles className="h-4 w-4" />
              创建缺失资产
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-xs">
          {!batch ? (
            <p className="text-muted-foreground">
              {script
                ? "尚未提取。点「提取资产」从本章剧本抽取角色/场景/道具。"
                : "本章暂无剧本，无法提取资产。"}
            </p>
          ) : (
            <>
              <AssetCategory
                batch={batch}
                type="character"
                label="角色"
                items={batch.characters.map((character) => ({
                  id: character.characterId,
                  name: character.name,
                  note: character.note,
                }))}
                adding={adding}
                addValue={addValue}
                onRemoveAsset={onRemoveAsset}
                onSubmitAdd={onSubmitAdd}
                onStartAdd={onStartAdd}
                onCancelAdd={onCancelAdd}
                onAddValueChange={onAddValueChange}
                getAssetStatus={getAssetStatus}
              />
              <AssetCategory
                batch={batch}
                type="scene"
                label="场景"
                items={batch.scenes.map((scene) => ({
                  id: scene.sceneId,
                  name: scene.name,
                  note: scene.note,
                }))}
                adding={adding}
                addValue={addValue}
                onRemoveAsset={onRemoveAsset}
                onSubmitAdd={onSubmitAdd}
                onStartAdd={onStartAdd}
                onCancelAdd={onCancelAdd}
                onAddValueChange={onAddValueChange}
                getAssetStatus={getAssetStatus}
              />
              <AssetCategory
                batch={batch}
                type="prop"
                label="道具"
                items={batch.props.map((prop) => ({
                  id: prop.assetId,
                  name: prop.name,
                  note: prop.note,
                }))}
                adding={adding}
                addValue={addValue}
                onRemoveAsset={onRemoveAsset}
                onSubmitAdd={onSubmitAdd}
                onStartAdd={onStartAdd}
                onCancelAdd={onCancelAdd}
                onAddValueChange={onAddValueChange}
                getAssetStatus={getAssetStatus}
              />
            </>
          )}
        </CardContent>
      )}

      <Dialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen}>
        <DialogContent className="max-h-[80vh] w-[min(760px,92vw)]">
          <DialogHeader>
            <DialogTitle className="truncate">
              剧本内容 · {chapter.index}. {chapter.title}
            </DialogTitle>
            <DialogDescription>
              {script ? "本章剧本全文（只读）" : "本章暂无剧本"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {script || "本章暂无剧本：请先在「剧本生产阶段」生成本章剧本。"}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AssetCategory({
  batch,
  type,
  label,
  items,
  adding,
  addValue,
  onRemoveAsset,
  onSubmitAdd,
  onStartAdd,
  onCancelAdd,
  onAddValueChange,
  getAssetStatus,
}: {
  batch: AssetBatch;
  type: AssetType;
  label: string;
  items: { id: string; name: string; note?: string }[];
  adding: AddingState;
  addValue: string;
  onRemoveAsset: (batch: AssetBatch, type: AssetType, id: string) => void;
  onSubmitAdd: (batch: AssetBatch) => void;
  onStartAdd: (episodeId: string, type: AssetType) => void;
  onCancelAdd: () => void;
  onAddValueChange: (value: string) => void;
  getAssetStatus: (type: AssetType, name: string, note?: string) => AssetStatus;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-8 shrink-0 pt-1 font-medium">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {items.map(({ id, name, note }) => {
          const status = getAssetStatus(type, name, note);
          const badgeClass = cn(
            "font-normal",
            status === "missing" && "border-destructive text-destructive",
            status === "exists" &&
              "border-warning/40 text-warning",
          );
          const title =
            status === "made"
              ? "已制作"
              : status === "exists"
                ? "资产库已有，尚未生成图片"
                : "资产库中不存在，请先创建";
          return (
            <span key={id} className="group relative inline-flex">
              <Badge
                variant={status === "made" ? "secondary" : "outline"}
                className={badgeClass}
                title={title}
              >
                {name}
              </Badge>
              <button
                type="button"
                aria-label={`删除${label} ${name}`}
                title="删除"
                onClick={() => onRemoveAsset(batch, type, id)}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold leading-none text-destructive-foreground shadow group-hover:flex"
              >
                ×
              </button>
            </span>
          );
        })}
        {adding?.episodeId === batch.episodeId && adding.type === type ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              value={addValue}
              onChange={(event) => onAddValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmitAdd(batch);
                if (event.key === "Escape") onCancelAdd();
              }}
              className="h-6 w-28 text-xs"
              placeholder={`新${label}`}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2"
              onClick={() => onSubmitAdd(batch)}
            >
              确定
            </Button>
          </span>
        ) : (
          <button
            type="button"
            className="text-xs text-primary hover:underline rounded-md"
            onClick={() => onStartAdd(batch.episodeId, type)}
          >
            + 添加
          </button>
        )}
      </div>
    </div>
  );
}
