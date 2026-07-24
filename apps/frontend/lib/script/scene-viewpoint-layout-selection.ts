export interface ContactSheetLayout {
  gridLayout: { rows: number; cols: number };
  viewpointsPerPage: number;
}

/**
 * Select the renderer's fixed square contact-sheet layout from viewpoint count.
 * This is pure so generation flows can share the exact same paging contract.
 */
export function selectContactSheetLayout(viewpointCount: number): ContactSheetLayout {
  if (viewpointCount <= 4) {
    return { gridLayout: { rows: 2, cols: 2 }, viewpointsPerPage: 4 };
  }

  return { gridLayout: { rows: 3, cols: 3 }, viewpointsPerPage: 9 };
}
