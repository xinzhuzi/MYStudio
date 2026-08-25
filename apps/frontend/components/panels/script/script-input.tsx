// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Script Input Component
 * 左栏：剧本输入（导入/创作两种模式）
 */

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  FileText,
  Wand2,
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  BookOpen,
} from "lucide-react";
import type { PromptLanguage } from "@/types/script";
import { useScriptStore } from "@/stores/script/script-store";
import { ScriptImportProgress } from "./script-import-progress";
import { ScriptInputSettings } from "./script-input-settings";

interface ScriptInputProps {
  rawScript: string;
  language: string;
  targetDuration: string;
  styleId: string;
  sceneCount?: string;
  shotCount?: string;
  parseStatus: "idle" | "parsing" | "ready" | "error";
  parseError?: string;
  chatConfigured: boolean;
  onRawScriptChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onSceneCountChange?: (value: string) => void;
  onShotCountChange?: (value: string) => void;
  onParse: () => void;
  onGenerateFromIdea?: (idea: string) => void;
  // 完整剧本导入
  onImportFullScript?: (text: string) => Promise<void>;
  importStatus?: 'idle' | 'importing' | 'ready' | 'error';
  importError?: string;
  // AI校准
  onCalibrate?: () => Promise<void>;
  calibrationStatus?: 'idle' | 'calibrating' | 'completed' | 'error';
  missingTitleCount?: number;
  // 大纲生成
  onGenerateSynopses?: () => Promise<void>;
  synopsisStatus?: 'idle' | 'generating' | 'completed' | 'error';
  missingSynopsisCount?: number;
  // 分镜生成状态
  viewpointAnalysisStatus?: 'idle' | 'analyzing' | 'completed' | 'error';
  // 角色校准状态
  characterCalibrationStatus?: 'idle' | 'calibrating' | 'completed' | 'error';
  // 场景校准状态
  sceneCalibrationStatus?: 'idle' | 'calibrating' | 'completed' | 'error';
  // 二次校准追踪（中栏独立按钮触发）
  secondPassTypes?: Set<string>;
  // 提示词语言
  promptLanguage?: PromptLanguage;
  onPromptLanguageChange?: (value: PromptLanguage) => void;
}

