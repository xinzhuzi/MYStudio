import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type EpisodeTreeDeleteItem = {
  type: "episode" | "scene" | "character" | "shot";
  name: string;
};

interface EpisodeTreeDeleteDialogProps {
  open: boolean;
  item: EpisodeTreeDeleteItem | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function EpisodeTreeDeleteDialog({
  open,
  item,
  onOpenChange,
  onConfirm,
}: EpisodeTreeDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除「{item?.name}」吗？此操作不可撤销。
            {item?.type === "episode" && "\n删除集将同时删除其下所有场景和分镜。"}
            {item?.type === "scene" && "\n删除场景将同时删除其下所有分镜。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground">
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
