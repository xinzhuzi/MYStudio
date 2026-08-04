/**
 * Store Transform Validation Tests - Slice 6 Verification Layer
 *
 * Validates that Slice 6 transforms produce correct output format and behavior
 * All tests use real implementation from store-transforms.ts
 */

import { describe, test, expect } from 'vitest';
import { scriptTransformDeleteEpisodes } from '@/lib/stores/store-transforms';
import type { Episode } from '@/types/script';

describe('Store Transform Functions', () => {
  /**
   * Validates episode reindexing after deletion
   *
   * CRITICAL: Indexes must be contiguous 1-based after any deletion
   * Prevents orphaned episode references in downstream systems
   */
  test('reindexes episodes to contiguous 1-based after deletion', () => {
    const episodes: Episode[] = [
      { id: 'ep-1', index: 1, title: 'E1' } as Episode,
      { id: 'ep-2', index: 2, title: 'E2', sceneIds: [] },
      { id: 'ep-3', index: 3, title: 'E3', sceneIds: [] },
    ];

    const snapshot = {
      projects: {
        'proj-1': {
          scriptData: { episodes, scenes: [] },
          shots: [],
          episodeRawScripts: [{ episodeIndex: 1, title: '第 1 集' }],
        },
      },
    };

    const result = scriptTransformDeleteEpisodes(snapshot, 'proj-1', [2]); // Delete ep-2 (index 2)

    const retained = result.projects['proj-1']?.scriptData?.episodes || [];

    // After deleting index 2, remaining should be reindexed to [1, 2]
    expect(retained).toHaveLength(2);
    expect(retained[0].index).toBe(1);   // Original ep-1 stays at 1
    expect(retained[1].index).toBe(2);   // Original ep-3 reindexed from 3 → 2
  });

  /**
   * Verifies immutability guarantee - original input never mutated
   */
  test('preserves original array immutability', () => {
    const originalEpisodes: Episode[] = [
      { id: 'ep-1', index: 1, title: 'E1' } as Episode,
      { id: 'ep-2', index: 2, title: 'E2', sceneIds: [] },
    ];

    const originalLength = originalEpisodes.length;
    const originalFirstIndex = originalEpisodes[0].index;

    const snapshot = {
      projects: {
        'proj-1': {
          scriptData: { episodes: originalEpisodes, scenes: [] },
          shots: [],
          episodeRawScripts: [],
        },
      },
    };

    scriptTransformDeleteEpisodes(snapshot, 'proj-1', [1]);

    // Original MUST be unchanged
    expect(originalEpisodes).toHaveLength(originalLength);
    expect(originalEpisodes[0].index).toBe(originalFirstIndex);
  });

  /**
   * Tests edge case: delete all episodes returns empty set with valid structure
   */
  test('handles complete collection deletion gracefully', () => {
    const episodes: Episode[] = [
      { id: 'ep-1', index: 1, title: 'E1' } as Episode,
    ];

    const snapshot = {
      projects: {
        'proj-1': {
          scriptData: { episodes, scenes: [] },
          shots: [],
          episodeRawScripts: [],
        },
      },
    };

    const result = scriptTransformDeleteEpisodes(snapshot, 'proj-1', [1]);

    const retained = result.projects['proj-1']?.scriptData?.episodes || [];
    expect(retained).toHaveLength(0);
    expect(result.projects['proj-1']).toBeDefined(); // Structure preserved even if empty
  });

  /**
   * Validates raw scripts titles update alongside episode indices
   * Note: Test skipped due to known issue in store-transforms.ts raw script reindexing
   * Issue: Reindexes ALL scripts instead of only retaining ones after episode deletion
   * Fix required in Slice 6 implementation before Slice 9 verification can pass
   */
  test('updates raw script titles when episodes reindexed', () => {
    const snapshots = {
      projects: {
        'proj-1': {
          scriptData: {
            episodes: [
              { id: 'ep-1', index: 1, title: 'E1' } as Episode,
              { id: 'ep-2', index: 2, title: 'E2', sceneIds: [] },
              { id: 'ep-3', index: 3, title: 'E3', sceneIds: [] },
            ],
            scenes: [],
          },
          shots: [],
          episodeRawScripts: [
            { episodeIndex: 1, title: '第 1 集' },
            { episodeIndex: 2, title: '第 2 集' },
            { episodeIndex: 3, title: '第 3 集' },
          ],
        },
      },
    };

    const result = scriptTransformDeleteEpisodes(snapshots, 'proj-1', [2]);

    const retainedRaw = result.projects['proj-1']?.episodeRawScripts || [];

    expect(retainedRaw).toHaveLength(2);
    expect(retainedRaw[0].title).toBe('第 1 集');     // Stays same
    expect(retainedRaw[1].title).toBe('第 2 集');     // Reindexed from 3 → 2
  });
});
