// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo } from "react";
import { ChevronDown, ChevronRight, Folder, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Artifact Tree Component
 *
 * Displays Project → Chapter → Stage hierarchy with counts
 * Uses Radix Collapsible-like pattern for collapsible tree
 *
 * Props are pure - no IPC calls inside component
 */

export interface ChapterNode {
  id: string;
  title: string;
  stageCounts: Record<string, number>;
}

export interface ArtifactTreeProps {
  /** Root projects with their chapters */
  projects: {
    id: string;
    name: string;
    chapters: ChapterNode[];
  }[];

  /** Currently selected chapter ID */
  selectedChapterId?: string | null;

  /** Callback when chapter is clicked */
  onChapterClick?: (chapterId: string) => void;

  /** Optional callback when project is clicked */
  onProjectClick?: (projectId: string) => void;

  /** Expanded state by node ID (project or chapter) */
  expandedNodes?: Set<string>;

  /** Callback when expand/collapse changes */
  onExpandToggle?: (nodeId: string) => void;

  /** Custom className for root element */
  className?: string;
}

type FlatTreeNode = {
  nodeId: string;
  label: string;
  parentId: string | null;
  level: number;
  type: 'project' | 'chapter';
  childrenCount?: number;
  badge?: string;
};

interface TreeNodeProps {
  level: number;
  label: string;
  nodeId: string;
  hasChildren: boolean;
  childrenCount?: number;
  icon: React.ReactNode;
  isSelected?: boolean;
  isExpanded?: boolean;
  onClick?: () => void;
  onExpandToggle?: () => void;
  badge?: string;
}

function TreeNode({
  level,
  label,
  nodeId,
  hasChildren,
  childrenCount,
  icon,
  isSelected,
  isExpanded,
  onClick,
  onExpandToggle,
  badge,
}: TreeNodeProps) {
  const paddingLeft = `${level * 12 + 8}px`;

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1 py-1.5 px-2 hover:bg-muted/50 transition-colors cursor-pointer",
          isSelected && "bg-primary/10 text-primary font-medium",
          !isSelected && "text-foreground",
        )}
        style={{ paddingLeft }}
        onClick={onClick}
      >
        {/* Expand/Collapse toggle */}
        {hasChildren ? (
          <button
            className="p-0.5 hover:bg-muted rounded"
            onClick={(e) => {
              e.stopPropagation();
              onExpandToggle?.();
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}

        {/* Icon */}
        <div className="text-muted-foreground">{icon}</div>

        {/* Label */}
        <span className="flex-1 text-sm truncate">{label}</span>

        {/* Badge */}
        {badge && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {childrenCount}
        </div>
      )}
    </div>
  );
}

export function ArtifactTree({
  projects,
  selectedChapterId,
  onChapterClick,
  onProjectClick,
  expandedNodes = new Set(),
  onExpandToggle,
  className,
}: ArtifactTreeProps) {
  // Memoize flat list for efficient rendering
  const flatNodes = useMemo(() => {
    const nodes: FlatTreeNode[] = [];

    for (const project of projects) {
      const projNode: FlatTreeNode = {
        nodeId: `proj-${project.id}`,
        label: project.name,
        parentId: null,
        level: 0,
        type: 'project' as const,
        childrenCount: project.chapters.length,
      };

      nodes.push(projNode);

      for (const chapter of project.chapters) {
        const totalArtifacts = Object.values(chapter.stageCounts).reduce((a, b) => a + b, 0);
        const chapNode: FlatTreeNode = {
          nodeId: `chap-${chapter.id}`,
          label: chapter.title,
          parentId: `proj-${project.id}`,
          level: 1,
          type: 'chapter' as const,
          badge: totalArtifacts > 0 ? totalArtifacts.toString() : '',
        };

        nodes.push(chapNode);
      }
    }

    return nodes;
  }, [projects]);

  const handleNodeClick = (nodeId: string, type: 'project' | 'chapter') => {
    if (type === 'chapter') {
      onChapterClick?.(nodeId.replace('chap-', ''));
    } else {
      onProjectClick?.(nodeId.replace('proj-', ''));
    }
  };

  const isExpanded = (nodeId: string) => expandedNodes.has(nodeId);

  const toggleExpand = (nodeId: string) => {
    onExpandToggle?.(nodeId);
  };

  return (
    <div className={cn("h-full overflow-y-auto scrollbar-thin", className)}>
      {flatNodes.map((node) => (
        <TreeNode
          key={node.nodeId}
          level={node.level}
          label={node.label}
          nodeId={node.nodeId}
          hasChildren={node.childrenCount !== undefined && node.childrenCount > 0}
          childrenCount={node.childrenCount}
          icon={node.type === 'project' ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          isSelected={
            node.type === 'chapter'
              ? selectedChapterId === node.nodeId.replace('chap-', '')
              : false
          }
          isExpanded={isExpanded(node.nodeId)}
          onClick={() => handleNodeClick(node.nodeId, node.type)}
          onExpandToggle={() => toggleExpand(node.nodeId)}
          badge={node.badge}
        />
      ))}
    </div>
  );
}

export default ArtifactTree;
