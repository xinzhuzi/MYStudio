import type { ScriptCharacter, ScriptScene } from "@/types/script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Loader2, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { EpisodeTreeAIResultCard } from "./episode-tree-ai-result-card";
import { EpisodeTreeCharacterEditForm } from "./episode-tree-character-edit-form";
import { EpisodeTreeSceneEditForm } from "./episode-tree-scene-edit-form";

export interface SceneAIResult {
  found: boolean;
  message: string;
  scene?: ScriptScene;
}

export interface CharacterAIResult {
  found: boolean;
  name: string;
  message: string;
  character?: ScriptCharacter;
}

interface EpisodeTreeEntityDialogsProps {
  sceneOpen: boolean;
  characterOpen: boolean;
  editingType: "episode" | "scene" | "character" | "shot" | null;
  formData: Record<string, string>;
  onFormFieldChange: (field: string, value: string) => void;
  onSceneOpenChange: (open: boolean) => void;
  onCharacterOpenChange: (open: boolean) => void;
  sceneQuery: string;
  sceneSearching: boolean;
  sceneResult: SceneAIResult | null;
  onSceneQueryChange: (query: string) => void;
  onSceneSearch: () => void;
  canFindScene: boolean;
  onSaveScene: () => void;
  onConfirmScene: () => void;
  characterQuery: string;
  characterSearching: boolean;
  characterResult: CharacterAIResult | null;
  onCharacterQueryChange: (query: string) => void;
  onCharacterSearch: () => void;
  canFindCharacter: boolean;
  onSaveCharacter: () => void;
  onConfirmCharacter: () => void;
}

