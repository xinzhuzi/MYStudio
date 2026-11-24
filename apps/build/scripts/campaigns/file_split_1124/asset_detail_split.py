#!/usr/bin/env python3
"""1124 超线拆分·资产详情视图第二刀(2026-11-24):钩子化 + 区域组件化。
前提:辅助件已由 ts_split.mjs 搬入 studio-asset-detail-helpers.ts。
做法:按唯一锚点切出代码块,逐字搬进新文件(钩子/组件 props 与视图变量同名,块内零改动),
视图里替换为同名额钩子调用/组件调用;最后按清单修剪视图不再用的导入。
每一步断言锚点唯一,任何不匹配立即失败不写盘。
"""
import sys

V = "frontend/components/panels/assets/StudioAssetDetailView.tsx"
src = open(V, encoding="utf-8").read()
orig_len = len(src)

def block(start: str, end: str | None = None, *, inclusive_end: bool = True) -> str:
    """按锚点取块。end 缺省=start 的行尾;inclusive_end=False 时块到 end 之前为止。"""
    assert src.count(start) == 1, f"起点锚不唯一/缺失: {start[:70]!r}"
    i = src.index(start)
    if end is None:
        j = src.index("\n", i) + 1
    else:
        assert src.count(end) == 1, f"终点锚不唯一/缺失: {end[:70]!r}"
        j = src.index(end, i)
        j = j + len(end) if inclusive_end else j
    return src[i:j]

def replace_once(old: str, new: str, label: str) -> None:
    global src
    assert src.count(old) == 1, f"{label}: 目标文本不唯一(count={src.count(old)})"
    src = src.replace(old, new)

def drop_import_line(imp: str, label: str) -> None:
    global src
    assert src.count(imp) == 1, f"import({label}) 不唯一: {src.count(imp)}"
    src = src.replace(imp, "", 1)

# ---------- 1. 折叠记忆 hook ----------
b_col_states = block(
    "  // 10-24 布局重造批1:基础信息区折叠态(默认展开;localStorage 记忆)",
    "  const [galleryCollapsed, setGalleryCollapsed] = useState(readGalleryCollapsed);\n",
)
b_col_effects = block(
    "  useEffect(() => {\n    try {\n      window.localStorage?.setItem(META_COLLAPSED_STORAGE_KEY",
    "  }, [galleryCollapsed]);\n",
)
open("frontend/components/panels/assets/studio-asset-detail-collapsed.ts", "w", encoding="utf-8").write(
    "/**\n * 基础信息区/图片区折叠态记忆(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出;\n"
    " * localStorage 键与读写逻辑零改动)。\n */\n"
    'import { useEffect, useState } from "react";\n'
    'import { GALLERY_COLLAPSED_STORAGE_KEY, META_COLLAPSED_STORAGE_KEY, readGalleryCollapsed, readMetaCollapsed } from "./studio-asset-detail-helpers";\n\n'
    "export function useDetailCollapsedFlags() {\n"
    + b_col_states
    + "\n"
    + b_col_effects
    + "\n  return { metaCollapsed, setMetaCollapsed, galleryCollapsed, setGalleryCollapsed };\n}\n"
)
replace_once(b_col_states, "  const { metaCollapsed, setMetaCollapsed, galleryCollapsed, setGalleryCollapsed } = useDetailCollapsedFlags();\n", "折叠态状态行")
replace_once(b_col_effects, "", "折叠态 effects")

# ---------- 2. 族图/展示序 hook ----------
b_fam = block(
    "  // R4 族聚显(1120 独立页役:拉取随 view)",
    "  displayImagesRef.current = displayImages;\n",
)
b_clamp = block(
    "  // 10-24 布局重造:展示序缩短时夹回选中位(删图/家族过滤后选中不悬空)",
    "  }, [displayImages.length]);\n",
)
open("frontend/components/panels/assets/studio-asset-detail-family-images.ts", "w", encoding="utf-8").write(
    "/**\n * 族聚显拉取与展示序(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * 进页/切资产按资产键自取族图(连点换行序号守卫),展示序=族序+live 新图置顶,\n"
    " * 删图/家族过滤后选中位夹回。逻辑零改动。\n */\n"
    'import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";\n'
    'import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";\n'
    'import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";\n'
    'import {\n  fetchFamilyImageEntries,\n  mergeFamilyDisplayImages,\n  type FamilyDisplayImageEntry,\n  type FamilyImageEntry,\n} from "@/lib/studio/asset-family-images";\n\n'
    "export function useAssetDisplayImages({\n  asset,\n  images,\n  externalFamilyImages,\n  removedFamilyPaths,\n  setCurrentIndex,\n}: {\n"
    "  asset: StudioAssetSummary | null;\n  images: AssetImage[];\n"
    "  /** 外部直供族图(测试/特殊场景);undefined=由本 hook 按资产键自取。 */\n"
    "  externalFamilyImages?: FamilyImageEntry[];\n"
    "  /** 本会话已删族兄弟路径(从展示序滤掉)。 */\n  removedFamilyPaths: string[];\n"
    "  setCurrentIndex: Dispatch<SetStateAction<number>>;\n"
    "}) {\n"
    + b_fam
    + "\n"
    + b_clamp
    + "\n  return { familyImages, displayImages, displayImagesRef };\n}\n"
)
replace_once(b_fam, "  const { familyImages, displayImages, displayImagesRef } = useAssetDisplayImages({\n    asset,\n    images,\n    externalFamilyImages,\n    removedFamilyPaths,\n    setCurrentIndex,\n  });\n", "族图块")
replace_once(b_clamp, "", "夹回 effect")

