// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ScreenplayInput.tsx (behavior-preserving refactor).
//
// Owns the character-picker UI logic for the screenplay input: the popover-open
// state, the visible-character list (filtered by share-characters / active
// project), the derived selected-id list, the draft-character resolver, and the
// picker add/remove/navigate handlers.
//
// The selection state itself (selectedCharacters / setSelectedCharacters) stays
// in the host component because it is shared with the draft-restore/persist
// effects and the submit flow; it is passed in as a param. This keeps the
// component's effect dependency arrays unchanged (the setter remains a
// useState setter that exhaustive-deps treats as stable). The character store
// is read here because this hook is the sole consumer of `characters`.

import { useCallback, useMemo, useState } from "react";
import { useCharacterLibraryStore, type Character } from "@/stores/library/character-library-store";
import type { Tab } from "@/stores/navigation/media-panel-store";

// Dragged/picked character info carried between the character library and the
// screenplay input. Extracted verbatim from ScreenplayInput.tsx.
export interface DraggedCharacter {
  characterId: string;
  characterName: string;
  visualTraits: string;
  thumbnailUrl?: string;
}

export interface UseScreenplayCharacterPickerParams {
  selectedCharacters: DraggedCharacter[];
  setSelectedCharacters: React.Dispatch<React.SetStateAction<DraggedCharacter[]>>;
  shareCharacters: boolean;
  activeProjectId: string | null;
  setActiveTab: (tab: Tab) => void;
}

export function useScreenplayCharacterPicker({
  selectedCharacters,
  setSelectedCharacters,
  shareCharacters,
  activeProjectId,
  setActiveTab,
}: UseScreenplayCharacterPickerParams) {
  const { characters } = useCharacterLibraryStore();
  const [isCharacterPopoverOpen, setIsCharacterPopoverOpen] = useState(false);

  const visibleCharacters = useMemo(() => {
    if (shareCharacters) return characters;
    if (!activeProjectId) return [];
    return characters.filter((c) => c.projectId === activeProjectId);
  }, [characters, shareCharacters, activeProjectId]);

  const selectedCharacterIds = useMemo(
    () => selectedCharacters.map((c) => c.characterId),
    [selectedCharacters],
  );

  const resolveDraftCharacters = useCallback(
    (characterIds: string[]): DraggedCharacter[] => {
      if (!characterIds?.length) return [];
      const seen = new Set<string>();
      return characterIds
        .map((id) => {
          const libChar = visibleCharacters.find((c) => c.id === id);
          if (!libChar || seen.has(libChar.id)) return null;
          seen.add(libChar.id);
          return {
            characterId: libChar.id,
            characterName: libChar.name,
            visualTraits: libChar.visualTraits || libChar.description || "",
            thumbnailUrl: libChar.views.length > 0 ? libChar.views[0].imageUrl : undefined,
          } as DraggedCharacter;
        })
        .filter(Boolean) as DraggedCharacter[];
    },
    [visibleCharacters],
  );

  // Remove character
  const removeCharacter = (characterId: string) => {
    setSelectedCharacters((prev) => prev.filter((c) => c.characterId !== characterId));
  };

  // Toggle character selection from popover
  const toggleCharacterSelection = (character: Character) => {
    const isSelected = selectedCharacters.some((c) => c.characterId === character.id);

    if (isSelected) {
      setSelectedCharacters((prev) => prev.filter((c) => c.characterId !== character.id));
    } else {
      const thumbnailUrl = character.views.length > 0 ? character.views[0].imageUrl : undefined;
      const newChar: DraggedCharacter = {
        characterId: character.id,
        characterName: character.name,
        visualTraits: character.visualTraits || character.description || "",
        thumbnailUrl,
      };
      setSelectedCharacters((prev) => [...prev, newChar]);
    }
  };

  // Navigate to characters view
  const goToCharacterLibrary = () => {
    setIsCharacterPopoverOpen(false);
    setActiveTab("characters");
  };

  return {
    visibleCharacters,
    selectedCharacterIds,
    resolveDraftCharacters,
    isCharacterPopoverOpen,
    setIsCharacterPopoverOpen,
    removeCharacter,
    toggleCharacterSelection,
    goToCharacterLibrary,
  };
}
