// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Circle,
  File as FileIcon,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactStage } from "@/types/artifacts";

export interface ArtifactFileTreeNode {
  path: string;
  name: string;
  type: "directory" | "file";
  children?: ArtifactFileTreeNode[];
  artifactIds?: string[];
  bytes?: number;
}

export interface ArtifactStageTreeNode {
  id: ArtifactStage;
  label: string;
  count: number;
}

export interface ArtifactChapterTreeNode {
  id: string;
  label: string;
  count: number;
  stages: ArtifactStageTreeNode[];
}

export interface ArtifactTreeProject {
  id: string;
  name: string;
  fileTree: ArtifactFileTreeNode[];
  chapters: ArtifactChapterTreeNode[];
}

export interface ArtifactTreeProps {
  projects: ArtifactTreeProject[];
  activeProjectId?: string | null;
  selectedChapterId?: string | null;
  selectedStageId?: ArtifactStage | null;
  selectedDirectoryPath?: string;
  fileNavigationActive?: boolean;
  expandedNodes?: Set<string>;
  onExpandToggle?: (nodeId: string) => void;
  onProjectClick?: (projectId: string) => void;
  onChapterClick?: (chapterId: string) => void;
  onStageClick?: (stageId: ArtifactStage, chapterId: string) => void;
  onDirectoryClick?: (path: string) => void;
  onFileClick?: (path: string) => void;
  className?: string;
}

const stageIcons: Partial<Record<ArtifactStage, LucideIcon>> = {
  novel: BookOpen,
  script: FileIcon,
  storyboard: FolderOpen,
  backup: FolderOpen,
};

function TreeRow({
  level,
  nodeId,
  label,
  icon,
  badge,
  hasChildren,
  expanded,
  selected,
  active,
  onClick,
  onToggle,
}: {
  level: number;
  nodeId: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  active: boolean;
  onClick: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 py-1.5 pr-2 hover:bg-muted/50 transition-colors cursor-pointer select-none",
        selected && "bg-primary/15 text-primary font-medium",
        active && !selected && "bg-accent/40",
      )}
      style={{ paddingLeft: `${level * 14 + 8}px` }}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={0}
      data-node-id={nodeId}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          className="p-0.5 hover:bg-muted rounded-md shrink-0"
          aria-label={expanded ? "折叠" : "展开"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="flex-1 text-sm truncate" title={label}>{label}</span>
      {active && <Circle className="h-2 w-2 fill-primary text-primary shrink-0" aria-label="当前项目" />}
      {badge !== undefined && badge > 0 && (
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{badge}</span>
      )}
    </div>
  );
}

export function ArtifactTree({
  projects,
  activeProjectId,
  selectedChapterId = null,
  selectedStageId = null,
  selectedDirectoryPath = "",
  fileNavigationActive = false,
  expandedNodes = new Set(),
  onExpandToggle,
  onProjectClick,
  onChapterClick,
  onStageClick,
  onDirectoryClick,
  onFileClick,
  className,
}: ArtifactTreeProps) {
  const isExpanded = (nodeId: string) => expandedNodes.has(nodeId);
  const toggle = (nodeId: string) => onExpandToggle?.(nodeId);

  const renderFileNodes = (projectId: string, nodes: ArtifactFileTreeNode[], level: number): React.ReactNode[] => (
    nodes.map((node) => {
      const nodeId = `file:${projectId}:${node.path}`;
      const expanded = isExpanded(nodeId);
      const isDirectory = node.type === "directory";
      return (
        <div key={nodeId}>
          <TreeRow
            level={level}
            nodeId={nodeId}
            label={node.name}
            icon={isDirectory ? (expanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />) : <FileIcon className="h-4 w-4" />}
            badge={node.artifactIds?.length}
            hasChildren={isDirectory && Boolean(node.children?.length)}
            expanded={expanded}
            selected={isDirectory && node.path === selectedDirectoryPath}
            active={false}
            onClick={() => (isDirectory ? onDirectoryClick?.(node.path) : onFileClick?.(node.path))}
            onToggle={() => toggle(nodeId)}
          />
          {isDirectory && expanded && renderFileNodes(projectId, node.children ?? [], level + 1)}
        </div>
      );
    })
  );

  const renderProjectBranch = (project: ArtifactTreeProject, levelOffset: number) => {
    const filesNodeId = `files:${project.id}`;
    const filesExpanded = isExpanded(filesNodeId);
    return (
      <>
        <TreeRow
          level={0 + levelOffset}
          nodeId={filesNodeId}
          label="本地文件"
          icon={filesExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
          badge={project.fileTree.length}
          hasChildren={project.fileTree.length > 0}
          expanded={filesExpanded}
          selected={fileNavigationActive && selectedDirectoryPath === ""}
          active={false}
          onClick={() => onDirectoryClick?.("")}
          onToggle={() => toggle(filesNodeId)}
        />
        {filesExpanded && renderFileNodes(project.id, project.fileTree, 1 + levelOffset)}
        {project.chapters.map((chapter) => {
          const chapterNodeId = `chapter:${project.id}:${chapter.id}`;
          const chapterExpanded = isExpanded(chapterNodeId);
          return (
            <div key={chapterNodeId}>
              <TreeRow
                level={0 + levelOffset}
                nodeId={chapterNodeId}
                label={chapter.label}
                icon={<BookOpen className="h-4 w-4" />}
                badge={chapter.count}
                hasChildren={chapter.stages.length > 0}
                expanded={chapterExpanded}
                selected={!fileNavigationActive && selectedChapterId === chapter.id && !selectedStageId}
                active={false}
                onClick={() => onChapterClick?.(chapter.id)}
                onToggle={() => toggle(chapterNodeId)}
              />
              {chapterExpanded && chapter.stages.map((stage) => {
                const stageNodeId = `stage:${project.id}:${chapter.id}:${stage.id}`;
                const Icon = stageIcons[stage.id] ?? FileIcon;
                return (
                  <TreeRow
                    key={stageNodeId}
                    level={1 + levelOffset}
                    nodeId={stageNodeId}
                    label={stage.label}
                    icon={<Icon className="h-4 w-4" />}
                    badge={stage.count}
                    hasChildren={false}
                    expanded={false}
                    selected={!fileNavigationActive && selectedChapterId === chapter.id && selectedStageId === stage.id}
                    active={false}
                    onClick={() => onStageClick?.(stage.id, chapter.id)}
                    onToggle={() => undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className={cn("h-full overflow-y-auto scrollbar-thin py-1 pb-3", className)} role="tree" aria-label="项目产物文件树">
      {projects.length === 0 ? (
        <div className="h-full flex items-center justify-center px-3 text-center text-xs text-muted-foreground py-8">
          当前项目没有产物
        </div>
      ) : projects.length === 1 ? (
        renderProjectBranch(projects[0], 0)
      ) : (
        projects.map((project) => {
          const projectNodeId = `project:${project.id}`;
          const projectExpanded = isExpanded(projectNodeId);
          return (
            <div key={project.id}>
              <TreeRow
                level={0}
                nodeId={projectNodeId}
                label={project.name}
                icon={<Folder className="h-4 w-4" />}
                hasChildren
                expanded={projectExpanded}
                selected={!fileNavigationActive && !selectedChapterId && !selectedDirectoryPath && !selectedStageId}
                active={project.id === activeProjectId}
                onClick={() => onProjectClick?.(project.id)}
                onToggle={() => toggle(projectNodeId)}
              />
              {projectExpanded && renderProjectBranch(project, 1)}
            </div>
          );
        })
      )}
    </div>
  );
}

export default ArtifactTree;
