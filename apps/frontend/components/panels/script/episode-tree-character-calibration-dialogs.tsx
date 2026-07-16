import { useCallback, useEffect, useState } from "react";
import type { FilteredCharacterRecord, ScriptCharacter } from "@/types/script";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Wand2, X } from "lucide-react";

interface EpisodeTreeCharacterCalibrationDialogsProps {
  calibrationOpen?: boolean;
  pendingCharacters?: ScriptCharacter[] | null;
  pendingFilteredCharacters?: FilteredCharacterRecord[];
  onConfirm?: (kept: ScriptCharacter[], filtered: FilteredCharacterRecord[]) => void;
  onCancel?: () => void;
  filteredOpen: boolean;
  onFilteredOpenChange: (open: boolean) => void;
  lastFilteredCharacters?: FilteredCharacterRecord[];
  onRestoreFilteredCharacter?: (name: string) => void;
}

export function EpisodeTreeCharacterCalibrationDialogs({
  calibrationOpen,
  pendingCharacters,
  pendingFilteredCharacters,
  onConfirm,
  onCancel,
  filteredOpen,
  onFilteredOpenChange,
  lastFilteredCharacters,
  onRestoreFilteredCharacter,
}: EpisodeTreeCharacterCalibrationDialogsProps) {
  const [keptCharacters, setKeptCharacters] = useState<ScriptCharacter[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<FilteredCharacterRecord[]>([]);
  const [removedCharacters, setRemovedCharacters] = useState<Map<string, ScriptCharacter>>(new Map());

  useEffect(() => {
    if (calibrationOpen && pendingCharacters) {
      setKeptCharacters([...pendingCharacters]);
      setFilteredCharacters([...(pendingFilteredCharacters || [])]);
      setRemovedCharacters(new Map());
    }
  }, [calibrationOpen, pendingCharacters, pendingFilteredCharacters]);

  const removeCharacter = useCallback((characterId: string) => {
    const character = keptCharacters.find((item) => item.id === characterId);
    if (!character) return;
    setRemovedCharacters((current) => new Map(current).set(character.name, character));
    setKeptCharacters((current) => current.filter((item) => item.id !== characterId));
    setFilteredCharacters((current) => [...current, { name: character.name, reason: "用户手动移除" }]);
  }, [keptCharacters]);

  const restoreCharacter = useCallback((characterName: string) => {
    setFilteredCharacters((current) => current.filter((item) => item.name !== characterName));
    const cached = removedCharacters.get(characterName);
    setKeptCharacters((current) => [...current, cached || {
      id: `char_restored_${Date.now()}`,
      name: characterName,
      tags: ["extra", "restored"],
    }]);
    if (cached) {
      setRemovedCharacters((current) => {
        const next = new Map(current);
        next.delete(characterName);
        return next;
      });
    }
  }, [removedCharacters]);

  const restoreAllAndConfirm = useCallback(() => {
    const restored = filteredCharacters.map((item, index): ScriptCharacter => ({
      id: `char_restored_${Date.now()}_${index}`,
      name: item.name,
      tags: ["extra", "restored"],
    }));
    onConfirm?.([...keptCharacters, ...restored], []);
  }, [filteredCharacters, keptCharacters, onConfirm]);

  return (
    <>
      <Dialog open={calibrationOpen} onOpenChange={(open) => { if (!open) onCancel?.(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4" />角色校准结果确认</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <h4 className="text-sm font-medium mb-2">保留角色 ({keptCharacters.length})</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                {keptCharacters.map((character) => {
                  const importance = character.tags?.find((tag) => ["protagonist", "supporting", "minor", "extra"].includes(tag));
                  const labels: Record<string, string> = { protagonist: "主角", supporting: "配角", minor: "次要", extra: "群演" };
                  return (
                    <div key={character.id} className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted text-xs">
                      <div className="flex items-center gap-2">
                        <span>{character.name}</span>
                        {importance && <span className="text-muted-foreground text-[10px]">({labels[importance] || importance})</span>}
                      </div>
                      <Button aria-label={`移除${character.name}`} variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive hover:text-destructive" onClick={() => removeCharacter(character.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
            {filteredCharacters.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">被过滤角色 ({filteredCharacters.length})</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                  {filteredCharacters.map((item, index) => (
                    <div key={`${item.name}_${index}`} className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted text-xs">
                      <div className="flex items-center gap-2"><span className="text-muted-foreground line-through">{item.name}</span><span className="text-muted-foreground text-[10px]">({item.reason})</span></div>
                      <Button aria-label={`恢复${item.name}`} variant="ghost" size="sm" className="h-5 w-5 p-0 text-green-600 hover:text-green-700" onClick={() => restoreCharacter(item.name)}><Check className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onCancel}>取消</Button>
            {filteredCharacters.length > 0 && <Button variant="secondary" onClick={restoreAllAndConfirm}>全部保留</Button>}
            <Button onClick={() => onConfirm?.(keptCharacters, filteredCharacters)}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={filteredOpen} onOpenChange={onFilteredOpenChange}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>被过滤的角色</DialogTitle></DialogHeader>
          <div className="py-2">
            {lastFilteredCharacters?.length ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {lastFilteredCharacters.map((item, index) => (
                  <div key={`${item.name}_${index}`} className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted text-xs">
                    <div><span>{item.name}</span><span className="text-muted-foreground ml-2">({item.reason})</span></div>
                    <Button variant="ghost" size="sm" className="h-5 text-xs px-1 text-green-600" onClick={() => onRestoreFilteredCharacter?.(item.name)}>恢复</Button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground text-center py-4">没有被过滤的角色</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => onFilteredOpenChange(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
