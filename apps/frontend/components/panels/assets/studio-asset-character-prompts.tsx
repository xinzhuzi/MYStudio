"use client";

import { useState } from "react";
import {
  type CharacterPromptCatalog,
  type CharacterPromptEntry,
} from "@/lib/studio/asset-character-json";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * 人物提示词面板(10-26 用户令)。多轮令收敛史:①数据化卡片+路由标注→路由标注
 * 整组不展示(像按钮);②引导提示删;③「点此编辑」行删;④阶段相关指令整块撤
 * (用户令「应该展示基础相关的提示词,而不是阶段相关的提示词,并且不要重复」
 * ——基底两卡+境界五卡同开时身份描述逐字重复三遍;阶段指令仍住真源 JSON 与
 * 目录层,「角色真源JSON」弹窗可查可改,仅面板不展示)。现只显两张基础卡:
 * 人脸基准(特写)/人物基底·素体(全身),各司其职不重复。
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
}: {
  catalog: CharacterPromptCatalog;
}) {
  return (
    <div className="grid gap-1.5" aria-label="人物提示词(真源JSON)">
      {catalog.faceBase ? <PromptCard entry={catalog.faceBase} /> : null}
      {catalog.bodyBase ? <PromptCard entry={catalog.bodyBase} /> : null}
    </div>
  );
}
