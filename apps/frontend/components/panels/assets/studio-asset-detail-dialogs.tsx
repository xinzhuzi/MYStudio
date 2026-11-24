/**
 * 资产详情·灯箱与弹窗群(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * 全屏缩放预览(节内序列)+音色分配/设定 MD/源提示词/真源 JSON/生成结果/查词六弹窗。
 * props 与宿主变量同名,块内零改动。
 */
import type { Dispatch, SetStateAction } from "react";
import type { AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import type { TtsSpeakerId } from "@/types/tts";
import type { CharacterJsonInfo } from "@/lib/studio/asset-character-json";
import type { ParsedAssetNames } from "@/lib/studio/asset-names";
import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";
import { StudioAssetSettingDialog } from "./StudioAssetSettingDialog";
import { StudioAssetSourcePromptDialog } from "./studio-asset-source-prompt-dialog";
import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";
import {
  StudioAssetGenerationResultDialog,
  type GenerationOutcome,
} from "./studio-asset-generation-result-dialog";
import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";
import { promptJsonTypeOf } from "./studio-asset-detail-helpers";

export function StudioAssetDetailDialogs({
  asset,
  parsedDraftName,
  linkedSpeakerIds,
  voiceAssignOpen,
  setVoiceAssignOpen,
  settingEditorOpen,
  setSettingEditorOpen,
  draftDescription,
  draftSetting,
  characterJsonOpen,
  onApply,
  sourcePromptOpen,
  setSourcePromptOpen,
  focusKind,
  characterJsonInfo,
  storePromptHit,
  setCharacterJsonOpen,
  generationOutcome,
  setGenerationOutcome,
  promptInspectTarget,
  setPromptInspectTarget,
  handleRerollFromPrompt,
}: {
  asset: StudioAssetSummary;
  parsedDraftName: ParsedAssetNames;
  linkedSpeakerIds: TtsSpeakerId[];
  voiceAssignOpen: boolean;
  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;
  settingEditorOpen: boolean;
  setSettingEditorOpen: Dispatch<SetStateAction<boolean>>;
  draftDescription: string;
  draftSetting: string;
  characterJsonOpen: boolean;
  onApply: (next: { description: string; setting: string }) => void;
  sourcePromptOpen: boolean;
  setSourcePromptOpen: Dispatch<SetStateAction<boolean>>;
  focusKind: AssetImageKind | null;
  characterJsonInfo: CharacterJsonInfo | null;
  storePromptHit: boolean;
  setCharacterJsonOpen: Dispatch<SetStateAction<boolean>>;
  generationOutcome: GenerationOutcome | null;
  setGenerationOutcome: Dispatch<SetStateAction<GenerationOutcome | null>>;
  promptInspectTarget: PromptTextInspectTarget | null;
  setPromptInspectTarget: Dispatch<SetStateAction<PromptTextInspectTarget | null>>;
  handleRerollFromPrompt: (payload: {
    imageName: string;
    imagePath: string;
    imageUrl?: string;
    finalText: string;
    routeHint: "i2i" | "t2i";
    hasInjectedLayers: boolean;
  }) => Promise<void>;
}) {
  return (
    <>
      {asset.type === "role" && (
        <RoleVoiceAssignDialog
          character={{ id: asset.id, name: parsedDraftName.primaryName }}
          linkedSpeakerIds={linkedSpeakerIds}
          open={voiceAssignOpen}
          onOpenChange={setVoiceAssignOpen}
        />
      )}
      {/* 1120 版式③:设定 MD 编辑弹窗(描述+设定同框,应用回填 draft) */}
      {asset.type !== "audio" && (
        <StudioAssetSettingDialog
          open={settingEditorOpen}
          name={parsedDraftName.primaryName}
          description={draftDescription}
          setting={draftSetting}
          onOpenChange={setSettingEditorOpen}
          onApply={onApply}
        />
      )}
      {/* 10-25 分层面板役:③实发终稿/B-3 查词共用 tEXt 查询弹层(打开=目标非空;
          关闭清目标,复用按目标重读) */}
      <StudioAssetSourcePromptDialog
        open={sourcePromptOpen}
        onOpenChange={setSourcePromptOpen}
        initialKind={focusKind}
      />
      {/* 提示词真源 JSON(10-26 用户令;10-27 store 位接线):完整展示+可编辑
          (repo 手工真源与 store 位生成件同待遇);宿主关即卸。type 收窄=真源域
          只覆盖 role/scene/tool 三轨,clip/audio 不传(按 undefined 平铺名探测)。 */}
      <StudioAssetCharacterJsonDialog
        open={characterJsonOpen && Boolean(characterJsonInfo || storePromptHit)}
        characterName={asset.name}
        type={promptJsonTypeOf(asset.type)}
        onOpenChange={setCharacterJsonOpen}
      />
      {/* R5 生成结果弹窗(10-26 用户令:每次生成完成自动弹出)。挂载守卫=有记录
          (宿主关=页卸载,卸载后任何异步竞态漏网 setState 也零渲染;嵌套弹窗已知坑①) */}
      <StudioAssetGenerationResultDialog
        open={generationOutcome !== null}
        onOpenChange={(next) => {
          if (!next) setGenerationOutcome(null);
        }}
        outcome={generationOutcome}
      />
      <StudioAssetPromptTextDialog
        open={promptInspectTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPromptInspectTarget(null);
        }}
        target={promptInspectTarget}
        onReroll={
          promptInspectTarget
            ? ({ breakdown }) => {
                // B-4(10-25 追加令):按引擎实收终稿原路重掷(动作内含忙守卫/相位/收编)
                handleRerollFromPrompt({
                  imageName: promptInspectTarget.imageName,
                  imagePath: promptInspectTarget.imagePath,
                  imageUrl: promptInspectTarget.imageUrl,
                  finalText: breakdown.finalText,
                  routeHint: breakdown.routeHint,
                  hasInjectedLayers: breakdown.layers.length > 0,
                });
              }
            : undefined
        }
      />
    </>
  );
}
