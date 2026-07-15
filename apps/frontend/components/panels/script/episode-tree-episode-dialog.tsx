import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EpisodeTreeEpisodeDialogProps {
  open: boolean;
  mode: "create" | "edit";
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onSave: () => void;
}

export function EpisodeTreeEpisodeDialog({
  open,
  mode,
  title,
  description,
  onOpenChange,
  onTitleChange,
  onDescriptionChange,
  onSave,
}: EpisodeTreeEpisodeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑集" : "新建集"}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === "edit" ? "编辑当前剧集的标题和描述" : "填写新剧集的标题和描述"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="episode-title">标题</Label>
            <Input id="episode-title" value={title} onChange={(event) => onTitleChange(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="episode-description">描述</Label>
            <Input id="episode-description" value={description} onChange={(event) => onDescriptionChange(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
