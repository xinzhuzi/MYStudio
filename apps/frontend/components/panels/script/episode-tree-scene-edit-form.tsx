import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EpisodeTreeSceneEditFormProps {
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  onNameChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onAtmosphereChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function EpisodeTreeSceneEditForm({
  name,
  location,
  time,
  atmosphere,
  onNameChange,
  onLocationChange,
  onTimeChange,
  onAtmosphereChange,
  onCancel,
  onSave,
}: EpisodeTreeSceneEditFormProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="scene-name">场景名称</Label>
        <Input id="scene-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="scene-location">地点</Label>
        <Input id="scene-location" value={location} onChange={(event) => onLocationChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="scene-time">时间</Label>
        <Input
          id="scene-time"
          value={time}
          onChange={(event) => onTimeChange(event.target.value)}
          placeholder="如：白天、夜晚、黄昏"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="scene-atmosphere">氛围</Label>
        <Input
          id="scene-atmosphere"
          value={atmosphere}
          onChange={(event) => onAtmosphereChange(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={onSave}>保存</Button>
      </DialogFooter>
    </div>
  );
}
