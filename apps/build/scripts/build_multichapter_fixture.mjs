#!/usr/bin/env node

/**
 * build_multichapter_fixture.mjs
 *
 * Purpose: Generate temporary multi-chapter test project dynamically
 *
 * Usage:
 *   node apps/build/scripts/build_multichapter_fixture.mjs
 *
 * Output: Prints temp directory path for downstream agents to use
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';


// ============================================================================
// UTILITIES
// ============================================================================

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateShortId() {
  return crypto.randomBytes(4).toString('hex').slice(0, 8);
}

async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

function rewriteMixedBackupForChapter(raw, chapterId) {
  const next = JSON.parse(JSON.stringify(raw));
  const studioStore = next['studio-store.json'];
  if (studioStore && Array.isArray(studioStore.novelChapters)) {
    studioStore.novelChapters = studioStore.novelChapters.filter((chapter) => chapter.id !== chapterId);
  }
  if (next.chapters && typeof next.chapters === 'object') delete next.chapters[chapterId];
  for (const [key, value] of Object.entries(next.continuity ?? {})) {
    if (value?.chapterId === chapterId) delete next.continuity[key];
  }
  const versions = next.exports?.['exports_manifest.json']?.versions;
  if (Array.isArray(versions)) {
    next.exports['exports_manifest.json'].versions = versions
      .map((version) => ({ ...version, chapters: version.chapters?.filter((id) => id !== chapterId) }))
      .filter((version) => version.chapters?.length !== 0);
  }
  return next;
}

function assertMixedBackupRoundTrip(raw, targetChapterId, untouchedChapterId) {
  const untouchedBefore = JSON.stringify(raw.chapters?.[untouchedChapterId]);
  const rewritten = rewriteMixedBackupForChapter(raw, targetChapterId);
  if (rewritten.chapters?.[targetChapterId]) {
    throw new Error(`Round-trip left target chapter ${targetChapterId} in mixed backup`);
  }
  if (JSON.stringify(rewritten.chapters?.[untouchedChapterId]) !== untouchedBefore) {
    throw new Error(`Round-trip changed untouched chapter ${untouchedChapterId}`);
  }
  const reparsed = JSON.parse(JSON.stringify(rewritten));
  if (JSON.stringify(reparsed.chapters?.[untouchedChapterId]) !== untouchedBefore) {
    throw new Error(`Round-trip serialization changed untouched chapter ${untouchedChapterId}`);
  }
}

// ============================================================================
// DATA GENERATORS - DERIVED DYNAMICALLY (NO HARDCODED NAMES)
// ============================================================================

function generateAssetId(prefix = 'asset') {
  return `${prefix}-${generateShortId()}`;
}

function generateCharacterData(chapterIndex, variantType = null) {
  const baseNames = ['Aria', 'Kael', 'Lyra', 'Theron', 'Mira', 'Zane'];
  const nameIndex = chapterIndex % baseNames.length;
  const baseName = baseNames[nameIndex];

  let fullName = baseName;
  if (variantType) {
    fullName = `${baseName}-${variantType}`;
  } else if (chapterIndex > 1) {
    fullName = `${baseName}-v${chapterIndex}`;
  }

  return {
    id: `char-${chapterIndex}-${generateShortId()}`, // TRACKING KEY: derived at runtime
    name: fullName,
    role: chapterIndex === 1 ? 'protagonist' : chapterIndex === 2 ? 'antagonist' : 'supporting',
    species: chapterIndex % 2 === 0 ? 'human' : 'elf',
    description: `A ${fullName.toLowerCase()} character in chapter ${chapterIndex}`,
    visualKey: `char-visual-${chapterIndex}-${generateShortId()}`,
    metadata: {
      chapterIndex,
      generatedAt: new Date().toISOString(),
      variant: variantType || null
    },
    tags: [`chapter-${chapterIndex}`, `role:${chapterIndex === 1 ? 'main' : 'secondary'}`]
  };
}

function generateSceneData(chapterIndex, sceneType = null) {
  const baseScenes = ['forest-clearing', 'castle-hall', 'ancient-temple', 'mountain-pass'];
  const sceneKey = baseScenes[chapterIndex % baseScenes.length];

  let displayName = sceneKey.replace('-', ' ');
  if (sceneType) {
    displayName = `${sceneKey}-${sceneType}`;
  }

  return {
    id: `scene-${chapterIndex}-${generateShortId()}`, // TRACKING KEY: derived at runtime
    displayName,
    location: sceneKey,
    lighting: chapterIndex % 2 === 0 ? 'dramatic' : 'soft',
    timeOfDay: chapterIndex % 3 === 0 ? 'dawn' : chapterIndex % 3 === 1 ? 'noon' : 'dusk',
    elements: [
      { type: 'terrain', subType: 'grassland', importance: chapterIndex === 1 ? 0.9 : 0.7 },
      { type: 'structure', subType: 'ruins', importance: 0.6 },
      { type: 'vegetation', subType: 'trees', importance: 0.8 }
    ],
    metadata: {
      chapterIndex,
      generatedAt: new Date().toISOString(),
      sceneType
    },
    colorPalette: ['#2C5F2D', '#97BC62', '#FFD700', '#4A4A4A']
  };
}

function generateSharedAsset(type, index) {
  const id = `${type}-shared-${generateShortId()}`;
  return {
    id,
    displayName: `${type}-shared-v${index}`,
    category: 'cross-chapter-shared',
    subtype: type,
    metadata: {
      sharedAcrossChapters: true,
      indices: [1, 2],
      generatedAt: new Date().toISOString()
    }
  };
}

function generateChapterExclusiveAsset(type, chapterIndex) {
  const id = `${type}-excl-${chapterIndex}-${generateShortId()}`;
  return {
    id,
    displayName: `${type}-chapter-${chapterIndex}-${generateShortId()}`,
    category: 'chapter-exclusive',
    subtype: type,
    chapterIndex,
    metadata: {
      exclusiveToChapter: chapterIndex,
      generatedAt: new Date().toISOString()
    }
  };
}

// ============================================================================
// CHAPTER DATA GENERATION
// ============================================================================

function generateNovelContent(chapterIndex) {
  return {
    chapterId: `chapter-${chapterIndex}`, // trackKey format: 'chapter-' + index
    title: `Chapter ${['One', 'Two'][chapterIndex - 1] || chapterIndex}`,
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    authorNotes: `Draft novel content for chapter ${chapterIndex}`,
    content: {
      paragraphs: Array.from({ length: 5 + chapterIndex }, (_, i) => ({
        id: `p-${chapterIndex}-${i + 1}`,
        text: `This is paragraph ${i + 1} of chapter ${chapterIndex}. In this section, the story unfolds with ${chapterIndex === 1 ? 'mystery' : 'tension'} building throughout the narrative arc...`,
        wordCount: 50 + chapterIndex * 10
      })),
      totalWords: 250 + chapterIndex * 50,
      themes: [
        chapterIndex === 1 ? 'discovery' : 'confrontation',
        'transformation',
        'destiny'
      ]
    },
    metadata: {
      chapterIndex,
      status: 'draft',
      reviewState: 'pending'
    }
  };
}

function generateScriptData(chapterIndex) {
  const sceneCount = 3 + chapterIndex;

  return {
    chapterId: `chapter-${chapterIndex}`, // trackKey must match novel chapterId
    formatVersion: '2.1.0',
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneId: `sc-${chapterIndex}-${i + 1}`,
      title: `Scene ${i + 1}: ${['Encounter', 'Discovery', 'Conflict', 'Resolution'][i % 4]}`,
      locationRef: `scene-${chapterIndex}-${(i % 3) + 1}`,
      characters: [
        { refId: `char-${chapterIndex}-${generateShortId()}`, presence: ['on-screen'] },
        ...(chapterIndex === 1 && i === 0 ? [{ refId: `char-shared-${generateShortId()}`, presence: ['cameo'] }] : [])
      ],
      dialogue: [
        {
          speaker: 'Protagonist',
          line: `Dialogue line 1 in scene ${i + 1} of chapter ${chapterIndex}.`,
          emotion: chapterIndex === 1 ? 'curious' : 'determined'
        },
        {
          speaker: 'Secondary',
          line: `Response line in scene ${i + 1}.`,
          emotion: 'neutral'
        }
      ],
      action: `Action beats describing movement and choreography in scene ${i + 1}.`,
      durationEstimate: 120 + chapterIndex * 30
    })),
    metadata: {
      chapterIndex,
      totalScenes: sceneCount,
      estimatedDuration: 420 + chapterIndex * 90
    }
  };
}

function generateStoryboardData(chapterIndex) {
  const panelCount = 6 + chapterIndex * 2;

  return {
    chapterId: `chapter-${chapterIndex}`, // trackKey consistency
    resolution: { width: 1920, height: 1080 },
    panels: Array.from({ length: panelCount }, (_, i) => ({
      panelId: `panel-${chapterIndex}-${i + 1}`,
      sequenceNumber: i + 1,
      sourceSceneRef: `sc-${chapterIndex}-${Math.floor(i / 2) + 1}`,
      composition: {
        cameraAngle: chapterIndex === 1 ? ['close-up', 'medium-shot'][i % 2] : ['wide-shot', 'over-the-shoulder'][i % 2],
        focusPoints: [
          { element: 'character', position: { x: 0.3, y: 0.5 } },
          { element: 'background', position: { x: 0.7, y: 0.5 } }
        ],
        depthLayers: [
          { layer: 'foreground', blur: 0 },
          { layer: 'midground', blur: 0 },
          { layer: 'background', blur: 1 }
        ]
      },
      notes: `Storyboard panel ${i + 1} for chapter ${chapterIndex}. Visual reference and direction.`,
      thumbnailRef: `thumb-${chapterIndex}-${i + 1}-placeholder.jpg`
    })),
    metadata: {
      chapterIndex,
      totalPanels: panelCount,
      styleGuide: 'ink-wash-mono'
    }
  };
}

function generateContinuityData(chapterIndex) {
  return {
    chapterId: `chapter-${chapterIndex}`, // trackKey alignment
    version: '1.0',
    assetsUsed: {
      characters: [generateCharacterData(chapterIndex).id],
      scenes: [generateSceneData(chapterIndex).id],
      props: chapterIndex === 1
        ? [generateSharedAsset('prop', 1).id, generateSharedAsset('prop', 2).id]
        : [generateSharedAsset('prop', 1).id, generateChapterExclusiveAsset('prop', 2).id]
    },
    timelineMarkers: [
      { timestamp: 0, event: 'chapter-start', chapterIndex },
      { timestamp: 120 * chapterIndex, event: 'climax', chapterIndex },
      { timestamp: 240 * chapterIndex, event: 'chapter-end', chapterIndex }
    ],
    references: {
      novelRef: `chapter-${chapterIndex}`,
      scriptRef: `chapter-${chapterIndex}`,
      storyboardRef: `chapter-${chapterIndex}`
    },
    changesFromPrevious: chapterIndex === 1
      ? 'Initial chapter baseline'
      : 'Continues from chapter 1, introduces new antagonist forces.',
    metadata: {
      chapterIndex,
      validatedAt: new Date().toISOString()
    }
  };
}

function generateExportsMetadata(chapterIndex) {
  return {
    chapterId: `chapter-${chapterIndex}`, // trackKey synchronization
    formats: [
      { format: 'json-full', path: `exports/chapter-${chapterIndex}/full.json`, size: 102400 + chapterIndex * 5120 },
      { format: 'json-minimal', path: `exports/chapter-${chapterIndex}/minimal.json`, size: 8192 + chapterIndex * 4096 },
      { format: 'csv-csv', path: `exports/chapter-${chapterIndex}/data.csv`, size: 4096 + chapterIndex * 2048 }
    ],
    dependencies: {
      requiredAssets: [
        generateCharacterData(chapterIndex).id,
        generateSceneData(chapterIndex).id
      ],
      optionalAssets: chapterIndex === 1 ? [] : [generateSharedAsset('prop', 1).id]
    },
    validationStatus: {
      integrityCheck: 'passed',
      crossRefCheck: 'passed',
      schemaCheck: 'passed'
    },
    metadata: {
      chapterIndex,
      exportedAt: new Date().toISOString()
    }
  };
}

function generateRemotionData(chapterIndex) {
  return {
    chapterId: `chapter-${chapterIndex}`,
    manifestId: `remotion-manifest-${generateShortId()}`,
    compositionId: `chapter-${chapterIndex}-composition`,
    jobs: [{
      jobId: `remotion-job-${generateShortId()}`,
      chapterId: `chapter-${chapterIndex}`,
      status: 'succeeded',
      outputPath: `remotion/chapter-${chapterIndex}/final.mp4`
    }],
    updatedAt: new Date().toISOString()
  };
}

// ============================================================================
// FULL PROJECT CONSTRUCTION
// ============================================================================

async function generateChapterData(chapterIndex) {
  // Generate all unique IDs first (derived at runtime, no hardcoded values)
  const chapterChar1 = generateCharacterData(chapterIndex);
  const chapterChar2 = generateCharacterData(chapterIndex, 'variant');
  const chapterScene1 = generateSceneData(chapterIndex);
  const chapterScene2 = generateSceneData(chapterIndex, 'derivative');

  return {
    novel: generateNovelContent(chapterIndex),
    script: generateScriptData(chapterIndex),
    storyboard: generateStoryboardData(chapterIndex),
    continuity: generateContinuityData(chapterIndex),
    exports: generateExportsMetadata(chapterIndex),
    remotion: generateRemotionData(chapterIndex),

    // Add generated asset refs to continuity
    _internal: {
      characters: [chapterChar1, chapterChar2],
      scenes: [chapterScene1, chapterScene2]
    }
  };
}

async function generateCrossChapterAssets() {
  return {
    sharedCharacters: Array.from({ length: 2 }, (_, i) => generateSharedAsset('character', i + 1)),
    sharedScenes: Array.from({ length: 2 }, (_, i) => generateSharedAsset('scene', i + 1)),
    sharedProps: Array.from({ length: 3 }, (_, i) => generateSharedAsset('prop', i + 1)),
    metadata: {
      category: 'cross-chapter-shared',
      generatedAt: new Date().toISOString()
    }
  };
}

async function generateBackupFile(filePath, data, includeTimestamp = false) {
  const content = includeTimestamp
    ? JSON.stringify({ ...data, _backupMeta: { createdAt: new Date().toISOString() } }, null, 2)
    : JSON.stringify(data, null, 2);

  await ensureDir(filePath);
  await writeFile(join(filePath, 'studio-store.json.bak'), content);
}

async function generateMixedBackupSample(filePath, projectId) {
  /**
   * Mixed backup sample - redacted real-shape regression fixture
   *
   * This represents the MULTI-CHAPTER mixed-JSON backup format registered in DAO-2024-009:
   * - Top-level envelope (projectId, createdAt, version, etc.)
   * - Embedded studio-store.json object (novelChapters[], settings)
   * - Individual chapter artifacts inline (novel_v1.json, script_v2.json, storyboard_v1.json)
   * - Shared asset bundles (assets_chars.json, assets_scenes.json)
   * - Continuity & exports snapshots
   * - Backward-compat fields (legacyRefs, migrationToken)
   *
   * STRIPPED: binary/large-text fields for privacy compliance
   */

  const mixedBackup = {
    _format: 'daojie-multichapter-mixed-json',
    _version: '1.0.0',
    _registeredIn: 'DAO-2024-009',
    projectId,
    createdAt: new Date().toISOString(),
    exportedBy: 'system-autobackup',

    // Core envelope
    projectEnvelope: {
      id: projectId,
      name: 'Multi-Chapter Test Project',
      version: '2.1.0',
      lastSaved: new Date().toISOString(),
      stage: 'production',
      chapterCount: 2,
      configSnapshot: {
        renderingEngine: 'ffmpeg-6.0',
        exportProfiles: ['1080p-h264', '4k-hevc'],
        ttsBackend: 'local-sidecar-v3'
      }
    },

    // Embedded studio-store shape (redacted sensitive fields)
    'studio-store.json': {
      projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      novelChapters: [
        {
          id: 'chapter-1',
          index: 1,
          title: 'The Awakening',
          status: 'finalized',
          chapterHash: 'sha256:[REDACTED]',
          assetReferences: [
            { type: 'character', refId: 'char-shared-a1b2c3' },
            { type: 'scene', refId: 'scene-shared-d4e5f6' }
          ]
        },
        {
          id: 'chapter-2',
          index: 2,
          title: 'The Confrontation',
          status: 'draft',
          chapterHash: 'sha256:[REDACTED]',
          assetReferences: [
            { type: 'character', refId: 'char-excl-g7h8i9' },
            { type: 'prop', refId: 'prop-shared-j0k1l2' }
          ]
        }
      ],
      settings: {
        defaultExportFormat: 'mp4-1080p',
        autoBackupEnabled: true,
        backupIntervalMinutes: 30,
        cloudSyncProvider: '[REDACTED]'
      },
      userPreferences: {
        theme: 'dark',
        language: 'en',
        shortcutCustomizations: {}
      }
    },

    // Individual chapter artifacts (inline snapshots)
    chapters: {
      'chapter-1': {
        'novel_v1.json': {
          chapterId: 'chapter-1',
          title: 'The Awakening',
          version: '1.0.0',
          contentSummary: '[REDACTED-TEXT-BLOCK]',
          metadata: {
            wordCount: 3420,
            paragraphCount: 12,
            themes: ['discovery', 'transformation']
          }
        },
        'script_v2.json': {
          chapterId: 'chapter-1',
          formatVersion: '2.1.0',
          sceneCount: 5,
          scenesSummary: ['Intro-forest', 'Meeting-hero', 'First-conflict', 'Climax-tent', 'Resolution-fog'],
          metadata: {
            estimatedDuration: 720,
            dialogueLines: 34,
            actionBlocks: 18
          }
        },
        'storyboard_v1.json': {
          chapterId: 'chapter-1',
          resolution: { width: 1920, height: 1080 },
          panelCount: 16,
          panelsSummary: ['panel-01-camera-wide', 'panel-02-character-close', 'panel-03-environment-detail'],
          metadata: {
            styleGuide: 'ink-wash-mono',
            reviewStatus: 'approved',
            reviewerNotes: '[REDACTED]'
          }
        }
      },

      'chapter-2': {
        'novel_v1.json': {
          chapterId: 'chapter-2',
          title: 'The Confrontation',
          version: '1.0.0',
          contentSummary: '[REDACTED-TEXT-BLOCK]',
          metadata: {
            wordCount: 4180,
            paragraphCount: 15,
            themes: ['confrontation', 'destiny']
          }
        },
        'script_v2.json': {
          chapterId: 'chapter-2',
          formatVersion: '2.1.0',
          sceneCount: 7,
          scenesSummary: ['Return-main', 'Setup-battle', 'Reveal-ally', 'Final-showdown'],
          metadata: {
            estimatedDuration: 980,
            dialogueLines: 52,
            actionBlocks: 28
          }
        },
        'storyboard_v1.json': {
          chapterId: 'chapter-2',
          resolution: { width: 1920, height: 1080 },
          panelCount: 22,
          panelsSummary: ['panel-01-tension-build', 'panel-02-battle-staging', 'panel-03-cataclysm'],
          metadata: {
            styleGuide: 'ink-wash-mono',
            reviewStatus: 'in-review',
            reviewerNotes: '[REDACTED]'
          }
        }
      }
    },

    // Asset bundles (shared + chapter-specific)
    assets: {
      chars: {
        'assets_chars.json': {
          bundleId: 'chars-shared-v1',
          version: '1.2.0',
          characters: [
            { id: 'char-shared-a1b2c3', displayName: 'Protagonist-A', roles: ['protagonist'], shared: true },
            { id: 'char-shared-b2c3d4', displayName: 'Supporter-B', roles: ['supporting'], shared: true },
            { id: 'char-excl-g7h8i9', displayName: 'Antagonist-C', roles: ['antagonist'], exclusiveToChapter: 2 }
          ],
          metadata: {
            lastModified: new Date().toISOString(),
            compatibility: '>=1.5.0'
          }
        },

        'assets_chars_chapter2-v3.json': {
          bundleId: 'chars-ch2-v3',
          version: '3.0.0',
          characters: [
            { id: 'char-excl-g7h8i9', displayName: 'Antagonist-C', variants: ['normal', 'battle-mode', 'defeated'] },
            { id: 'char-excl-h8i9j0', displayName: 'Minion-D', roles: [' minion'], chapterSpecific: 2 }
          ],
          metadata: {
            lastModified: new Date().toISOString(),
            dependencyOn: 'chars-shared-v1'
          }
        }
      },

      scenes: {
        'assets_scenes.json': {
          bundleId: 'scenes-shared-v2',
          version: '2.1.0',
          scenes: [
            { id: 'scene-shared-d4e5f6', displayName: 'Ancient-Forest', categories: ['nature', 'encounter'] },
            { id: 'scene-shared-e5f6g7', displayName: 'Castle-Ruins', categories: ['architecture', 'climax'] }
          ],
          metadata: {
            textures: '[REDACTED-FIELD-COUNT]',
            lightingPresets: 12
          }
        }
      },

      props: {
        'assets_props.json': {
          bundleId: 'props-shared-v1',
          version: '1.0.0',
          props: [
            { id: 'prop-shared-j0k1l2', displayName: 'Magic-Totem', categories: ['artifact', 'key-item'] },
            { id: 'prop-shared-k1l2m3', displayName: 'Weathered-Sword', categories: ['weapon', 'legacy'] }
          ],
          metadata: {
            physicsEnabled: true,
            interactiveElements: 3
          }
        }
      }
    },

    // Continuity snapshots
    continuity: {
      'continuity_chapter1.json': {
        chapterId: 'chapter-1',
        version: '1.0.0',
        validatedAt: new Date().toISOString(),
        crossReferenceStatus: {
          novelConsistency: 'verified',
          scriptAlignment: 'verified',
          storyboardMatch: 'verified'
        },
        assetUsageLog: [
          { assetId: 'char-shared-a1b2c3', usageCount: 8, scenes: ['sc-1-1', 'sc-1-3', 'sc-1-5'] },
          { assetId: 'scene-shared-d4e5f6', usageCount: 4, scenes: ['sc-1-1', 'sc-1-2'] }
        ],
        notes: '[REDACTED]'
      },

      'continuity_chapter2.json': {
        chapterId: 'chapter-2',
        version: '1.0.0',
        validatedAt: new Date().toISOString(),
        crossReferenceStatus: {
          novelConsistency: 'pending',
          scriptAlignment: 'verified',
          storyboardMatch: 'in-progress'
        },
        assetUsageLog: [
          { assetId: 'char-excl-g7h8i9', usageCount: 12, scenes: ['sc-2-2', 'sc-2-5', 'sc-2-7'] },
          { assetId: 'prop-shared-j0k1l2', usageCount: 3, scenes: ['sc-2-1', 'sc-2-4'] }
        ],
        notes: '[REDACTED]'
      }
    },

    // Exports history
    exports: {
      'exports_manifest.json': {
        projectId,
        versions: [
          {
            version: 'v1.0.0',
            exportedAt: new Date(Date.now() - 86400000).toISOString(),
            format: 'mp4-1080p',
            outputRef: 'output/v1.0.0/',
            chapters: ['chapter-1'],
            checksum: 'sha256:[REDACTED]'
          },
          {
            version: 'v1.1.0',
            exportedAt: new Date(Date.now() - 43200000).toISOString(),
            format: 'mp4-1080p',
            outputRef: 'output/v1.1.0/',
            chapters: ['chapter-1', 'chapter-2'],
            checksum: 'sha256:[REDACTED]'
          }
        ],
        latest: 'v1.1.0'
      }
    },

    // Backward compatibility fields
    legacyCompat: {
      migrationToken: 'migr-[REDACTED]',
      previousFormatVersions: ['0.9.0', '1.0.0-alpha'],
      legacyRefs: {
        oldProjectId: 'proj-legacy-[REDACTED]',
        oldWorkspacePath: '/Volumes/OldDrive/[REDACTED]/'
      },
      deprecationNotices: [
        { field: 'rawImageData', replacedBy: 'compressedTextureRefs', since: '1.2.0' }
      ]
    },

    // Metadata for this backup itself
    backupMeta: {
      backupId: crypto.randomBytes(8).toString('hex'),
      compressedSize: 524288,
      uncompressedSize: 1572864,
      compressionRatio: 0.33,
      checksums: {
        md5: '[REDACTED]',
        sha256: '[REDACTED]'
      },
      storageLocation: '[REDACTED-PATH]',
      retentionPolicy: '30days',
      tags: ['auto-backup', 'multichapter', 'regression-test']
    }
  };

  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(mixedBackup, null, 2));
  return mixedBackup;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function generateFixture() {
  try {
    const timestamp = Date.now();
    const projectId = `fixture-proj-${timestamp}`;
    const baseTempDir = `/tmp/mystudio-fixture-${timestamp}/${projectId}`;

    console.log(`🏗️  Generating multichapter fixture...`);
    console.log(`📁 Base temp directory: /tmp/mystudio-fixture-${timestamp}/`);
    console.log(`🎯 Project ID: ${projectId}`);

    // Create main temp directory structure
    await ensureDir(baseTempDir);
    const pDir = join(baseTempDir, '_p', projectId);
    await ensureDir(pDir);

    // Generate multi-chapter data
    console.log('\n📝 Generating chapter data...');

    const chapters = [];
    const chapterDataList = [];

    for (let i = 1; i <= 2; i++) {
      console.log(`  → Generating chapter ${i}...`);
      const chapterData = await generateChapterData(i);
      chapterDataList.push({ index: i, data: chapterData });
      chapters.push({
        id: `chapter-${i}`, // trackKey = 'chapter-' + index (as specified)
        index: i,
        title: i === 1 ? 'The Awakening' : 'The Confrontation',
        status: i === 1 ? 'finalized' : 'draft'
      });
    }

    // Generate cross-chapter shared assets
    console.log('🔗 Generating cross-chapter shared assets...');
    const sharedAssets = await generateCrossChapterAssets();

    // Build studio-store.json
    console.log('📦 Building studio-store.json...');

    const studioStore = {
      projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      novelChapters: chapters,
      settings: {
        renderingEngine: 'ffmpeg-6.0',
        exportProfiles: ['1080p-h264', '4k-hevc'],
        defaultLanguage: 'en',
        autoBackupEnabled: true
      },
      version: '2.1.0',
      assets: {
        shared: sharedAssets,
        chapters: chapterDataList.map(({ index, data }) => ({
          chapterIndex: index,
          characters: data._internal.characters.map(c => c.id),
          scenes: data._internal.scenes.map(s => s.id)
        }))
      },
      userPreferences: {
        theme: 'dark',
        fontSize: 14,
        autosaveInterval: 300
      }
    };

    const studioStorePath = join(pDir, 'studio-store.json');
    await writeFile(studioStorePath, JSON.stringify(studioStore, null, 2));

    // Persist shared assets separately so the fixture exercises retain/shared
    // handling instead of keeping everything only inside the studio envelope.
    const sharedAssetsDir = join(pDir, 'workflow-images', 'assets', 'shared');
    await ensureDir(sharedAssetsDir);
    await writeFile(join(sharedAssetsDir, 'shared-assets.json'), JSON.stringify(sharedAssets, null, 2));
    await writeFile(join(sharedAssetsDir, 'shared-character.png'), `shared-character-${projectId}`);
    await writeFile(join(sharedAssetsDir, 'shared-scene.png'), `shared-scene-${projectId}`);
    await writeFile(join(sharedAssetsDir, 'shared-prop.png'), `shared-prop-${projectId}`);

    // Write individual chapter artifacts
    console.log('✍️  Writing chapter artifacts...');

    for (const { index, data } of chapterDataList) {
      const chapterPDir = join(pDir, `chapter-${index}`);
      await ensureDir(chapterPDir);

      // Novel
      await writeFile(join(chapterPDir, 'novel.json'),
                     JSON.stringify(data.novel, null, 2));

      // Script
      await writeFile(join(chapterPDir, 'script.json'),
                     JSON.stringify(data.script, null, 2));

      // Storyboard
      await writeFile(join(chapterPDir, 'storyboard.json'),
                     JSON.stringify(data.storyboard, null, 2));

      // Continuity
      await writeFile(join(chapterPDir, 'continuity.json'),
                     JSON.stringify(data.continuity, null, 2));

      // Exports metadata
      await writeFile(join(chapterPDir, 'exports.json'),
                     JSON.stringify(data.exports, null, 2));

      // Remotion manifest and representative physical outputs
      await writeFile(join(chapterPDir, 'remotion.json'),
                     JSON.stringify(data.remotion, null, 2));
      const storyboardDir = join(pDir, 'workflow-images', 'storyboards', `chapter-${index}`);
      const exportDir = join(pDir, 'exports', `chapter-${index}`);
      const remotionDir = join(pDir, 'remotion', `chapter-${index}`);
      const chapterAssetsDir = join(pDir, 'workflow-images', 'assets', `chapter-${index}`);
      await ensureDir(storyboardDir);
      await ensureDir(exportDir);
      await ensureDir(remotionDir);
      await ensureDir(chapterAssetsDir);
      await writeFile(join(storyboardDir, 'shot-001.png'), `storyboard-${projectId}-chapter-${index}`);
      await writeFile(join(exportDir, 'final.mp4'), `export-${projectId}-chapter-${index}`);
      await writeFile(join(remotionDir, 'final.mp4'), `remotion-${projectId}-chapter-${index}`);
      await writeFile(join(chapterAssetsDir, 'character-variant.png'), `variant-${projectId}-chapter-${index}`);

      console.log(`    ✓ Chapter ${index} artifacts written`);
    }

    // Write chapter-exclusive backup file (.bak)
    console.log('💾 Writing chapter-exclusive backup file...');
    const backupDir = join(pDir, '.backups');
    await ensureDir(backupDir);

    const backupData = {
      _type: 'chapter-exclusive-backup',
      _version: '1.0.0',
      _generatedAt: new Date().toISOString(),
      projectId,
      chapterIndex: 2,
      backupRef: 'chapter-2-pre-export-checkpoint',
      snapshot: {
        novel: chapterDataList.find(c => c.index === 2)?.data.novel,
        script: chapterDataList.find(c => c.index === 2)?.data.script,
        includesVariantAssets: true,
        variantIds: chapterDataList.find(c => c.index === 2)?.data._internal.characters.map(c => c.id)
      },
      metadata: {
        purpose: 'pre-export-snapshot',
        recoverable: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }
    };

    await writeFile(join(backupDir, 'chapter-2-pre-export.json.bak'),
                   JSON.stringify(backupData, null, 2));

    // Write registered multi-chapter mixed-JSON backup format
    console.log('🗄️  Writing mixed-backup-sample-v1.json (registered DAO-2024-009 format)...');
    // Keep generated data entirely inside the temporary fixture.  The checked-in
    // redacted regression fixture is a stable input and must never be overwritten
    // with timestamped synthetic data by this generator.
    const fixturesDir = join(baseTempDir, 'fixtures');
    await ensureDir(fixturesDir);

    const mixedBackupPath = join(fixturesDir, 'mixed-backup-sample-v1.json.bak');
    const mixedBackup = await generateMixedBackupSample(
      mixedBackupPath,
      projectId
    );
    assertMixedBackupRoundTrip(mixedBackup, 'chapter-1', 'chapter-2');

    // Final summary
    console.log('\n✅ Fixture generation complete!');
    console.log(`\n📊 Summary:`);
    console.log(`   Total chapters: ${chapters.length}`);
    console.log(`   Chapters: ${chapters.map(c => c.id).join(', ')}`);
    console.log(`   Shared assets: ${Object.keys(sharedAssets).filter(k => k !== 'metadata').length} bundles`);
    console.log(`   Backup files: 2 (.bak + mixed JSON)`);
    console.log(`   Temp directory: ${baseTempDir}`);
    console.log(`   Fixture registry: ${mixedBackupPath}`);

    // Output for downstream agents
    console.log(`\n🎯 TEMP_DIR=${baseTempDir}`);
    console.log(`🎯 PROJECT_ID=${projectId}`);
    console.log(`🎯 FIXTURE_PATH=${mixedBackupPath}`);

    return {
      tempDir: baseTempDir,
      projectId,
      fixturePath: mixedBackupPath,
      chapterCount: chapters.length
    };

  } catch (error) {
    console.error('❌ Error generating fixture:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url.startsWith('file:')) {
  generateFixture();
}

export { generateFixture };
