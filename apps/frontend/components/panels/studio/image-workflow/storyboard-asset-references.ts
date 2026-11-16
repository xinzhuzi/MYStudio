import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import {
  collectDerivedAssetPlanEntries,
  findDerivedPlanEntryForCharacter,
  resolveStoryboardScene,
  sceneBaseName,
} from "./storyboard-canonical-context";

/**
 * 分镜关联资产 → 参考图解析(P2 自动挂载)。
 *
 * 数据链:storyboard.associateAssetsNames(分镜表「引用资产名称」列=角色/场景/
 * 道具实名)→ studio-assets 桥 batchMatch 三发(场景 scene/角色 role/道具 tool)
 * → previewUrl(file:// 受管路径,与资产库展示同源)。场景在前(旧链 @图1 场景
 * 惯例)、角色在后(激活 prefix 身份一致性锁)、道具殿后;限场景 1 + 角色 3 +
 * 道具 2。
 *
 * ⚠️ 两词分工(11-15 L1 道具断链根修):桥查询词用 DB 实型 "tool"
 * (StudioAssetKind 词表),引用层 assetType 落 "prop"
 * (ImageWorkflowAssetTargetType 联合无 "tool" 键)——拼板标签/@图N kindLabel/
 * 连续性落库等下游全在 "prop" 键下现成消费,错键任一处即断链。
 *
 * ⚠️ 持久化纪律(2026-08-23 OOM 实证):节点只存 file:// 轻量 URL,严禁把
 * base64 dataURL 写进图/store——每图 MB 级,几十工作流曾把渲染进程堆到 2.4GB
 * OOM。生图传输在 use-image-workflow-generation 按需经 readImageDataUrl IPC
 * 转 dataURL(与 project-file 参考同口径,不落盘)。
 * 桥缺失/无命中/无图 → 空数组(fail-empty,建流不挂参考);但 11-15 L2 起
 * fail-empty 必留 diagnostics warn 痕(镜 id/请求名单/滤除名单),不再无痕——
 * 「分镜图未参考剧本资产」靠人眼判图的时代终结。
 */
