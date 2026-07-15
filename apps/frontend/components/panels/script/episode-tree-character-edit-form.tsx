import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EpisodeTreeCharacterEditFormProps {
  name: string;
  gender: string;
  age: string;
  personality: string;
  onNameChange: (value: string) => void;
  onGenderChange: (value: string) => void;
  onAgeChange: (value: string) => void;
  onPersonalityChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function EpisodeTreeCharacterEditForm({
  name,
  gender,
  age,
  personality,
  onNameChange,
  onGenderChange,
  onAgeChange,
  onPersonalityChange,
  onCancel,
  onSave,
}: EpisodeTreeCharacterEditFormProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="character-name">角色名</Label>
        <Input id="character-name" value={name} onChange={(event) => onNameChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="character-gender">性别</Label>
        <Input id="character-gender" value={gender} onChange={(event) => onGenderChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="character-age">年龄</Label>
        <Input id="character-age" value={age} onChange={(event) => onAgeChange(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="character-personality">性格</Label>
        <Input
          id="character-personality"
          value={personality}
          onChange={(event) => onPersonalityChange(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={onSave}>保存</Button>
      </DialogFooter>
    </div>
  );
}
