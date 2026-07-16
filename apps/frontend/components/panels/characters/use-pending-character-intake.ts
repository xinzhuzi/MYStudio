import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getStyleById } from "@/lib/constants/visual-styles";
import type { PendingCharacterData } from "@/stores/media-panel-store";
import type {
  CharacterIdentityAnchors,
  CharacterNegativePrompt,
  PromptLanguage,
} from "@/types/script";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface UsePendingCharacterIntakeOptions {
  pendingCharacterData: PendingCharacterData | null;
  setPendingCharacterData: (data: PendingCharacterData | null) => void;
  setName: StateSetter<string>;
  setGender: StateSetter<string>;
  setAge: StateSetter<string>;
  setPersonality: StateSetter<string>;
  setRole: StateSetter<string>;
  setTraits: StateSetter<string>;
  setSkills: StateSetter<string>;
  setKeyActions: StateSetter<string>;
  setAppearance: StateSetter<string>;
  setRelationships: StateSetter<string>;
  setDescription: StateSetter<string>;
  setTags: StateSetter<string[]>;
  setNotes: StateSetter<string>;
  setPromptLanguage: StateSetter<PromptLanguage>;
  setVisualPromptEn: StateSetter<string>;
  setVisualPromptZh: StateSetter<string>;
  setIdentityAnchors: StateSetter<CharacterIdentityAnchors | undefined>;
  setCharNegativePrompt: StateSetter<CharacterNegativePrompt | undefined>;
  setStoryYear: StateSetter<number | undefined>;
  setEra: StateSetter<string | undefined>;
  setSourceEpisodeId: StateSetter<string | undefined>;
  setStyleId: StateSetter<string>;
}

export function usePendingCharacterIntake(options: UsePendingCharacterIntakeOptions): void {
  const {
    pendingCharacterData,
    setPendingCharacterData,
    setName,
    setGender,
    setAge,
    setPersonality,
    setRole,
    setTraits,
    setSkills,
    setKeyActions,
    setAppearance,
    setRelationships,
    setDescription,
    setTags,
    setNotes,
    setPromptLanguage,
    setVisualPromptEn,
    setVisualPromptZh,
    setIdentityAnchors,
    setCharNegativePrompt,
    setStoryYear,
    setEra,
    setSourceEpisodeId,
    setStyleId,
  } = options;

  useEffect(() => {
    if (!pendingCharacterData) return;

    setName(pendingCharacterData.name || "");

    const genderMap: Record<string, string> = {
      "男": "male", "男性": "male", male: "male", Male: "male",
      "女": "female", "女性": "female", female: "female", Female: "female",
    };
    setGender(genderMap[pendingCharacterData.gender || ""] || "");

    const ageStr = pendingCharacterData.age || "";
    let mappedAge = "";
    if ((ageStr.includes("5") && ageStr.includes("12")) || ageStr.includes("儿童")) {
      mappedAge = "child";
    } else if (ageStr.includes("13") || ageStr.includes("18") || ageStr.includes("青少年")) {
      mappedAge = "teen";
    } else if (ageStr.includes("19") || ageStr.includes("20") || ageStr.includes("25") || ageStr.includes("30") || ageStr.includes("青年")) {
      mappedAge = "young-adult";
    } else if (ageStr.includes("35") || ageStr.includes("40") || ageStr.includes("45") || ageStr.includes("50") || ageStr.includes("中年")) {
      mappedAge = "adult";
    } else if (ageStr.includes("55") || ageStr.includes("60") || ageStr.includes("70") || ageStr.includes("老年")) {
      mappedAge = "senior";
    } else if (ageStr.match(/\d+.*\d+/)) {
      mappedAge = "adult";
    }
    setAge(mappedAge);

    setPersonality(pendingCharacterData.personality || "");
    setRole(pendingCharacterData.role || "");
    setTraits(pendingCharacterData.traits || "");
    setSkills(pendingCharacterData.skills || "");
    setKeyActions(pendingCharacterData.keyActions || "");
    setAppearance(pendingCharacterData.appearance || "");
    setRelationships(pendingCharacterData.relationships || "");

    const descriptionParts: string[] = [];
    if (pendingCharacterData.role) descriptionParts.push(`【身份/背景】\n${pendingCharacterData.role}`);
    if (pendingCharacterData.traits) descriptionParts.push(`【核心特质】\n${pendingCharacterData.traits}`);
    if (pendingCharacterData.skills) descriptionParts.push(`【技能/能力】\n${pendingCharacterData.skills}`);
    if (pendingCharacterData.keyActions) descriptionParts.push(`【关键事迹】\n${pendingCharacterData.keyActions}`);
    if (pendingCharacterData.appearance) descriptionParts.push(`【外貌特征】\n${pendingCharacterData.appearance}`);
    if (pendingCharacterData.relationships) descriptionParts.push(`【人物关系】\n${pendingCharacterData.relationships}`);
    if (descriptionParts.length > 0) {
      setDescription(descriptionParts.join("\n\n"));
    }

    if (pendingCharacterData.tags) setTags(pendingCharacterData.tags);
    if (pendingCharacterData.notes) setNotes(pendingCharacterData.notes);
    if (pendingCharacterData.promptLanguage) setPromptLanguage(pendingCharacterData.promptLanguage);
    if (pendingCharacterData.visualPromptEn) setVisualPromptEn(pendingCharacterData.visualPromptEn);
    if (pendingCharacterData.visualPromptZh) setVisualPromptZh(pendingCharacterData.visualPromptZh);
    if (pendingCharacterData.identityAnchors) setIdentityAnchors(pendingCharacterData.identityAnchors);
    if (pendingCharacterData.negativePrompt) setCharNegativePrompt(pendingCharacterData.negativePrompt);
    if (pendingCharacterData.storyYear) setStoryYear(pendingCharacterData.storyYear);
    if (pendingCharacterData.era) setEra(pendingCharacterData.era);
    setSourceEpisodeId(pendingCharacterData.sourceEpisodeId);

    if (pendingCharacterData.styleId) {
      const validStyle = getStyleById(pendingCharacterData.styleId);
      if (validStyle) {
        setStyleId(validStyle.id);
      }
    }

    // TODO: 处理多阶段角色变体
    // 如果有 stageInfo 或 consistencyElements，应该：
    // 1. 在角色描述中提示用户这是多阶段角色
    // 2. 生成角色后自动为其添加 variations
    // 注：这部分逻辑应该在 handleCreateAndGenerate 后执行
    setPendingCharacterData(null);
  }, [
    pendingCharacterData,
    setAge,
    setAppearance,
    setCharNegativePrompt,
    setDescription,
    setEra,
    setGender,
    setIdentityAnchors,
    setKeyActions,
    setName,
    setNotes,
    setPendingCharacterData,
    setPersonality,
    setPromptLanguage,
    setRelationships,
    setRole,
    setSkills,
    setSourceEpisodeId,
    setStoryYear,
    setStyleId,
    setTags,
    setTraits,
    setVisualPromptEn,
    setVisualPromptZh,
  ]);
}
