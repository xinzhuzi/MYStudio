"use client";

import { useState } from "react";
import {
  findCharacterPromptRealm,
  type CharacterPromptCatalog,
  type CharacterPromptEntry,
} from "@/lib/studio/asset-character-json";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FileJson2, ImageIcon, Sparkles } from "lucide-react";

/**
 * 人物提示词面板(10-26 用户令:「这些应由 JSON 数据化控制,找位置放置并标注
 * 文生图/图生图」)。真源角色的人物提示词以目录化卡片呈现,逐条带路由徽标
 * (文生图/图生图+细注),随「阶段」选择联动显示该境指令;基底两组恒显。
 * 编辑入口统一收敛到「角色真源JSON」弹窗(存桌面技能存储,保存后弹窗即刷新)。
 */

// 徽标配色走语义 token(design-lint R2 禁调色板硬编码):文生图=primary 主色系,
// 图生图=中性系;路由语义由图标+文案承载,配色只做主/次区分
const ROUTE_STYLES: Record<CharacterPromptEntry["route"], { label: string; icon: typeof Sparkles; className: string }> = {
  t2i: {
    label: "文生图",
    icon: Sparkles,
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  i2i: {
    label: "图生图",
    icon: ImageIcon,
    className: "border-border bg-muted text-foreground/85",
  },
};

function RouteBadge({ entry }: { entry: CharacterPromptEntry }) {
  const style = ROUTE_STYLES[entry.route];
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${style.className}`}
      title={`${style.label}:${entry.routeNote}`}
    >
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

function PromptCard({ entry }: { entry: CharacterPromptEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className="w-full rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-left transition-colors hover:border-primary/40"
      onClick={() => setExpanded((value) => !value)}
      title={expanded ? "点击收起" : "点击展开全文"}
      aria-expanded={expanded}
    >
      <div className="flex items-center gap-1.5">
        <RouteBadge entry={entry} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{entry.title}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </div>
      <p
        className={cn(
          "mt-1 whitespace-pre-wrap break-all text-[11px] leading-4 text-muted-foreground",
          expanded ? "" : "line-clamp-2",
        )}
      >
        {entry.text}
      </p>
      {!expanded ? <span className="sr-only">(已截断,点击展开)</span> : null}
    </button>
  );
}

export function StudioAssetCharacterPrompts({
  catalog,
  stage,
  stageSelectorAvailable = true,
  onOpenJson,
}: {
  catalog: CharacterPromptCatalog;
  /** 当前「阶段」选择(null=「无」→ 只显基底组+引导)。 */
  stage: string | null | undefined;
  /** 阶段选择器是否在场(<2 聚类阶段时弹窗不渲染选择器;引导文案随之切换)。 */
  stageSelectorAvailable?: boolean;
  onOpenJson: () => void;
}) {
  const realm = findCharacterPromptRealm(catalog, stage);
  return (
    <div className="space-y-2" aria-label="人物提示词(真源JSON)">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={onOpenJson}
          title="打开角色真源 JSON 编辑弹窗(保存到桌面技能存储,保存后本面板即时刷新)"
        >
          <FileJson2 className="h-3 w-3 shrink-0" />
          <span className="truncate">人物提示词由真源 JSON 数据化驱动,点此编辑</span>
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-muted-foreground/80">基底(恒显)</div>
        <div className="grid gap-1.5">
          {catalog.faceBase ? <PromptCard entry={catalog.faceBase} /> : null}
          {catalog.bodyBase ? <PromptCard entry={catalog.bodyBase} /> : null}
        </div>
      </div>

      {realm ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground/80">{realm.stage}(随「阶段」选择联动)</div>
          <div className="grid gap-1.5">
            {realm.entries.map((entry) => (
              <PromptCard key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {stageSelectorAvailable
            ? "选择上方「阶段」可查看该境的正视图/海报/三视图等指令(每境五条,均标注路由)。"
            : "该角色暂无带阶段标记的图片,阶段选择器未显示;各境指令可在「角色真源JSON」中查看。"}
        </div>
      )}
    </div>
  );
}
