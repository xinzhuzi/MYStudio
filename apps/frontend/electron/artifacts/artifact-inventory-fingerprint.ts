// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import fs from "node:fs";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ArtifactRecord, PhysicalRef } from "@/types/artifacts";

/**
 * Calculate SHA-256 fingerprint of a file
 */
export async function calculateFileFingerprint(filePath: string): Promise<{
  bytes: number;
  hash256: string;
}> {
 
  await fsp.stat(filePath);
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    let bytesRead = 0;

    stream.on("data", (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;
    });

    stream.on("end", () => {
      resolve({
        bytes: bytesRead,
        hash256: hash.digest("hex"),
      });
    });

    stream.on("error", reject);
  });
}

export function physicalRefType(
  fileKind: "json" | "backup" | "media" | "other",
  _decoderFormat?: string,
): PhysicalRef["type"] {
  if (fileKind === "backup") return "backup";
  // Decoder format describes the JSON payload, not its physical provenance.
  // Active project JSON must remain a project-file even when it uses a legacy
  // or mixed-backup decoder; only the scanner's suffix classification can mark
  // a source as backup.
  return "project-file";
}

export function mergeArtifactRecords(existing: ArtifactRecord, incoming: ArtifactRecord): ArtifactRecord {
  const refs = new Map<string, PhysicalRef>();
  for (const ref of [...existing.physicalRefs, ...incoming.physicalRefs]) {
    refs.set(`${ref.type}:${ref.path}`, ref);
  }
  const physicalRefs = [...refs.values()];
  const referencedBytes = physicalRefs.reduce((sum, ref) => sum + (ref.bytes ?? 0), 0);
  return {
    ...existing,
    chapterId: existing.chapterId ?? incoming.chapterId,
    state: existing.state === "blocked" || incoming.state === "blocked"
      ? "blocked"
      : existing.state === "active" || incoming.state === "active"
        ? "active"
        : existing.state,
    bytes: referencedBytes || existing.bytes || incoming.bytes,
    physicalRefs,
  };
}

export function legacyArtifactIdFor(artifact: ArtifactRecord): string {
  const parts = artifact.id.split(":");
  return parts.length >= 3 ? `${parts[0]}:media-file:${parts.slice(2).join(":")}` : artifact.id;
}