# ---------- 3. 角色真源 hook ----------
b_src = block(
    "  // 角色真源 JSON(10-26):按资产名解析",
    "  /** 关弹窗/切资产时清理生成路的阶段选择",
    inclusive_end=False,
)
b_src = b_src.rstrip() + "\n"
open("frontend/components/panels/assets/studio-asset-detail-prompt-source.ts", "w", encoding="utf-8").write(
    "/**\n * 角色提示词真源(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * repo 手工真源/store 位探测/DB 回退三层目录统一为双卡渲染目录;派发/保存用主体句\n"
    " * (镜像激活=真源派生句,否则 DB 值)。逻辑零改动。\n */\n"
    'import { useEffect, useMemo, useState } from "react";\n'
    'import type { StudioAssetSummary } from "@/types/studio-assets";\n'
    'import {\n  deriveBareSubjectFromClothed,\n  deriveSubjectFromCharacterJson,\n  getCharacterJsonInfo,\n  loadCharacterJsonText,\n  parseCharacterPromptCatalog,\n  resolveAssetPromptJsonInfo,\n  type AssetPromptJsonInfo,\n  type CharacterPromptCatalog,\n} from "@/lib/studio/asset-character-json";\n'
    'import { promptJsonTypeOf } from "./studio-asset-detail-helpers";\n\n'
    "export function useAssetCharacterPromptSource({\n  asset,\n  selectedStage,\n  draftPrompt,\n  characterJsonOpen,\n}: {\n"
    "  asset: StudioAssetSummary | null;\n  selectedStage: string | null;\n  draftPrompt: string;\n  characterJsonOpen: boolean;\n"
    "}) {\n"
    + b_src
    + "\n  return {\n    characterJsonInfo,\n    storePromptHit,\n    characterSubjectMirror,\n    characterBodyBaseSubject,\n    characterPromptCatalog,\n    unifiedPromptCatalog,\n    subjectCardEditable,\n    subjectMirrorActive,\n    effectiveSubjectPrompt,\n  };\n}\n"
)
replace_once(b_src, "  const {\n    characterJsonInfo,\n    storePromptHit,\n    characterSubjectMirror,\n    characterBodyBaseSubject,\n    characterPromptCatalog,\n    unifiedPromptCatalog,\n    subjectCardEditable,\n    subjectMirrorActive,\n    effectiveSubjectPrompt,\n  } = useAssetCharacterPromptSource({ asset, selectedStage, draftPrompt, characterJsonOpen });\n", "真源块")

