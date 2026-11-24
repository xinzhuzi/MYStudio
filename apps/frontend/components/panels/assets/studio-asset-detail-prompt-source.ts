/**
 * 角色提示词真源(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * repo 手工真源/store 位探测/DB 回退三层目录统一为双卡渲染目录;派发/保存用主体句
 * (镜像激活=真源派生句,否则 DB 值)。逻辑零改动。
 */
import { useEffect, useMemo, useState } from "react";
import type { StudioAssetSummary } from "@/types/studio-assets";
import {
  deriveBareSubjectFromClothed,
  deriveSubjectFromCharacterJson,
  getCharacterJsonInfo,
  loadCharacterJsonText,
  parseCharacterPromptCatalog,
  resolveAssetPromptJsonInfo,
  type AssetPromptJsonInfo,
  type CharacterPromptCatalog,
} from "@/lib/studio/asset-character-json";
import { promptJsonTypeOf } from "./studio-asset-detail-helpers";

export function useAssetCharacterPromptSource({
  asset,
  selectedStage,
  draftPrompt,
  characterJsonOpen,
}: {
  asset: StudioAssetSummary | null;
  selectedStage: string | null;
  draftPrompt: string;
  characterJsonOpen: boolean;
}) {
  // 角色真源 JSON(10-26):按资产名解析 art_skills/<包>/json/<角色名>.json;模块级
  // 缓存,无真源角色恒 null(按钮整段不渲染,配角弹窗零变化)
  const characterJsonInfo = getCharacterJsonInfo(asset?.name);
  // store 位真源探测(10-27 接线):项目库 store/assets/files/prompts/<名>.json 命中
  // 的 role/scene/tool 资产与 repo 手工真源同待遇(按钮/弹窗/素体句闸放开);弹窗
  // 重开/切资产/编辑弹窗关闭即重探(缓存随 save invalidate)。探测中=null。
  const [storePromptInfo, setStorePromptInfo] = useState<AssetPromptJsonInfo | null>(null);
  useEffect(() => {
    if (!asset?.name) {
      setStorePromptInfo(null);
      return;
    }
    let cancelled = false;
    resolveAssetPromptJsonInfo(asset.name, promptJsonTypeOf(asset.type))
      .then((info) => {
        if (!cancelled) setStorePromptInfo(info);
      })
      .catch(() => {
        if (!cancelled) setStorePromptInfo({ origin: null });
      });
    return () => {
      cancelled = true;
    };
  }, [asset?.name, asset?.type, characterJsonOpen]);
  const storePromptHit = storePromptInfo?.origin === "store";
  // 真源接线(10-26 用户令:「提示词应由 JSON 数据化控制+标注文生图/图生图」):
  // 有真源的角色,提示词区=结构化人物提示词面板(随「阶段」联动,逐条路由徽标),
  // 主体句文本框退场;内部派发仍吃派生主体句(镜像走展示+派发边界覆写,不抢
  // draftPrompt state——水合链桥 get 异步回填竞态下恒以真源为准,保存时落 DB=
  // 陈旧种子自愈)。JSON 编辑弹窗关闭后重载,编辑即时反映。派生失败(null)整体
  // 回退既有 DB 行为,fail-safe。
  // 10-27 store 位接线:文本链可含 store 文本(store-only 角色同待遇);门控从
  // 「repo glob 命中」放开为「repo info 或 store 探测命中任一」。
  const [characterJsonText, setCharacterJsonText] = useState<string | null>(null);
  useEffect(() => {
    if (!characterJsonInfo && !storePromptHit) {
      setCharacterJsonText(null);
      return;
    }
    let cancelled = false;
    loadCharacterJsonText(asset?.name, promptJsonTypeOf(asset?.type)).then((load) => {
      if (!cancelled) setCharacterJsonText(load.status === "ready" ? load.text : null);
    });
    return () => {
      cancelled = true;
    };
  }, [characterJsonInfo, storePromptHit, asset?.name, asset?.type, characterJsonOpen]);
  const characterSubjectMirror = useMemo(
    () => characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, selectedStage)
      : null,
    [characterJsonText, selectedStage],
  );
  // 10-26 型区分令:「无衣物定妆」=素体型——恒用 body_base 素体主体词,不吃阶段
  // (选了境界也不发该境带衣主体词;该型定义=全身无衣物,衣物系此后 i2i 注入)
  // 10-27 store 位接线:store-only 角色的骨架素体句与运行时派生 parity
  // (characterJsonInfo||storePromptInfo 收窄放宽;用户改 store JSON 后闸句随变)。
  const characterBodyBaseSubject = useMemo(
    () => (characterJsonInfo || storePromptHit) && characterJsonText !== null
      ? deriveSubjectFromCharacterJson(characterJsonText, null)
      : null,
    [characterJsonInfo, storePromptHit, characterJsonText],
  );
  const characterPromptCatalog = useMemo(
    // 1121 布局统一:门槛放宽=repo 真源 ∨ store 位真源(store JSON 同 schema,
    // Win 侧 201 件即时吃两卡面板;旧门槛 repo-only=Mac 上仅晏燎走两卡、其余
    // 全员单块正文=用户三报「布局不一致」根源)
    () => (characterJsonInfo || storePromptHit) && characterJsonText !== null ? parseCharacterPromptCatalog(characterJsonText) : null,
    [characterJsonInfo, storePromptHit, characterJsonText],
  );
  // 1121 布局统一(用户令「都统一成晏燎的样子」):无真源 role 用 DB 数据构建
  // 同构双卡——主体句卡(DB subject,点击可展开编辑,保住原 Textarea 编辑口)+
  // 素体卡(既有自动派生链 deriveBareSubjectFromClothed);卡名如实不冒充
  // 真源语义(「主体句」≠「人脸基准」,界面不许撒谎),结构=两折叠卡同款。
  const fallbackPromptCatalog = useMemo<CharacterPromptCatalog | null>(() => {
    if (asset?.type !== "role") return null;
    // repo 真源在途时禁用回退卡:装载窗内抢先渲染会冒充「已无真源」形态,
    // 且掩掉测试/用户对真源已就位的判据(卡片标题同文)。store-only 不禁:
    // 其 JSON 常只有 body_base 无 hd_face_base,主体句卡由 DB 回退补位合并。
    if (characterJsonInfo) return null;
    const subject = (draftPrompt || "").trim();
    const bare = subject ? deriveBareSubjectFromClothed(subject) : null;
    if (!subject && !bare) return null;
    return {
      faceBase: subject
        ? { key: "db-subject", route: "t2i", routeNote: "主体句(DB,点击卡头「编辑」改)", title: "主体句", text: subject }
        : null,
      bodyBase: bare
        ? { key: "db-bare", route: "t2i", routeNote: "素体句(自动派生,剥除衣物)", title: "无衣物定妆(素体基底)", text: bare }
        : null,
      realms: [],
    };
  }, [asset?.type, draftPrompt, characterJsonInfo]);
  // 统一渲染目录:真源目录优先;其 faceBase 缺席(store-only 常态)时用 DB
  // 主体句卡补位——全员恒呈「主体句/人脸基准 + 无衣物定妆(素体基底)」双卡骨架
  const unifiedPromptCatalog = useMemo<CharacterPromptCatalog | null>(() => {
    if (characterPromptCatalog) {
      if (characterPromptCatalog.faceBase || !fallbackPromptCatalog?.faceBase) return characterPromptCatalog;
      return { ...characterPromptCatalog, faceBase: fallbackPromptCatalog.faceBase };
    }
    return fallbackPromptCatalog;
  }, [characterPromptCatalog, fallbackPromptCatalog]);
  // 主体句卡可编辑=该卡来自 DB 回退(真源 faceBase 恒只读镜像)
  const subjectCardEditable = !characterPromptCatalog?.faceBase;
  const subjectMirrorActive = Boolean(characterJsonInfo) && characterSubjectMirror !== null;
  // 派发/保存用主体句(TS 收窄:镜像激活=真源派生句,否则 DB 值)
  const effectiveSubjectPrompt = characterSubjectMirror !== null && Boolean(characterJsonInfo)
    ? characterSubjectMirror
    : draftPrompt;

  return {
    characterJsonInfo,
    storePromptHit,
    characterSubjectMirror,
    characterBodyBaseSubject,
    characterPromptCatalog,
    unifiedPromptCatalog,
    subjectCardEditable,
    subjectMirrorActive,
    effectiveSubjectPrompt,
  };
}
