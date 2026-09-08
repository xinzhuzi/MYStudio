// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 声明式节点定义聚合(09-08 canvas-node-framework)。P1 试点:nsfw/sticky
 * 已声明化;P2/P3 迁移清单:reference/prompt/uncloth/generated(见
 * .trellis/tasks/09-08-canvas-node-framework/prd.md)。
 */
export { CanvasNodeShell, defineReactNode } from "./node-shell";
export type { CanvasNodeDefinition, CanvasNodeHandleDef } from "./node-registry";
export { nsfwNodeDefinition } from "./nodes/nsfw";
export { stickyNodeDefinition } from "./nodes/sticky";
export { referenceNodeDefinition } from "./nodes/reference";
export { promptNodeDefinition } from "./nodes/prompt";
export { unclothNodeDefinition } from "./nodes/uncloth";
export { generatedNodeDefinition } from "./nodes/generated";
export { groupNodeDefinition } from "./nodes/group";
export { comfyWorkflowNodeDefinition } from "./nodes/comfy-workflow";
export { comfyGenericNodeDefinition } from "./nodes/comfy-generic";
export { RerouteCard, RerouteFlowNode } from "./reroute-card";
// 09-09 编辑器单源上提:两画布卡经此消费,panels→features 单向合规
export { ReferenceNodeEditor } from "./nodes/reference";
export { PromptNodeEditor } from "./nodes/prompt";
export {
  GeneratedNodeEditor,
  GeneratedImageFrame,
  BatchImageArea,
  useGeneratedNodeMeta,
} from "./nodes/generated";
export { useCanvasDraftValue } from "./draft-input";
export { MentionPicker } from "./mention-picker";

import { nsfwNodeDefinition } from "./nodes/nsfw";
import { stickyNodeDefinition } from "./nodes/sticky";
import { referenceNodeDefinition } from "./nodes/reference";
import { promptNodeDefinition } from "./nodes/prompt";
import { unclothNodeDefinition } from "./nodes/uncloth";
import { generatedNodeDefinition } from "./nodes/generated";
import { groupNodeDefinition } from "./nodes/group";
import { comfyWorkflowNodeDefinition } from "./nodes/comfy-workflow";
import { comfyGenericNodeDefinition } from "./nodes/comfy-generic";
import type { CanvasNodeDefinition } from "./node-registry";

export const CANVAS_NODE_DEFINITIONS: Readonly<Record<string, CanvasNodeDefinition>> = {
  [nsfwNodeDefinition.typeId]: nsfwNodeDefinition,
  [stickyNodeDefinition.typeId]: stickyNodeDefinition,
  [referenceNodeDefinition.typeId]: referenceNodeDefinition,
  [promptNodeDefinition.typeId]: promptNodeDefinition,
  [unclothNodeDefinition.typeId]: unclothNodeDefinition,
  [generatedNodeDefinition.typeId]: generatedNodeDefinition,
  [groupNodeDefinition.typeId]: groupNodeDefinition,
  [comfyWorkflowNodeDefinition.typeId]: comfyWorkflowNodeDefinition,
  [comfyGenericNodeDefinition.typeId]: comfyGenericNodeDefinition,
};
