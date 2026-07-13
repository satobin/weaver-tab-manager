import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type ActiveWindowsDataSource } from '../features/active-windows/useActiveWindows';
import { type DedupeRule } from '../features/deduplication/deduplication';
import {
  type ColorMode,
  DEFAULT_SETTINGS,
  type SettingsService,
} from '../features/settings/settingsService';
import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../test/activeWindowsFixtures';
import { SettingsPage } from './SettingsPage';

function createActiveWindowsDataSource(): ActiveWindowsDataSource {
  return {
    loadSnapshot: vi.fn(() =>
      Promise.resolve(
        createActiveWindowsSnapshot({
          windows: [
            createManagedWindow({
              tabs: [
                createManagedTab({
                  active: true,
                  id: 101,
                  title: 'Quarterly plan',
                  url: 'https://docs.google.com/document/d/doc-id/edit?tab=t.0',
                }),
              ],
            }),
            createManagedWindow({
              focused: false,
              id: 2,
              isCurrent: false,
              label: 'Window 1',
              tabs: [
                createManagedTab({
                  active: true,
                  id: 201,
                  title: 'Quarterly plan copy',
                  url: 'https://docs.google.com/document/d/doc-id/preview#heading=one',
                  windowId: 2,
                }),
              ],
            }),
          ],
        }),
      ),
    ),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createService(
  preserveGroupsDuringSort = true,
  advancedDuplicateMatchingEnabled = true,
): SettingsService {
  const createSettings = (overrides: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
    ...DEFAULT_SETTINGS,
    advancedDuplicateMatchingEnabled,
    preserveGroupsDuringSort,
    ...overrides,
  });
  return {
    load: vi.fn(() => Promise.resolve(createSettings())),
    setAdvancedDuplicateMatchingEnabled: vi.fn((enabled: boolean) =>
      Promise.resolve(createSettings({ advancedDuplicateMatchingEnabled: enabled })),
    ),
    setColorMode: vi.fn((colorMode: ColorMode) => Promise.resolve(createSettings({ colorMode }))),
    setDeduplicationRules: vi.fn((rules: readonly DedupeRule[]) =>
      Promise.resolve(createSettings({ deduplicationRules: [...rules] })),
    ),
    setPreserveGroupsDuringSort: vi.fn((value: boolean) =>
      Promise.resolve(createSettings({ preserveGroupsDuringSort: value })),
    ),
    setShowTabUrls: vi.fn((value: boolean) =>
      Promise.resolve(createSettings({ showTabUrls: value })),
    ),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('SettingsPage', () => {
  it('loads and updates the appearance setting', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const selector = screen.getByRole('radiogroup', { name: 'Color scheme' });
    const system = within(selector).getByRole('radio', { name: 'System' });
    const dark = within(selector).getByRole('radio', { name: 'Dark' });

    await waitFor(() => expect(system).toBeEnabled());
    expect(system).toBeChecked();
    await user.click(system);
    expect(service.setColorMode).not.toHaveBeenCalled();

    await user.click(dark);

    expect(service.setColorMode).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(dark).toBeChecked());
  });

  it('loads and updates the group-preserving sort preference', async () => {
    const user = userEvent.setup();
    const service = createService(false);
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Preserve groups when sorting' });

    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(service.setPreserveGroupsDuringSort).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('loads and updates the tab URL visibility preference', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show tab URLs' });

    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(service.setShowTabUrls).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('keeps duplicate-rule fields stable while saving an unrelated preference', async () => {
    const user = userEvent.setup();
    const service = createService();
    let finishSave: (() => void) | undefined;
    vi.mocked(service.setShowTabUrls).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve({ ...DEFAULT_SETTINGS, showTabUrls: true });
        }),
    );
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show tab URLs' });
    const googlePreset = await screen.findByRole('switch', {
      name: 'Google Docs, Sheets & Slides preset',
    });

    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await waitFor(() => expect(service.setShowTabUrls).toHaveBeenCalledWith(true));

    expect(toggle).toBeDisabled();
    expect(googlePreset).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add custom rule' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'System' })).toBeEnabled();

    await act(async () => {
      finishSave?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
  });

  it('keeps the previous value and reports a failed save', async () => {
    const user = userEvent.setup();
    const service = createService(true);
    vi.mocked(service.setPreserveGroupsDuringSort).mockRejectedValue(new Error('Storage full'));
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Preserve groups when sorting' });

    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
    expect(toggle).toBeChecked();
  });

  it('persists a valid rule draft through the shared settings service', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Add custom rule' }));
    const firstPattern = screen.getByRole('textbox', { name: 'URL pattern' });

    await user.type(firstPattern, 'custom.example.com/*');
    const customRules = screen.getByRole('region', { name: 'Custom rules' });
    await user.click(within(customRules).getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(1));
    expect(service.setDeduplicationRules).toHaveBeenCalledWith([
      ...DEFAULT_SETTINGS.deduplicationRules,
      expect.objectContaining({
        glob: 'custom.example.com/*',
      }),
    ]);
  });

  it('saves presets immediately without consuming an unsaved custom draft', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Add custom rule' }));
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.type(pattern, 'draft.example.com/*');
    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));

    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(1));
    expect(pattern).toHaveValue('draft.example.com/*');
    expect(screen.getByText('Unsaved custom rule changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));
    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(2));
    const savedRules = vi.mocked(service.setDeduplicationRules).mock.calls[1]?.[0];
    expect(savedRules?.slice(0, 3).every((rule) => rule.enabled)).toBe(true);
    expect(savedRules).toContainEqual(expect.objectContaining({ glob: 'draft.example.com/*' }));
  });

  it('starts with advanced matching off and expands it without disabling exact matching', async () => {
    const user = userEvent.setup();
    const service = createService(true, false);
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = await screen.findByRole('switch', { name: 'Advanced duplicate matching' });

    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Exact full-URL duplicates always match/)).toBeInTheDocument();
    expect(screen.queryByText('Google Docs, Sheets & Slides')).not.toBeInTheDocument();
    await user.click(toggle);

    expect(service.setAdvancedDuplicateMatchingEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText('Google Docs, Sheets & Slides')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add custom rule' })).toBeInTheDocument();
  });

  it('previews the keeper and closures from open tabs using the current rules', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    expect(await screen.findByText('Google Docs, Sheets & Slides')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));
    await user.click(screen.getByRole('button', { name: /Preview matches/ }));

    const preview = screen.getByRole('region', { name: 'Duplicate match preview' });

    expect(within(preview).getByText('docs.google.com/document/d/doc-id')).toBeInTheDocument();
    expect(within(preview).getByText('Quarterly plan')).toBeInTheDocument();
    expect(within(preview).getByText('Quarterly plan copy')).toBeInTheDocument();
    expect(within(preview).getByText('Keep')).toBeInTheDocument();
    expect(within(preview).getByText('Close')).toBeInTheDocument();
  });
});
