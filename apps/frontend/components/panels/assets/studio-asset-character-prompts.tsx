"use client";

import { useState } from "react";
import {
  findCharacterPromptRealm,
  type CharacterPromptCatalog,
  type CharacterPromptEntry,
} from "@/lib/studio/asset-character-json";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * 人物提示词面板(10-26 用户令:「这些应由 JSON 数据化控制,找位置放置并标注
 * 文生图/图生图」)。真源角色的人物提示词以目录化卡片呈现,随「阶段」选择联动;
 * 编辑入口统一收敛到「角色真源JSON」弹窗(存桌面技能存储,保存后弹窗即刷新)。
 * 10-26 三次令收敛:路由标注整组不展示(徽章像按钮→灰字仍碍眼→全删);
 * 路由数据仍住目录(lib 层),仅不渲染。
 */

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
}: {
  catalog: CharacterPromptCatalog;
  /** 当前「阶段」选择(null=「无」→ 只显基底组)。 */
  stage: string | null | undefined;
}) {
  const realm = findCharacterPromptRealm(catalog, stage);
  return (
    <div className="space-y-2" aria-label="人物提示词(真源JSON)">
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
      ) : null}
    </div>
  );
}
