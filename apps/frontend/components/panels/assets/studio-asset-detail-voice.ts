/**
 * 资产详情音色/关联说话人(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * 音色绑定/档案解析 + 资产名全别名匹配的角色库 speaker 键收集。逻辑零改动。
 */
import { useMemo } from "react";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { TtsSpeakerId } from "@/types/tts";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useAssetDetailViewStore } from "@/stores/assets/asset-detail-view-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";

export function useAssetDetailVoice(asset: StudioAssetSummary | null) {
  const activeTtsProjectId = useTtsStore((s) => s.activeProjectId);
  const ttsProjects = useTtsStore((s) => s.projects);
  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);
  // linkedSpeakerIds(1120 独立页役:计算随弹窗退役迁入 view 消费):资产名全
  // 分隔符别名解析后收集项目内匹配的角色库条目 speaker 键(共享资产如「李先生;
  // 管事」拆开的各角色键都接住),分配音色时统一双写,保证工作流试听/成片一致。
  // 旧 fallbackRow(工作流行 id 兜底键)随两消费方改 store 落 target 而退役——
  // 名字匹配主体保留(实现期按 PRD §10.5 最小面定)。
  const linkedProjectId = useProjectStore((state) => state.activeProjectId);
  const linkedCharacters = useCharacterLibraryStore((state) => state.characters);
  const detailOrigin = useAssetDetailViewStore((state) => state.origin);
  const detailSourceRowId = useAssetDetailViewStore((state) => state.sourceRowId);
  const linkedSpeakerIds = useMemo<TtsSpeakerId[]>(() => {
    if (asset?.type !== "role") return [];
    const names = new Set(parseAssetNames(asset.name ?? "").allNames);
    const ids = linkedCharacters
      .filter(
        (character) =>
          (!linkedProjectId || character.projectId === linkedProjectId) &&
          names.has(character.name.trim()),
      )
      .map((character) => toRoleSpeakerId(character.id));
    // 复审 M2 修:script-tab 行兜底(旧 collectLinkedSpeakerIds 语义回归)——
    // 资产名≠角色库现名(改名晚于剧本行生成)时,角色行自身 speaker 键仍入列,
    // 分配音色双写不静默断
    if (detailOrigin === "script-tab" && detailSourceRowId) {
      const fallback = toRoleSpeakerId(detailSourceRowId);
      if (!ids.includes(fallback)) ids.push(fallback);
    }
    return ids;
  }, [asset?.type, asset?.name, linkedCharacters, linkedProjectId, detailOrigin, detailSourceRowId]);

  // 音色绑定/档案(详情页头卡与试听;asset 为空时恒 undefined)
  const roleSpeakerId = asset ? toRoleSpeakerId(asset.id) : undefined;
  const roleVoiceBindings = activeTtsProjectId ? (ttsProjects[activeTtsProjectId]?.bindings ?? {}) : {};
  const roleVoiceBinding = asset?.type === "role" && roleSpeakerId ? roleVoiceBindings[roleSpeakerId] : undefined;
  const roleVoiceProfile = roleVoiceBinding ? voiceProfiles[roleVoiceBinding.profileId] : undefined;

  return { roleSpeakerId, roleVoiceBinding, roleVoiceProfile, linkedSpeakerIds };
}
