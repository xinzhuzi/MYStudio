import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as CanonicalApiManager from "./panels/settings/api";
import * as LegacyApiManager from "./api-manager";
import {
  API_PROVIDER_PRESETS as CanonicalApiProviderPresets,
} from "./panels/settings/api/AddProviderDialog";
import {
  API_PROVIDER_PRESETS as LegacyApiProviderPresets,
} from "./api-manager/AddProviderDialog";
import {
  FEATURE_CONFIGS as CanonicalFeatureConfigs,
  modelSupportsCapability as canonicalModelSupportsCapability,
} from "./panels/settings/api/FeatureBindingPanel";
import {
  FEATURE_CONFIGS as LegacyFeatureConfigs,
  modelSupportsCapability as legacyModelSupportsCapability,
} from "./api-manager/FeatureBindingPanel";
import {
  getBrandIcon as canonicalGetBrandIcon,
  type BrandIconFn as CanonicalBrandIconFn,
} from "./panels/settings/api/brand-icons";
import {
  getBrandIcon as legacyGetBrandIcon,
  type BrandIconFn as LegacyBrandIconFn,
} from "./api-manager/brand-icons";
import {
  EditableTimecode as PlaybackEditableTimecode,
  type EditableTimecodeProps as PlaybackEditableTimecodeProps,
} from "./features/playback/editable-timecode";
import {
  VideoPlayer as PlaybackVideoPlayer,
  type VideoPlayerProps as PlaybackVideoPlayerProps,
} from "./features/playback/video-player";
import {
  DraggableMediaItem as MediaDraggableMediaItem,
  type DraggableMediaItemProps as MediaDraggableMediaItemProps,
} from "./features/media/draggable-item";
import {
  EditableTimecode as LegacyEditableTimecode,
  type EditableTimecodeProps as LegacyEditableTimecodeProps,
} from "./ui/editable-timecode";
import {
  VideoPlayer as LegacyVideoPlayer,
  type VideoPlayerProps as LegacyVideoPlayerProps,
} from "./ui/video-player";
import {
  DraggableMediaItem as LegacyDraggableMediaItem,
  type DraggableMediaItemProps as LegacyDraggableMediaItemProps,
} from "./ui/draggable-item";
import {
  buildVoiceReferenceAssets as canonicalBuildVoiceReferenceAssets,
  type VoiceReferenceAsset as CanonicalVoiceReferenceAsset,
} from "@/lib/tts/voice-reference-assets";
import {
  buildVoiceReferenceAssets as legacyBuildVoiceReferenceAssets,
  type VoiceReferenceAsset as LegacyVoiceReferenceAsset,
} from "./panels/studio/voice-reference-assets";
import * as CanonicalAngleSwitch from "./features/storyboard/angle-switch";
import * as LegacyAngleSwitch from "./angle-switch";
import CanonicalAngleControllerDefault, {
  AngleController as CanonicalAngleController,
  type AngleControllerProps as CanonicalAngleControllerProps,
} from "./features/storyboard/angle-switch/AngleController";
import LegacyAngleControllerDefault, {
  AngleController as LegacyAngleController,
  type AngleControllerProps as LegacyAngleControllerProps,
} from "./angle-switch/AngleController";
import {
  AngleSwitchDialog as CanonicalAngleSwitchDialog,
  type AngleSwitchDialogProps as CanonicalAngleSwitchDialogProps,
} from "./features/storyboard/angle-switch/AngleSwitchDialog";
import {
  AngleSwitchDialog as LegacyAngleSwitchDialog,
  type AngleSwitchDialogProps as LegacyAngleSwitchDialogProps,
} from "./angle-switch/AngleSwitchDialog";
import {
  AngleSwitchResultDialog as CanonicalAngleSwitchResultDialog,
  type AngleSwitchHistoryItem as CanonicalAngleSwitchHistoryItem,
  type AngleSwitchResult as CanonicalAngleSwitchResult,
  type AngleSwitchResultDialogProps as CanonicalAngleSwitchResultDialogProps,
} from "./features/storyboard/angle-switch/AngleSwitchResultDialog";
import {
  AngleSwitchResultDialog as LegacyAngleSwitchResultDialog,
  type AngleSwitchHistoryItem as LegacyAngleSwitchHistoryItem,
  type AngleSwitchResult as LegacyAngleSwitchResult,
  type AngleSwitchResultDialogProps as LegacyAngleSwitchResultDialogProps,
} from "./angle-switch/AngleSwitchResultDialog";
import * as CanonicalQuadGrid from "./features/storyboard/quad-grid";
import * as LegacyQuadGrid from "./quad-grid";
import {
  QuadGridDialog as CanonicalQuadGridDialog,
  type QuadGridDialogProps as CanonicalQuadGridDialogProps,
  type QuadVariationType as CanonicalQuadVariationType,
} from "./features/storyboard/quad-grid/QuadGridDialog";
import {
  QuadGridDialog as LegacyQuadGridDialog,
  type QuadGridDialogProps as LegacyQuadGridDialogProps,
  type QuadVariationType as LegacyQuadVariationType,
} from "./quad-grid/QuadGridDialog";
import {
  QuadGridResultDialog as CanonicalQuadGridResultDialog,
  type QuadGridResult as CanonicalQuadGridResult,
  type QuadGridResultDialogProps as CanonicalQuadGridResultDialogProps,
} from "./features/storyboard/quad-grid/QuadGridResultDialog";
import {
  QuadGridResultDialog as LegacyQuadGridResultDialog,
  type QuadGridResult as LegacyQuadGridResult,
  type QuadGridResultDialogProps as LegacyQuadGridResultDialogProps,
} from "./quad-grid/QuadGridResultDialog";
import {
  WardrobeModal as CanonicalWardrobeModal,
  type WardrobeModalProps as CanonicalWardrobeModalProps,
} from "./panels/characters/wardrobe-modal";
import {
  WardrobeModal as LegacyWardrobeModal,
  type WardrobeModalProps as LegacyWardrobeModalProps,
} from "./WardrobeModal";
import {
  StoryboardConfigToolbar as CanonicalStoryboardConfigToolbar,
} from "./panels/storyboard-config-toolbar";
import {
  StoryboardConfigToolbar as DirectorStoryboardConfigToolbar,
  type StoryboardConfigToolbarProps as DirectorStoryboardConfigToolbarProps,
} from "./panels/director/storyboard-config-toolbar";
import type { StoryboardConfigToolbarProps as CanonicalStoryboardConfigToolbarProps } from "./panels/storyboard-config-toolbar-types";

