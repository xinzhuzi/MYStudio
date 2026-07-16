// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Episode Tree Component
 * 中间栏：层级结构预览（集→场景→分镜）+ 状态追踪 + CRUD管理
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import type { ScriptData, ScriptCharacter, ScriptScene, Episode, Shot, CompletionStatus, ProjectBackground, EpisodeRawScript, CalibrationStrictness, FilteredCharacterRecord } from "@/types/script";
import { getShotCompletionStatus, calculateProgress } from "@/lib/script/shot-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  User,
  Circle,
  Clock,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Search,
  Sparkles,
  Check,
  X,
} from "lucide-react";
import type { TrailerDuration, TrailerConfig } from "@/stores/director-store";
import type { TrailerGenerationOptions } from "@/lib/script/trailer-service";
import { EpisodeTreeTrailerPanel } from "./episode-tree-trailer-panel";
import { EpisodeTreeEpisodeDialog } from "./episode-tree-episode-dialog";
import { EpisodeTreeDeleteDialog } from "./episode-tree-delete-dialog";
import { EpisodeTreeEntityDialogs } from "./episode-tree-entity-dialogs";
import { EpisodeTreeCharacterCalibrationDialogs } from "./episode-tree-character-calibration-dialogs";
import { EpisodeTreeCharacterList } from "./episode-tree-character-list";
import { EpisodeTreeStructure } from "./episode-tree-structure";
import { useEpisodeTreeDeleteController } from "./use-episode-tree-delete-controller";
import {
  EpisodeTreeHeader,
  type EpisodeTreeFilter,
  type EpisodeTreeTab,
} from "./episode-tree-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// 计算完成状态图标
function StatusIcon({ status }: { status?: CompletionStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case "in_progress":
      return <Clock className="h-3 w-3 text-yellow-500" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
}

interface EpisodeTreeProps {
  scriptData: ScriptData | null;
  shots: Shot[];
  shotStatus?: "idle" | "generating" | "ready" | "error"; // 分镜生成状态
  selectedItemId: string | null;
  selectedItemType: "character" | "scene" | "shot" | "episode" | null;
  onSelectItem: (id: string, type: "character" | "scene" | "shot" | "episode") => void;
  // CRUD callbacks (Bundle 版本，同步 episodeRawScripts)
  onAddEpisodeBundle?: (title: string, synopsis: string) => void;
  onUpdateEpisodeBundle?: (episodeIndex: number, updates: { title?: string; synopsis?: string }) => void;
  onDeleteEpisodeBundle?: (episodeIndex: number) => void;
  onAddScene?: (scene: ScriptScene, episodeId?: string) => void;
  onUpdateScene?: (id: string, updates: Partial<ScriptScene>) => void;
  onDeleteScene?: (id: string) => void;
  onAddCharacter?: (character: ScriptCharacter) => void;
  onUpdateCharacter?: (id: string, updates: Partial<ScriptCharacter>) => void;
  onDeleteCharacter?: (id: string) => void;
  onDeleteShot?: (id: string) => void;
  // 分镜生成 callbacks
  onGenerateEpisodeShots?: (episodeIndex: number) => void;
  onRegenerateAllShots?: () => void;
  episodeGenerationStatus?: Record<number, 'idle' | 'generating' | 'completed' | 'error'>;
  // 分镜校准 callback
  onCalibrateShots?: (episodeIndex: number) => void;
  onCalibrateScenesShots?: (sceneId: string) => void;
  // 角色校准 callback
  onCalibrateCharacters?: () => void;
  characterCalibrationStatus?: 'idle' | 'calibrating' | 'completed' | 'error';
  // AI 角色查找相关
  projectBackground?: ProjectBackground;
  episodeRawScripts?: EpisodeRawScript[];
  onAIFindCharacter?: (query: string) => Promise<{
    found: boolean;
    name: string;
    message: string;
    character?: ScriptCharacter;
  }>;
  aiFindingStatus?: 'idle' | 'searching' | 'found' | 'not_found' | 'error';
  // AI 场景查找相关
  onAIFindScene?: (query: string) => Promise<{
    found: boolean;
    message: string;
    scene?: ScriptScene;
  }>;
  // 场景校准相关
  onCalibrateScenes?: () => void;  // 全局校准所有场景
  onCalibrateEpisodeScenes?: (episodeIndex: number) => void;  // 校准单集场景
  sceneCalibrationStatus?: 'idle' | 'calibrating' | 'completed' | 'error';
  // 预告片相关
  trailerConfig?: TrailerConfig | null;
  onGenerateTrailer?: (duration: TrailerDuration) => void;
  onClearTrailer?: () => void;
  trailerApiOptions?: TrailerGenerationOptions | null;
  // 单个分镜校准 callback
  onCalibrateSingleShot?: (shotId: string) => void;
  singleShotCalibrationStatus?: Record<string, 'idle' | 'calibrating' | 'completed' | 'error'>;
  // 校准严格度相关
  calibrationStrictness?: CalibrationStrictness;
  onCalibrationStrictnessChange?: (strictness: CalibrationStrictness) => void;
  lastFilteredCharacters?: FilteredCharacterRecord[];
  onRestoreFilteredCharacter?: (characterName: string) => void;
  // 校准确认弹窗
  calibrationDialogOpen?: boolean;
  pendingCalibrationCharacters?: ScriptCharacter[] | null;
  pendingFilteredCharacters?: FilteredCharacterRecord[];
  onConfirmCalibration?: (kept: ScriptCharacter[], filtered: FilteredCharacterRecord[]) => void;
  onCancelCalibration?: () => void;
}

export function EpisodeTree({
  scriptData,
  shots,
  shotStatus,
  selectedItemId,
  selectedItemType,
  onSelectItem,
  onAddEpisodeBundle,
  onUpdateEpisodeBundle,
  onDeleteEpisodeBundle,
  onAddScene,
  onUpdateScene,
  onDeleteScene,
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onDeleteShot,
  onGenerateEpisodeShots,
  onRegenerateAllShots,
  episodeGenerationStatus,
  onCalibrateShots,
  onCalibrateScenesShots,
  onCalibrateCharacters,
  characterCalibrationStatus,
  // AI 角色查找相关
  projectBackground,
  episodeRawScripts,
  onAIFindCharacter,
  aiFindingStatus,
  // AI 场景查找相关
  onAIFindScene,
  // 场景校准相关
  onCalibrateScenes,
  onCalibrateEpisodeScenes,
  sceneCalibrationStatus,
  // 预告片相关
  trailerConfig,
  onGenerateTrailer,
  onClearTrailer,
  trailerApiOptions,
  // 单个分镜校准
  onCalibrateSingleShot,
  singleShotCalibrationStatus,
  // 校准严格度相关
  calibrationStrictness,
  onCalibrationStrictnessChange,
  lastFilteredCharacters,
  onRestoreFilteredCharacter,
  // 校准确认弹窗
  calibrationDialogOpen,
  pendingCalibrationCharacters,
  pendingFilteredCharacters,
  onConfirmCalibration,
  onCancelCalibration,
}: EpisodeTreeProps) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set(["default"]));
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<EpisodeTreeFilter>("all");
  // Tab 状态: 剧集结构 vs 预告片
  const [activeTab, setActiveTab] = useState<EpisodeTreeTab>("structure");

  // Dialog states
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false);
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);

  // Edit states
  const [editingItem, setEditingItem] = useState<{ type: "episode" | "scene" | "character" | "shot"; id: string } | null>(null);
  const [targetEpisodeId, setTargetEpisodeId] = useState<string | null>(null);

  // Form states
  const [formData, setFormData] = useState<Record<string, string>>({});
  
  // AI 角色查找状态
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{
    found: boolean;
    name: string;
    message: string;
    character?: ScriptCharacter;
  } | null>(null);
  
  // AI 场景查找状态
  const [sceneAiQuery, setSceneAiQuery] = useState("");
  const [sceneAiSearching, setSceneAiSearching] = useState(false);
  const [sceneAiResult, setSceneAiResult] = useState<{
    found: boolean;
    message: string;
    scene?: ScriptScene;
  } | null>(null);

  // 被过滤角色查看弹窗
  const [filteredCharsDialogOpen, setFilteredCharsDialogOpen] = useState(false);
  
  // 如果没有episodes，创建一个默认的
  const episodes = useMemo(() => {
    if (!scriptData) return [];
    if (scriptData.episodes && scriptData.episodes.length > 0) {
      return scriptData.episodes;
    }
    // 默认单集
    return [{
      id: "default",
      index: 1,
      title: scriptData.title || "第1集",
      sceneIds: scriptData.scenes.map((s) => s.id),
    }];
  }, [scriptData]);

  const {
    deleteDialogOpen,
    setDeleteDialogOpen,
    deleteItem,
    handleDelete,
    confirmDelete,
  } = useEpisodeTreeDeleteController({
    episodes,
    onDeleteEpisodeBundle,
    onDeleteScene,
    onDeleteCharacter,
    onDeleteShot,
  });

  // 按场景分组的shots
  const shotsByScene = useMemo(() => {
    const map: Record<string, Shot[]> = {};
    shots.forEach((shot) => {
      const sceneId = shot.sceneRefId;
      if (!map[sceneId]) map[sceneId] = [];
      map[sceneId].push(shot);
    });
    return map;
  }, [shots]);

  // 筛选后的shots
  const filteredShots = useMemo(() => {
    if (filter === "all") return shots;
    return shots.filter((shot) => {
      const status = getShotCompletionStatus(shot);
      if (filter === "completed") return status === "completed";
      if (filter === "pending") return status !== "completed";
      return true;
    });
  }, [shots, filter]);

  const toggleEpisode = (id: string) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleScene = (id: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // CRUD handlers
  const handleAddEpisode = () => {
    setEditingItem(null);
    setFormData({ title: `第${episodes.length + 1}集`, description: "" });
    setEpisodeDialogOpen(true);
  };

  const handleEditEpisode = (ep: Episode) => {
    setEditingItem({ type: "episode", id: ep.id });
    setFormData({ title: ep.title, description: ep.description || "" });
    setEpisodeDialogOpen(true);
  };

  const handleSaveEpisode = () => {
    if (editingItem?.type === "episode") {
      const ep = episodes.find(e => e.id === editingItem.id);
      if (ep) {
        onUpdateEpisodeBundle?.(ep.index, { title: formData.title, synopsis: formData.description });
      }
    } else {
      onAddEpisodeBundle?.(formData.title || `第${episodes.length + 1}集`, formData.description || '');
    }
    setEpisodeDialogOpen(false);
    setFormData({});
  };

  const handleAddScene = (episodeId: string) => {
    setEditingItem(null);
    setTargetEpisodeId(episodeId);
    // 重置 AI 查找状态
    setSceneAiQuery("");
    setSceneAiResult(null);
    setSceneAiSearching(false);
    setFormData({ name: "", location: "", time: "白天", atmosphere: "" });
    setSceneDialogOpen(true);
  };

  const handleEditScene = (scene: ScriptScene) => {
    setEditingItem({ type: "scene", id: scene.id });
    setFormData({ name: scene.name || "", location: scene.location, time: scene.time || "白天", atmosphere: scene.atmosphere || "" });
    setSceneDialogOpen(true);
  };

  // AI 场景查找
  const handleSceneAISearch = useCallback(async () => {
    if (!sceneAiQuery.trim() || !onAIFindScene) return;
    
    setSceneAiSearching(true);
    setSceneAiResult(null);
    
    try {
      const result = await onAIFindScene(sceneAiQuery);
      setSceneAiResult(result);
      
      // 如果找到场景，自动填充表单
      if (result.scene) {
        setFormData({
          name: result.scene.name || "",
          location: result.scene.location || "",
          time: result.scene.time || "白天",
          atmosphere: result.scene.atmosphere || "",
        });
      }
    } catch (error) {
      console.error('[handleSceneAISearch] 错误:', error);
      setSceneAiResult({
        found: false,
        message: '查找失败，请重试',
      });
    } finally {
      setSceneAiSearching(false);
    }
  }, [sceneAiQuery, onAIFindScene]);

  // 确认添加 AI 查找到的场景
  const handleConfirmAIScene = useCallback(() => {
    if (!sceneAiResult?.scene) return;
    onAddScene?.(sceneAiResult.scene, targetEpisodeId || undefined);
    setSceneDialogOpen(false);
    setSceneAiQuery("");
    setSceneAiResult(null);
    setFormData({});
    setTargetEpisodeId(null);
  }, [sceneAiResult, onAddScene, targetEpisodeId]);

  const handleSaveScene = () => {
    if (editingItem?.type === "scene") {
      onUpdateScene?.(editingItem.id, { name: formData.name, location: formData.location, time: formData.time, atmosphere: formData.atmosphere });
    } else {
      // 如果有 AI 结果，使用 AI 生成的完整场景数据
      if (sceneAiResult?.scene) {
        onAddScene?.(sceneAiResult.scene, targetEpisodeId || undefined);
      } else {
        const newScene: ScriptScene = {
          id: `scene_${Date.now()}`,
          name: formData.name || "新场景",
          location: formData.location || "未知地点",
          time: formData.time || "白天",
          atmosphere: formData.atmosphere,
        };
        onAddScene?.(newScene, targetEpisodeId || undefined);
      }
    }
    setSceneDialogOpen(false);
    setFormData({});
    setSceneAiQuery("");
    setSceneAiResult(null);
    setTargetEpisodeId(null);
  };

  const handleAddCharacter = () => {
    setEditingItem(null);
    // 重置 AI 查找状态
    setAiQuery("");
    setAiResult(null);
    setAiSearching(false);
    setFormData({ name: "", gender: "", age: "", personality: "" });
    setCharacterDialogOpen(true);
  };

  const handleEditCharacter = (char: ScriptCharacter) => {
    setEditingItem({ type: "character", id: char.id });
    setFormData({ name: char.name, gender: char.gender || "", age: char.age || "", personality: char.personality || "" });
    setCharacterDialogOpen(true);
  };

  // AI 角色查找
  const handleAISearch = useCallback(async () => {
    if (!aiQuery.trim() || !onAIFindCharacter) return;
    
    setAiSearching(true);
    setAiResult(null);
    
    try {
      const result = await onAIFindCharacter(aiQuery);
      setAiResult(result);
      
      // 如果找到角色，自动填充表单
      if (result.character) {
        setFormData({
          name: result.character.name || "",
          gender: result.character.gender || "",
          age: result.character.age || "",
          personality: result.character.personality || "",
          role: result.character.role || "",
        });
      }
    } catch (error) {
      console.error('[handleAISearch] 错误:', error);
      setAiResult({
        found: false,
        name: "",
        message: '查找失败，请重试',
      });
    } finally {
      setAiSearching(false);
    }
  }, [aiQuery, onAIFindCharacter]);

  // 确认添加 AI 查找到的角色
  const handleConfirmAICharacter = useCallback(() => {
    if (!aiResult?.character) return;
    onAddCharacter?.(aiResult.character);
    setCharacterDialogOpen(false);
    setAiQuery("");
    setAiResult(null);
    setFormData({});
  }, [aiResult, onAddCharacter]);

  const handleSaveCharacter = () => {
    if (editingItem?.type === "character") {
      onUpdateCharacter?.(editingItem.id, { name: formData.name, gender: formData.gender, age: formData.age, personality: formData.personality });
    } else {
      // 如果有 AI 结果，使用 AI 生成的完整角色数据
      if (aiResult?.character) {
        onAddCharacter?.(aiResult.character);
      } else {
        const newChar: ScriptCharacter = {
          id: `char_${Date.now()}`,
          name: formData.name || "新角色",
          gender: formData.gender,
          age: formData.age,
          personality: formData.personality,
        };
        onAddCharacter?.(newChar);
      }
    }
    setCharacterDialogOpen(false);
    setFormData({});
    setAiQuery("");
    setAiResult(null);
  };

  // 计算整体进度
  const overallProgress = useMemo(() => {
    if (!scriptData) return '0/0';
    return calculateProgress(
      shots.map((s) => ({ status: getShotCompletionStatus(s) }))
    );
  }, [shots, scriptData]);

  if (!scriptData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        解析剧本后显示结构
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <EpisodeTreeHeader
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        title={scriptData.title}
        genre={scriptData.genre}
        overallProgress={overallProgress}
        filter={filter}
        onFilterChange={setFilter}
        onCalibrateScenes={onCalibrateScenes}
        sceneCalibrationStatus={sceneCalibrationStatus}
        onRegenerateAllShots={onRegenerateAllShots}
        onAddEpisode={handleAddEpisode}
      />
      {/* 预告片 Tab 内容 */}
      {activeTab === "trailer" && (
        <EpisodeTreeTrailerPanel
          shots={shots}
          selectedItemId={selectedItemId}
          selectedItemType={selectedItemType}
          onSelectItem={onSelectItem}
          trailerConfig={trailerConfig}
          onGenerateTrailer={onGenerateTrailer}
          onClearTrailer={onClearTrailer}
          trailerApiOptions={trailerApiOptions}
          onCalibrateSingleShot={onCalibrateSingleShot}
          singleShotCalibrationStatus={singleShotCalibrationStatus}
        />
      )}

      {/* 剧集结构 Tab 内容 - 树形结构 */}
      {activeTab === "structure" && (
      <ScrollArea className="flex-1">
        <div className="p-2 pb-20 space-y-1">
          <EpisodeTreeStructure
            episodes={episodes}
            scenes={scriptData.scenes}
            shots={shots}
            shotsByScene={shotsByScene}
            filter={filter}
            expandedEpisodes={expandedEpisodes}
            expandedScenes={expandedScenes}
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
            shotStatus={shotStatus}
            episodeGenerationStatus={episodeGenerationStatus}
            sceneCalibrationStatus={sceneCalibrationStatus}
            onSelectItem={onSelectItem}
            onToggleEpisode={toggleEpisode}
            onToggleScene={toggleScene}
            onAddScene={handleAddScene}
            onEditEpisode={handleEditEpisode}
            onEditScene={handleEditScene}
            onDeleteItem={handleDelete}
            onGenerateEpisodeShots={onGenerateEpisodeShots}
            onCalibrateShots={onCalibrateShots}
            onCalibrateEpisodeScenes={onCalibrateEpisodeScenes}
            onCalibrateScenesShots={onCalibrateScenesShots}
          />

          <EpisodeTreeCharacterList
            characters={scriptData.characters}
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
            onSelectItem={onSelectItem}
            onEditCharacter={handleEditCharacter}
            onDeleteCharacter={(character) => handleDelete("character", character.id, character.name)}
            onAddCharacter={handleAddCharacter}
            onCalibrateCharacters={onCalibrateCharacters}
            characterCalibrationStatus={characterCalibrationStatus}
            calibrationStrictness={calibrationStrictness}
            onCalibrationStrictnessChange={onCalibrationStrictnessChange}
            onOpenFilteredCharacters={() => setFilteredCharsDialogOpen(true)}
          />
        </div>
      </ScrollArea>
      )}

      <EpisodeTreeEpisodeDialog
        open={episodeDialogOpen}
        mode={editingItem?.type === "episode" ? "edit" : "create"}
        title={formData.title || ""}
        description={formData.description || ""}
        onOpenChange={setEpisodeDialogOpen}
        onTitleChange={(title) => setFormData({ ...formData, title })}
        onDescriptionChange={(description) => setFormData({ ...formData, description })}
        onSave={handleSaveEpisode}
      />

      <EpisodeTreeEntityDialogs
        sceneOpen={sceneDialogOpen}
        characterOpen={characterDialogOpen}
        editingType={editingItem?.type || null}
        formData={formData}
        onFormFieldChange={(field, value) => setFormData((current) => ({ ...current, [field]: value }))}
        onSceneOpenChange={(open) => {
          setSceneDialogOpen(open);
          if (!open) {
            setSceneAiQuery("");
            setSceneAiResult(null);
            setSceneAiSearching(false);
          }
        }}
        onCharacterOpenChange={(open) => {
          setCharacterDialogOpen(open);
          if (!open) {
            setAiQuery("");
            setAiResult(null);
            setAiSearching(false);
          }
        }}
        sceneQuery={sceneAiQuery}
        sceneSearching={sceneAiSearching}
        sceneResult={sceneAiResult}
        onSceneQueryChange={setSceneAiQuery}
        onSceneSearch={handleSceneAISearch}
        canFindScene={Boolean(onAIFindScene)}
        onSaveScene={handleSaveScene}
        onConfirmScene={handleConfirmAIScene}
        characterQuery={aiQuery}
        characterSearching={aiSearching}
        characterResult={aiResult}
        onCharacterQueryChange={setAiQuery}
        onCharacterSearch={handleAISearch}
        canFindCharacter={Boolean(onAIFindCharacter)}
        onSaveCharacter={handleSaveCharacter}
        onConfirmCharacter={handleConfirmAICharacter}
      />

      <EpisodeTreeDeleteDialog
        open={deleteDialogOpen}
        item={deleteItem}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
      />

      <EpisodeTreeCharacterCalibrationDialogs
        calibrationOpen={calibrationDialogOpen}
        pendingCharacters={pendingCalibrationCharacters}
        pendingFilteredCharacters={pendingFilteredCharacters}
        onConfirm={onConfirmCalibration}
        onCancel={onCancelCalibration}
        filteredOpen={filteredCharsDialogOpen}
        onFilteredOpenChange={setFilteredCharsDialogOpen}
        lastFilteredCharacters={lastFilteredCharacters}
        onRestoreFilteredCharacter={onRestoreFilteredCharacter}
      />
    </div>
  );
}