# ---------- 4. 实发终稿探针 hook ----------
b_probe_state = block(
    '  // ③ 实发终稿(A-2③):探针态+弹层目标(弹层目标亦承载 B-3 查词,共用壳)\n  const [finalDraftProbe, setFinalDraftProbe] = useState<FinalDraftProbe>({ status: "idle" });\n',
)
b_probe_effect = block(
    "  // ③ 实发终稿探针(10-25 分层面板役 A-2③,PRD §4.1 算法)",
    "  }, [focusKind, displayImages]);\n",
)
open("frontend/components/panels/assets/studio-asset-detail-probe.ts", "w", encoding="utf-8").write(
    "/**\n * 实发终稿探针(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * displayImages 按 focusKind 组回溯读 tEXt,状态机 idle/no-products/probing/\n"
    " * unreadable/bridge-missing/ready。逻辑零改动。\n */\n"
    'import { useEffect, useState } from "react";\n'
    'import type { AssetImageKind } from "@/types/studio-assets";\n'
    'import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";\n'
    'import { buildFinalDraftCandidates } from "@/lib/studio/asset-prompt-inspect";\n'
    'import type { FamilyDisplayImageEntry } from "@/lib/studio/asset-family-images";\n'
    'import type { FinalDraftProbe } from "./studio-asset-detail-helpers";\n\n'
    "export function useFinalDraftProbe({\n  focusKind,\n  displayImages,\n}: {\n"
    "  focusKind: AssetImageKind | null;\n  displayImages: FamilyDisplayImageEntry[];\n"
    "}) {\n"
    + b_probe_state.split("\n", 1)[1]  # 去掉原注释行(hook 文件头已说明);状态行逐字保留
    + b_probe_effect
    + "\n  return { finalDraftProbe, setFinalDraftProbe };\n}\n"
)
replace_once(b_probe_state, "", "探针状态行")
replace_once(b_probe_effect, "  const { finalDraftProbe, setFinalDraftProbe } = useFinalDraftProbe({ focusKind, displayImages });\n", "探针 effect")

# ---------- 5. 音色/关联说话人 hook ----------
b_voice_stores = block(
    "  const activeTtsProjectId = useTtsStore((s) => s.activeProjectId);",
    "  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);\n",
)
b_voice_linked = block(
    "  // linkedSpeakerIds(1120 独立页役:计算随弹窗退役迁入 view 消费)",
    "  }, [asset?.type, asset?.name, linkedCharacters, linkedProjectId, detailOrigin, detailSourceRowId]);\n",
)
b_voice_derived = block(
    "  const roleSpeakerId = toRoleSpeakerId(asset.id);",
    "  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;\n",
)
open("frontend/components/panels/assets/studio-asset-detail-voice.ts", "w", encoding="utf-8").write(
    "/**\n * 资产详情音色/关联说话人(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * 音色绑定/档案解析 + 资产名全别名匹配的角色库 speaker 键收集。逻辑零改动。\n */\n"
    'import { useMemo } from "react";\n'
    'import type { StudioAssetSummary } from "@/types/studio-assets";\n'
    'import type { TtsSpeakerId } from "@/types/tts";\n'
    'import { useCharacterLibraryStore } from "@/stores/library/character-library-store";\n'
    'import { useProjectStore } from "@/stores/project/project-store";\n'
    'import { useAssetDetailViewStore } from "@/stores/assets/asset-detail-view-store";\n'
    'import { useTtsStore } from "@/stores/tts/tts-store";\n'
    'import { parseAssetNames } from "@/lib/studio/asset-names";\n'
    'import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";\n\n'
    "export function useAssetDetailVoice(asset: StudioAssetSummary | null) {\n"
    + b_voice_stores
    + b_voice_linked
    + "\n  // 音色绑定/档案(详情页头卡与试听;asset 为空时恒 undefined)\n"
    + b_voice_derived.replace(
        "const roleSpeakerId = toRoleSpeakerId(asset.id);",
        "const roleSpeakerId = asset ? toRoleSpeakerId(asset.id) : undefined;",
    ).replace(
        'const roleVoiceBinding = asset.type === "role" ? roleVoiceBindings[roleSpeakerId] : undefined;',
        'const roleVoiceBinding = asset?.type === "role" && roleSpeakerId ? roleVoiceBindings[roleSpeakerId] : undefined;',
    )
    + "\n  return { roleSpeakerId, roleVoiceBinding, roleVoiceProfile, linkedSpeakerIds };\n}\n"
)
replace_once(b_voice_stores, "", "tts store 行")
replace_once(b_voice_linked, "  const { roleSpeakerId, roleVoiceBinding, roleVoiceProfile, linkedSpeakerIds } = useAssetDetailVoice(asset);\n", "关联说话人块")
replace_once(b_voice_derived, "", "音色派生块")