const componentsRoot = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(componentsRoot, "ui");
const apiManagerRoot = join(componentsRoot, "api-manager");
const angleSwitchRoot = join(componentsRoot, "angle-switch");
const quadGridRoot = join(componentsRoot, "quad-grid");
const storeImportPattern = /from\s+["'][^"']*stores\//;

const compatibilityFacades = new Map([
  [
    "editable-timecode.tsx",
    "@/components/features/playback/editable-timecode",
  ],
  ["video-player.tsx", "@/components/features/playback/video-player"],
  ["draggable-item.tsx", "@/components/features/media/draggable-item"],
]);

const apiManagerCompatibilityFacades = new Map([
  ["index.ts", "@/components/panels/settings/api"],
  ["AddProviderDialog.tsx", "@/components/panels/settings/api/AddProviderDialog"],
  ["ApiKeyEditorDialog.tsx", "@/components/panels/settings/api/ApiKeyEditorDialog"],
  ["EditProviderDialog.tsx", "@/components/panels/settings/api/EditProviderDialog"],
  ["FeatureBindingPanel.tsx", "@/components/panels/settings/api/FeatureBindingPanel"],
  ["brand-icons/index.tsx", "@/components/panels/settings/api/brand-icons"],
  ["brand-icons/brand-icon-types.ts", "@/components/panels/settings/api/brand-icons/brand-icon-types"],
  ["brand-icons/icons-large.tsx", "@/components/panels/settings/api/brand-icons/icons-large"],
  ["brand-icons/icons-medium.tsx", "@/components/panels/settings/api/brand-icons/icons-medium"],
  ["brand-icons/icons-small.tsx", "@/components/panels/settings/api/brand-icons/icons-small"],
]);

const angleSwitchCompatibilityFacades = new Map([
  ["index.ts", { target: "@/components/features/storyboard/angle-switch" }],
  [
    "AngleController.tsx",
    {
      target: "@/components/features/storyboard/angle-switch/AngleController",
      forwardsDefault: true,
    },
  ],
  [
    "AngleSwitchDialog.tsx",
    { target: "@/components/features/storyboard/angle-switch/AngleSwitchDialog" },
  ],
  [
    "AngleSwitchResultDialog.tsx",
    { target: "@/components/features/storyboard/angle-switch/AngleSwitchResultDialog" },
  ],
]);

const quadGridCompatibilityFacades = new Map([
  ["index.ts", { target: "@/components/features/storyboard/quad-grid" }],
  [
    "QuadGridDialog.tsx",
    { target: "@/components/features/storyboard/quad-grid/QuadGridDialog" },
  ],
  [
    "QuadGridResultDialog.tsx",
    { target: "@/components/features/storyboard/quad-grid/QuadGridResultDialog" },
  ],
]);

function readTypeScriptSources(root: string): Array<[string, string]> {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      return readTypeScriptSources(entryPath);
    }

    if (!/\.tsx?$/.test(entry.name)) {
      return [];
    }

    return [[relative(uiRoot, entryPath), readFileSync(entryPath, "utf8")]];
  });
}