export async function resolveStoryboardAssetReferences(
  storyboard: Pick<StoryboardItem, "associateAssetsNames">
    & Partial<Pick<StoryboardItem, "videoDesc" | "prompt" | "lines" | "id" | "sceneName" | "timeOfDay" | "associateAssetsIds" | "shotSemantics" | "episodeId">> | undefined,
): Promise<ImageWorkflowOpenContext["assetReferences"]> {
  const names = storyboard?.associateAssetsNames ?? [];
  // 1117 C2 G3:场景名前置——G1 五级序解析出的场景名(id 命中/sceneName 落库/
  // 文本探针/守卫名匹配+态行优选)进 scene 发查询名单,S8-S12 场景节点恢复
  // 可挂(此前只吃 associateAssetsNames 名字,场景名不在即空转)。
  const sceneResolution = storyboard ? resolveStoryboardScene(storyboard) : null;
  const sceneQueryNames = sceneResolution?.fact
    ? [sceneResolution.fact.name, sceneBaseName(sceneResolution.fact.name), ...names]
        .filter(Boolean).filter((name, index, all) => all.indexOf(name) === index)
    : names;
  if (!names.length && !sceneQueryNames.length) return [];
  // 画面文本(身份防线 08-24 S08 实证): associateAssetsNames 记的是「镜所在
  // 场景的在场实体」,可能含画面外角色(如 S08 的独孤剑尘)——角色参考必须
  // 只挂画面描述/台词中提及者,否则参考图+身份锚点会把画面外主角画进镜里
  // 或顶替画面角色形象。场景/道具不滤(挂入帮画面画对环境与道具)。
  // 1117 C2(B5):第四源=visibleCharacters 名单——语义在场=镜内可见=提名
  // (S11 晏燎:videoDesc 只写「孩子们」不点名,语义 JSON 明列晏燎,参考图
  // 被滤=口径错位;滤网认语义也认文本,镜外者仍守文本防线)。
  const semanticNames = storyboard?.shotSemantics?.visibleCharacters.map((character) => character.name) ?? [];
  const frameText = [storyboard?.videoDesc, storyboard?.prompt, storyboard?.lines, semanticNames.join("\n")]
    .filter(Boolean).join("\n");
  // 无画面文本(最小调用/无描述)时不过滤——维持既有行为;有文本才执行画面过滤
  const hasFrameText = frameText.trim().length > 0;
  const bridge = getStudioAssetsBridge();
  if (!bridge?.batchMatch) {
    // L2 可观测化:names 非空而桥缺席=全链必 fail-empty(11-15 验尸断点②),
    // 留痕定谳用——不 toast 打扰,diagnostics warn 恒在
    void logEvent({
      level: "warn",
      category: "asset",
      operationId: createOperationId("storyboard-asset-refs-bridge-missing"),
      message: "Storyboard asset references resolved empty: studio-assets bridge missing",
      context: {
        shotId: storyboard?.id ?? "",
        associateAssetsNames: names,
      },
    });
    return [];
  }

  const matches = await Promise.all([
    // 1117 C2 G3:scene 发=G1 解析名前置的 sceneQueryNames(id 命中/落库场景
    // 名/文本探针回填;态行名+基础名双查)。
    bridge.batchMatch({ type: "scene", names: sceneQueryNames }),
    bridge.batchMatch({ type: "role", names }),
    // L1 道具第三发(11-15 断点①):DB 实型 tool 从未被查询——道具参考图在
    // 全链任何一环都不可能挂载;桥查询词 "tool",引用层落 "prop"(见头注两词分工)
    bridge.batchMatch({ type: "tool", names }),
  ].map((call) => call.catch(() => [] as Array<{ name: string; asset: unknown }>)));

  // 1117 C2 G5①:role 发衍生优先——规划⑦复合名(「晏燎·夜课少年」)单发
  // 查询,命中带图=该基础名的角色参考改挂衍生行(nameMatches 双向包含天然
  // 命中;显式第二发防与基础名混发后 pickBestAssetRow completeness 择优
  // 不确定——衍生先查先中即定)。
  const derivedPlanEntries = semanticNames.length ? collectDerivedAssetPlanEntries(storyboard?.episodeId) : [];
  const derivedCompoundNames: string[] = [];
  for (const name of semanticNames) {
    const entry = findDerivedPlanEntryForCharacter(derivedPlanEntries, name);
    if (entry) derivedCompoundNames.push(entry.compoundName);
  }
  const derivedRoleMatches = derivedCompoundNames.length
    ? await bridge
        .batchMatch({ type: "role", names: derivedCompoundNames })
        .catch(() => [] as Array<{ name: string; asset: unknown }>)
    : [];
  const derivedByBaseName = new Map<string, { title: string; imageUrl: string }>();
  for (const entry of derivedRoleMatches) {
    const asset = entry.asset as {
      name?: string; previewUrl?: string; thumbnailUrl?: string;
      images?: Array<{ name?: string; url?: string }>;
    } | null;
    const imageUrl = pickSingleViewAssetImage(asset, "character") ?? asset?.previewUrl ?? asset?.thumbnailUrl ?? "";
    const title = asset?.name || entry.name;
    if (!imageUrl || /^(?:data|blob):/i.test(imageUrl)) continue;
    derivedByBaseName.set(sceneBaseName(title), { title, imageUrl });
  }

  const references: NonNullable<ImageWorkflowOpenContext["assetReferences"]> = [];
  const seen = new Set<string>();
  const skipped: Array<{ title: string; assetType: string; reason: string }> = [];
  const mentionedInFrame = (title: string, queryName: string): boolean => {
    if (frameText.includes(title) || frameText.includes(queryName)) return true;
    // 简称兜底: 资产名「监工赵四」↔画面「赵四」(去职业前缀/取尾名比对)
    const short = title.replace(/^(?:监工|管事|老|年轻|小)/, "");
    if (short.length >= 2 && frameText.includes(short)) return true;
    // 正文短名方向(08-28 R17 实证):正文写「独孤」而资产叫「独孤剑尘」时全名
    // 前缀逐级截取(≥2字)命中即视为提名——先剥职业/年龄前缀再截,避免
    // 「监工/管事」这类泛称单独触发把画面外角色放进参考。
    // L4 后缀/双向方向(11-15 断点④):正文写「剑尘」而资产叫「独孤剑尘」时
    // 前缀截取不命中——补后缀逐级截取(≥2字),与前缀合围成双向包含;
    // 仍只匹配「资产名自身的切片出现在正文」(被动提名),正文任意词反查
    // 资产名的宽方向刻意不做(泛词误挂会破 S08 画面外防线)
    for (const name of new Set([
      short,
      queryName.replace(/^(?:监工|管事|老|年轻|小)/, ""),
    ])) {
      for (let len = 2; len < name.length; len += 1) {
        if (frameText.includes(name.slice(0, len))) return true;
        if (frameText.includes(name.slice(name.length - len))) return true;
      }
    }
    return false;
  };
  const collect = (
    entries: Array<{ name: string; asset: unknown }> | undefined,
    assetType: "scene" | "character" | "prop",
    limit: number,
  ) => {
    if (!Array.isArray(entries)) return;
    let added = 0;
    for (const entry of entries) {
      if (added >= limit) break;
      const asset = entry.asset as {
        id?: string; name?: string; previewUrl?: string; thumbnailUrl?: string;
        images?: Array<{ name?: string; url?: string }>;
      } | null;
      // 1115 第六病理修(主会话处置令「资产库单姿立绘优先」):角色/道具主图为
      // 多视图/三视图/设定卡而图库含 _人物图_/_正视图_ 单姿时,参考位改挂单姿,
      // 禁整卡(分镜-1 赵四五视图整卡实证=同角色多副本);仅当单姿严格优于主图才
      // 切换,主图已是单姿/两者同档/无更优=维持主图(横幅卡残余由拼板层单视图
      // 裁切兜底,storyboard-reference-sheet singlePoseCropRect)。
      const imageUrl = pickSingleViewAssetImage(asset, assetType)
        ?? asset?.previewUrl ?? asset?.thumbnailUrl ?? "";
      let title = asset?.name || entry.name;
      // 1117 C2 G5①:衍生行优先(带图)——基础名命中的角色参考改挂规划⑦衍生
      // 行(单姿优选已在衍生匹配侧同款施加);衍生行缺席=维持基础行,形态句
      // 由正典装配层文字承载(buildStoryboardCanonicalContext derived-missing)。
      let effectiveImageUrl = imageUrl;
      if (assetType === "character" && derivedByBaseName.size) {
        const derived = derivedByBaseName.get(sceneBaseName(title));
        if (derived && !seen.has(derived.title)) {
          skipped.push({ title, assetType, reason: `derived-preferred:${derived.title}` });
          title = derived.title;
          effectiveImageUrl = derived.imageUrl;
        }
      }
      if (!effectiveImageUrl || /^(?:data|blob):/i.test(effectiveImageUrl) || seen.has(title)) {
        skipped.push({ title, assetType, reason: "no-image-or-dup" });
        continue;
      }
      if (assetType === "character" && hasFrameText && !mentionedInFrame(title, entry.name)) {
        skipped.push({ title, assetType, reason: "off-frame" });
        continue;
      }
      seen.add(title);
      references.push({ imageUrl: effectiveImageUrl, title, assetType, assetId: asset?.id });
      added += 1;
    }
  };
  // 先场景后角色再道具:collect 顺序即 continuityOrder 顺序(道具殿后不破
  // 旧链 @图1 场景惯例)
  collect(matches[0], "scene", 1);
  collect(matches[1], "character", 3);
  collect(matches[2], "prop", 2);
  // L2 可观测化:names 非空而结果空/有滤除 → warn 留痕(镜 id/请求名单/滤除
  // 名单),装配侧(generateOneShot)另记「本期参考数」上下文,双痕互证
  if (!references.length || skipped.length) {
    void logEvent({
      level: "warn",
      category: "asset",
      operationId: createOperationId("storyboard-asset-refs-fail-partial"),
      message: references.length
        ? "Storyboard asset references partially resolved (skipped entries)"
        : "Storyboard asset references resolved empty: names requested but none attached",
      context: {
        shotId: storyboard?.id ?? "",
        associateAssetsNames: names,
        frameTextPresent: hasFrameText,
        skipped,
      },
    });
  }
  return references;
}

