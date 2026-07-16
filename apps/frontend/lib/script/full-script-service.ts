// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Full Script Service compatibility facade.
 *
 * Existing callers keep this import path while each workflow stage lives in
 * its own service module.
 */

export { extractEpisodeSummary, isMissingTitle } from "./episode-calibration-utils";
export {
  exportProjectMetadata,
  generateEpisodeSynopses,
  getMissingSynopsisEpisodes,
} from "./episode-synopsis-service";
export type { SynopsisGenerationResult } from "./episode-synopsis-service";
export { calibrateEpisodeTitles, getMissingTitleEpisodes } from "./episode-title-calibration-service";
export type { CalibrationOptions, CalibrationResult } from "./episode-title-calibration-service";
export { importFullScript } from "./full-script-import-service";
export type { ImportResult } from "./full-script-import-service";
export { importSingleEpisodeContent } from "./single-episode-import-service";
export type { SingleEpisodeImportResult } from "./single-episode-import-service";
export type { ShotCalibrationOptions } from "./shot-calibration-prompt-service";
export { calibrateEpisodeShots, calibrateSingleShot } from "./shot-calibration-service";
export type { ShotCalibrationResult } from "./shot-calibration-service";
export {
  generateEpisodeShots,
  getEpisodeGenerationSummary,
  regenerateAllEpisodeShots,
} from "./episode-generation-service";
export type {
  GenerateEpisodeShotsResult,
  GenerateShotsOptions,
} from "./episode-generation-service";
