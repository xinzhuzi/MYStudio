// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ScreenplayInput.tsx (behavior-preserving refactor).
//
// Owns the character drag-over/drop affordance for the screenplay input drop
// zone: tracks the drag-over highlight state and, on drop, parses the
// application/json character payload, de-duplicates against the current
// selection, and appends the new character. Distinct from use-drag-drop.ts,
// which handles external File drags. The current selection and its setter are
// passed in (owned by the character picker hook) so this hook stays a pure
// adapter over DnD events.

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { DraggedCharacter } from "./use-screenplay-character-picker";

export interface UseScreenplayDragDropParams {
  selectedCharacters: DraggedCharacter[];
  setSelectedCharacters: React.Dispatch<React.SetStateAction<DraggedCharacter[]>>;
}

export function useScreenplayDragDrop({
  selectedCharacters,
  setSelectedCharacters,
}: UseScreenplayDragDropParams) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle character drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  // Handle character drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      try {
        const data = JSON.parse(e.dataTransfer.getData("application/json"));
        if (data.type === "character") {
          // Check if already added
          if (selectedCharacters.some((c) => c.characterId === data.characterId)) {
            toast.info("该角色已添加");
            return;
          }

          const newChar: DraggedCharacter = {
            characterId: data.characterId,
            characterName: data.characterName,
            visualTraits: data.visualTraits || "",
            thumbnailUrl: data.thumbnailUrl,
          };

          setSelectedCharacters((prev) => [...prev, newChar]);
          toast.success(`已添加角色: ${data.characterName}`);
        }
      } catch (err) {
        // Not a valid character drop
      }
    },
    [selectedCharacters, setSelectedCharacters],
  );

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop };
}