/**
 * 单姿图优先(1115 第六病理修,主会话处置令「资产库单姿立绘优先;只有设定卡时,
 * 出图前裁/选正面单姿为参考,禁整卡」):角色/道具在主图非单姿(多视图/三视图/
 * 设定卡标记,或无单姿标记的存量图)而 images 图库含 _人物图_/_正视图_ 单姿时,
 * 返回该单姿 url;其余情形(场景/主图已单姿/图库无单姿)返回 undefined=走主图。
 * 单姿标记取资产图命名规则(_人物图_/_正视图_,与 classifyAssetImage 命名表
 * 同源口径);卡标记=_多视图_/_三视图_/_设定卡_。
 */
function pickSingleViewAssetImage(
  asset: {
    previewUrl?: string;
    images?: Array<{ name?: string; url?: string }>;
  } | null | undefined,
  assetType: "scene" | "character" | "prop",
): string | undefined {
  if (!asset || (assetType !== "character" && assetType !== "prop")) return undefined;
  const poseMarker = /_(?:人物图|正视图)_/;
  const mainBasename = (() => {
    try { return decodeURIComponent((asset.previewUrl ?? "").split("/").pop() ?? ""); }
    catch { return (asset.previewUrl ?? "").split("/").pop() ?? ""; }
  })();
  const mainIsPose = poseMarker.test(mainBasename);
  if (mainIsPose) return undefined;
  const galleryPose = (asset.images ?? []).find((image) =>
    image?.url && !/^(?:data|blob):/i.test(image.url)
    && (poseMarker.test(image.name ?? "") || poseMarker.test(image.url)));
  // 主图是明确卡标记(_多视图_/_三视图_/_设定卡_)或无标记存量图(画幅未知)→
  // 图库单姿恒优(单姿命名是显式证据,存量名零证据);统一切换,无第三档。
  return galleryPose?.url;
}
