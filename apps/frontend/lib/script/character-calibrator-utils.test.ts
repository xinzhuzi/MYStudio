import { describe, expect, it } from 'vitest';
import { buildCharacterPriorityRecords } from './character-calibrator-utils';

describe('buildCharacterPriorityRecords', () => {
  it('prioritizes named characters and marks occupational group extras', () => {
    const stats = new Map([
      ['张明', { sceneCount: 1, dialogueCount: 0, episodeCount: 1 }],
      ['保安', { sceneCount: 20, dialogueCount: 3, episodeCount: 2 }],
    ]);
    const records = buildCharacterPriorityRecords(['保安', '张明'], stats, 'normal');
    expect(records.map((record) => record.name)).toEqual(['张明', '保安']);
    expect(records[1].isGroupExtra).toBe(true);
  });
});
