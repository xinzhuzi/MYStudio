/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 资产详情对话框动作钩子——润色/保存/删除/一键生图/带入重生成/打开/增删换图/转写。
 * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;闭包引用经 ctx 注入
 * (通读人工核验,非正则法);any 为迁移期务实妥协。
 */
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { eventBus } from "@/lib/event-bus";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { polishAssetPrompt, type AssetType, type PolishResult } from "@/lib/ai/prompt-polisher";
import { generateAsset } from "@/lib/studio/asset-generation-orchestrator";
import { generateAssetStyleTransferImage } from "@/lib/studio/asset-style-transfer";
import { generateAssetFacePortrait, type AssetFacePortraitMode } from "@/lib/studio/asset-face-portrait";
import { generateAssetExpressionSheet } from "@/lib/studio/asset-expression-sheet";
import { generateAssetTypeShot, getAssetTypeShotProfile, planAssetTypeFillMissingQueue } from "@/lib/studio/asset-type-shot";
import { rerollAssetImageFromPromptText } from "@/lib/studio/asset-prompt-reroll";
import {
  findDisplayImageIndex,
  mergeFamilyDisplayImages,
  type FamilyImageEntry,
} from "@/lib/studio/asset-family-images";
import { asAssetImageTrack, classifyAssetImage, getAssetImageKindSpectrum } from "@/lib/studio/asset-image-kind";
import { buildStageTypeShotImageName, extractStageName } from "@/lib/studio/asset-stage-prompts";
import { latestKindImage, singleKindReplacementFilePaths } from "@/lib/studio/asset-image-kind";
import type { AssetImageKind } from "@/types/studio-assets";
import { getAssetImageOpenTarget, getAssetOperationError, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";
import { persistGeneratedAssetPromptToLibrary, saveGeneratedAssetImageToLibrary } from "./studio-asset-generation-persistence";

/**
 * 阶段参考图锚(10-25 阶段矩阵 T3,PRD §3.3):该阶段组内最新一张(任意型)的 url。
 * 「组内最新」口径=clusterAssetStages 的输入序末位——跨型全局末位必属某型的 latest
 * 集(后于它的同型图若在场即取代之),故展示序倒扫取首个命中段与聚类取法等价;
 * 组空/无 url 返回 undefined,调用方回退轮播当前图(既有行为)。
 */
function resolveStageReferenceImage(images: AssetImage[], stage: string): string | undefined {
  for (let i = images.length - 1; i >= 0; i -= 1) {
    if (extractStageName(images[i].name) === stage) {
      return images[i].url || undefined;
    }
  }
  return undefined;
}

export function useStudioAssetDialogActions(ctx: {
  asset: any;
  onOpenChange: any;
  visualManualId: any;
  detail: any;
  images: AssetImage[];
  /** 10-19 图生图·画风转换:当前 i2i 相位(在跑直返守卫)。 */
  i2iPhase?: string | null;
  /** R4 族聚显:轮播实际展示序(族兄弟只读条目并入);currentIndex 按此序计。 */
  displayImages?: AssetImage[];
  /** 行打开时取到的族条目(updatedAt 倒序);undefined=桥缺席/失败,回落本行图。 */
  familyImages?: FamilyImageEntry[];
  currentIndex: any;
  draftName: any;
  draftDescription: any;
  draftPrompt: any;
  draftSetting: any;
  setIsPolishingPrompt: any;
  setDraftName: any;
  setDraftDescription: any;
  setDraftPrompt: any;
  setDraftSetting: any;
  /** A-3 润色还原(10-25 分层面板役):applyPolishedPrompt 覆写前的润色前快照
   *  写入位(组件态单条,PRD 裁定 Q5a;仅状态存取,生成行为零变)。 */
  setPrePolishPrompt: any;
  setFullAsset: Dispatch<SetStateAction<StudioAssetSummary | null>>;
  setImages: Dispatch<SetStateAction<AssetImage[]>>;
  setCurrentIndex: any;
  setGeneratePhase: any;
  setGenerateMessage: any;
  setRecognizedText: any;
  /** 10-19 图生图·画风转换:i2i 相位/文案注入(与一键生成同款状态机拆分)。 */
  setI2iPhase: any;
  setI2iMessage: any;
  /** 10-21 高清人脸:人脸相位/文案注入(图生图/文生图两路共用一套状态机)。 */
  facePhase?: string | null;
  setFacePhase: any;
  setFaceMessage: any;
  /** 10-21 表情差分:差分相位/文案注入(图生图单路,与人脸同款状态机形态)。 */
  expressionPhase?: string | null;
  setExpressionPhase: any;
  setExpressionMessage: any;
  /** 10-24 批3 按型出图:通用第五路相位/文案注入(型名进相位文案;一键补缺队列复用本相位聚合)。 */
  generatePhaseForGuard?: string | null;
  typeShotPhase?: string | null;
  setTypeShotPhase: any;
  setTypeShotMessage: any;
  /** 10-25 分层面板役复审修(A-1 写入点第4项):一键补缺队列逐型派发前的聚焦钩子。
   *  队列内 dispatchKindGeneration 直调底层执行器,不经 Dialog 包装的 focusOnKind
   *  ——经此钩子与生成派发同帧写 focusKind,防面板构成区滞留旧聚焦型/通用态
   *  与实际执行型错位。 */
  onFillMissingKindFocus?: (kind: AssetImageKind) => void;
  /** 10-25 追加令 Phase C:按型主体句槽读取(t2i 路/人脸文生图路该型优先用槽内句)。 */
  getKindSubjectOverride?: (kind: AssetImageKind) => string | undefined;
  /** 10-25 追加令·i2i 指令可编辑:指令覆盖读取(非空=本次生成用此指令作终稿;
   *  会话态不持久化,覆盖按型/人脸图生图/表情差分三路)。 */
  getInstructionOverride?: (kind: AssetImageKind) => string | undefined;
  /** 10-25 追加令 Phase C:按型主体句槽草稿(保存时序列化入库;Record<型名,句>)。 */
  promptOverridesDraft?: Record<string, string>;
  setActiveStudio: any;
  setActiveTab: any;
  /** 10-25 深审修:弹窗当前资产 id 探针(完成尾段活性守卫,防跨资产污染)。 */
  getActiveAssetId?: () => string | null;
  /** 10-25 用户令·派生流水线修:展示序图集活取探针——一键补缺队列整循环活在
   *  点击帧闭包内,后续派发读旧闭包图集(定妆收编后表情锚恒落空断队列);
   *  人脸·图生图/表情差分的定妆锚一律经此取最新展示序。 */
  getDisplayImages?: () => AssetImage[];
  /** 同步回写口(与 getDisplayImages 配对):收编尾段算出最新图集时立即回写探针
   *  ref——setImages 要等渲染提交,队列异步链不等渲染,锚活取须绕开渲染时序。 */
  onImagesCollected?: (images: AssetImage[]) => void;
  /** 10-25 深审修:本会话已删族兄弟路径(handleAddImage 定位下标用展示序口径)。 */
  removedFamilyPaths?: string[];
  resolveAssetGenerationReferenceImage: any;
  resolveThreeTrackAssetType: any;
}) {
  const {
    asset,
    onOpenChange,
    visualManualId,
    detail,
    images,
    i2iPhase,
    displayImages,
    familyImages,
    currentIndex,
    draftName,
    draftDescription,
    draftPrompt,
    draftSetting,
    setIsPolishingPrompt,
    setDraftName,
    setDraftDescription,
    setDraftPrompt,
    setDraftSetting,
    setPrePolishPrompt,
    setFullAsset,
    setImages,
    setCurrentIndex,
    setGeneratePhase,
    setGenerateMessage,
    setRecognizedText,
    setI2iPhase,
    setI2iMessage,
    facePhase,
    setFacePhase,
    setFaceMessage,
    expressionPhase,
    setExpressionPhase,
    setExpressionMessage,
    generatePhaseForGuard,
    typeShotPhase,
    setTypeShotPhase,
    setTypeShotMessage,
    onFillMissingKindFocus,
    getKindSubjectOverride,
    getInstructionOverride,
    promptOverridesDraft,
    setActiveStudio,
    setActiveTab,
    getActiveAssetId,
    getDisplayImages,
    onImagesCollected,
    removedFamilyPaths,
    resolveAssetGenerationReferenceImage,
    resolveThreeTrackAssetType,
  } = ctx;
  /** 展示序缺省回落本行图(资产库面板等无族聚显入口的调用方零行为变化)。 */
  const carouselImages = displayImages ?? images;

  /** 批3 复审 H 修(五路互斥统一守卫,PRD 验收「任一生成相位在跑,生成族全禁」):
   *  直达入口(占位卡 CTA/完整度缺失 chip 经 onGenerateByKind)与节头钮/下拉共用
   *  本闸——任一相位在跑(含一键补缺队列聚合的 typeShotPhase)即忙直返,防并发
   *  点火另一路生成(双生成并发/相位文案互踩/完成切新图竞态)。一键补缺队列经
   *  laneGuard:false 复用底层执行器(队列入口自带五路守卫+自持聚合相位)。 */
  const isAnyGenerationLaneBusy = (): boolean =>
    !!(generatePhaseForGuard || i2iPhase || facePhase || expressionPhase || typeShotPhase);

  /** 润色当前资产的提示词 */
  const handlePolishPrompt = async () => {
    if (!asset || !visualManualId) {
      toast.error(!visualManualId ? "请先选择视觉手册" : "无资产信息");
      return;
    }

    setIsPolishingPrompt(true);
    try {
      let assetType: AssetType;
      try {
        assetType = resolveThreeTrackAssetType(asset.type);
      } catch {
        toast.error("该资产类型不支持生图提示词（仅角色/场景/道具三轨）");
        return;
      }

      const result = await polishAssetPrompt({
        assetType,
        name: asset.name,
        description: draftDescription || asset.description || "",
        isDerivative: false,
        visualManualId,
      });

      if (result.status === "success") {
        // A-3 复审修:独立润色入口与 applyPolishedPrompt 同款覆写前快照——
        // 「还原上次润色前」钮覆盖两个润色入口(此前仅一键生成路可还原)。
        // 与队列路同闸:空结果不快照不清旧快照。
        if (result.prompt.trim()) {
          setPrePolishPrompt(draftPrompt);
        }
        setDraftPrompt(result.prompt);
        toast.success("提示词润色完成");
      } else {
        toast.error(`润色失败: ${result.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`润色出错: ${message}`);
    } finally {
      setIsPolishingPrompt(false);
    }
  };

  const handleSave = async () => {
    if (!getStudioAssetsBridge()?.update) {
      toast.error("当前环境不支持保存");
      return;
    }
    const updates: Record<string, unknown> = {};
    updates.name = draftName;
    updates.description = draftDescription;
    updates.prompt = draftPrompt;
    updates.setting = draftSetting;
    // Phase C(10-25 追加令):按型主体句槽随保存入库(空对象=清槽照写);
    // undefined=未水合(桥 get 未返回窗口)禁写——防把库内槽位清成 {}
    if (promptOverridesDraft !== undefined) updates.promptOverrides = promptOverridesDraft;
    try {
      const result = await getStudioAssetsBridge()!.update({ id: asset.id, updates });
      if (result) {
        toast.success("已保存");
      } else {
        toast.error("保存失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "保存失败"));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除「${asset.name}」？此操作不可撤销。`)) return;

    let success = false;
    try {
      if (asset.id.startsWith("manying-prop:")) {
        // 本地道具库数据，从 localStorage store 删除
        const realId = asset.id.replace("manying-prop:", "");
        usePropsLibraryStore.getState().deleteProp(realId);
        success = true;
      } else if (getStudioAssetsBridge()?.delete) {
        success = await getStudioAssetsBridge()!.delete(asset.id);
      } else {
        toast.error("当前环境不支持删除");
        return;
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "删除失败"));
      return;
    }

    if (success) {
      toast.success("已删除");
      eventBus.emit("asset:deleted", { id: asset.id, type: asset.type });
      onOpenChange(false);
    } else {
      toast.error("删除失败");
    }
  };

  const copyText = async (label: string, value?: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label}为空`);
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success(`已复制${label}`);
  };

  const handleOneClickGenerateAssetImage = async () => {
    // 10-25 深审修(低①):五路互斥入口补全路忙守卫(原仅靠按钮 disabled,
    // 新增启用态入口复刻时防双生成并发)
    if (isAnyGenerationLaneBusy()) {
      toast.warning("有生成任务正在进行，请稍候");
      return;
    }
    if (!visualManualId) {
      toast.error("请先在「风格与导演选择」中选择视觉手册");
      return;
    }
    const existingPrompt = draftPrompt.trim();
    const shouldGeneratePrompt = !existingPrompt;
    setGeneratePhase(shouldGeneratePrompt ? "polishing" : "generating");
    setGenerateMessage(shouldGeneratePrompt ? `正在根据风格生成 ${asset.name} 的出图提示词...` : `正在生成 ${asset.name} 的图片...`);
    try {
      let assetType: AssetType;
      try {
        assetType = resolveThreeTrackAssetType(asset.type);
      } catch {
        toast.error("该资产类型不支持生成图片（仅角色/场景/道具三轨）");
        setGeneratePhase(null);
        return;
      }
      let promptPersistPromise: Promise<boolean> | null = null;
      // A-3 润色还原(10-25 分层面板役,PRD §4.1 A-3):覆写前把旧值存组件态
      // prePolishPrompt(单条,「还原上次润色前」钮消费)。快照旗=同轮生成
      // progress+done 双帧只存首帧——第二帧闭包 draftPrompt 已是润色后值,再存
      // 会把真快照覆写掉;跨轮各建新闭包,旗自然复位(还原语义=撤销**上次**润色)。
      // 仅状态存取,生成行为零变(润色/写库链路原样)。
      let prePolishSnapshotTaken = false;
      const applyPolishedPrompt = (polishResult?: PolishResult) => {
        const prompt = polishResult?.status === "success" ? polishResult.prompt?.trim() : "";
        if (!prompt) return;
        if (!prePolishSnapshotTaken) {
          setPrePolishPrompt(draftPrompt);
          prePolishSnapshotTaken = true;
        }
        setDraftPrompt(prompt);
        setFullAsset((current) => current ? { ...current, prompt } : current);
      };
      // 以当前查看的设定图为参考再生成(身份一致性;道劫链据此加参考图降噪锁);
      // 族聚显在驾时当前查看的可能是族兄弟图——同族同脸,同样可作参考
      const referenceImage = resolveAssetGenerationReferenceImage(carouselImages, currentIndex);
      const result = await generateAsset(
        {
          assetId: asset.id,
          assetType,
          name: asset.name,
          description: draftDescription || asset.name,
          isDerivative: false,
          visualManualId,
          skipPolish: !shouldGeneratePrompt,
          existingPrompt: shouldGeneratePrompt ? undefined : existingPrompt,
          referenceImages: referenceImage ? [referenceImage] : undefined,
        },
        (progress) => {
          if (progress.polishResult?.status === "success" && progress.polishResult.prompt?.trim()) {
            applyPolishedPrompt(progress.polishResult);
            promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, progress.polishResult);
          }
          if (progress.phase === "polishing") {
            setGeneratePhase("polishing");
            setGenerateMessage(`正在根据风格生成 ${asset.name} 的出图提示词...`);
          } else if (progress.phase === "generating") {
            setGeneratePhase("generating");
            setGenerateMessage(`正在生成 ${asset.name} 的图片...`);
          } else if (progress.phase === "saving") {
            setGeneratePhase("saving");
            setGenerateMessage(`正在保存 ${asset.name} 的图片...`);
          }
        },
      );
      if (result.phase === "done") {
        setGeneratePhase("done");
        setGenerateMessage("生成完成！");
        applyPolishedPrompt(result.polishResult);
        promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, result.polishResult);
        if (promptPersistPromise) {
          await promptPersistPromise;
        }
        // 10-19 用户令:废「主图」名号——一键生成结果名 = 资产名_中文日期
        // (1020 落存储层:此名随 replace-image 透传,盘上文件名同款,禁时间戳)
        const genNow = new Date();
        const genDate = `${genNow.getFullYear()}年${String(genNow.getMonth() + 1).padStart(2, "0")}月${String(genNow.getDate()).padStart(2, "0")}日`;
        const generatedImageName = `${asset.name}_${genDate}`;
        const _savedToLibrary = await saveGeneratedAssetImageToLibrary(
          asset.id,
          result.imageLocalPath,
          result.polishResult,
          generatedImageName,
        );
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && getActiveAssetId && getActiveAssetId() !== asset.id) {
            // 10-25 深审修(跨资产污染):生成期间切换资产→产物已入库,表单/图集不回填
            toast.info(`「${asset.name}」生成完成已入库；当前已切换资产，弹窗状态不回填`);
          } else if (updated) {
            setDraftName(updated.name || "");
            setDraftDescription(updated.description || "");
            setDraftPrompt(updated.prompt || "");
            setDraftSetting(updated.setting || "");
            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              // 批2(10-24):一键生成无型标记,不落 kind(读路兜底=早期未分类)
              newImgs.push({ name: generatedImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            // 10-25 深审修(低⑤):主图条目与 images[] 同 filePath 去重(防重复卡+重复 key)
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            setCurrentIndex(0);
          }
        }
        if (!_savedToLibrary) {
          toast.warning(`「${asset.name}」图片已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」资产生成完成`);
        }
      } else {
        applyPolishedPrompt(result.polishResult);
        promptPersistPromise ??= persistGeneratedAssetPromptToLibrary(asset.id, result.polishResult);
        if (promptPersistPromise) {
          await promptPersistPromise;
        }
        setGeneratePhase("failed");
        setGenerateMessage(`生成失败: ${result.error || "未知错误"}`);
        toast.error(`生成失败: ${result.error || "未知错误"}`);
      }
    } catch (err: unknown) {
      setGeneratePhase("failed");
      setGenerateMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => {
        setGeneratePhase(null);
        setGenerateMessage("");
      }, 3000);
    }
  };

  /** 图生图·画风转换(10-19):取轮播当前图作唯一参考,qwen-image-2-1 本地渠道整体转画风;
   * 成功尾段镜像一键生成(写回资产库+asset:updated 广播+get 刷新轮播);相位 3s 自动清。 */
  const handleImageToImageStyle = async () => {
    // 10-25 深审修(低①):全路忙守卫(原只查 i2iPhase,其余四路在跑仍可点火)
    if (isAnyGenerationLaneBusy()) {
      toast.warning("有生成任务正在进行，请稍候");
      return;
    }
    // 诊断打点(10-19 用户令:图生图链路要日志)——operationId 由本层造,
    // 贯通 service 四点(构造摘要/发起/成功/失败);守卫拒绝逐因留痕。
    const operationId = createOperationId("asset-style-transfer");
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset style transfer requested (image-to-image)",
      context: { assetId: asset.id, assetType: asset.type, assetName: asset.name, currentIndex },
    });
    if (isAnyGenerationLaneBusy()) {
      // 在跑直返(10-25 深审修:全路口径;按钮已禁,双保险)
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset style transfer guard rejected (busy)",
        context: { assetId: asset.id, i2iPhase },
      });
      return;
    }
    let assetType: AssetType;
    try {
      assetType = resolveThreeTrackAssetType(asset.type);
    } catch {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset style transfer guard rejected (non-three-track)",
        context: { assetId: asset.id, assetType: asset.type },
      });
      toast.error("该资产类型不支持画风转换（仅角色/场景/道具三轨）");
      return;
    }
    // 10-25 用户令(派生流水线):表情差分恒以「全身定妆图」为锚(不随轮播漂)
    const fullBodyAnchor = latestKindImage(getDisplayImages?.() ?? carouselImages, "全身定妆");
    const referenceImage = fullBodyAnchor?.url;
    if (!referenceImage) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset style transfer guard rejected (no reference image)",
        context: { assetId: asset.id, displayImageCount: carouselImages.length },
      });
            toast.error("尚无全身定妆图——表情差分以全身定妆为锚，请先「生成全身定妆」(文生图)");
      return;
    }
    // 10-19 用户令:废「主图」名号——图生图结果名 = 原图名_中文日期(如 晏燎_练气期_正视图_v1_2026年10月19日)
    const inputImageName = fullBodyAnchor?.name || asset.name;
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
    const resultImageName = `${inputImageName}_${dateSuffix}`;
    setI2iPhase("generating");
    setI2iMessage(`正在转换 ${asset.name} 的画风...`);
    try {
      const result = await generateAssetStyleTransferImage(
        {
          assetId: asset.id,
          assetType,
          assetName: asset.name,
          referenceImage,
          ...(getInstructionOverride?.("表情差分")?.trim()
            ? { instructionOverride: getInstructionOverride?.("表情差分")?.trim() }
            : {}),
          operationId,
        },
        (progress) => {
          // 生成/保存两相位都保持 spinner;文案随进度推进
          if (progress.phase === "generating" || progress.phase === "saving") {
            setI2iPhase("generating");
            if (progress.message) setI2iMessage(progress.message);
          }
        },
      );
      if (result.phase === "done") {
        setI2iPhase("done");
        setI2iMessage("画风转换完成！");
        // 批2(10-24):视图模型落 kind=源图分类(画风转换不改取景版式,源是三视图
        // 产物转完仍是人物多视图);行级主图 kind 持久化候 Round 3 Q2 后续裁定
        const sourceKind = classifyAssetImage(carouselImages[currentIndex] ?? { name: inputImageName });
        // 1020 落存储层:resultImageName(原图名_中文日期)随 replace-image 透传,
        // 盘上文件名与轮播显示名同源(旧链只改显示层,盘上恒时间戳=用户追报病根)
        const savedToLibrary = await saveGeneratedAssetImageToLibrary(asset.id, result.imageLocalPath, undefined, resultImageName);
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && getActiveAssetId && getActiveAssetId() !== asset.id) {
            // 10-25 深审修(跨资产污染):生成期间切换资产→产物已入库,表单/图集不回填
            toast.info(`「${asset.name}」生成完成已入库；当前已切换资产，弹窗状态不回填`);
          } else if (updated) {            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              newImgs.push({ name: resultImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl, kind: sourceKind });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            // 10-25 深审修(低⑤):主图条目与 images[] 同 filePath 去重(防重复卡+重复 key)
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            // 10-19 用户报障「图生图后主图来回变」:完成即切到新主图(与更换主图同款
            // setCurrentIndex(0));不归零 → 轮播 key 重挂在旧索引,叠加并存 images[]
            // 增长位移 = 看到的一直是旧位置的内容而非新图
            setCurrentIndex(0);
          }
        }
        if (!savedToLibrary) {
          toast.warning(`「${asset.name}」画风转换图已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」画风转换完成`);
        }
      } else {
        setI2iPhase("failed");
        setI2iMessage(`画风转换失败: ${result.error || "未知错误"}`);
        toast.error(`画风转换失败: ${result.error || "未知错误"}`);
      }
    } catch (err: unknown) {
      setI2iPhase("failed");
      setI2iMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => {
        setI2iPhase(null);
        setI2iMessage("");
      }, 3000);
    }
  };

  /** 10-21 高清人脸(用户令:人物弹窗图生图/文生图两路都要):镜像画风转换尾段
   * (写回资产库+asset:updated 广播+get 刷新轮播+完成切新图);相位 3s 自动清。
   * 图生图路=参考图锚身份+固定指令重构头肩特写;文生图路=描述作主体句+
   * base_type=高清人脸型层(1:1 取景/排布/负面全由型承载)。
   * 10-24 批3 返值化(true=done/false=守卫拒或失败):供一键补缺队列探成功,
   * 按钮路调用方忽略返回值,对外行为零变。 */
  const runFacePortrait = async (
    mode: AssetFacePortraitMode,
    options?: { laneGuard?: boolean },
  ): Promise<boolean> => {
    const operationId = createOperationId("asset-face-portrait");
    const modeLabel = mode === "image" ? "图生图" : "文生图";
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset face portrait requested",
      context: { mode, assetId: asset.id, assetType: asset.type, assetName: asset.name, currentIndex },
    });
    // 复审 H 修:五路互斥统一守卫(队列 laneGuard:false 免闸防逐型派发自拒)
    if (options?.laneGuard !== false && isAnyGenerationLaneBusy()) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset face portrait guard rejected (busy-lane)",
        context: { assetId: asset.id, mode },
      });
      return false;
    }
    if (facePhase) {
      // 在跑直返(按钮已禁,双保险)
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset face portrait guard rejected (busy)",
        context: { assetId: asset.id, facePhase },
      });
      return false;
    }
    if (asset.type !== "role") {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset face portrait guard rejected (non-role)",
        context: { assetId: asset.id, assetType: asset.type },
      });
      toast.error("高清人脸仅角色资产可用");
      return false;
    }
    let referenceImage: string | undefined;
    // 10-25 用户令(派生流水线):人脸·图生图恒以「全身定妆图」为锚(不随轮播漂);
    // 无定妆图=流水线断源,明确引导先文生图定妆
    let fullBodyAnchor: { url: string; name: string } | null = null;
    if (mode === "image") {
      fullBodyAnchor = latestKindImage(getDisplayImages?.() ?? carouselImages, "全身定妆");
      referenceImage = fullBodyAnchor?.url;
      if (!referenceImage) {
        void logEvent({
          level: "warn",
          category: "asset",
          operationId,
          message: "Asset face portrait guard rejected (no reference image)",
          context: { assetId: asset.id, displayImageCount: carouselImages.length },
        });
        toast.error("尚无全身定妆图——高清人脸图生图以全身定妆为锚，请先「生成全身定妆」(文生图)");
        return false;
      }
    }
    // Phase C(10-25 追加令):text 路主体句=高清人脸槽覆盖优先,空回退共享链
    const subjectText = mode === "text"
      ? (getKindSubjectOverride?.("高清人脸")?.trim() || draftPrompt.trim() || draftDescription.trim() || detail.prompt?.trim() || detail.description?.trim())
      : undefined;
    if (mode === "text" && !subjectText) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset face portrait guard rejected (no subject text)",
        context: { assetId: asset.id },
      });
      toast.error("没有可用于出图的描述或提示词");
      return false;
    }
    // 命名沿 10-19「废主图名号」令:图生图=原图名_人脸_中文日期;文生图=资产名_人脸_中文日期
    // 命名锚(10-25 派生流水线):image 路=定妆图名(产物溯源其源);text 路=资产名
    const inputImageName = mode === "image" ? (fullBodyAnchor?.name || carouselImages[currentIndex]?.name || asset.name) : asset.name;
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
    const resultImageName = `${inputImageName}_人脸_${dateSuffix}`;
    setFacePhase("generating");
    setFaceMessage(`正在生成 ${asset.name} 的高清人脸(${modeLabel})...`);
    try {
      const result = await generateAssetFacePortrait(
        {
          assetId: asset.id,
          assetName: asset.name,
          mode,
          referenceImage,
          subjectText,
          // 追加令:image 路指令覆盖/text 路该型主体句槽(空=既有行为零变)
          ...(mode === "image" && getInstructionOverride?.("高清人脸")?.trim()
            ? { instructionOverride: getInstructionOverride?.("高清人脸")?.trim() }
            : {}),
          operationId,
        },
        (progress) => {
          if (progress.phase === "generating" || progress.phase === "saving") {
            setFacePhase("generating");
            if (progress.message) setFaceMessage(progress.message);
          }
        },
      );
      if (result.phase === "done") {
        setFacePhase("done");
        setFaceMessage("高清人脸生成完成！");
        // 10-25 用户令·单图型替换:生成成功先清该型旧图再收编(桥缺席/单条删除失败
        // 不阻断收编——新图照入库,残留旧图下轮再生成时再清)
        for (const stalePath of singleKindReplacementFilePaths(images, "高清人脸")) {
          await getStudioAssetsBridge()?.removeImage?.({ assetId: asset.id, imageFilePath: stalePath });
        }
        const savedToLibrary = await saveGeneratedAssetImageToLibrary(asset.id, result.imageLocalPath, undefined, resultImageName);
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && getActiveAssetId && getActiveAssetId() !== asset.id) {
            // 10-25 深审修(跨资产污染):生成期间切换资产→产物已入库,表单/图集不回填
            toast.info(`「${asset.name}」生成完成已入库；当前已切换资产，弹窗状态不回填`);
          } else if (updated) {            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              // 批2(10-24):生成写路落 kind 视图值(名内 _人脸_ 标记为持久兜底)
              newImgs.push({ name: resultImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl, kind: "高清人脸" });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            // 10-25 深审修(低⑤):主图条目与 images[] 同 filePath 去重(防重复卡+重复 key)
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            // 完成即切到新主图(与画风转换同款 setCurrentIndex(0))
            setCurrentIndex(0);
          }
        }
        if (!savedToLibrary) {
          toast.warning(`「${asset.name}」高清人脸已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」高清人脸(${modeLabel})生成完成`);
        }
        return true;
      } else {
        setFacePhase("failed");
        setFaceMessage(`高清人脸生成失败: ${result.error || "未知错误"}`);
        toast.error(`高清人脸生成失败: ${result.error || "未知错误"}`);
        return false;
      }
    } catch (err: unknown) {
      setFacePhase("failed");
      setFaceMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setTimeout(() => {
        setFacePhase(null);
        setFaceMessage("");
      }, 3000);
    }
  };
  const handleFacePortraitFromImage = () => runFacePortrait("image");
  const handleFacePortraitFromText = () => runFacePortrait("text");

  /** 10-21 表情差分(用户令:资产库弹窗角色要有表情差分,图生图逻辑):镜像
   * 人脸图生图路(轮播当前图锚身份+固定指令承载九宫格取景语言);命名沿
   * 「废主图名号」令=原图名_表情差分_中文日期;相位 3s 自动清。
   * 10-24 批3 返值化(供一键补缺队列探成功;按钮路对外行为零变)。 */
  const runExpressionSheet = async (options?: { laneGuard?: boolean }): Promise<boolean> => {
    const operationId = createOperationId("asset-expression-sheet");
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset expression sheet requested",
      context: { assetId: asset.id, assetType: asset.type, assetName: asset.name, currentIndex },
    });
    // 复审 H 修:五路互斥统一守卫(队列 laneGuard:false 免闸防逐型派发自拒)
    if (options?.laneGuard !== false && isAnyGenerationLaneBusy()) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset expression sheet guard rejected (busy-lane)",
        context: { assetId: asset.id },
      });
      return false;
    }
    if (expressionPhase) {
      // 在跑直返(按钮已禁,双保险)
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset expression sheet guard rejected (busy)",
        context: { assetId: asset.id, expressionPhase },
      });
      return false;
    }
    if (asset.type !== "role") {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset expression sheet guard rejected (non-role)",
        context: { assetId: asset.id, assetType: asset.type },
      });
      toast.error("表情差分仅角色资产可用");
      return false;
    }
    // 10-25 用户令(派生流水线):表情差分恒以「全身定妆图」为锚(不随轮播漂)
    const fullBodyAnchor = latestKindImage(getDisplayImages?.() ?? carouselImages, "全身定妆");
    const referenceImage = fullBodyAnchor?.url;
    if (!referenceImage) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset expression sheet guard rejected (no reference image)",
        context: { assetId: asset.id, displayImageCount: carouselImages.length },
      });
      toast.error("没有可作参考的图片，请先生成或添加图片");
      return false;
    }
    // 命名沿 10-19「废主图名号」令:图生图=原图名_表情差分_中文日期
    const inputImageName = carouselImages[currentIndex]?.name || asset.name;
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
    const resultImageName = `${inputImageName}_表情差分_${dateSuffix}`;
    setExpressionPhase("generating");
    setExpressionMessage(`正在生成 ${asset.name} 的表情差分...`);
    try {
      const result = await generateAssetExpressionSheet(
        {
          assetId: asset.id,
          assetName: asset.name,
          referenceImage,
          ...(getInstructionOverride?.("表情差分")?.trim()
            ? { instructionOverride: getInstructionOverride?.("表情差分")?.trim() }
            : {}),
          operationId,
        },
        (progress) => {
          if (progress.phase === "generating" || progress.phase === "saving") {
            setExpressionPhase("generating");
            if (progress.message) setExpressionMessage(progress.message);
          }
        },
      );
      if (result.phase === "done") {
        setExpressionPhase("done");
        setExpressionMessage("表情差分生成完成！");
        // 10-25 用户令·单图型替换:生成成功先清该型旧图再收编(桥缺席/单条删除失败
        // 不阻断收编——新图照入库,残留旧图下轮再生成时再清)
        for (const stalePath of singleKindReplacementFilePaths(images, "表情差分")) {
          await getStudioAssetsBridge()?.removeImage?.({ assetId: asset.id, imageFilePath: stalePath });
        }
        const savedToLibrary = await saveGeneratedAssetImageToLibrary(asset.id, result.imageLocalPath, undefined, resultImageName);
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && getActiveAssetId && getActiveAssetId() !== asset.id) {
            // 10-25 深审修(跨资产污染):生成期间切换资产→产物已入库,表单/图集不回填
            toast.info(`「${asset.name}」生成完成已入库；当前已切换资产，弹窗状态不回填`);
          } else if (updated) {            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              // 批2(10-24):生成写路落 kind 视图值(名内 _表情差分_ 标记为持久兜底)
              newImgs.push({ name: resultImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl, kind: "表情差分" });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            // 10-25 深审修(低⑤):主图条目与 images[] 同 filePath 去重(防重复卡+重复 key)
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            // 完成即切到新主图(与人脸/画风转换同款 setCurrentIndex(0))
            setCurrentIndex(0);
          }
        }
        if (!savedToLibrary) {
          toast.warning(`「${asset.name}」表情差分已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」表情差分生成完成`);
        }
        return true;
      } else {
        setExpressionPhase("failed");
        setExpressionMessage(`表情差分生成失败: ${result.error || "未知错误"}`);
        toast.error(`表情差分生成失败: ${result.error || "未知错误"}`);
        return false;
      }
    } catch (err: unknown) {
      setExpressionPhase("failed");
      setExpressionMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setTimeout(() => {
        setExpressionPhase(null);
        setExpressionMessage("");
      }, 3000);
    }
  };
  const handleExpressionSheet = () => runExpressionSheet();

  /** B-4 用此词重掷(10-25 追加令):以查词/实发终稿弹层的引擎实收正向终稿为指令,
   * 按原路重掷一张(指令逐字/原参考图/注入层在场则原 base_type 重注/seed 新掷)。
   * 占用按型出图通用相位道(与五路互斥);收编尾段镜像表情差分(收编+广播+刷新+
   * 完成切新图);命名=原图名_重掷_中文日期(归原节)。 */
  const handleRerollFromPrompt = async (payload: {
    imageName: string;
    imagePath: string;
    imageUrl?: string;
    finalText: string;
    routeHint: "i2i" | "t2i";
    hasInjectedLayers: boolean;
  }): Promise<void> => {
    if (isAnyGenerationLaneBusy()) {
      toast.warning("有生成任务正在进行，请稍候");
      return;
    }
    const operationId = createOperationId("asset-prompt-reroll");
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset prompt reroll requested",
      context: { assetId: asset.id, imageName: payload.imageName, route: payload.routeHint },
    });
    setTypeShotPhase("generating");
    setTypeShotMessage(`正在按原词重掷 ${asset.name}...`);
    try {
      const result = await rerollAssetImageFromPromptText(
        {
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          imageName: payload.imageName,
          finalText: payload.finalText,
          routeHint: payload.routeHint,
          hasInjectedLayers: payload.hasInjectedLayers,
          referenceImageUrl: payload.imageUrl,
          operationId,
        },
        (progress) => {
          if (progress.phase === "generating" || progress.phase === "saving") {
            setTypeShotPhase("generating");
            if (progress.message) setTypeShotMessage(progress.message);
          }
        },
      );
      if (result.phase === "done" && result.imageLocalPath && result.resultImageName && result.resultKind) {
        setTypeShotPhase("done");
        setTypeShotMessage("重掷完成！");
        // 10-25 用户令·单图型替换:生成成功先清该型旧图再收编(桥缺席/单条删除失败
        // 不阻断收编——新图照入库,残留旧图下轮再生成时再清)
        for (const stalePath of singleKindReplacementFilePaths(images, result.resultKind)) {
          await getStudioAssetsBridge()?.removeImage?.({ assetId: asset.id, imageFilePath: stalePath });
        }
        await saveGeneratedAssetImageToLibrary(asset.id, result.imageLocalPath, undefined, result.resultImageName);
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && (!getActiveAssetId || getActiveAssetId() === asset.id)) {
            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              // 重掷产物 kind 落值=原图归型(名内原标记为持久兜底)
              newImgs.push({ name: result.resultImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl, kind: result.resultKind });
            }
            if (updated.images?.length) newImgs.push(...updated.images);
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            setCurrentIndex(0);
          }
        }
        toast.success(`「${asset.name}」按原词重掷完成`);
      } else {
        setTypeShotPhase("failed");
        setTypeShotMessage(`重掷失败: ${result.error || "未知错误"}`);
        toast.error(`重掷失败: ${result.error || "未知错误"}`);
      }
    } catch (err: unknown) {
      setTypeShotPhase("failed");
      setTypeShotMessage(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => {
        setTypeShotPhase(null);
        setTypeShotMessage("");
      }, 3000);
    }
  };

  /** 10-24 批3 按型出图(PRD §① 型驱动通用件,单一参数=型名;Round 3 扩展令⑤推广
   * 图片三轨):型档案表查表分流——i2i 路(轮播当前图锚身份+Phase2 base_type 型层
   * 注入,取景归还型层)/t2i 路(描述主体句+base_type 型层承载取景);命名沿「废主图
   * 名号」令=原图名_{型名}_中文日期(t2i 路无原图,锚资产名,与人脸文生图路同款);
   * 写回尾段镜像人脸/表情差分(saveGeneratedAssetImageToLibrary+asset:updated 广播+
   * get 刷新+完成切新图+批3 kind 落值);相位 3s 自动清。managedLane=false 供一键补缺
   * 队列复用(队列自持聚合相位,防逐型 3s 清相位把队列中段的互斥解除)。
   * 10-25 阶段矩阵 T3(PRD §3.3):options.stage=生成路选中阶段——命名改
   * 资产名_{阶段}_{型名}_中文日期(T1 buildStageTypeShotImageName,不再锚轮播图名,
   * 防旧图名内陈旧标记链式繁殖;i2i/t2i 两路同款);i2i 参考图默认锚=该阶段组内
   * 最新一张(任意型),组空回退轮播当前图;t2i 路仅命名带阶段(无参考图语义)。
   * 人脸双钮/表情差分/重掷/一键补缺队列不带阶段(PRD §3.3,无阶段语义)。 */
  const executeTypeShot = async (
    kind: AssetImageKind,
    options?: { managedLane?: boolean; stage?: string },
  ): Promise<boolean> => {
    const managedLane = options?.managedLane !== false;
    const stage = options?.stage?.trim() || undefined;
    const profile = getAssetTypeShotProfile(kind);
    const operationId = createOperationId("asset-type-shot");
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset type shot requested",
      context: {
        kind,
        route: profile?.route ?? "unknown",
        assetId: asset.id,
        assetType: asset.type,
        assetName: asset.name,
        currentIndex,
        ...(stage ? { stage } : {}),
      },
    });
    if (!profile) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset type shot guard rejected (unknown kind)",
        context: { assetId: asset.id, kind },
      });
      toast.error(`「${kind}」不在按型出图型档案内`);
      return false;
    }
    // Round 3 ⑤:三轨型谱归属守卫——型名必须在当前资产轨的型谱内(role 谱回归零变化;
    // scene 轨吃 scene 三型+自由,tool 轨吃道具+自由,跨轨型名拒收)
    const track = asAssetImageTrack(asset.type);
    if (!track) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset type shot guard rejected (non-image-track)",
        context: { assetId: asset.id, assetType: asset.type },
      });
      toast.error("按型出图仅角色/场景/道具三轨资产可用");
      return false;
    }
    if (!getAssetImageKindSpectrum(track).order.includes(kind)) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset type shot guard rejected (kind not in track spectrum)",
        context: { assetId: asset.id, kind, track },
      });
      toast.error(`「${kind}」不在${asset.type === "role" ? "角色" : asset.type === "scene" ? "场景" : "道具"}轨的按型出图型谱内`);
      return false;
    }
    let referenceImage: string | undefined;
    if (profile.route === "i2i") {
      // T3(10-25 阶段矩阵):选中阶段时参考图默认锚=该阶段组内最新一张(任意型,
      // 身份锚定该阶段形态,防全局轮播停在异阶段图);组空回退轮播当前图(既有行为)
      referenceImage = (stage ? resolveStageReferenceImage(carouselImages, stage) : undefined)
        ?? resolveAssetGenerationReferenceImage(carouselImages, currentIndex);
      if (!referenceImage) {
        void logEvent({
          level: "warn",
          category: "asset",
          operationId,
          message: "Asset type shot guard rejected (no reference image)",
          context: { assetId: asset.id, kind, displayImageCount: carouselImages.length },
        });
        toast.error("没有可作参考的图片，请先生成或添加图片");
        return false;
      }
    }
    // Phase C(10-25 追加令):t2i 路主体句=该型槽覆盖优先,空回退共享主体句链
    const subjectText = profile.route === "t2i"
      ? (getKindSubjectOverride?.(kind)?.trim() || draftPrompt.trim() || draftDescription.trim() || detail.prompt?.trim() || detail.description?.trim())
      : undefined;
    if (profile.route === "t2i" && !subjectText) {
      void logEvent({
        level: "warn",
        category: "asset",
        operationId,
        message: "Asset type shot guard rejected (no subject text)",
        context: { assetId: asset.id, kind },
      });
      toast.error("没有可用于出图的描述或提示词");
      return false;
    }
    // 命名沿 10-19「废主图名号」令:i2i=原图名_{型名}_中文日期;t2i=资产名_{型名}_中文日期
    // T3(10-25 阶段矩阵):带阶段时改 资产名_{阶段}_{型名}_中文日期(T1 命名器;两路同款,
    // 不再锚轮播图名——防旧图名内陈旧标记链式繁殖,产物归组归型由 T1 测试钉)
    const inputImageName = profile.route === "i2i" ? (carouselImages[currentIndex]?.name || asset.name) : asset.name;
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
    const resultImageName = stage
      ? buildStageTypeShotImageName(asset.name, stage, profile.kind, dateSuffix)
      : `${inputImageName}_${kind}_${dateSuffix}`;
    if (managedLane) {
      setTypeShotPhase("generating");
      setTypeShotMessage(`正在生成 ${asset.name} 的${kind}...`);
    }
    try {
      const result = await generateAssetTypeShot(
        {
          assetId: asset.id,
          assetName: asset.name,
          kind,
          track,
          referenceImage,
          subjectText,
          // 追加令·i2i 指令可编辑:会话级覆盖优先,空=型档案固定指令(既有零变)
          ...(profile.route === "i2i" && getInstructionOverride?.(kind)?.trim()
            ? { instructionOverride: getInstructionOverride?.(kind)?.trim() }
            : {}),
          operationId,
        },
        (progress) => {
          if (progress.phase === "generating" || progress.phase === "saving") {
            if (managedLane) {
              setTypeShotPhase("generating");
              if (progress.message) setTypeShotMessage(progress.message);
            }
          }
        },
      );
      if (result.phase === "done") {
        if (managedLane) {
          setTypeShotPhase("done");
          setTypeShotMessage(`${kind}生成完成！`);
        }
        // 10-25 用户令·单图型替换:生成成功先清该型旧图再收编(桥缺席/单条删除失败
        // 不阻断收编——新图照入库,残留旧图下轮再生成时再清)
        for (const stalePath of singleKindReplacementFilePaths(images, kind)) {
          await getStudioAssetsBridge()?.removeImage?.({ assetId: asset.id, imageFilePath: stalePath });
        }
        const savedToLibrary = await saveGeneratedAssetImageToLibrary(asset.id, result.imageLocalPath, undefined, resultImageName);
        // 广播资产库更新:提取区 chip 颜色等依赖资产库缓存的面据此自动刷新
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        if (getStudioAssetsBridge()?.get) {
          const updated = await getStudioAssetsBridge()!.get(asset.id);
          if (updated && getActiveAssetId && getActiveAssetId() !== asset.id) {
            // 10-25 深审修(跨资产污染):生成期间切换资产→产物已入库,表单/图集不回填
            toast.info(`「${asset.name}」生成完成已入库；当前已切换资产，弹窗状态不回填`);
          } else if (updated) {            const newImgs: AssetImage[] = [];
            if (updated.previewUrl || updated.thumbnailUrl) {
              // 批3(10-24):生成写路落 kind 视图值(按型出图产物型名即所属节)
              newImgs.push({ name: resultImageName, filePath: updated.filePath || "", url: updated.previewUrl || updated.thumbnailUrl, kind });
            }
            if (updated.images?.length) {
              newImgs.push(...updated.images);
            }
            // 10-25 深审修(低⑤):主图条目与 images[] 同 filePath 去重(防重复卡+重复 key)
            const seen = new Set<string>();
            const dedupedImgs = newImgs.filter((img) => {
              const key = img.filePath || img.url || img.name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setImages(dedupedImgs);
            onImagesCollected?.(dedupedImgs);
            // 完成即切到新主图(与人脸/表情差分同款 setCurrentIndex(0))
            setCurrentIndex(0);
          }
        }
        if (!savedToLibrary) {
          toast.warning(`「${asset.name}」${kind}已生成，但未能写回资产库主图`);
        } else {
          toast.success(`「${asset.name}」${kind}生成完成`);
        }
        return true;
      } else {
        if (managedLane) {
          setTypeShotPhase("failed");
          setTypeShotMessage(`${kind}生成失败: ${result.error || "未知错误"}`);
        }
        toast.error(`${kind}生成失败: ${result.error || "未知错误"}`);
        return false;
      }
    } catch (err: unknown) {
      if (managedLane) {
        setTypeShotPhase("failed");
        setTypeShotMessage(err instanceof Error ? err.message : String(err));
      }
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (managedLane) {
        setTimeout(() => {
          setTypeShotPhase(null);
          setTypeShotMessage("");
        }, 3000);
      }
    }
  };

  /** 按型出图公共入口(节头钮/下拉/占位卡 CTA/完整度缺失 chip):五路互斥统一守卫
   *  在跑直返(按钮已禁,双保险;复审 H 修=全相位,非仅自家 typeShotPhase)。
   *  T3(10-25 阶段矩阵):options.stage 透传 executeTypeShot(命名/参考图锚定语义)。 */
  const runTypeShot = async (kind: AssetImageKind, options?: { stage?: string }): Promise<boolean> => {
    if (isAnyGenerationLaneBusy()) return false;
    return executeTypeShot(kind, options);
  };
  const handleTypeShot = (kind: AssetImageKind, options?: { stage?: string }) => {
    void runTypeShot(kind, options);
  };

  /** 10-24 批3 一键补缺顺序队列(PRD B 节:聚合相位,逐型完成落图;Round 3 ⑤ 三轨
   * 推广):按本行自有图集+当前资产轨型谱核心计缺失(role 五必备/scene 三核心/tool
   * 道具;planAssetTypeFillMissingQueue;复审 M 修=Q1 不抵扣,展示序族兄弟图不计入),
   * 逐型派发到各自生成路(高清人脸/表情差分接既有路,余型走 executeTypeShot),任一型
   * 失败即中止队列(队列失败/取消策略候 Round 3 后续裁定,Phase1 取失败即停);
   * typeShot 相位聚合承载进度文案。 */
  const runFillMissingQueue = async (): Promise<void> => {
    if (generatePhaseForGuard || i2iPhase || facePhase || expressionPhase || typeShotPhase) {
      toast.error("有生成任务正在进行，请稍候");
      return;
    }
    const track = asAssetImageTrack(asset.type);
    if (!track) {
      toast.error("一键补缺仅角色/场景/道具三轨资产可用");
      return;
    }
    const trackNoun = track === "role" ? "角色" : track === "scene" ? "场景" : "道具";
    // 批3 复审 M 修(Round 3 Q1):补缺计划按本行自有图集计——族聚显展示序
    // (carouselImages)含族兄弟行图,同型图不抵扣本行缺口;十境图归属确认候
    // 版本系统落地后细化,当前按本行现集计(参考图可用性仍查展示序,同族同脸可锚)
    const missing = planAssetTypeFillMissingQueue(images, track);
    if (missing.length === 0) {
      toast.info("核心必备已齐，无需补缺");
      return;
    }
    // 参考图守卫:队列含 i2i 路型别(高清人脸/表情差分既有路+型档案 i2i 型)且零图才拦
    // (Round 3 ⑤:tool 轨核心=道具走 t2i,零图可补;role 轨行为零变化)
    const needsReference = missing.some(
      (kind) => kind === "高清人脸" || kind === "表情差分" || getAssetTypeShotProfile(kind)?.route === "i2i",
    );
    if (needsReference && carouselImages.length === 0) {
      toast.error(`先有${trackNoun}图片才能一键补缺`);
      return;
    }
    const dispatchKindGeneration = (kind: AssetImageKind): Promise<boolean> => {
      // 复审 H 修:laneGuard:false——队列入口已持五路守卫+自持聚合相位(typeShotPhase),
      // 底层执行器免统一守卫防逐型派发自拒
      if (kind === "高清人脸") return runFacePortrait(carouselImages.length > 0 ? "image" : "text", { laneGuard: false });
      if (kind === "表情差分") return runExpressionSheet({ laneGuard: false });
      return executeTypeShot(kind, { managedLane: false });
    };
    setTypeShotPhase("generating");
    let completed = 0;
    try {
      for (const kind of missing) {
        setTypeShotMessage(`正在补缺 ${completed + 1}/${missing.length}:${kind}...`);
        // 复审修(A-1 写入点第4项):逐型派发同帧聚焦执行型——队列不经 Dialog 的
        // focusOnKind 包装,经钩子补写,面板构成区随实际执行型行进
        onFillMissingKindFocus?.(kind);
        const ok = await dispatchKindGeneration(kind);
        if (!ok) {
          setTypeShotPhase("failed");
          setTypeShotMessage(`${kind}补缺失败，队列中止`);
          toast.error(`${kind}补缺失败，队列中止（已完成 ${completed}/${missing.length}）`);
          return;
        }
        completed += 1;
      }
      setTypeShotPhase("done");
      setTypeShotMessage("一键补缺完成！");
      toast.success(`「${asset.name}」已补全 ${completed} 类核心图`);
    } finally {
      setTimeout(() => {
        setTypeShotPhase(null);
        setTypeShotMessage("");
      }, 3000);
    }
  };
  const handleFillMissingQueue = () => {
    void runFillMissingQueue();
  };

  const handleRegenerate = async () => {
    // 空描述守卫沿用(无描述无出图意义);prompt 本身不预填——画布与资产库
    // 各走各的链路(09-10 全屏 ComfyUI 合一,旧预填+image:generated 回存已退役)。
    const hasPrompt = Boolean(
      draftPrompt.trim() ||
        draftDescription.trim() ||
        detail.prompt?.trim() ||
        detail.description?.trim(),
    );
    if (!hasPrompt) {
      toast.error("没有可用于出图的描述或提示词");
      return;
    }

    setActiveStudio("comfy");
    setActiveTab("freedom");
    onOpenChange(false);
    toast.success("已打开 ComfyUI 画布");
  };

  const handleOpenSource = async () => {
    const target = getAssetImageOpenTarget(carouselImages, currentIndex, detail);
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    try {
      const result = await window.electronAPI.openPath(target);
      if (!result.success) {
        toast.error(result.error || "打开失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "打开失败"));
    }
  };

  const handleOpenFolder = async () => {
    const target = asset.sourcePath || asset.filePath;
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的本地路径");
      return;
    }
    const dir = target.substring(0, target.lastIndexOf("/")) || target;
    try {
      const result = await window.electronAPI.openPath(dir);
      if (!result.success) {
        toast.error(result.error || "打开失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "打开失败"));
    }
  };

  const handleAddImage = async () => {
    if (!getStudioAssetsBridge()?.selectImageFiles || !getStudioAssetsBridge()?.addImage) {
      toast.error("当前环境不支持添加图片");
      return;
    }
    try {
      const filePaths = await getStudioAssetsBridge()!.selectImageFiles();
      if (!filePaths.length) return;

      let lastResult: StudioAssetSummary | null = null;
      let addedCount = 0;
      let failedCount = 0;
      for (const filePath of filePaths) {
        const imageName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "新图片";
        try {
          const result = await getStudioAssetsBridge()!.addImage({
            assetId: asset.id,
            imageName: imageName.trim(),
            sourceFilePath: filePath,
          });
          if (result?.images) {
            lastResult = result;
            addedCount += 1;
          } else {
            failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      if (lastResult?.images) {
        const newImgs: AssetImage[] = [];
        if (lastResult.previewUrl || lastResult.thumbnailUrl) {
          // 10-19 用户令:废「主图」名号——主图位=资产名_中文日期
          const addNow = new Date();
          const addDate = `${addNow.getFullYear()}年${String(addNow.getMonth() + 1).padStart(2, "0")}月${String(addNow.getDate()).padStart(2, "0")}日`;
          newImgs.push({ name: `${asset.name}_${addDate}`, filePath: lastResult.filePath || "", url: lastResult.previewUrl || lastResult.thumbnailUrl });
        }
        newImgs.push(...lastResult.images);
        setFullAsset(lastResult);
        setImages(newImgs);
        // R4 族聚显:展示序=族序+live 新图置顶——按新图 filePath 定位展示序高亮
        const lastAddedFilePath = lastResult.images[lastResult.images.length - 1]?.filePath;
        // 10-25 深审修(低):定位下标须与弹窗真实展示序同口径——滤掉本会话已删族兄弟
        const nextDisplay = mergeFamilyDisplayImages(familyImages, newImgs, asset?.id)
          .filter((entry) => !(removedFamilyPaths ?? []).includes(entry.filePath));
        const targetIndex = findDisplayImageIndex(nextDisplay, lastAddedFilePath);
        setCurrentIndex(targetIndex >= 0 ? targetIndex : newImgs.length - 1);
        if (failedCount > 0) {
          toast.warning(`已添加 ${addedCount} 张图片，${failedCount} 张未添加`);
        } else {
          toast.success(`已添加 ${addedCount} 张图片`);
        }
      } else {
        toast.error(`添加失败：${failedCount} 张图片均未添加`);
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "添加失败"));
    }
  };

  const handleReplaceImage = async () => {
    if (!getStudioAssetsBridge()?.selectImageFile || !getStudioAssetsBridge()?.replaceImage) {
      toast.error("当前环境不支持更换图片");
      return;
    }
    try {
      const filePath = await getStudioAssetsBridge()!.selectImageFile();
      if (!filePath) return;
      const result = await getStudioAssetsBridge()!.replaceImage({ assetId: asset.id, sourceFilePath: filePath });
      if (result) {
        const newImgs = updateImagesAfterReplacingMainImage(images, result);
        setImages(newImgs);
        setFullAsset((current) => current ? { ...current, ...result } : result);
        setCurrentIndex(0);
        toast.success("已更换");
      } else {
        toast.error("更换失败");
      }
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "更换失败"));
    }
  };

  const handleRemoveImage = async (img: AssetImage, idx: number): Promise<boolean> => {
    // 10-19 用户裁定:主图亦可删 + 追令「可见即可删」(族聚显兄弟图同权)。
    // 返回值=是否真删成功(供弹窗层同步过滤展示序,删后不刷新=用户报障)。
    void idx; // 签名沿用 pane 的 (image, index) 契约;删除按 filePath 定位,不按下标
    if (!getStudioAssetsBridge()?.removeImage) return false;
    const ownIndex = images.findIndex((item) => item.filePath === img.filePath);
    if (ownIndex === -1) {
      // 族兄弟条目:本行未命中 → 按 familyImages 找到它真正所属的行去删(删对行,
      // 防「按当前行 id 删错资产」的旧跨行风险;非本行亦非已知族兄弟=展示层陈旧,静默拒)
      const sibling = (familyImages ?? []).find(
        (entry) => entry.filePath === img.filePath && entry.assetId !== asset.id,
      );
      if (!sibling) return false;
      try {
        const result = await getStudioAssetsBridge()!.removeImage({
          assetId: sibling.assetId,
          imageFilePath: img.filePath,
        });
        if (result) {
          toast.success(`已删除(该图属于「${sibling.name || sibling.assetId}」)`);
          // 刷新链:列表页(AssetsTab 听 asset:updated 重载)+ 弹窗层据返回值过滤本轮播
          eventBus.emit("asset:updated", { id: sibling.assetId, type: asset.type });
          return true;
        }
        toast.error("删除失败");
        return false;
      } catch (error: unknown) {
        toast.error(getAssetOperationError(error, "删除失败"));
        return false;
      }
    }
    try {
      const result = await getStudioAssetsBridge()!.removeImage({ assetId: asset.id, imageFilePath: img.filePath });
      if (result) {
        const newImgs = images.filter((_, i) => i !== ownIndex);
        setImages(newImgs);
        setCurrentIndex(Math.min(currentIndex, Math.max(carouselImages.length - 2, 0)));
        toast.success("已删除");
        eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
        return true;
      }
      toast.error("删除失败");
      return false;
    } catch (error: unknown) {
      toast.error(getAssetOperationError(error, "删除失败"));
      return false;
    }
  };

  // (10-24 布局重造批1顺带清理:889-921 悬空未绑定的重命名图片 async 函数已删——
  //  无 UI 入口的死代码,重命名能力未在 19 项保全清单内,桥侧重命名接口本体未动。)

  const handleTranscribe = async () => {
    const filePath = asset.sourcePath || asset.filePath;
    if (!filePath) {
      toast.error("无音频文件路径");
      return;
    }
    const ttsRuntime = getTtsRuntimeBridge();
    if (!ttsRuntime?.request) {
      toast.error("TTS 后端未就绪");
      return;
    }
    toast.info("正在识别说话内容...");
    try {
      const result = await ttsRuntime.request({
        method: "POST",
        path: "/transcribe",
        body: { audio_path: filePath },
      }) as { text?: string };
      if (result?.text) {
        setDraftDescription(result.text);
        setRecognizedText(result.text);
        if (getStudioAssetsBridge()?.update) {
          await getStudioAssetsBridge()!.update({
            id: asset.id,
            updates: { description: result.text },
          });
        }
        toast.success("识别完成并已保存");
      } else {
        toast.error("未识别到内容");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "识别失败");
    }
  };

  return {
    handlePolishPrompt, handleSave, handleDelete, copyText,
    handleOneClickGenerateAssetImage, handleImageToImageStyle, handleRegenerate,
    handleOpenSource, handleOpenFolder, handleAddImage, handleReplaceImage,
    handleRemoveImage, handleTranscribe, handleFacePortraitFromImage, handleFacePortraitFromText, handleExpressionSheet,
    handleTypeShot, handleFillMissingQueue, handleRerollFromPrompt,
  };
}
