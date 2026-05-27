// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { PropsWithChildren, useEffect } from "react";
import {
  getInteractionSoundIntentFromTarget,
  playInteractionSound,
} from "@/lib/interaction-sound";

export function InteractionEffects({ children }: PropsWithChildren) {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const intent = getInteractionSoundIntentFromTarget(event.target);
      if (intent) playInteractionSound(intent);
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return <div className="studio-experience-root">{children}</div>;
}
