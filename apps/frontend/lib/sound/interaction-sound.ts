// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

export type InteractionSoundIntent = "primary" | "soft" | "confirm";

export interface InteractionSoundTarget {
  tagName: string;
  role?: string | null;
  type?: string | null;
  disabled?: boolean;
  ariaDisabled?: string | null;
  sound?: string | null;
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

let audioContext: AudioContext | null = null;
let lastPlayAt = 0;

export function resolveInteractionSoundIntent(
  target: InteractionSoundTarget
): InteractionSoundIntent | null {
  const explicitSound = target.sound?.trim().toLowerCase();
  if (explicitSound === "off") return null;
  if (explicitSound === "primary" || explicitSound === "soft" || explicitSound === "confirm") {
    return explicitSound;
  }

  if (target.disabled || target.ariaDisabled === "true") return null;

  const tagName = target.tagName.toUpperCase();
  const role = target.role?.toLowerCase() ?? "";
  const inputType = target.type?.toLowerCase() ?? "";

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

  return resolveInteractionSoundIntent({
    tagName: element.tagName,
    role: element.getAttribute("role"),
    type: element.getAttribute("type"),
    disabled:
      element.hasAttribute("disabled") ||
      Boolean("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled),
    ariaDisabled: element.getAttribute("aria-disabled"),
    sound: element.getAttribute("data-interaction-sound"),
  });
}

export function playInteractionSound(intent: InteractionSoundIntent): void {
  if (typeof window === "undefined") return;

  const now = performance.now();
  if (now - lastPlayAt < 45) return;
  lastPlayAt = now;

  const AudioContextCtor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  audioContext ??= new AudioContextCtor();
  const context = audioContext;
  void context.resume();

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const currentTime = context.currentTime;
  const tone =
    intent === "confirm"
      ? { frequency: 820, gain: 0.045, duration: 0.07 }
      : intent === "soft"
        ? { frequency: 470, gain: 0.022, duration: 0.032 }
        : { frequency: 650, gain: 0.034, duration: 0.04 };

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(tone.frequency, currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(tone.frequency * 0.72, currentTime + tone.duration);

  gain.gain.setValueAtTime(0.0001, currentTime);
  gain.gain.exponentialRampToValueAtTime(tone.gain, currentTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + tone.duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(currentTime);
  oscillator.stop(currentTime + tone.duration + 0.01);
}
