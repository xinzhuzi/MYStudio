import { useState } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StylePicker } from "@/components/features/visual-style/style-picker";
import type { PromptLanguage } from "@/types/script";

const PROMPT_LANGUAGE_OPTIONS = [{ value: "zh", label: "仅中文" }, { value: "en", label: "仅英文" }, { value: "zh+en", label: "中英文" }];
const DURATION_OPTIONS = [{ value: "auto", label: "自动" }, { value: "10s", label: "10秒" }, { value: "15s", label: "15秒" }, { value: "20s", label: "20秒" }, { value: "30s", label: "30秒" }, { value: "60s", label: "1分钟" }, { value: "90s", label: "1分30秒" }, { value: "120s", label: "2分钟" }, { value: "180s", label: "3分钟" }];
const SCENE_COUNT_OPTIONS = ["1", "2", "3", "4", "5", "6", "8", "10"].map((value) => ({ value, label: `${value}个场景` }));
const SHOT_COUNT_OPTIONS = ["3", "4", "5", "6", "8", "10", "12"].map((value) => ({ value, label: `${value}个分镜` })).concat({ value: "custom", label: "自定义..." });

interface ScriptInputSettingsProps {
  mode: "import" | "create"; language: string; targetDuration: string; styleId: string;
  sceneCount?: string; shotCount?: string; parseStatus: "idle" | "parsing" | "ready" | "error";
  onLanguageChange: (value: string) => void; onDurationChange: (value: string) => void;
  onStyleChange: (value: string) => void; onSceneCountChange?: (value: string) => void;
  onShotCountChange?: (value: string) => void; promptLanguage?: PromptLanguage;
  onPromptLanguageChange?: (value: PromptLanguage) => void;
}

export function ScriptInputSettings({
  mode, language, targetDuration, styleId, sceneCount, shotCount, parseStatus,
  onLanguageChange, onDurationChange, onStyleChange, onSceneCountChange,
  onShotCountChange, promptLanguage, onPromptLanguageChange,
}: ScriptInputSettingsProps) {
  const [showCustomShotInput, setShowCustomShotInput] = useState(false);
  const [customShotValue, setCustomShotValue] = useState("");
  return (
    <>
      {/* 导入模式：显示语言、场景数量、分镜数量 */}
      {mode === "import" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">剧本语言</Label>
            <Select
              value={language}
              onValueChange={onLanguageChange}
              disabled={parseStatus === "parsing"}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="中文">中文</SelectItem>
                <SelectItem value="English">English</SelectItem>
                <SelectItem value="日本語">日本語</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">提示词语言</Label>
            <Select
              value={promptLanguage || "zh"}
              onValueChange={(v) => onPromptLanguageChange?.(v as PromptLanguage)}
              disabled={parseStatus === "parsing"}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMPT_LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              控制AI校准生成中/英文提示词，默认仅中文可减少生成压力
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-sm">场景数量（可选）</Label>
              <Select
                value={sceneCount || ""}
                onValueChange={(v) => onSceneCountChange?.(v)}
                disabled={parseStatus === "parsing"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="自动" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  {SCENE_COUNT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">分镜数量（可选）</Label>
              {showCustomShotInput ? (
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    placeholder="输入数量"
                    value={customShotValue}
                    onChange={(e) => setCustomShotValue(e.target.value)}
                    onBlur={() => {
                      if (customShotValue && parseInt(customShotValue) > 0) {
                        onShotCountChange?.(customShotValue);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customShotValue && parseInt(customShotValue) > 0) {
                        onShotCountChange?.(customShotValue);
                      }
                    }}
                    className="h-8 text-xs flex-1"
                    disabled={parseStatus === "parsing"}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setShowCustomShotInput(false);
                      setCustomShotValue("");
                      onShotCountChange?.("auto");
                    }}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Select
                  value={shotCount || ""}
                  onValueChange={(v) => {
                    if (v === "custom") {
                      setShowCustomShotInput(true);
                    } else {
                      onShotCountChange?.(v);
                    }
                  }}
                  disabled={parseStatus === "parsing"}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="自动" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动</SelectItem>
                    {SHOT_COUNT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* 视觉风格 - 导入模式也可以选择 */}
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              <Palette className="h-3 w-3" />
              视觉风格
            </Label>
            <StylePicker
              value={styleId}
              onChange={(id) => onStyleChange(id)}
              disabled={parseStatus === "parsing"}
            />
            <p className="text-[10px] text-muted-foreground">
              此风格将用于AI校准分镜时生成视觉描述
            </p>
          </div>
        </div>
      )}

      {/* 创作模式：显示语言、时长、风格、场景数量、分镜数量 */}
      {mode === "create" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">提示词语言</Label>
            <Select
              value={promptLanguage || "zh"}
              onValueChange={(v) => onPromptLanguageChange?.(v as PromptLanguage)}
              disabled={parseStatus === "parsing"}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMPT_LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              控制AI生成中/英文提示词，默认仅中文可减少生成压力
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-sm">语言</Label>
              <Select
                value={language}
                onValueChange={onLanguageChange}
                disabled={parseStatus === "parsing"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="中文">中文</SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="日本語">日本語</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">时长</Label>
              <Select
                value={targetDuration}
                onValueChange={onDurationChange}
                disabled={parseStatus === "parsing"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">风格</Label>
              <StylePicker
                value={styleId}
                onChange={(id) => onStyleChange(id)}
                disabled={parseStatus === "parsing"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-sm">场景数量（可选）</Label>
              <Select
                value={sceneCount || ""}
                onValueChange={(v) => onSceneCountChange?.(v)}
                disabled={parseStatus === "parsing"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="自动" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  {SCENE_COUNT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">分镜数量（可选）</Label>
              {showCustomShotInput ? (
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    placeholder="输入数量"
                    value={customShotValue}
                    onChange={(e) => setCustomShotValue(e.target.value)}
                    onBlur={() => {
                      if (customShotValue && parseInt(customShotValue) > 0) {
                        onShotCountChange?.(customShotValue);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customShotValue && parseInt(customShotValue) > 0) {
                        onShotCountChange?.(customShotValue);
                      }
                    }}
                    className="h-8 text-xs flex-1"
                    disabled={parseStatus === "parsing"}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setShowCustomShotInput(false);
                      setCustomShotValue("");
                      onShotCountChange?.("auto");
                    }}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Select
                  value={shotCount || ""}
                  onValueChange={(v) => {
                    if (v === "custom") {
                      setShowCustomShotInput(true);
                    } else {
                      onShotCountChange?.(v);
                    }
                  }}
                  disabled={parseStatus === "parsing"}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="自动" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动</SelectItem>
                    {SHOT_COUNT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