export function EpisodeTreeEntityDialogs({
  sceneOpen,
  characterOpen,
  editingType,
  formData,
  onFormFieldChange,
  onSceneOpenChange,
  onCharacterOpenChange,
  sceneQuery,
  sceneSearching,
  sceneResult,
  onSceneQueryChange,
  onSceneSearch,
  canFindScene,
  onSaveScene,
  onConfirmScene,
  characterQuery,
  characterSearching,
  characterResult,
  onCharacterQueryChange,
  onCharacterSearch,
  canFindCharacter,
  onSaveCharacter,
  onConfirmCharacter,
}: EpisodeTreeEntityDialogsProps) {
  return (
    <>
      <Dialog open={sceneOpen} onOpenChange={onSceneOpenChange}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingType === "scene" ? (
                <><Pencil className="h-4 w-4" />编辑场景</>
              ) : (
                <><Sparkles className="h-4 w-4 text-primary" />AI 智能添加场景</>
              )}
            </DialogTitle>
          </DialogHeader>

          {editingType === "scene" ? (
            <EpisodeTreeSceneEditForm
              name={formData.name || ""}
              location={formData.location || ""}
              time={formData.time || ""}
              atmosphere={formData.atmosphere || ""}
              onNameChange={(value) => onFormFieldChange("name", value)}
              onLocationChange={(value) => onFormFieldChange("location", value)}
              onTimeChange={(value) => onFormFieldChange("time", value)}
              onAtmosphereChange={(value) => onFormFieldChange("atmosphere", value)}
              onCancel={() => onSceneOpenChange(false)}
              onSave={onSaveScene}
            />
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">描述你需要的场景，例如：</Label>
                <div className="text-xs text-muted-foreground space-y-1 pl-2">
                  <p>• “缺第5集的张家客厅这个场景”</p>
                  <p>• “添加医院走廊这个地点”</p>
                  <p>• “需要公司会议室”</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="输入场景名或描述..."
                    value={sceneQuery}
                    onChange={(event) => onSceneQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        onSceneSearch();
                      }
                    }}
                    disabled={sceneSearching}
                  />
                  <Button
                    onClick={onSceneSearch}
                    disabled={!sceneQuery.trim() || sceneSearching || !canFindScene}
                    className="shrink-0"
                  >
                    {sceneSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {!canFindScene && <p className="text-xs text-amber-500">请先导入剧本以启用 AI 查找</p>}
              </div>

              {sceneResult && (
                <EpisodeTreeAIResultCard found={sceneResult.found} message={sceneResult.message}>
                  {sceneResult.scene && (
                    <div className="space-y-2 pl-6">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">场景名：</span>
                          <span className="font-medium">{sceneResult.scene.name || sceneResult.scene.location}</span>
                        </div>
                        {sceneResult.scene.time && <div><span className="text-muted-foreground">时间：</span><span>{sceneResult.scene.time}</span></div>}
                        {sceneResult.scene.atmosphere && <div className="col-span-2"><span className="text-muted-foreground">氛围：</span><span>{sceneResult.scene.atmosphere}</span></div>}
                      </div>
                      {sceneResult.scene.location && sceneResult.scene.location !== sceneResult.scene.name && (
                        <div className="text-sm"><span className="text-muted-foreground">地点详情：</span><p className="text-xs mt-1 text-muted-foreground">{sceneResult.scene.location}</p></div>
                      )}
                      {sceneResult.scene.visualPrompt && (
                        <div className="text-sm"><span className="text-muted-foreground">视觉描述：</span><p className="text-xs mt-1 text-muted-foreground">{sceneResult.scene.visualPrompt}</p></div>
                      )}
                      {sceneResult.scene.tags && sceneResult.scene.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">{sceneResult.scene.tags.map((tag, index) => <span key={index} className="text-xs bg-muted px-1.5 py-0.5 rounded">#{tag}</span>)}</div>
                      )}
                    </div>
                  )}
                </EpisodeTreeAIResultCard>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => onSceneOpenChange(false)}>取消</Button>
                {sceneResult?.scene ? (
                  <Button onClick={onConfirmScene} className="gap-1"><Check className="h-4 w-4" />确认添加</Button>
                ) : sceneResult && !sceneResult.found ? (
                  <Button onClick={onSaveScene} variant="secondary" className="gap-1"><Plus className="h-4 w-4" />仍然创建</Button>
                ) : null}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={characterOpen} onOpenChange={onCharacterOpenChange}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingType === "character" ? (
                <><Pencil className="h-4 w-4" />编辑角色</>
              ) : (
                <><Sparkles className="h-4 w-4 text-primary" />AI 智能添加角色</>
              )}
            </DialogTitle>
          </DialogHeader>

          {editingType === "character" ? (
            <EpisodeTreeCharacterEditForm
              name={formData.name || ""}
              gender={formData.gender || ""}
              age={formData.age || ""}
              personality={formData.personality || ""}
              onNameChange={(value) => onFormFieldChange("name", value)}
              onGenderChange={(value) => onFormFieldChange("gender", value)}
              onAgeChange={(value) => onFormFieldChange("age", value)}
              onPersonalityChange={(value) => onFormFieldChange("personality", value)}
              onCancel={() => onCharacterOpenChange(false)}
              onSave={onSaveCharacter}
            />
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">描述你需要的角色，例如：</Label>
                <div className="text-xs text-muted-foreground space-y-1 pl-2">
                  <p>• “缺第10集的王大哥这个角色”</p>
                  <p>• “添加张小宝这个人”</p>
                  <p>• “需要刀疑哥”</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="输入角色名或描述..."
                    value={characterQuery}
                    onChange={(event) => onCharacterQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        onCharacterSearch();
                      }
                    }}
                    disabled={characterSearching}
                  />
                  <Button
                    onClick={onCharacterSearch}
                    disabled={!characterQuery.trim() || characterSearching || !canFindCharacter}
                    className="shrink-0"
                  >
                    {characterSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {!canFindCharacter && <p className="text-xs text-amber-500">请先导入剧本以启用 AI 查找</p>}
              </div>

              {characterResult && (
                <EpisodeTreeAIResultCard found={characterResult.found} message={characterResult.message}>
                  {characterResult.character && (
                    <div className="space-y-2 pl-6">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-muted-foreground">角色名：</span><span className="font-medium">{characterResult.character.name}</span></div>
                        {characterResult.character.gender && <div><span className="text-muted-foreground">性别：</span><span>{characterResult.character.gender}</span></div>}
                        {characterResult.character.age && <div><span className="text-muted-foreground">年龄：</span><span>{characterResult.character.age}</span></div>}
                        {characterResult.character.personality && <div><span className="text-muted-foreground">性格：</span><span>{characterResult.character.personality}</span></div>}
                      </div>
                      {characterResult.character.role && <div className="text-sm"><span className="text-muted-foreground">角色简介：</span><p className="text-xs mt-1 text-muted-foreground">{characterResult.character.role}</p></div>}
                      {characterResult.character.visualPromptZh && <div className="text-sm"><span className="text-muted-foreground">视觉描述：</span><p className="text-xs mt-1 text-muted-foreground">{characterResult.character.visualPromptZh}</p></div>}
                    </div>
                  )}
                </EpisodeTreeAIResultCard>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => onCharacterOpenChange(false)}>取消</Button>
                {characterResult?.character ? (
                  <Button onClick={onConfirmCharacter} className="gap-1"><Check className="h-4 w-4" />确认添加</Button>
                ) : characterResult && !characterResult.found ? (
                  <Button onClick={onSaveCharacter} variant="secondary" className="gap-1"><Plus className="h-4 w-4" />仍然创建</Button>
                ) : null}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
