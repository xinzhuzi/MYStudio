import { describe, expect, it } from "vitest";

import * as facade from "./full-script-service";
import * as generation from "./episode-generation-service";
import * as synopsis from "./episode-synopsis-service";
import * as titles from "./episode-title-calibration-service";
import * as importer from "./full-script-import-service";
import * as singleImporter from "./single-episode-import-service";
import * as shots from "./shot-calibration-service";

describe("full-script-service compatibility facade", () => {
  it("preserves the workflow-stage exports and function identity", () => {
    expect(facade.generateEpisodeShots).toBe(generation.generateEpisodeShots);
    expect(facade.regenerateAllEpisodeShots).toBe(generation.regenerateAllEpisodeShots);
    expect(facade.getEpisodeGenerationSummary).toBe(generation.getEpisodeGenerationSummary);
    expect(facade.generateEpisodeSynopses).toBe(synopsis.generateEpisodeSynopses);
    expect(facade.exportProjectMetadata).toBe(synopsis.exportProjectMetadata);
    expect(facade.calibrateEpisodeTitles).toBe(titles.calibrateEpisodeTitles);
    expect(facade.importFullScript).toBe(importer.importFullScript);
    expect(facade.importSingleEpisodeContent).toBe(singleImporter.importSingleEpisodeContent);
    expect(facade.calibrateEpisodeShots).toBe(shots.calibrateEpisodeShots);
    expect(facade.calibrateSingleShot).toBe(shots.calibrateSingleShot);
  });

  it("keeps the calibration helper exports available to existing callers", () => {
    expect(facade.extractEpisodeSummary).toBeTypeOf("function");
    expect(facade.isMissingTitle).toBeTypeOf("function");
    expect(facade.getMissingTitleEpisodes).toBeTypeOf("function");
    expect(facade.getMissingSynopsisEpisodes).toBeTypeOf("function");
  });
});