# ---------- 6. 水合/清场 hook ----------
b_hyd = block(
    "  // 「弹窗关即清理」effect 随弹窗壳退役(1120 详情独立页):「宿主关」=组件卸载,",
    "  }, [asset?.id]);\n",
)
open("frontend/components/panels/assets/studio-asset-detail-hydration.ts", "w", encoding="utf-8").write(
    "/**\n * 资产详情水合与换靶清场(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * 切资产/清空时复位全部会话态、按行播种草稿、桥 get 回填全列。ctx 注入写法沿\n"
    " * studio-asset-detail-actions 同款(08-31 专批范式);处理器体零改动。\n */\n"
    'import type { Dispatch, SetStateAction } from "react";\n'
    'import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";\n'
    'import { toast } from "sonner";\n'
    'import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";\n'
    'import { parsePromptOverrides } from "@/lib/studio/asset-prompt-layers";\n'
    'import { getAssetOperationError } from "./studio-asset-detail-utils";\n'
    'import type { AssetTypeShotFailureState } from "./studio-asset-detail-preview-pane";\n'
    'import type { GenerationOutcome, GenerationOutcomeRecord } from "./studio-asset-generation-result-dialog";\n'
    'import type { PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";\n\n'
    "type GeneratePhase = \"polishing\" | \"generating\" | \"saving\" | \"done\" | \"failed\" | null;\n"
    "type LanePhase = \"generating\" | \"done\" | \"failed\" | null;\n\n"
    "export function useAssetDetailHydration(ctx: {\n"
    "  asset: StudioAssetSummary | null;\n"
    "  setFullAsset: Dispatch<SetStateAction<StudioAssetSummary | null>>;\n"
    "  setImages: Dispatch<SetStateAction<AssetImage[]>>;\n"
    "  setCurrentIndex: Dispatch<SetStateAction<number>>;\n"
    "  setRecognizedText: Dispatch<SetStateAction<string | null>>;\n"
    "  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  setRemovedFamilyPaths: Dispatch<SetStateAction<string[]>>;\n"
    "  setPreviewIndex: Dispatch<SetStateAction<number | null>>;\n"
    "  setFocusKind: Dispatch<SetStateAction<AssetImageKind | null>>;\n"
    "  setPrePolishPrompt: Dispatch<SetStateAction<string | null>>;\n"
    "  setPromptInspectTarget: Dispatch<SetStateAction<PromptTextInspectTarget | null>>;\n"
    "  setGenerationOutcome: Dispatch<SetStateAction<GenerationOutcome | null>>;\n"
    "  queueRecordsRef: { current: GenerationOutcomeRecord[] };\n"
    "  setPromptOverridesDraft: Dispatch<SetStateAction<Partial<Record<AssetImageKind, string>>>>;\n"
    "  setPromptOverridesHydrated: Dispatch<SetStateAction<boolean>>;\n"
    "  setInstructionDrafts: Dispatch<SetStateAction<Partial<Record<AssetImageKind, string>>>>;\n"
    "  setInstructionEditOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  setTypeShotFailure: Dispatch<SetStateAction<AssetTypeShotFailureState | null>>;\n"
    "  setGeneratePhase: Dispatch<SetStateAction<GeneratePhase>>;\n"
    "  setI2iPhase: Dispatch<SetStateAction<LanePhase>>;\n"
    "  setFacePhase: Dispatch<SetStateAction<LanePhase>>;\n"
    "  setExpressionPhase: Dispatch<SetStateAction<LanePhase>>;\n"
    "  setTypeShotPhase: Dispatch<SetStateAction<LanePhase>>;\n"
    "  setBusyTarget: Dispatch<SetStateAction<string | null>>;\n"
    "  setI2iMessage: Dispatch<SetStateAction<string>>;\n"
    "  setExpressionMessage: Dispatch<SetStateAction<string>>;\n"
    "  setTypeShotMessage: Dispatch<SetStateAction<string>>;\n"
    "  setFaceMessage: Dispatch<SetStateAction<string>>;\n"
    "  resetStageState: () => void;\n"
    "}) {\n"
    "  const {\n"
    "    asset, setFullAsset, setImages, setCurrentIndex, setRecognizedText, setVoiceAssignOpen,\n"
    "    setRemovedFamilyPaths, setPreviewIndex, setFocusKind, setPrePolishPrompt, setPromptInspectTarget,\n"
    "    setGenerationOutcome, queueRecordsRef, setPromptOverridesDraft, setPromptOverridesHydrated,\n"
    "    setInstructionDrafts, setInstructionEditOpen, setTypeShotFailure, setGeneratePhase, setI2iPhase,\n"
    "    setFacePhase, setExpressionPhase, setTypeShotPhase, setBusyTarget, setI2iMessage,\n"
    "    setExpressionMessage, setTypeShotMessage, setFaceMessage, resetStageState,\n"
    "  } = ctx;\n"
    + b_hyd
    + "}\n"
)
replace_once(b_hyd, "  useAssetDetailHydration({\n"
    "    asset,\n    setFullAsset,\n    setImages,\n    setCurrentIndex,\n    setRecognizedText,\n    setVoiceAssignOpen,\n    setRemovedFamilyPaths,\n    setPreviewIndex,\n    setFocusKind,\n    setPrePolishPrompt,\n    setPromptInspectTarget,\n    setGenerationOutcome,\n    queueRecordsRef,\n    setPromptOverridesDraft,\n    setPromptOverridesHydrated,\n    setInstructionDrafts,\n    setInstructionEditOpen,\n    setTypeShotFailure,\n    setGeneratePhase,\n    setI2iPhase,\n    setFacePhase,\n    setExpressionPhase,\n    setTypeShotPhase,\n    setBusyTarget,\n    setI2iMessage,\n    setExpressionMessage,\n    setTypeShotMessage,\n    setFaceMessage,\n    resetStageState,\n  });\n", "水合 effect")

