import { useCallback, useState } from "react";
import type { Episode } from "@/types/script";

export type EpisodeTreeDeleteEntityType = "episode" | "scene" | "character" | "shot";

export type EpisodeTreeDeleteControllerItem = {
  type: EpisodeTreeDeleteEntityType;
  id: string;
  name: string;
};

type UseEpisodeTreeDeleteControllerOptions = {
  episodes: Episode[];
  onDeleteEpisodeBundle?: (episodeIndex: number) => void;
  onDeleteScene?: (id: string) => void;
  onDeleteCharacter?: (id: string) => void;
  onDeleteShot?: (id: string) => void;
};

export function useEpisodeTreeDeleteController({
  episodes,
  onDeleteEpisodeBundle,
  onDeleteScene,
  onDeleteCharacter,
  onDeleteShot,
}: UseEpisodeTreeDeleteControllerOptions) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<EpisodeTreeDeleteControllerItem | null>(null);

  const handleDelete = useCallback((type: EpisodeTreeDeleteEntityType, id: string, name: string) => {
    setDeleteItem({ type, id, name });
    setDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteItem) return;

    switch (deleteItem.type) {
      case "episode": {
        const episode = episodes.find((item) => item.id === deleteItem.id);
        if (episode) onDeleteEpisodeBundle?.(episode.index);
        break;
      }
      case "scene":
        onDeleteScene?.(deleteItem.id);
        break;
      case "character":
        onDeleteCharacter?.(deleteItem.id);
        break;
      case "shot":
        onDeleteShot?.(deleteItem.id);
        break;
    }

    setDeleteDialogOpen(false);
    setDeleteItem(null);
  }, [deleteItem, episodes, onDeleteCharacter, onDeleteEpisodeBundle, onDeleteScene, onDeleteShot]);

  return {
    deleteDialogOpen,
    setDeleteDialogOpen,
    deleteItem,
    handleDelete,
    confirmDelete,
  };
}
