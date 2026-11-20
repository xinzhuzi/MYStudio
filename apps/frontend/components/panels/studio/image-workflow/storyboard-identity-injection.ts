/**
 * 分镜提示词 A/B 并轨「设计卡全文注入」模式(1120,PRD 11-20-toonflow-binding-
 * phase1 件三;父任务 11-20-toonflow-relations-survey §3.1.3/§二对照表)。
 *
 * Toonflow §3.4 对应物:角色设计卡文本以「参考 N:<全文>」整段追加进提示词
 * (新代铁律4「文本参考整段注入」——角色设定进 prompt 的唯一代码级机制)。
 * 与五项序正典的 A/B 差异=「传设定」vs「拆解拼接+防崩护栏」:正典把身份段
 * 白名单提取(十七刀A)后织进五项序首位;本模式设计卡全文逐字成块注入,
 * 主体句走零身份段形态(buildCanonicalSubjectSentence 传 identities:[])。
 *
 * 边界(PRD 四裁):不动 storyboard-canonical-prompt.ts 本体——本模块只消费
 * 其纯函数;开关默认 canonical=正典路径字节级零变化。传输层(identity-injection
 * 模式)对注入块跳过身份段相关 lint 断言,锚词断言(场景/时辰/主角名)两模式
 * 都保留(见 run-image-workflow-node-generation.ts 装配段)。
 */
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  buildCanonicalSubjectSentence,
  type CanonicalIdentityParagraph,
  type CanonicalReferenceSlot,
  type CanonicalSubjectInput,
} from "@/lib/studio/storyboard-canonical-prompt";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import {
  STORYBOARD_IDENTITY_OVERRIDE_KEY,
  nameMatches,
  parsePromptOverride,
} from "./storyboard-canonical-context";

/** 构句模式:canonical=五项序正典(缺省);identity-injection=设计卡全文注入。 */
export type StoryboardPromptMode = "canonical" | "identity-injection";

/**
 * 开关解析(纯函数,fail-safe):发车配置 workflowConfig.storyboardPromptMode
 * 缺省/非法值一律回落 canonical——默认路径字节级零变化的守门点。
 */
export function resolveStoryboardPromptMode(mode: unknown): StoryboardPromptMode {
  return mode === "identity-injection" ? "identity-injection" : "canonical";
}

/**
 * 设计卡全文身份段解析(§4.3 同源级联,**不洗版**):①资产库 promptOverrides
 * 「分镜剧情图」键(逐字)→②资产 prompt 列(生图提示词真源,全文逐字——与
 * 正典路的差异点:正典过 sanitizeAssetPromptForIdentity 白名单提取,本模式
 * 照抄 Toonflow「全文注入」)→③description 补位→④三库中文视觉字段回落。
 * 桥查询失败回落三库(fail-safe,与正典解析同纪律,不留痕阻断)。
 */
export async function resolveIdentityFullTexts(
  characterNames: readonly string[],
): Promise<CanonicalIdentityParagraph[]> {
  const bridge = getStudioAssetsBridge();
  const projectId = useProjectStore.getState().activeProjectId;
  const library = useCharacterLibraryStore.getState().characters;
  const identities: CanonicalIdentityParagraph[] = [];
  for (const name of characterNames.map((entry) => entry.trim()).filter(Boolean)) {
    let identity: CanonicalIdentityParagraph | undefined;
    if (bridge?.getByName) {
      try {
        const asset = await bridge.getByName({ type: "role", name });
        const override = parsePromptOverride(asset?.promptOverrides, STORYBOARD_IDENTITY_OVERRIDE_KEY);
        if (override) {
          identity = { name, paragraph: override, origin: "asset-override" };
        } else if ((asset?.prompt ?? "").trim()) {
          identity = { name, paragraph: asset!.prompt!.trim(), origin: "asset-description" };
        } else if (asset?.description?.trim()) {
          identity = { name, paragraph: asset.description.trim(), origin: "asset-description" };
        }
      } catch {
        // 桥查询失败回落三库,不留痕阻断(与正典身份段解析同纪律)
      }
    }
    if (!identity) {
      const character = library.find(
        (entry) =>
          nameMatches(name, entry.name)
          && (!projectId || !entry.projectId || entry.projectId === projectId),
      );
      const fallback = character?.variations?.find((variation) => variation.visualPromptZh?.trim())?.visualPromptZh
        ?? character?.appearance
        ?? character?.description
        ?? "";
      if (fallback.trim()) identity = { name, paragraph: fallback.trim(), origin: "character-library" };
    }
    if (identity) identities.push(identity);
  }
  return identities;
}