# ---------- 7. 基础信息区组件(含音色卡与提示词区,块内零改动) ----------
b_meta = block(
    "              {/* ① 基础信息区(1120 三令1 更名;紧凑四行网格+可折叠,",
    "              {/* 空壳资产生成引导",
    inclusive_end=False,
).rstrip() + "\n"
meta_props = """export function StudioAssetMetaRegion({
  asset,
  displayName,
  draftName,
  setDraftName,
  parsedDraftName,
  metaCollapsed,
  setMetaCollapsed,
  spokenText,
  setDraftDescription,
  setRecognizedText,
  setSettingEditorOpen,
  setVoiceAssignOpen,
  roleVoiceBinding,
  roleVoiceProfile,
  imageRuleRows,
  finalDraftProbe,
  handleOpenFinalDraft,
  setSourcePromptOpen,
  characterJsonInfo,
  storePromptHit,
  setCharacterJsonOpen,
  unifiedPromptCatalog,
  subjectCardEditable,
  setSubjectExpanded,
  setSubjectEditorOpen,
  subjectEditorOpen,
  focusIsI2iFamily,
  focusKind,
  subjectValue,
  handleSubjectChange,
  kindSlotActive,
  subjectMirrorActive,
}: {
  asset: StudioAssetSummary;
  displayName: string;
  draftName: string;
  setDraftName: Dispatch<SetStateAction<string>>;
  parsedDraftName: ParsedAssetNames;
  metaCollapsed: boolean;
  setMetaCollapsed: Dispatch<SetStateAction<boolean>>;
  spokenText: string;
  setDraftDescription: Dispatch<SetStateAction<string>>;
  setRecognizedText: Dispatch<SetStateAction<string | null>>;
  setSettingEditorOpen: Dispatch<SetStateAction<boolean>>;
  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;
  roleVoiceBinding: ProjectVoiceBinding | undefined;
  roleVoiceProfile: VoiceProfile | undefined;
  imageRuleRows: Array<{ kind: AssetImageKind; aspect: string; core: boolean; count: number }>;
  finalDraftProbe: FinalDraftProbe;
  handleOpenFinalDraft: () => void;
  setSourcePromptOpen: Dispatch<SetStateAction<boolean>>;
  characterJsonInfo: CharacterJsonInfo | null;
  storePromptHit: boolean;
  setCharacterJsonOpen: Dispatch<SetStateAction<boolean>>;
  unifiedPromptCatalog: CharacterPromptCatalog | null;
  subjectCardEditable: boolean;
  setSubjectExpanded: Dispatch<SetStateAction<boolean>>;
  setSubjectEditorOpen: Dispatch<SetStateAction<boolean>>;
  subjectEditorOpen: boolean;
  focusIsI2iFamily: boolean;
  focusKind: AssetImageKind | null;
  subjectValue: string;
  handleSubjectChange: (value: string) => void;
  kindSlotActive: boolean;
  subjectMirrorActive: boolean;
}) {
  return (
    <>
"""
meta_call = """              <StudioAssetMetaRegion
                asset={asset}
                displayName={displayName}
                draftName={draftName}
                setDraftName={setDraftName}
                parsedDraftName={parsedDraftName}
                metaCollapsed={metaCollapsed}
                setMetaCollapsed={setMetaCollapsed}
                spokenText={spokenText}
                setDraftDescription={setDraftDescription}
                setRecognizedText={setRecognizedText}
                setSettingEditorOpen={setSettingEditorOpen}
                setVoiceAssignOpen={setVoiceAssignOpen}
                roleVoiceBinding={roleVoiceBinding}
                roleVoiceProfile={roleVoiceProfile}
                imageRuleRows={imageRuleRows}
                finalDraftProbe={finalDraftProbe}
                handleOpenFinalDraft={handleOpenFinalDraft}
                setSourcePromptOpen={setSourcePromptOpen}
                characterJsonInfo={characterJsonInfo}
                storePromptHit={storePromptHit}
                setCharacterJsonOpen={setCharacterJsonOpen}
                unifiedPromptCatalog={unifiedPromptCatalog}
                subjectCardEditable={subjectCardEditable}
                setSubjectExpanded={setSubjectExpanded}
                setSubjectEditorOpen={setSubjectEditorOpen}
                subjectEditorOpen={subjectEditorOpen}
                focusIsI2iFamily={focusIsI2iFamily}
                focusKind={focusKind}
                subjectValue={subjectValue}
                handleSubjectChange={handleSubjectChange}
                kindSlotActive={kindSlotActive}
                subjectMirrorActive={subjectMirrorActive}
              />
"""
open("frontend/components/panels/assets/studio-asset-detail-meta-region.tsx", "w", encoding="utf-8").write(
    "/**\n * 资产详情·基础信息区(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * 可折叠壳+名字/设定/说话内容+音色卡+提示词区(图像规范清单/源提示词/真源 JSON/\n"
    " * 实发终稿动作组、双卡目录与主体句编辑)。props 与宿主变量同名,块内零改动。\n */\n"
    'import type { Dispatch, SetStateAction } from "react";\n'
    'import { Badge } from "@/components/ui/badge";\n'
    'import { Button } from "@/components/ui/button";\n'
    'import { Textarea } from "@/components/ui/textarea";\n'
    'import type { AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";\n'
    'import type { CharacterJsonInfo, CharacterPromptCatalog } from "@/lib/studio/asset-character-json";\n'
    'import type { ParsedAssetNames } from "@/lib/studio/asset-names";\n'
    'import type { ProjectVoiceBinding, VoiceProfile } from "@/types/tts";\n'
    'import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";\n'
    'import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";\n'
    'import { ChevronDown, ChevronRight, FileJson, FileText, Loader2, Volume2 } from "lucide-react";\n'
    'import {\n  TYPE_LABEL,\n  displayAudioPath,\n  promptJsonTypeOf,\n  subjectDowngradeNote,\n  type FinalDraftProbe,\n} from "./studio-asset-detail-helpers";\n\n'
    + meta_props
    + b_meta
    + "    </>\n  );\n}\n"
)
replace_once(block(
    "              {/* ① 基础信息区(1120 三令1 更名;紧凑四行网格+可折叠,",
    "              {/* 空壳资产生成引导",
    inclusive_end=False,
), meta_call, "基础信息区组件化")

