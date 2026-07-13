const MERGE_DIALOG_MAX_WIDTH = 360;
const MERGE_DIALOG_VIEWPORT_PADDING = 16;

export function getMergeDialogHorizontalOffset(buttonLeft: number, viewportWidth: number): number {
  const dialogWidth = Math.min(
    MERGE_DIALOG_MAX_WIDTH,
    Math.max(0, viewportWidth - MERGE_DIALOG_VIEWPORT_PADDING * 2),
  );
  const maximumLeft = Math.max(
    MERGE_DIALOG_VIEWPORT_PADDING,
    viewportWidth - dialogWidth - MERGE_DIALOG_VIEWPORT_PADDING,
  );
  const dialogLeft = Math.min(Math.max(buttonLeft, MERGE_DIALOG_VIEWPORT_PADDING), maximumLeft);
  return dialogLeft - buttonLeft;
}