function listTypeScriptFiles(root: string, baseRoot = root): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath, baseRoot);
    }

    return /\.tsx?$/.test(entry.name) ? [relative(baseRoot, entryPath)] : [];
  });
}

describe("component ownership", () => {
  it("keeps canonical ui implementations free of store imports", () => {
    const violations = readTypeScriptSources(uiRoot)
      .filter(([fileName]) => !compatibilityFacades.has(fileName))
      .filter(([, source]) => storeImportPattern.test(source))
      .map(([fileName]) => fileName);

    expect(violations).toEqual([]);
  });

  it("keeps old ui entries as thin value and type re-export facades", () => {
    for (const [fileName, target] of compatibilityFacades) {
      const source = readFileSync(join(uiRoot, fileName), "utf8");

      expect(source).toContain(`export type {`);
      expect(source).toContain(`export {`);
      expect(source.split(target)).toHaveLength(3);
      expect(source).not.toMatch(storeImportPattern);
      expect(source).not.toContain("function ");
      expect(source).not.toContain('"use client"');
    }
  });

  it("resolves old value and prop-type exports to the canonical modules", () => {
    expect(LegacyEditableTimecode).toBe(PlaybackEditableTimecode);
    expect(LegacyVideoPlayer).toBe(PlaybackVideoPlayer);
    expect(LegacyDraggableMediaItem).toBe(MediaDraggableMediaItem);

    expectTypeOf<LegacyEditableTimecodeProps>().toEqualTypeOf<PlaybackEditableTimecodeProps>();
    expectTypeOf<LegacyVideoPlayerProps>().toEqualTypeOf<PlaybackVideoPlayerProps>();
    expectTypeOf<LegacyDraggableMediaItemProps>().toEqualTypeOf<MediaDraggableMediaItemProps>();
  });

  it("preserves shared voice-reference compatibility exports (media-preview 已归 ui/ 并撤垫片 08-30)", () => {
    expect(legacyBuildVoiceReferenceAssets).toBe(canonicalBuildVoiceReferenceAssets);
    expectTypeOf<LegacyVoiceReferenceAsset>().toEqualTypeOf<CanonicalVoiceReferenceAsset>();

    expect(readFileSync(
      join(componentsRoot, "panels/studio/voice-reference-assets.ts"),
      "utf8",
    ).trim()).toBe('export * from "@/lib/tts/voice-reference-assets";');

    const roleVoiceAssignSource = readFileSync(
      join(componentsRoot, "panels/assets/RoleVoiceAssignDialog.tsx"),
      "utf8",
    );
    expect(roleVoiceAssignSource).toContain(
      'from "@/lib/tts/voice-reference-assets"',
    );
    expect(roleVoiceAssignSource).not.toContain("../studio/voice-reference-assets");
  });

  it("keeps director storyboard-config-toolbar as a thin panels facade", () => {
    expect(DirectorStoryboardConfigToolbar).toBe(CanonicalStoryboardConfigToolbar);
    expectTypeOf<DirectorStoryboardConfigToolbarProps>().toEqualTypeOf<CanonicalStoryboardConfigToolbarProps>();

    expect(
      readFileSync(
        join(componentsRoot, "panels/director/storyboard-config-toolbar.tsx"),
        "utf8",
      ).trim().split(/\r?\n/),
    ).toEqual([
      'export type { StoryboardConfigToolbarProps } from "../storyboard-config-toolbar-types";',
      'export { StoryboardConfigToolbar } from "../storyboard-config-toolbar";',
    ]);
  });

  it("keeps director use-video-generation as an exact lib/ai video-generator facade", () => {
    // Source-only lock: avoid loading the full video-generator graph in this suite.
    // Runtime identity is covered by lib/ai/ai-manager.test.ts path contract.
    const source = readFileSync(
      join(componentsRoot, "panels/director/use-video-generation.ts"),
      "utf8",
    );
    const codeLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    expect(codeLines).toEqual(['export * from "@/lib/ai/video-generator";']);
  });

  it("keeps sclass-scenes-utils as an exact storyboard-scenes-utils alias facade", () => {
    expect(
      readFileSync(
        join(componentsRoot, "panels/sclass/sclass-scenes-utils.ts"),
        "utf8",
      ).trim(),
    ).toBe(
      'export { filterTrailerScenes as filterSClassTrailerScenes } from "../storyboard-scenes-utils";',
    );
  });

  it("keeps the root wardrobe entry as an exact character-panel facade", () => {
    expect(LegacyWardrobeModal).toBe(CanonicalWardrobeModal);
    expectTypeOf<LegacyWardrobeModalProps>().toEqualTypeOf<CanonicalWardrobeModalProps>();
    expect(
      readFileSync(join(componentsRoot, "WardrobeModal.tsx"), "utf8").trim(),
    ).toBe(
      'export * from "@/components/panels/characters/wardrobe-modal";',
    );
  });

  it("keeps old api-manager entries as exact one-line settings facades", () => {
    for (const [fileName, target] of apiManagerCompatibilityFacades) {
      const source = readFileSync(join(apiManagerRoot, fileName), "utf8");

      expect(source.trim()).toBe(`export * from "${target}";`);
    }
  });

  it("preserves the api-manager barrel and direct public export identities", () => {
    expect(Object.keys(LegacyApiManager).sort()).toEqual([
      "AddProviderDialog",
      "ApiKeyEditorDialog",
      "EditProviderDialog",
      "FeatureBindingPanel",
    ]);
    expect(LegacyApiManager).toEqual(CanonicalApiManager);
    expect(LegacyApiProviderPresets).toBe(CanonicalApiProviderPresets);
    expect(LegacyFeatureConfigs).toBe(CanonicalFeatureConfigs);
    expect(legacyModelSupportsCapability).toBe(canonicalModelSupportsCapability);
    expect(legacyGetBrandIcon).toBe(canonicalGetBrandIcon);
    expectTypeOf<LegacyBrandIconFn>().toEqualTypeOf<CanonicalBrandIconFn>();
  });

  it("keeps the old storyboard leaf packages as an exact thin-facade inventory", () => {
    const assertFacades = (
      root: string,
      facades: Map<string, { target: string; forwardsDefault?: boolean }>,
    ) => {
      expect(listTypeScriptFiles(root).sort()).toEqual([...facades.keys()].sort());

      for (const [fileName, { target, forwardsDefault }] of facades) {
        const expectedLines = [`export * from "${target}";`];
        if (forwardsDefault) {
          expectedLines.push(`export { default } from "${target}";`);
        }

        expect(readFileSync(join(root, fileName), "utf8").trim().split(/\r?\n/)).toEqual(expectedLines);
      }
    };

    assertFacades(angleSwitchRoot, angleSwitchCompatibilityFacades);
    assertFacades(quadGridRoot, quadGridCompatibilityFacades);
  });

  it("preserves storyboard leaf barrel, direct value, default, and type export identities", () => {
    expect(LegacyAngleSwitch).toEqual(CanonicalAngleSwitch);
    expect(LegacyAngleController).toBe(CanonicalAngleController);
    expect(LegacyAngleControllerDefault).toBe(CanonicalAngleControllerDefault);
    expect(LegacyAngleSwitchDialog).toBe(CanonicalAngleSwitchDialog);
    expect(LegacyAngleSwitchResultDialog).toBe(CanonicalAngleSwitchResultDialog);

    expectTypeOf<LegacyAngleControllerProps>().toEqualTypeOf<CanonicalAngleControllerProps>();
    expectTypeOf<LegacyAngleSwitchDialogProps>().toEqualTypeOf<CanonicalAngleSwitchDialogProps>();
    expectTypeOf<LegacyAngleSwitchHistoryItem>().toEqualTypeOf<CanonicalAngleSwitchHistoryItem>();
    expectTypeOf<LegacyAngleSwitchResult>().toEqualTypeOf<CanonicalAngleSwitchResult>();
    expectTypeOf<LegacyAngleSwitchResultDialogProps>().toEqualTypeOf<CanonicalAngleSwitchResultDialogProps>();

    expect(LegacyQuadGrid).toEqual(CanonicalQuadGrid);
    expect(LegacyQuadGridDialog).toBe(CanonicalQuadGridDialog);
    expect(LegacyQuadGridResultDialog).toBe(CanonicalQuadGridResultDialog);

    expectTypeOf<LegacyQuadGridDialogProps>().toEqualTypeOf<CanonicalQuadGridDialogProps>();
    expectTypeOf<LegacyQuadVariationType>().toEqualTypeOf<CanonicalQuadVariationType>();
    expectTypeOf<LegacyQuadGridResult>().toEqualTypeOf<CanonicalQuadGridResult>();
    expectTypeOf<LegacyQuadGridResultDialogProps>().toEqualTypeOf<CanonicalQuadGridResultDialogProps>();
  });
});