# ---------- 8. 灯箱+弹窗群组件(块内零改动) ----------
b_dlg = block(
    "      {/* 10-19 用户令:全屏缩放预览",
    "    </>\n  );",
    inclusive_end=False,
).rstrip() + "\n"
open("frontend/components/panels/assets/studio-asset-detail-dialogs.tsx", "w", encoding="utf-8").write(
    "/**\n * 资产详情·灯箱与弹窗群(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):\n"
    " * 全屏缩放预览(节内序列)+音色分配/设定 MD/源提示词/真源 JSON/生成结果/查词六弹窗。\n"
    " * props 与宿主变量同名,块内零改动。\n */\n"
    'import type { Dispatch, SetStateAction } from "react";\n'
    'import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";\n'
    'import type { TtsSpeakerId } from "@/types/tts";\n'
    'import type { CharacterJsonInfo } from "@/lib/studio/asset-character-json";\n'
    'import type { ParsedAssetNames } from "@/lib/studio/asset-names";\n'
    'import type { FamilyDisplayImageEntry } from "@/lib/studio/asset-family-images";\n'
    'import { classifyAssetImage } from "@/lib/studio/asset-image-kind";\n'
    'import { ImagePreviewModal } from "@/components/ui/media-preview-modal";\n'
    'import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";\n'
    'import { StudioAssetSettingDialog } from "./StudioAssetSettingDialog";\n'
    'import { StudioAssetSourcePromptDialog } from "./studio-asset-source-prompt-dialog";\n'
    'import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";\n'
    'import {\n  StudioAssetGenerationResultDialog,\n  type GenerationOutcome,\n} from "./studio-asset-generation-result-dialog";\n'
    'import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";\n'
    'import { promptJsonTypeOf } from "./studio-asset-detail-helpers";\n\n'
    "export function StudioAssetDetailDialogs({\n"
    "  asset,\n  displayImages,\n  previewIndex,\n  setPreviewIndex,\n  parsedDraftName,\n  linkedSpeakerIds,\n  voiceAssignOpen,\n  setVoiceAssignOpen,\n  settingEditorOpen,\n  setSettingEditorOpen,\n  draftDescription,\n  draftSetting,\n  onSettingApply,\n  sourcePromptOpen,\n  setSourcePromptOpen,\n  focusKind,\n  characterJsonInfo,\n  storePromptHit,\n  setCharacterJsonOpen,\n  generationOutcome,\n  setGenerationOutcome,\n  promptInspectTarget,\n  setPromptInspectTarget,\n  handleRerollFromPrompt,\n}: {\n"
    "  asset: StudioAssetSummary;\n  displayImages: FamilyDisplayImageEntry[];\n  previewIndex: number | null;\n"
    "  setPreviewIndex: Dispatch<SetStateAction<number | null>>;\n  parsedDraftName: ParsedAssetNames;\n"
    "  linkedSpeakerIds: TtsSpeakerId[];\n  voiceAssignOpen: boolean;\n  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  settingEditorOpen: boolean;\n  setSettingEditorOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  draftDescription: string;\n  draftSetting: string;\n"
    "  onSettingApply: (next: { description: string; setting: string }) => void;\n"
    "  sourcePromptOpen: boolean;\n  setSourcePromptOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  focusKind: AssetImageKind | null;\n  characterJsonInfo: CharacterJsonInfo | null;\n  storePromptHit: boolean;\n"
    "  setCharacterJsonOpen: Dispatch<SetStateAction<boolean>>;\n"
    "  generationOutcome: GenerationOutcome | null;\n  setGenerationOutcome: Dispatch<SetStateAction<GenerationOutcome | null>>;\n"
    "  promptInspectTarget: PromptTextInspectTarget | null;\n"
    "  setPromptInspectTarget: Dispatch<SetStateAction<PromptTextInspectTarget | null>>;\n"
    "  handleRerollFromPrompt: (payload: {\n    imageName: string;\n    imagePath: string;\n    imageUrl?: string;\n    finalText: string;\n    routeHint: \"i2i\" | \"t2i\";\n    hasInjectedLayers: boolean;\n  }) => Promise<void>;\n"
    "}) {\n  return (\n    <>\n"
    + b_dlg
    + "    </>\n  );\n}\n"
)
dlg_call = """      <StudioAssetDetailDialogs
        asset={asset}
        displayImages={displayImages}
        previewIndex={previewIndex}
        setPreviewIndex={setPreviewIndex}
        parsedDraftName={parsedDraftName}
        linkedSpeakerIds={linkedSpeakerIds}
        voiceAssignOpen={voiceAssignOpen}
        setVoiceAssignOpen={setVoiceAssignOpen}
        settingEditorOpen={settingEditorOpen}
        setSettingEditorOpen={setSettingEditorOpen}
        draftDescription={draftDescription}
        draftSetting={draftSetting}
        onSettingApply={(next) => {
          setDraftDescription(next.description);
          setDraftSetting(next.setting);
          setRecognizedText(null);
        }}
        sourcePromptOpen={sourcePromptOpen}
        setSourcePromptOpen={setSourcePromptOpen}
        focusKind={focusKind}
        characterJsonInfo={characterJsonInfo}
        storePromptHit={storePromptHit}
        setCharacterJsonOpen={setCharacterJsonOpen}
        generationOutcome={generationOutcome}
        setGenerationOutcome={setGenerationOutcome}
        promptInspectTarget={promptInspectTarget}
        setPromptInspectTarget={setPromptInspectTarget}
        handleRerollFromPrompt={handleRerollFromPrompt}
      />
"""
replace_once(block(
    "      {/* 10-19 用户令:全屏缩放预览",
    "    </>\n  );",
    inclusive_end=False,
), dlg_call, "弹窗群组件化")