export function ScriptInput({
  rawScript,
  language,
  targetDuration,
  styleId,
  sceneCount,
  shotCount,
  parseStatus,
  parseError,
  chatConfigured,
  onRawScriptChange,
  onLanguageChange,
  onDurationChange,
  onStyleChange,
  onSceneCountChange,
  onShotCountChange,
  onParse,
  onGenerateFromIdea,
  onImportFullScript,
  importStatus,
  importError,
  onCalibrate,
  calibrationStatus,
  missingTitleCount,
  onGenerateSynopses,
  synopsisStatus,
  missingSynopsisCount,
  viewpointAnalysisStatus,
  characterCalibrationStatus,
  sceneCalibrationStatus,
  secondPassTypes,
  promptLanguage,
  onPromptLanguageChange,
}: ScriptInputProps) {
  const scriptActiveProjectId = useScriptStore((state) => state.activeProjectId);
  const inputDraft = useScriptStore((state) => {
    if (!state.activeProjectId) return null;
    return state.projects[state.activeProjectId]?.inputDraft || null;
  });
  const setInputDraft = useScriptStore((state) => state.setInputDraft);

  const [mode, setMode] = useState<"import" | "create">(inputDraft?.mode || "import");
  const [idea, setIdea] = useState(inputDraft?.idea || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isGeneratingSynopsis, setIsGeneratingSynopsis] = useState(false);

  // Reload persisted draft when project switches
  useEffect(() => {
    setMode(inputDraft?.mode || "import");
    setIdea(inputDraft?.idea || "");
  }, [scriptActiveProjectId, inputDraft?.mode, inputDraft?.idea]);

  // Persist mode/idea draft to survive panel switching
  useEffect(() => {
    if (!scriptActiveProjectId) return;
    const timer = window.setTimeout(() => {
      setInputDraft(scriptActiveProjectId, { mode, idea });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [scriptActiveProjectId, mode, idea, setInputDraft]);

  const handleGenerate = async () => {
    if (!idea.trim() || !onGenerateFromIdea) return;
    setIsGenerating(true);
    try {
      await onGenerateFromIdea(idea);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImportFullScript = async () => {
    if (!rawScript.trim() || !onImportFullScript) return;
    setIsImporting(true);
    try {
      await onImportFullScript(rawScript);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCalibrate = async () => {
    if (!onCalibrate) return;
    setIsCalibrating(true);
    try {
      await onCalibrate();
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleGenerateSynopses = async () => {
    if (!onGenerateSynopses) return;
    setIsGeneratingSynopsis(true);
    try {
      await onGenerateSynopses();
    } finally {
      setIsGeneratingSynopsis(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-3 space-y-3">
      {/* 模式切换 */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as "import" | "create")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="import" className="text-xs">
            <FileText className="h-3 w-3 mr-1" />
            导入
          </TabsTrigger>
          <TabsTrigger value="create" className="text-xs">
            <Sparkles className="h-3 w-3 mr-1" />
            创作
          </TabsTrigger>
        </TabsList>

        {/* 导入模式 */}
        <TabsContent value="import" className="flex-1 mt-3 overflow-y-auto">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              粘贴完整剧本（包含大纲、人物小传、各集内容）
            </Label>
            <Textarea
              placeholder="支持的格式：\n• 第X集（集标记）\n• **1-1日 内 地点**（场景头）\n• 人物：角色A、角色B\n• 角色名：（动作）台词\n• △动作描写\n• 【字幕】【闪回】等"
              value={rawScript}
              onChange={(e) => onRawScriptChange(e.target.value)}
              className="min-h-[200px] max-h-[40vh] resize-none text-sm overflow-y-auto"
              disabled={parseStatus === "parsing" || isImporting}
            />
            {/* 导入状态提示 */}
            {importStatus === "ready" && (
              <div className="space-y-1">
                <p className="text-xs text-success">✓ 导入成功！可在右侧点击集名生成分镜</p>
                {(missingTitleCount ?? 0) > 0 && (
                  <p className="text-xs text-warning">
                    ⚠ {missingTitleCount} 集缺少标题，可使用AI校准生成
                  </p>
                )}
              </div>
            )}
            {importStatus === "error" && importError && (
              <p className="text-xs text-destructive">导入失败：{importError}</p>
            )}
            
            <ScriptImportProgress
              importStatus={importStatus}
              calibrationStatus={calibrationStatus}
              synopsisStatus={synopsisStatus}
              viewpointAnalysisStatus={viewpointAnalysisStatus}
              characterCalibrationStatus={characterCalibrationStatus}
              sceneCalibrationStatus={sceneCalibrationStatus}
              secondPassTypes={secondPassTypes}
            />
          </div>
        </TabsContent>

        {/* 创作模式 */}
        <TabsContent value="create" className="flex-1 mt-3">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                输入故事创意，AI帮你生成剧本
              </Label>
              <Textarea
                placeholder="例如：一个内向程序员在咖啡店邂逅开朗女孩的温暖故事..."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                className="min-h-[100px] resize-none text-sm"
                disabled={isGenerating}
              />
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!idea.trim() || isGenerating || !chatConfigured}
              className="w-full"
              variant="paid"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI生成剧本
                </>
              )}
            </Button>

            {/* 生成后的剧本预览 */}
            {rawScript && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  生成的剧本（可编辑）
                </Label>
                <Textarea
                  value={rawScript}
                  onChange={(e) => onRawScriptChange(e.target.value)}
                  className="min-h-[100px] resize-none text-sm"
                  disabled={parseStatus === "parsing"}
                />
              </div>
            )}

            {/* 创作模式工作流引导 */}
            {parseStatus === "ready" && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                <div className="text-xs font-medium text-primary">✨ 剧本已生成，下一步</div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
                    <span>在中栏选择场景 → 右栏点「去场景库生成背景」</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">2</span>
                    <span>选择角色 → 右栏点「去角色库生成形象」</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">3</span>
                    <span>选择分镜 → 右栏点「去AI导演生成视频」</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="space-y-3 pt-2 border-t">
        <ScriptInputSettings
        mode={mode}
        language={language}
        targetDuration={targetDuration}
        styleId={styleId}
        sceneCount={sceneCount}
        shotCount={shotCount}
        parseStatus={parseStatus}
        onLanguageChange={onLanguageChange}
        onDurationChange={onDurationChange}
        onStyleChange={onStyleChange}
        onSceneCountChange={onSceneCountChange}
        onShotCountChange={onShotCountChange}
        promptLanguage={promptLanguage}
        onPromptLanguageChange={onPromptLanguageChange}
        />

        {/* API 警告 */}
        {!chatConfigured && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-warning/10 border border-warning/20">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs text-warning">
              <p className="font-medium">API 未配置</p>
              <p className="opacity-80">请在设置中配置API密钥</p>
            </div>
          </div>
        )}

        {/* 导入/解析按钮 */}
        <div className="space-y-2">
          {/* 完整剧本导入按钮（不需要AI，用规则解析） */}
          {mode === "import" && onImportFullScript && (
            <Button
              onClick={handleImportFullScript}
              disabled={!rawScript.trim() || isImporting}
              className="w-full"
              variant="default"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  导入中...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  导入完整剧本
                </>
              )}
            </Button>
          )}
          
          {/* AI校准按钮 - 导入成功且有缺失标题时显示 */}
          {mode === "import" && importStatus === "ready" && (missingTitleCount ?? 0) > 0 && onCalibrate && (
            <Button
              onClick={handleCalibrate}
              disabled={isCalibrating || calibrationStatus === 'calibrating'}
              className="w-full"
              variant="outline"
            >
              {isCalibrating || calibrationStatus === 'calibrating' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI校准中...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  AI校准（生成{missingTitleCount}集标题）
                </>
              )}
            </Button>
          )}
          
          {/* 生成大纲按钮 - 导入成功后显示 */}
          {mode === "import" && importStatus === "ready" && onGenerateSynopses && (
            <Button
              onClick={handleGenerateSynopses}
              disabled={isGeneratingSynopsis || synopsisStatus === 'generating'}
              className="w-full"
              variant="paid"
            >
              {isGeneratingSynopsis || synopsisStatus === 'generating' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成大纲中...
                </>
              ) : (
                <>
                  <BookOpen className="h-4 w-4 mr-2" />
                  {(missingSynopsisCount ?? 0) > 0 
                    ? `生成大纲（${missingSynopsisCount}集缺失）`
                    : '重新生成大纲'
                  }
                </>
              )}
            </Button>
          )}
          
          {/* AI解析按钮 - 仅在导入模式显示 */}
          {mode === "import" && (
            <Button
              onClick={onParse}
              disabled={!rawScript.trim() || parseStatus === "parsing" || !chatConfigured}
              className="w-full"
              variant={onImportFullScript ? "outline" : "default"}
            >
              {parseStatus === "parsing" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  解析中...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  AI解析剧本
                </>
              )}
            </Button>
          )}
        </div>

        {/* 解析错误 */}
        {parseStatus === "error" && parseError && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{parseError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
