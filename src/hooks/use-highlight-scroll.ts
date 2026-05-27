// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useState, useRef } from "react";

export function useHighlightScroll(
  highlightId: string | null,
  onClearHighlight: () => void,
  highlightDuration = 1000
) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerElement = (id: string, element: HTMLElement | null) => {
    if (element) {
      elementRefs.current.set(id, element);
    } else {
      elementRefs.current.delete(id);
    }
  };

  useEffect(() => {
    if (!highlightId) return;

    setHighlightedId(highlightId);

    const target = elementRefs.current.get(highlightId);
    target?.scrollIntoView({ block: "center" });

    const timeout = setTimeout(() => {
      setHighlightedId(null);
      onClearHighlight();
    }, highlightDuration);

    return () => clearTimeout(timeout);
  }, [highlightId, onClearHighlight, highlightDuration]);

  return { highlightedId, registerElement };
}
