import { describe, expect, it } from 'vitest';
import { buildCharacterPriorityRecords, extractAllCharactersFromEpisodes } from './character-calibrator-utils';

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

describe('extractAllCharactersFromEpisodes', () => {
  it('deduplicates trimmed scene and dialogue names while preserving first-seen IDs', () => {
    const result = extractAllCharactersFromEpisodes([
      {
        episodeIndex: 1,
        title: '第一集',
        rawContent: '',
        scenes: [
          {
            sceneHeader: '门外',
            content: '',
            actions: [],
            subtitles: [],
            characters: [' 张三 ', '李四'],
            dialogues: [{ character: '张三', line: '在。' }],
          },
          {
            sceneHeader: '门内',
            content: '',
            actions: [],
            subtitles: [],
            characters: [],
            dialogues: [{ character: ' 王五 ', line: '来。' }],
          },
        ],
        shotGenerationStatus: 'idle',
      },
    ]);

    expect(result).toEqual([
      { id: 'char_raw_1', name: '张三' },
      { id: 'char_raw_2', name: '李四' },
      { id: 'char_raw_3', name: '王五' },
    ]);
  });
});
