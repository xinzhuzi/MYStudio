/**
 * Test data generators for deletion tests
 * Slice 9 Verification Layer - Deletion Transaction fixtures
 */

export interface Chapter {
  id: string;
  name: string;
  deleted: boolean;
}

export interface Bundle {
  projectId: string;
  chapters: Chapter[];
  timestamp: number;
}

/**
 * Creates a test bundle with contiguously indexed chapters
 */
export const createTestBundle = (): Bundle => ({
  projectId: 'fixture-proj-001',
  chapters: [
    { id: 'chapter-001', name: 'Test Chapter', deleted: false },
    { id: 'chapter-002', name: 'Another Test Chapter', deleted: false },
    { id: 'chapter-003', name: 'Third Test Chapter', deleted: false },
  ],
  timestamp: Date.now(),
});

/**
 * Creates a mock journal entry for transaction testing
 */
export const createMockJournalEntry = (projectId: string, action: 'prepare' | 'commit' | 'rollback') => {
  return {
    id: `journal-${Date.now()}`,
    projectId,
    action,
    timestamp: Date.now(),
    bundleSnapshot: createTestBundle(),
    status: action === 'prepare' ? 'pending' : 'completed',
  };
};

/**
 * Creates test chapters with various states
 */
export const createTestChapters = (count: number, startId = 1): Chapter[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `chapter-${String(startId + i).padStart(3, '0')}`,
    name: `Test Chapter ${startId + i}`,
    deleted: false,
  }));
};

/**
 * Creates a bundle with mixed deleted/non-deleted chapters
 */
export const createPartiallyDeletedBundle = (): Bundle => {
  return {
    projectId: 'fixture-proj-partial',
    chapters: [
      { id: 'chapter-001', name: 'Active Chapter', deleted: false },
      { id: 'chapter-002', name: 'Deleted Chapter', deleted: true },
      { id: 'chapter-003', name: 'Active Chapter 2', deleted: false },
      { id: 'chapter-004', name: 'Deleted Chapter 2', deleted: true },
    ],
    timestamp: Date.now(),
  };
};
