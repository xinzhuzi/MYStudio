import { useMemo, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Filter, Loader2,
  MoreHorizontal, Pencil, Plus, Trash2, User, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CalibrationStrictness, CompletionStatus, ScriptCharacter } from "@/types/script";

interface EpisodeTreeCharacterListProps {
  characters: ScriptCharacter[];
  selectedItemId: string | null;
  selectedItemType: "character" | "scene" | "shot" | "episode" | null;
  onSelectItem: (id: string, type: "character") => void;
  onEditCharacter: (character: ScriptCharacter) => void;
  onDeleteCharacter: (character: ScriptCharacter) => void;
  onAddCharacter: () => void;
  onCalibrateCharacters?: () => void;
  characterCalibrationStatus?: "idle" | "calibrating" | "completed" | "error";
  calibrationStrictness?: CalibrationStrictness;
  onCalibrationStrictnessChange?: (strictness: CalibrationStrictness) => void;
  onOpenFilteredCharacters: () => void;
}

function CharacterStatusIcon({ status }: { status?: CompletionStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-3 w-3 text-green-500" />;
  if (status === "in_progress") return <Clock className="h-3 w-3 text-yellow-500" />;
  return <Circle className="h-3 w-3 text-muted-foreground" />;
}

export function EpisodeTreeCharacterList({
  characters, selectedItemId, selectedItemType, onSelectItem, onEditCharacter,
  onDeleteCharacter, onAddCharacter, onCalibrateCharacters,
  characterCalibrationStatus, calibrationStrictness,
  onCalibrationStrictnessChange, onOpenFilteredCharacters,
}: EpisodeTreeCharacterListProps) {
  const [extrasExpanded, setExtrasExpanded] = useState(false);
  const { mainCharacters, extraCharacters } = useMemo(() => {
    const seenIds = new Set<string>();
    const uniqueCharacters = characters
      .filter((character) => !character.stageCharacterIds?.length)
      .filter((character) => {
        if (seenIds.has(character.id)) return false;
        seenIds.add(character.id);
        return true;
      });
    return {
      mainCharacters: uniqueCharacters.filter((character) =>
        character.tags?.includes("protagonist") || character.tags?.includes("supporting")),
      extraCharacters: uniqueCharacters.filter((character) =>
        !character.tags?.includes("protagonist") && !character.tags?.includes("supporting")),
    };
  }, [characters]);

  const renderCharacterItem = (character: ScriptCharacter) => (
    <div key={character.id} className="flex items-center group">
      <button
        onClick={() => onSelectItem(character.id, "character")}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-muted",
          selectedItemId === character.id && selectedItemType === "character" && "bg-primary/10",
        )}
      >
        <CharacterStatusIcon status={character.status} />
        {character.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={`管理${character.name}`} variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100">
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEditCharacter(character)}>
            <Pencil className="h-3 w-3 mr-2" />编辑
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => onDeleteCharacter(character)}>
            <Trash2 className="h-3 w-3 mr-2" />删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <div className="mt-4 pt-4 border-t">
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-1"><User className="h-3 w-3" />角色 ({mainCharacters.length})</div>
          <div className="flex items-center gap-1">
            {onCalibrateCharacters && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="角色校准菜单" size="sm" variant="ghost" className="h-5 text-xs px-1" disabled={characterCalibrationStatus === "calibrating"}>
                    {characterCalibrationStatus === "calibrating" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreHorizontal className="h-3 w-3" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onCalibrateCharacters}><Wand2 className="h-3 w-3 mr-2" />AI角色校准</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="text-xs"><Wand2 className="h-3 w-3 mr-2" />校准严格度</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup value={calibrationStrictness || "normal"} onValueChange={(value) => onCalibrationStrictnessChange?.(value as CalibrationStrictness)}>
                        <DropdownMenuRadioItem value="strict" className="text-xs">严格</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="normal" className="text-xs">标准</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="loose" className="text-xs">宽松</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={onOpenFilteredCharacters}><Filter className="h-3 w-3 mr-2" />查看被过滤角色</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button aria-label="添加角色" size="sm" variant="ghost" className="h-5 text-xs px-1" onClick={onAddCharacter}><Plus className="h-3 w-3" /></Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 px-2 mt-1">{mainCharacters.map(renderCharacterItem)}</div>
      </div>
      {extraCharacters.length > 0 && (
        <div className="mt-2 border-t border-dashed pt-2">
          <button onClick={() => setExtrasExpanded((expanded) => !expanded)} className="w-full px-2 py-1 text-xs text-muted-foreground flex items-center justify-between hover:bg-muted/50 rounded">
            <div className="flex items-center gap-1">
              {extrasExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>群演配角 ({extraCharacters.length})</span>
            </div>
          </button>
          {extrasExpanded && <div className="flex flex-wrap gap-1 px-2 mt-1">{extraCharacters.map(renderCharacterItem)}</div>}
        </div>
      )}
    </>
  );
}