# ---------- 9. 视图导入修剪(搬走后不再用的) ----------
new_imports = (
    'import { useDetailCollapsedFlags } from "./studio-asset-detail-collapsed";\n'
    'import { useAssetDisplayImages } from "./studio-asset-detail-family-images";\n'
    'import { useAssetCharacterPromptSource } from "./studio-asset-detail-prompt-source";\n'
    'import { useFinalDraftProbe } from "./studio-asset-detail-probe";\n'
    'import { useAssetDetailVoice } from "./studio-asset-detail-voice";\n'
    'import { useAssetDetailHydration } from "./studio-asset-detail-hydration";\n'
    'import { StudioAssetMetaRegion } from "./studio-asset-detail-meta-region";\n'
    'import { StudioAssetDetailDialogs } from "./studio-asset-detail-dialogs";\n'
)
replace_once('import { toast } from "sonner";\n', 'import { toast } from "sonner";\n' + new_imports, "新钩子导入")

for old, new, label in [
    ('import { useCharacterLibraryStore } from "@/stores/library/character-library-store";\n', "", "character-library"),
    ('import { useProjectStore } from "@/stores/project/project-store";\n', "", "project-store"),
    ('import { useAssetDetailViewStore } from "@/stores/assets/asset-detail-view-store";\n', "", "detail-view-store"),
    ('import { useTtsStore } from "@/stores/tts/tts-store";\n', "", "tts-store"),
    ('import { RoleVoiceAssignDialog } from "./RoleVoiceAssignDialog";\n', "", "voice dialog"),
    ('import { RoleVoicePreviewButton } from "./RoleVoicePreviewButton";\n', "", "preview button"),
    ('import { StudioAssetSettingDialog } from "./StudioAssetSettingDialog";\n', "", "setting dialog"),
    ('import { StudioAssetCharacterPrompts } from "./studio-asset-character-prompts";\n', "", "character prompts"),
    ('import { StudioAssetSourcePromptDialog } from "./studio-asset-source-prompt-dialog";\n', "", "source prompt dialog"),
    ('import { StudioAssetCharacterJsonDialog } from "./studio-asset-character-json-dialog";\n', "", "json dialog"),
    ('import { StudioAssetPromptTextDialog, type PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";\n',
     'import type { PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";\n', "prompt text dialog"),
    ('import {\n  StudioAssetGenerationResultDialog,\n  type GenerationOutcome,\n  type GenerationOutcomeRecord,\n} from "./studio-asset-generation-result-dialog";\n',
     'import { type GenerationOutcome, type GenerationOutcomeRecord } from "./studio-asset-generation-result-dialog";\n', "result dialog"),
    ('import { ImagePreviewModal } from "@/components/ui/media-preview-modal";\n', "", "preview modal"),
    ('import { getAssetDisplayName, getAssetOperationError } from "./studio-asset-detail-utils";\n',
     'import { getAssetDisplayName } from "./studio-asset-detail-utils";\n', "detail utils"),
    ('import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";\n', "", "role speaker id"),
    ('import type { TtsSpeakerId } from "@/types/tts";\n', "", "tts speaker"),
    ('import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";\n', "", "bridge"),
    ('import { parsePromptOverrides } from "@/lib/studio/asset-prompt-layers";\n', "", "prompt layers"),
    ('import {\n  buildFinalDraftCandidates,\n  resolvePromptOwnerNote,\n  type PromptInspectCandidate,\n} from "@/lib/studio/asset-prompt-inspect";\n',
     'import {\n  resolvePromptOwnerNote,\n  type PromptInspectCandidate,\n} from "@/lib/studio/asset-prompt-inspect";\n', "prompt inspect"),
    ('import {\n  deriveBareSubjectFromClothed,\n  deriveSubjectFromCharacterJson,\n  resolveBareTypeSubjectGate,\n  getCharacterJsonInfo,\n  loadCharacterJsonText,\n  parseCharacterPromptCatalog,\n  resolveAssetPromptJsonInfo,\n  type AssetPromptJsonInfo,\n  type CharacterPromptCatalog,\n} from "@/lib/studio/asset-character-json";\n',
     'import { resolveBareTypeSubjectGate } from "@/lib/studio/asset-character-json";\n', "character json"),
    ('import { ArrowLeft, ChevronDown, ChevronRight, FileJson, FileText, Loader2, Volume2 } from "lucide-react";\n',
     'import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";\n', "lucide"),
    ('import { Textarea } from "@/components/ui/textarea";\n', "", "textarea"),
    ('import {\n  fetchFamilyImageEntries,\n  mergeFamilyDisplayImages,\n  type FamilyDisplayImageEntry,\n  type FamilyImageEntry,\n} from "@/lib/studio/asset-family-images";\n',
     'import type { FamilyImageEntry } from "@/lib/studio/asset-family-images";\n', "family images"),
]:
    drop_import_line(old, label)

open(V, "w", encoding="utf-8").write(src)
print(f"视图 {orig_len} → {len(src.splitlines())} 行")
for f in [
    "studio-asset-detail-collapsed", "studio-asset-detail-family-images", "studio-asset-detail-prompt-source",
    "studio-asset-detail-probe", "studio-asset-detail-voice", "studio-asset-detail-hydration",
    "studio-asset-detail-meta-region", "studio-asset-detail-dialogs",
]:
    n = len(open(f"frontend/components/panels/assets/{f}{'.' + ('tsx' if f.endswith(('region','dialogs')) else 'ts')}", encoding="utf-8").read().splitlines())
    print(f"  {f}: {n} 行")
