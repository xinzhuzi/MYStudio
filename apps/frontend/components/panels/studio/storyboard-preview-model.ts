import { parseStoryboardTable } from "@/lib/studio/storyboard-table";
import type { StoryboardShotSemantics } from "@/types/studio";

export interface ProductionFlowTableRow {
  index: number;
  title: string;
  titleEn: string;
  description: string;
  scene: string;
  sceneIndex?: number;
  associateAssetsNames: string[];
  duration: number;
  shotSize: string;
  cameraMove: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  emotion: string;
  lines: string;
  sound: string;
  associateAssetsIds: string[];
  /** 出镜语义(角色位置/朝向/动作、道具状态、转场衔接)——分镜表第 8 列 */
  shotSemantics?: StoryboardShotSemantics;
}

export function parseStoryboardPreviewRows(text: string): ProductionFlowTableRow[] {
  if (!text.trim()) return [];
  const parsed = parseStoryboardTable(text, "preview");
  if (parsed.rows.length) {
    return parsed.rows.map((row) => ({
      index: row.index,
      title: buildStoryboardRowTitle(row.description, row.index),
      titleEn: `shot-${String(row.index).padStart(3, "0")}`,
      description: row.description,
      scene: row.scene,
      sceneIndex: row.sceneIndex,
      associateAssetsNames: row.associateAssetsNames,
      duration: row.duration,
      shotSize: row.shotSize,
      cameraMove: row.cameraMove,
      action: row.action,
      orientation: row.orientation,
      spatialRelation: row.spatialRelation,
      emotion: row.emotion,
      lines: row.lines,
      sound: row.sound,
      associateAssetsIds: row.associateAssetsIds,
      shotSemantics: row.shotSemantics,
    }));
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line, index) => {
      const fields = line.slice(1, -1).split("|").map((item) => item.trim());
      return {
        index: Number.parseInt(fields[0] ?? "", 10) || index + 1,
        title: buildStoryboardRowTitle(fields[1] ?? "", index + 1),
        titleEn: `shot-${String(index + 1).padStart(3, "0")}`,
        description: fields[1] ?? "",
        scene: fields[2] ?? "",
        associateAssetsNames: splitPreviewList(fields[3] ?? ""),
        duration: Number.parseInt(fields[4] ?? "", 10) || 0,
        shotSize: fields[5] ?? "",
        cameraMove: fields[6] ?? "",
        action: fields[7] ?? "",
        orientation: fields[8] ?? "",
        spatialRelation: fields[9] ?? "",
        emotion: fields[10] ?? "",
        lines: fields[11] ?? "",
        sound: fields[12] ?? "",
        associateAssetsIds: splitPreviewList(fields[13] ?? ""),
      };
    });
}

export function buildStoryboardRowTitle(description: string, index: number): string {
  const text = description.trim();
  if (!text) return `分镜 ${index}`;
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

export function splitPreviewList(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[，,、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
