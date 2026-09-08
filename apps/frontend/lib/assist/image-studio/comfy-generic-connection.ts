// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * comfy-generic ↔ comfy-generic 连线口型匹配(09-09 照 ComfyUI):
 * 双端都是效果节点时,输出槽类型必须与输入口类型一致(IMAGE→IMAGE/LATENT→LATENT,
 * 大小写不敏感);类型词表与端口配色(comfy-port-colors)同源约定。
 * 非双 generic 端点恒放行——业务域规则由 isValidImageConnection 单源裁决。
 * 口信息缺失(存量边/动态口未回填)放行,严格校验留给子图编译器大白话报错。
 */

import type { ImageWorkflowGraph } from "@/types/studio";

interface PortLike {
  id: string;
  type: string;
  side?: string;
}

export function comfyGenericPortTypesCompatible(
  graph: ImageWorkflowGraph,
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
): boolean {
  if (!connection.source || !connection.target) return true;
  const src = graph.nodes.find((node) => node.id === connection.source);
  const tgt = graph.nodes.find((node) => node.id === connection.target);
  if (src?.type !== "comfy-generic" || tgt?.type !== "comfy-generic") return true;
  const descriptor = (node: typeof src) =>
    ((node as { descriptor?: { ports?: PortLike[] } }).descriptor?.ports ?? []) as PortLike[];
  const outputs = descriptor(src).filter((port) => port.side === "output");
  const outPort =
    connection.sourceHandle != null ? outputs[Number(connection.sourceHandle)] : undefined;
  const inputs = descriptor(tgt).filter((port) => port.side === "input");
  const inPort =
    inputs.find((port) => port.id === connection.targetHandle) ?? inputs[0];
  if (!outPort || !inPort) return true;
  return outPort.type.trim().toUpperCase() === inPort.type.trim().toUpperCase();
}
