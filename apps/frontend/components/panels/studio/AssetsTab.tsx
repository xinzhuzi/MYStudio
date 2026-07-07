import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import { AssetsBatchCard, type AssetType } from "./AssetsBatchCard";
import { assetRecordMatches, nameMatches } from "./asset-matching";

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
  setHeaderActions: (actions: ReactNode) => void;
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

  // 资产中心缓存（异步加载，一次全取）
  const [assetCenterNames, setAssetCenterNames] = useState<
    Record<string, { name: string; desc: string }[]>
  >({ role: [], scene: [], tool: [] });
  useEffect(() => {
    if (mode !== "manage") return;
    if (
      typeof window === "undefined" ||
      !(window as unknown as Record<string, unknown>).studioAssets
    )
      return;
    const sa = (window as unknown as Record<string, unknown>).studioAssets as {
      list: (
        p: Record<string, unknown>,
      ) => Promise<{ items: Record<string, unknown>[] }>;
    };
    for (const t of ["role", "scene", "tool"]) {
      sa.list({ type: t, limit: 99999 })
        .then((res) => {
          setAssetCenterNames((prev) => ({
            ...prev,
            [t]: (res.items || []).map((it) => ({
              name: String(it.name ?? ""),
              desc: String(it.description ?? ""),
            })),
          }));
        })
        .catch(() => {});
    }
  }, [mode]);

  /** 资产匹配状态：不存在(爆红) / 已有但无图(黄) / 已制作(绿)
   *  匹配策略：先查本地轻量库，再查资产中心（assets.db），按名字+别名+描述+泛称NPC兜底 */
  const getAssetStatus = (
    type: AssetType,
    name: string,
    note?: string,
  ): "missing" | "exists" | "made" => {
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
      const hasImg = libChars.some(
        (c) =>
          nameMatches(name, c.name) &&
          (!!c.thumbnailUrl || (c.views?.length ?? 0) > 0),
      );
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
      const hasImg = libScenes.some(
        (s) =>
          nameMatches(name, s.name) &&
          (!!s.referenceImage || !!s.referenceImageBase64),
      );
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
    const hasImg = libProps.some(
      (p) =>
        nameMatches(name, p.name) &&
        !!(p as unknown as Record<string, unknown>).imageUrl,
    );
    return hasImg ? "made" : "exists";
  };

  const scriptChapters = useMemo(
    () =>
      props.novelChapters.filter((ch) =>
        props.agentWorkData.some(
          (w) => w.key === "scriptDraft" && w.episodeId === ch.id,
        ),
      ),
    [props.novelChapters, props.agentWorkData],
  );

  const run = async (id: string) => {
    setExtractingId(id);
    try {
      await props.extractAssets(id);
    } finally {
      setExtractingId(null);
    }
  };

  const setHeaderActions = props.setHeaderActions;
  const extractAssets = props.extractAssets;
  useEffect(() => {
    setHeaderActions(
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {mode === "manage"
            ? "管理本章剧本资产（角色 / 场景 / 道具）与资产库制作状态；"
            : "从剧本提取资产（角色 / 场景 / 道具），与资产库匹配；"}
          <span className="text-destructive">红色=未制作</span>
          {mode === "manage" ? "。" : "，然后在本阶段下方手动生成。"}
        </span>
        <Button
          size="sm"
          disabled={extractingId !== null || scriptChapters.length === 0}
          onClick={async () => {
            for (const ch of scriptChapters) {
              setExtractingId(ch.id);
              try {
                await extractAssets(ch.id);
              } finally {
                setExtractingId(null);
              }
            }
          }}
        >
          <Boxes className="h-4 w-4" />
          {extractingId !== null ? "提取中…" : "批量提取全部"}
        </Button>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, extractAssets, scriptChapters, extractingId, mode]);

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

  if (!scriptChapters.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        还没有剧本：请先在「剧本生产阶段」生成各章剧本，再来管理资产（角色/场景/道具）。
      </div>
    );
  }

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
      {scriptChapters.map((ch) => {
        const batch = props.entityExtractions.find(
          (b) => b.episodeId === ch.id,
        );
        const script = [...props.agentWorkData]
          .reverse()
          .find((w) => w.key === "scriptDraft" && w.episodeId === ch.id)?.data;
        const open = !collapsed.has(ch.id);
        return (
          <AssetsBatchCard
            key={ch.id}
            mode={mode}
            chapter={ch}
            batch={batch}
            script={script}
            open={open}
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
        );
      })}
    </div>
  );
}
