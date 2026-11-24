/**
 * 资产详情水合与换靶清场(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * 切资产/清空时复位全部会话态、按行播种草稿、桥 get 回填全列。ctx 注入写法沿
 * studio-asset-detail-actions 同款(08-31 专批范式);处理器体零改动。
 */
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AssetImage, AssetImageKind, StudioAssetSummary } from "@/types/studio-assets";
import { toast } from "sonner";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { parsePromptOverrides } from "@/lib/studio/asset-prompt-layers";
import { getAssetOperationError } from "./studio-asset-detail-utils";
import type { AssetTypeShotFailureState } from "./studio-asset-detail-preview-pane";
import type { GenerationOutcome, GenerationOutcomeRecord } from "./studio-asset-generation-result-dialog";
import type { PromptTextInspectTarget } from "./studio-asset-prompt-text-dialog";

type GeneratePhase = "polishing" | "generating" | "saving" | "done" | "failed" | null;
type LanePhase = "generating" | "done" | "failed" | null;

export function useAssetDetailHydration(ctx: {
  asset: StudioAssetSummary | null;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftDescription: Dispatch<SetStateAction<string>>;
  setDraftPrompt: Dispatch<SetStateAction<string>>;
  setDraftSetting: Dispatch<SetStateAction<string>>;
  setFullAsset: Dispatch<SetStateAction<StudioAssetSummary | null>>;
  setImages: Dispatch<SetStateAction<AssetImage[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  setRecognizedText: Dispatch<SetStateAction<string | null>>;
  setVoiceAssignOpen: Dispatch<SetStateAction<boolean>>;
  setRemovedFamilyPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewIndex: Dispatch<SetStateAction<number | null>>;
  setFocusKind: Dispatch<SetStateAction<AssetImageKind | null>>;
  setPrePolishPrompt: Dispatch<SetStateAction<string | null>>;
  setPromptInspectTarget: Dispatch<SetStateAction<PromptTextInspectTarget | null>>;
  setGenerationOutcome: Dispatch<SetStateAction<GenerationOutcome | null>>;
  queueRecordsRef: { current: GenerationOutcomeRecord[] };
  setPromptOverridesDraft: Dispatch<SetStateAction<Partial<Record<AssetImageKind, string>>>>;
  setPromptOverridesHydrated: Dispatch<SetStateAction<boolean>>;
  setInstructionDrafts: Dispatch<SetStateAction<Partial<Record<AssetImageKind, string>>>>;
  setInstructionEditOpen: Dispatch<SetStateAction<boolean>>;
  setTypeShotFailure: Dispatch<SetStateAction<AssetTypeShotFailureState | null>>;
  setGeneratePhase: Dispatch<SetStateAction<GeneratePhase>>;
  setI2iPhase: Dispatch<SetStateAction<LanePhase>>;
  setFacePhase: Dispatch<SetStateAction<LanePhase>>;
  setExpressionPhase: Dispatch<SetStateAction<LanePhase>>;
  setTypeShotPhase: Dispatch<SetStateAction<LanePhase>>;
  setBusyTarget: Dispatch<SetStateAction<string | null>>;
  setI2iMessage: Dispatch<SetStateAction<string>>;
  setExpressionMessage: Dispatch<SetStateAction<string>>;
  setTypeShotMessage: Dispatch<SetStateAction<string>>;
  setFaceMessage: Dispatch<SetStateAction<string>>;
  resetStageState: () => void;
}) {
  const {
    asset, setDraftName, setDraftDescription, setDraftPrompt, setDraftSetting, setFullAsset, setImages, setCurrentIndex, setRecognizedText, setVoiceAssignOpen,
    setRemovedFamilyPaths, setPreviewIndex, setFocusKind, setPrePolishPrompt, setPromptInspectTarget,
    setGenerationOutcome, queueRecordsRef, setPromptOverridesDraft, setPromptOverridesHydrated,
    setInstructionDrafts, setInstructionEditOpen, setTypeShotFailure, setGeneratePhase, setI2iPhase,
    setFacePhase, setExpressionPhase, setTypeShotPhase, setBusyTarget, setI2iMessage,
    setExpressionMessage, setTypeShotMessage, setFaceMessage, resetStageState,
  } = ctx;
  // 「弹窗关即清理」effect 随弹窗壳退役(1120 详情独立页):「宿主关」=组件卸载,
  // state/队列/ref 全随卸载销毁;切资产清理由下方 [asset?.id] effect 接管
  // (10-19 双弹勘误/10-25 A-1/A-2③/B-3 的关时清语义由「卸载即清」承接)。

  useEffect(() => {
    if (!asset) {
      setFullAsset(null);
      setImages([]);
      setCurrentIndex(0);
      setRecognizedText(null);
      setVoiceAssignOpen(false);
      setRemovedFamilyPaths([]);
      setPreviewIndex(null);
      setFocusKind(null);
      setPrePolishPrompt(null);
      setPromptInspectTarget(null);
      setGenerationOutcome(null);
      queueRecordsRef.current = [];
      setPromptOverridesDraft({});
      setPromptOverridesHydrated(false);
      setInstructionDrafts({});
      setInstructionEditOpen(false);
      // 1121 失败持久态:旧资产会话的失败红态不带入新宿主
      setTypeShotFailure(null);
      // 1121 换靶串台根修:五路生成相位+busyTarget+四路文案随靶清(残留会让新宿主
      // 挂旧会话的 spinner/进度文案——busyKey 无资产维,section:<kind> 跨资产同键
      // 命中)。治标范围=换靶瞬间的显示残留:A 在途任务仍走完自身 finally 自清;
      // A 尾部 done/failed setter 无资产守卫属既有残留,不在本役根治。
      // (generateMessage 值位从未读取=死码,不清;另四枚 message 确被 pane 消费)
      setGeneratePhase(null);
      setI2iPhase(null);
      setFacePhase(null);
      setExpressionPhase(null);
      setTypeShotPhase(null);
      setBusyTarget(null);
      setI2iMessage("");
      setExpressionMessage("");
      setTypeShotMessage("");
      setFaceMessage("");
      resetStageState();
      return;
    }

    // 切资产也清(同弹窗内换资产时 previewIndex 可能指向旧资产图序;族过滤
    // 路径属旧资产会话,直换 A→B 时同样清——10-25 深审修,与注释「切资产即清」对齐;
    // focusKind 同理属旧资产会话的聚焦态,随切重置;A-3 润色快照/查词弹层目标同理;
    // 生成路 selectedStage 同样随切资产重置。
    setPreviewIndex(null);
    setRemovedFamilyPaths([]);
    setFocusKind(null);
    setPrePolishPrompt(null);
    setPromptInspectTarget(null);
    // 1121 失败持久态:切资产清(旧资产会话的失败红态不带入新资产)
    setTypeShotFailure(null);
    // 1121 换靶串台根修:五路生成相位+busyTarget+四路文案随切资产清(同 !asset 支;
    // 残留会让新宿主挂旧会话的 spinner/进度文案——busyKey 无资产维,section:<kind>
    // 跨资产同键命中)。治标范围=换靶瞬间的显示残留:A 在途任务仍走完自身 finally
    // 自清;A 尾部 done/failed setter 无资产守卫属既有残留,不在本役根治。
    // (generateMessage 值位从未读取=死码,不清;另四枚 message 确被 pane 消费)
    setGeneratePhase(null);
    setI2iPhase(null);
    setFacePhase(null);
    setExpressionPhase(null);
    setTypeShotPhase(null);
    setBusyTarget(null);
    setI2iMessage("");
    setExpressionMessage("");
    setTypeShotMessage("");
    setFaceMessage("");
    // R5 结果弹窗/队列累积随切资产清(旧资产会话的记录不带入新宿主)
    setGenerationOutcome(null);
    queueRecordsRef.current = [];
    setPromptOverridesDraft({});
    setPromptOverridesHydrated(false);
    setInstructionDrafts({});
    setInstructionEditOpen(false);
    resetStageState();

    let cancelled = false;
    const initialImages: AssetImage[] = [];
    if (asset.previewUrl || asset.thumbnailUrl) {
      // 10-19 用户令废「主图」名号:初始加载名=文件名(去扩展名)
      const mainBase = (asset.filePath || "").split("/").pop()?.replace(/\.[^.]+$/, "") || asset.name;
      initialImages.push({ name: mainBase, filePath: asset.filePath || "", url: asset.previewUrl || asset.thumbnailUrl });
    }
    if (asset.images?.length) {
      initialImages.push(...asset.images);
    }
    setFullAsset(null);
    setRecognizedText(null);
    setImages(initialImages);
    setCurrentIndex(0);
    setDraftName(asset.name || "");
    setDraftDescription(asset.description || "");
    setDraftPrompt(asset.prompt || "");
    setDraftSetting(asset.setting || "");
    // Phase C 播种:桥缺席兜底资产行的槽值(桥成功位随后覆盖)——播种即水合
    setPromptOverridesDraft(parsePromptOverrides(asset.promptOverrides));
    setPromptOverridesHydrated(true);

    if (getStudioAssetsBridge()?.get) {
      getStudioAssetsBridge()!.get(asset.id).then((result) => {
        if (!result || cancelled) return;
        setFullAsset(result);
        setDraftName(result.name || "");
        setDraftDescription(result.description || "");
        setDraftPrompt(result.prompt || "");
        setDraftSetting(result.setting || "");
        // Phase C 播种:fullAsset 槽值为准(桥 get 全列)——播种即水合
        setPromptOverridesDraft(parsePromptOverrides(result.promptOverrides));
        setPromptOverridesHydrated(true);
        const updatedImgs: AssetImage[] = [];
        if (result.previewUrl || result.thumbnailUrl) {
          // 10-19 用户令废「主图」名号:刷新名=文件名(去扩展名)
          const refreshBase = (result.filePath || "").split("/").pop()?.replace(/\.[^.]+$/, "") || asset.name;
          updatedImgs.push({ name: refreshBase, filePath: result.filePath || "", url: result.previewUrl || result.thumbnailUrl });
        }
        if (result.images?.length) {
          updatedImgs.push(...result.images);
        }
        setImages(updatedImgs);
      }).catch((error: unknown) => {
        if (!cancelled) {
          toast.error(getAssetOperationError(error, "加载资产详情失败"));
        }
      });
    }

    return () => {
      cancelled = true;
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);
}
