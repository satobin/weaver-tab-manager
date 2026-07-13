import { describe, expect, it } from 'vitest';

import { getMergeDialogHorizontalOffset } from './mergeDialogPosition';

describe('getMergeDialogHorizontalOffset', () => {
  it('left-aligns the dialog with the button when it fits', () => {
    expect(getMergeDialogHorizontalOffset(200, 1024)).toBe(0);
  });

  it('shifts the dialog left enough to preserve the viewport gutter', () => {
    expect(getMergeDialogHorizontalOffset(700, 800)).toBe(-276);
  });

  it('shifts a button at the viewport edge into the gutter', () => {
    expect(getMergeDialogHorizontalOffset(4, 800)).toBe(12);
  });
});
