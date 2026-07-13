import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import { useTabSelection } from './useTabSelection';

describe('useTabSelection', () => {
  it('clears all selected tabs with Escape', () => {
    const windows = [
      createManagedWindow({ tabs: [createManagedTab({ id: 1 }), createManagedTab({ id: 2 })] }),
    ];
    const { result } = renderHook(() => useTabSelection(windows));

    act(() => result.current.setTabs([1, 2], true));
    expect(result.current.selectedCount).toBe(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(result.current.selectedCount).toBe(0);
  });

  it('excludes selected IDs that disappear after a snapshot refresh', () => {
    const first = [createManagedWindow({ tabs: [createManagedTab({ id: 1 })] })];
    const second = [createManagedWindow({ tabs: [createManagedTab({ id: 2 })] })];
    const { result, rerender } = renderHook(({ windows }) => useTabSelection(windows), {
      initialProps: { windows: first },
    });

    act(() => result.current.setTabs([1], true));
    expect(result.current.selectedCount).toBe(1);

    rerender({ windows: second });
    expect(result.current.selectedCount).toBe(0);
  });
});