/**
 * 「参考 N:<全文>」块构造(纯函数):N=§4.5 传输槽序(Toonflow §3.4「参考 N」
 * =第 N 张参考图)——传输槽 image_1=主角角色→image_2=场景/次角色→道具恒不
 * 入图,与 assetBindings 写路 slot(场景→角色→道具全量序)不同序,编号以传输
 * 槽为准才与送模参考图逐槽对上。角色身份段按名匹配挂对应角色传输槽号;无
 * 传输槽(超额被裁/零槽 t2i/槽缺席旧章)的身份段按序补号在全部传输槽之后
 * (参考序连续,禁空洞禁撞号)。场景/前帧槽无身份段,不产块(其槽号只占号)。
 */
export function buildIdentityInjectionReferenceBlocks(
  identities: readonly CanonicalIdentityParagraph[],
  slots?: readonly CanonicalReferenceSlot[],
): string[] {
  const transportSlots = slots ?? [];
  const characterSlots = transportSlots.filter((slot) => slot.role === "character");
  // 补号起点=全部传输槽之后(槽序物理连续 1..N,场景/前帧槽也占号,防撞)。
  let nextSlot = transportSlots.length;
  return identities
    .filter((identity) => identity.paragraph.trim())
    .map((identity) => {
      const slot = characterSlots.find((candidate) => nameMatches(identity.name, candidate.title));
      const number = slot?.slot ?? (nextSlot += 1);
      return `参考 ${number}：${identity.paragraph.trim()}`;
    });
}

/** 基底+参考块合稿(纯函数):单段成文(09 格式七规①),基底去句号后「；」拼接,收「。」。 */
export function appendIdentityInjectionBlocks(base: string, blocks: readonly string[]): string {
  if (!blocks.length) return base;
  return `${base.replace(/。$/, "")}；${blocks.join("；")}。`;
}

export interface StoryboardIdentityInjectionInput {
  /** 传输期生效主体句输入(context 层 effectiveSubject,与正典同源)。 */
  subject: CanonicalSubjectInput;
  /** §4.5 槽位映射结果(体裁路由:零槽=t2i 主体句形态重建;兼参考块编号坐标
   *  ——块 N=角色所在传输槽号,与 assetBindings 写路 slot 解耦)。 */
  slots: readonly CanonicalReferenceSlot[];
  /** 正典体裁化终稿:有槽时=i2i 指令体(本就零身份段,指图不描字)——注入基底直用。 */
  canonicalInstructionPrompt: string;
  /** 设计卡全文身份段(resolveIdentityFullTexts 产物)。 */
  identities: readonly CanonicalIdentityParagraph[];
}

export interface StoryboardIdentityInjectionPrompt {
  /**
   * lint 基底(零身份段主体句/i2i 指令体):体裁断言/重叠预检/语义门按此跑
   * ——身份段相关 lint 断言对注入块豁免的边界即 base|prompt 之分。
   */
  base: string;
  /** 终稿=base+参考块(送 400;锚词断言按此全文跑,两模式同门)。 */
  prompt: string;
  /** 「参考 N:<全文>」块(诊断留痕/lint 豁免面)。 */
  blocks: string[];
}

/**
 * 设计卡全文注入装配(纯函数):零槽=t2i 主体句零身份段重建
 * (buildCanonicalSubjectSentence 传 identities:[] 形态);有槽=i2i 指令体
 * 直用(正典 i2i 变化项本就零身份段,身份由参考图携带——本模式在此之上
 * 全文成块追加,文图双通道传设定)。
 */
export function buildStoryboardIdentityInjectionPrompt(
  input: StoryboardIdentityInjectionInput,
): StoryboardIdentityInjectionPrompt {
  const base = input.slots.length === 0
    ? buildCanonicalSubjectSentence({ ...input.subject, identities: [] }).text
    : input.canonicalInstructionPrompt;
  const blocks = buildIdentityInjectionReferenceBlocks(input.identities, input.slots);
  return { base, prompt: appendIdentityInjectionBlocks(base, blocks), blocks };
}
