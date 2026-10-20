import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { eventBus } from "@/lib/events/event-bus";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { toast } from "sonner";
import { AssetsBatchCard, type AssetType } from "./AssetsBatchCard";
import { assetRecordMatches, nameMatches } from "./asset-matching";
import { latestAgentWorkEntry } from "./workflow-helpers";

export function AssetsTab(props: {
  mode?: "extract" | "manage";
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  entityExtractions: ReturnType<
    typeof useStudioStore.getState
  >["entityExtractions"];
  extractAssets: (episodeId: string) => Promise<void> | void;
  updateExtraction: (
    batch: ReturnType<
      typeof useStudioStore.getState
    >["entityExtractions"][number],
  ) => void;
}) {
  type Batch = ReturnType<
    typeof useStudioStore.getState
  >["entityExtractions"][number];
  const mode = props.mode ?? "extract";
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    episodeId: string;
    type: AssetType;
  } | null>(null);
  const [addValue, setAddValue] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // 对接资产中心（assets.db）+ 本地轻量库：按名字 + 别名 + 模糊匹配 + 描述相似匹配
  const libChars = useCharacterLibraryStore((s) => s.characters);
  const addCharacter = useCharacterLibraryStore((s) => s.addCharacter);
  const libScenes = useSceneStore((s) => s.scenes);
  const addScene = useSceneStore((s) => s.addScene);
  const libProps = usePropsLibraryStore((s) => s.items);
  const addProp = usePropsLibraryStore((s) => s.addProp);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // 资产中心缓存（带图片状态供「已制作」判定）
  // 契约:渲染提取视图不得初始化独立资产库——manage 模式挂载即取;extract 模式
  // 只在资产库确有变化/重匹配的用户动作事件后首次拉取(300ms 去抖合并连发事件)。
  // 详情弹窗生成只写资产库不回写本地轻量库,不订阅这里的话提取区颜色永远不更新。
  const [assetCenterNames, setAssetCenterNames] = useState<
    Record<string, { name: string; desc: string; hasImage: boolean }[]>
  >({ role: [], scene: [], tool: [] });
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !(window as unknown as Record<string, unknown>).studioAssets
    )
      return;
    const sa = (window as unknown as Record<string, unknown>).studioAssets as {
      list?: (
        p: Record<string, unknown>,
      ) => Promise<{ items: Record<string, unknown>[] }>;
    };
    if (typeof sa.list !== "function") return;
    const load = () => {
      for (const t of ["role", "scene", "tool"]) {
        sa.list!({ type: t, limit: 99999 })
          .then((res) => {
            setAssetCenterNames((prev) => ({
              ...prev,
              [t]: (res.items || []).map((it) => ({
                name: String(it.name ?? ""),
                desc: String(it.description ?? ""),
                hasImage: Boolean(
                  it.filePath ||
                    it.previewUrl ||
                    it.thumbnailUrl ||
                    (Array.isArray(it.images) && it.images.length > 0),
                ),
              })),
            }));
          })
          .catch(() => {});
      }
    };
    if (mode === "manage") load();
    let reloadTimer: number | undefined;
    const scheduleReload = () => {
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(load, 300);
    };
    const offs = [
      eventBus.on("asset:updated", scheduleReload),
      eventBus.on("asset:deleted", scheduleReload),
      eventBus.on("asset:rematch", scheduleReload),
    ];
    return () => {
      window.clearTimeout(reloadTimer);
      offs.forEach((off) => off());
    };
  }, [mode]);

  /** 资产匹配状态：不存在(爆红) / 已有但无图(黄) / 已制作(绿)
   *  匹配策略：先查本地轻量库，再查资产中心（assets.db），按名字+别名+描述+泛称NPC兜底
   *  图片判定：本地轻量库有图，或资产中心同名条目已带主图（详情弹窗生成走 replaceImage
   *  只写资产库不回写本地库，只看本地会把已生成资产永远判成黄） */
  const getAssetStatus = (
    type: AssetType,
    name: string,
    note?: string,
  ): "missing" | "exists" | "made" => {
    const centerHasImage = (entries: { name: string; hasImage: boolean }[]) =>
      entries.some((e) => e.hasImage && nameMatches(name, e.name));
    const findMatch = (
      localItems: { name: string; aliases?: string[]; desc?: string }[],
      centerItems: { name: string; desc: string }[],
      fallbackGeneric?: boolean,
    ) =>
      assetRecordMatches({
        name,
        note,
        localItems,
        centerItems,
        fallbackGeneric,
      });

    if (type === "character") {
      const localItems = libChars.map((c) => ({
        name: c.name,
        aliases:
          ((c as unknown as Record<string, unknown>).aliases as string[]) ?? [],
        desc: [c.description, c.role, c.personality, c.traits]
          .filter(Boolean)
          .join(" "),
      }));
      const found = findMatch(localItems, assetCenterNames.role, true);
      if (!found) return "missing";
      const hasImg =
        libChars.some(
          (c) =>
            nameMatches(name, c.name) &&
            (!!c.thumbnailUrl || (c.views?.length ?? 0) > 0),
        ) || centerHasImage(assetCenterNames.role);
      return hasImg ? "made" : "exists";
    }
    if (type === "scene") {
      const localItems = libScenes.map((s) => ({
        name: s.name,
        desc: [
          (s as unknown as Record<string, unknown>).atmosphere as string,
          (s as unknown as Record<string, unknown>).location as string,
          s.name,
        ]
          .filter(Boolean)
          .join(" "),
      }));
      const found = findMatch(localItems, assetCenterNames.scene);
      if (!found) return "missing";
      const hasImg =
        libScenes.some(
          (s) =>
            nameMatches(name, s.name) &&
            (!!s.referenceImage || !!s.referenceImageBase64),
        ) || centerHasImage(assetCenterNames.scene);
      return hasImg ? "made" : "exists";
    }
    // prop
    const localItems = libProps.map((p) => ({
      name: p.name,
      desc:
        ((p as unknown as Record<string, unknown>).description as string) ?? "",
    }));
    const found = findMatch(localItems, assetCenterNames.tool);
    if (!found) return "missing";
    const hasImg =
      libProps.some(
        (p) =>
          nameMatches(name, p.name) &&
          !!(p as unknown as Record<string, unknown>).imageUrl,
      ) || centerHasImage(assetCenterNames.tool);
    return hasImg ? "made" : "exists";
  };

  // 10-20 用户铁律:提取视图只显示选择器选中章(=激活章)单卡,严禁多章共存/数据
  // 污染——旧「列出所有有草稿的章」多卡列表作废(全书 4125 章有批后会爆炸)。
  // 章身份与生成区同锚(activeChapterId,装载完成后原子翻转;空项目回退第一章)。
  const activeChapterId = useStudioStore((s) => s.activeChapterId);
  const selectedChapter =
    props.novelChapters.find((ch) => ch.id === activeChapterId) ??
    props.novelChapters[0];

  // D22 口径落地:选中章无草稿时读漫剧剧本(novel/drama/chapter-NNN_漫剧.md)作
  // 「剧本内容」与提取使能的真源——4123 个无草稿章可看可提,与全书 runner 同输入。
  // 桥缺席/读取失败优雅回退(脚本面保持 undefined=旧禁用态);seq 防切章竞态串章。
  const [dramaScript, setDramaScript] = useState<string | null>(null);
  const selectedChapterId = selectedChapter?.id;
  // 有草稿章不预读漫剧(D22 回落只在无草稿时才需要;省一次 IPC,且不干扰
  // 源记忆 readText 恰 N 次类锚)
  const selectedHasDraft = Boolean(
    props.agentWorkData.some((w) => w.key === "scriptDraft" && w.episodeId === selectedChapterId),
  );
  useEffect(() => {
    setDramaScript(null);
    if (!selectedChapterId || !activeProjectId || selectedHasDraft) return;
    const bridge = getProjectFilesBridge();
    if (!bridge?.readText) return;
    let seq = true;
    const relativePath = `novel/drama/${selectedChapterId}_漫剧.md`;
    bridge
      .readText({ projectId: activeProjectId, relativePath })
      .then((res) => {
        if (seq && res.success && res.text) setDramaScript(res.text);
      })
      .catch(() => {});
    return () => {
      seq = false;
    };
  }, [selectedChapterId, activeProjectId, selectedHasDraft]);

  const run = async (id: string) => {
    setExtractingId(id);
    try {
      await props.extractAssets(id);
    } finally {
      setExtractingId(null);
    }
  };


  const genId = (p: string) =>
    `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const removeAsset = (batch: Batch, type: AssetType, id: string) => {
    const next: Batch =
      type === "character"
        ? {
            ...batch,
            characters: batch.characters.filter((c) => c.characterId !== id),
          }
        : type === "scene"
          ? { ...batch, scenes: batch.scenes.filter((s) => s.sceneId !== id) }
          : { ...batch, props: batch.props.filter((p) => p.assetId !== id) };
    props.updateExtraction(next);
  };
  const submitAdd = (batch: Batch) => {
    const name = addValue.trim();
    if (!adding || !name) {
      setAdding(null);
      setAddValue("");
      return;
    }
    const next: Batch =
      adding.type === "character"
        ? {
            ...batch,
            characters: [
              ...batch.characters,
              { characterId: genId("char"), name, aliases: [] },
            ],
          }
        : adding.type === "scene"
          ? {
              ...batch,
              scenes: [...batch.scenes, { sceneId: genId("scene"), name }],
            }
          : {
              ...batch,
              props: [...batch.props, { assetId: genId("asset"), name }],
            };
    props.updateExtraction(next);
    setAdding(null);
    setAddValue("");
  };

  const createAssetShell = (
    batch: Batch,
    type: AssetType,
    name: string,
    note?: string,
  ) => {
    const prompt = note?.trim() || name;
    if (type === "character") {
      addCharacter({
        name,
        description: prompt,
        visualTraits: prompt,
        projectId: activeProjectId ?? undefined,
        role: note,
        traits: note,
        notes: note,
        tags: ["剧本资产"],
        status: "linked",
        linkedEpisodeId: batch.episodeId,
        views: [],
      });
      toast.success(`已创建角色资产：${name}`);
      return;
    }
    if (type === "scene") {
      addScene({
        name,
        location: name,
        time: "",
        atmosphere: note || "",
        visualPrompt: prompt,
        projectId: activeProjectId ?? undefined,
        tags: ["剧本资产"],
        notes: note,
        status: "linked",
        linkedEpisodeId: batch.episodeId,
      });
      toast.success(`已创建场景资产：${name}`);
      return;
    }
    addProp({
      name,
      description: prompt,
      visualPrompt: prompt,
      projectId: activeProjectId ?? undefined,
      imageUrl: "",
      folderId: null,
    });
    toast.success(`已创建道具资产：${name}`);
  };

  const createMissingAssets = (batch: Batch) => {
    let created = 0;
    for (const item of batch.characters) {
      if (getAssetStatus("character", item.name, item.note) !== "missing")
        continue;
      createAssetShell(batch, "character", item.name, item.note);
      created += 1;
    }
    for (const item of batch.scenes) {
      if (getAssetStatus("scene", item.name, item.note) !== "missing")
        continue;
      createAssetShell(batch, "scene", item.name, item.note);
      created += 1;
    }
    for (const item of batch.props) {
      if (getAssetStatus("prop", item.name, item.note) !== "missing")
        continue;
      createAssetShell(batch, "prop", item.name, item.note);
      created += 1;
    }
    if (!created) {
      toast.info("本章提取资产都已存在，无需重复创建");
    }
  };

  if (!selectedChapter) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        还没有剧本：请先在「剧本生产阶段」生成各章剧本，再来管理资产（角色/场景/道具）。
      </div>
    );
  }

  // R12(10-14-audit4-residuals):本章剧本取最新草稿走单源 latestAgentWorkEntry
  // (按 updatedAt),数组序不再参与语义;无草稿回落漫剧剧本(D22,与 runner 同输入)。
  const selectedScript =
    latestAgentWorkEntry(props.agentWorkData, "scriptDraft", selectedChapter.id)
      ?.data ?? (dramaScript ?? undefined);

  return (
    <div className="space-y-4">
      {mode === "manage" ? (
        <div className="rounded-lg border border-border/70 bg-panel/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">剧本资产管理</h3>
                <Badge variant="secondary">
                  资产批次 {props.entityExtractions.length}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                基于本阶段提取出的角色、场景、道具创建资产，并推进图片/素材制作。
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {
        // 10-20 单章铁律:只渲染选择器选中章的一张卡(旧多章 map 列表作废);
        // 单卡恒为激活章(选中即装载完成),窗口外文案分支在此视图不可达
      }
      <AssetsBatchCard
        mode={mode}
        chapter={selectedChapter}
        batch={props.entityExtractions.find(
          (b) => b.episodeId === selectedChapter.id,
        )}
        inWindow
        script={selectedScript}
        open={!collapsed.has(selectedChapter.id)}
        extractingId={extractingId}
        adding={adding}
        addValue={addValue}
        onToggle={toggle}
        onRun={run}
        onCreateMissingAssets={createMissingAssets}
        onRemoveAsset={removeAsset}
        onSubmitAdd={submitAdd}
        onStartAdd={(episodeId, type) => {
          setAdding({ episodeId, type });
          setAddValue("");
        }}
        onCancelAdd={() => {
          setAdding(null);
          setAddValue("");
        }}
        onAddValueChange={setAddValue}
        getAssetStatus={getAssetStatus}
      />
    </div>
  );
}
