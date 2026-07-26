import { Check, Plus, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Character } from "@/stores/library/character-library-store";

interface CharacterPickerPopoverProps {
  characters: Character[];
  selectedCharacterIds: string[];
  open: boolean;
  variant: "empty" | "add";
  onOpenChange: (open: boolean) => void;
  onToggle: (character: Character) => void;
  onCreate: () => void;
}

export function CharacterPickerPopover({
  characters,
  selectedCharacterIds,
  open,
  variant,
  onOpenChange,
  onToggle,
  onCreate,
}: CharacterPickerPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {variant === "empty" ? (
          <button
            aria-label="选择角色"
            className="w-full h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-6 w-6" />
          </button>
        ) : (
          <button
            aria-label="添加角色"
            className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b">
          <p className="text-sm font-medium">选择角色</p>
        </div>
        {characters.length === 0 ? (
          <div className="p-4 text-center">
            <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">角色库为空</p>
            <Button variant="outline" size="sm" onClick={onCreate}>
              去创建角色
            </Button>
          </div>
        ) : (
          <div className="max-h-[200px] overflow-y-auto">
            {characters.map((character) => {
              const isSelected = selectedCharacterIds.includes(character.id);
              const thumbnail = character.views.length > 0
                ? character.views[0].imageUrl
                : undefined;

              return (
                <button
                  key={character.id}
                  aria-pressed={isSelected}
                  onClick={() => onToggle(character)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted transition-colors text-left"
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={character.name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                  <span className="flex-1 text-sm truncate">{character.name}</span>
                  {isSelected && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
