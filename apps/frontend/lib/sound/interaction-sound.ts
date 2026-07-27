// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { initSound, playSound, type SoundEffect } from "./sound";

export type InteractionSoundIntent = "primary" | "soft" | "confirm" | "cancel";

export interface InteractionSoundTarget {
  tagName: string;
  role?: string | null;
  type?: string | null;
  disabled?: boolean;
  ariaDisabled?: string | null;
  ariaLabel?: string | null;
  sound?: string | null;
}

/** 关闭/取消/删除/失败类操作，听感上应当是下沉而不是确认 */
const dismissLabelPattern = /取消|关闭|删除|失败/;

function isDismissLabel(ariaLabel?: string | null): boolean {
  return Boolean(ariaLabel && dismissLabelPattern.test(ariaLabel));
}

const textEntryInputTypes = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

const softRoles = new Set(["checkbox", "menuitem", "option", "radio", "switch", "tab"]);
const primaryRoles = new Set(["button", "link"]);
const interactiveSelector = [
  "[data-interaction-sound]",
  "button",
  "a",
  "summary",
  "select",
  "input",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
].join(",");

let lastPlayAt = 0;

export function resolveInteractionSoundIntent(
  target: InteractionSoundTarget
): InteractionSoundIntent | null {
  const explicitSound = target.sound?.trim().toLowerCase();
  if (explicitSound === "off") return null;
  if (
    explicitSound === "primary" ||
    explicitSound === "soft" ||
    explicitSound === "confirm" ||
    explicitSound === "cancel"
  ) {
    return explicitSound;
  }

  if (target.disabled || target.ariaDisabled === "true") return null;

  const tagName = target.tagName.toUpperCase();
  const role = target.role?.toLowerCase() ?? "";
  const inputType = target.type?.toLowerCase() ?? "";

  const base = resolveBaseIntent(tagName, role, inputType);
  // 关闭/取消/删除类按钮走下沉的 cancel 音，其余保持 base
  if (base === "primary" && isDismissLabel(target.ariaLabel)) return "cancel";
  return base;
}

function resolveBaseIntent(
  tagName: string,
  role: string,
  inputType: string
): InteractionSoundIntent | null {
  if (tagName === "TEXTAREA") return null;
  if (tagName === "INPUT") {
    if (textEntryInputTypes.has(inputType)) return null;
    if (inputType === "checkbox" || inputType === "radio") return "soft";
    if (inputType === "button" || inputType === "reset" || inputType === "submit") {
      return "primary";
    }
    return null;
  }

  if (tagName === "BUTTON" || tagName === "A" || tagName === "SUMMARY") return "primary";
  if (tagName === "SELECT") return "soft";
  if (primaryRoles.has(role)) return "primary";
  if (softRoles.has(role)) return "soft";

  return null;
}

export function getInteractionSoundIntentFromTarget(
  target: EventTarget | null
): InteractionSoundIntent | null {
  if (!(target instanceof Element)) return null;

  const element = target.closest(interactiveSelector);
  if (!element) return null;
  if (element.closest("[data-no-sound]")) return null;

  return resolveInteractionSoundIntent({
    tagName: element.tagName,
    role: element.getAttribute("role"),
    type: element.getAttribute("type"),
    disabled:
      element.hasAttribute("disabled") ||
      Boolean("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled),
    ariaDisabled: element.getAttribute("aria-disabled"),
    ariaLabel: element.getAttribute("aria-label"),
    sound: element.getAttribute("data-interaction-sound") ?? element.getAttribute("data-sound"),
  });
}

/** intent 到合成引擎音色的唯一映射 */
export const INTENT_TO_EFFECT: Record<InteractionSoundIntent, SoundEffect> = {
  primary: "activate",
  soft: "click",
  confirm: "success",
  cancel: "cancel",
};

/**
 * 连播间隔下限：新音色带 160–300ms 的空气尾，间隔太短会让尾音互相叠加、
 * 听起来又回到"吵"。
 */
const MIN_REPLAY_INTERVAL_MS = 70;

export function playInteractionSound(intent: InteractionSoundIntent): void {
  if (typeof window === "undefined") return;

  const now = performance.now();
  if (now - lastPlayAt < MIN_REPLAY_INTERVAL_MS) return;
  lastPlayAt = now;

  // 首次交互时解锁 AudioContext（浏览器自动播放策略）
  initSound();
  playSound(INTENT_TO_EFFECT[intent]);
}
