// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ScreenplayInput.tsx (behavior-preserving refactor).
//
// Owns the reference-image state for the screenplay input: the selected File[]
// (capped at 3), the derived object-URL list, the revoke-on-change cleanup, and
// the add/remove handlers. Pure with respect to its inputs (no params); the
// cap of 3 matches the original inline constant.

import { useEffect, useMemo, useState } from "react";

const MAX_REFERENCE_IMAGES = 3;

export function useScreenplayImages() {
  const [images, setImages] = useState<File[]>([]);
  const imageUrls = useMemo(
    () => images.map((img) => URL.createObjectURL(img)),
    [images],
  );
  useEffect(() => {
    return () => {
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageUrls]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newImages = Array.from(files).slice(0, MAX_REFERENCE_IMAGES); // Max 3 images
      setImages((prev) => [...prev, ...newImages].slice(0, MAX_REFERENCE_IMAGES));
    }
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return { images, imageUrls, handleImageChange, removeImage };
}
