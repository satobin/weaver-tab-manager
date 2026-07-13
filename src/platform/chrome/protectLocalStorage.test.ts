import { describe, expect, it, vi } from 'vitest';

import { protectLocalStorage, type LocalStorageAccessApi } from './protectLocalStorage';

describe('protectLocalStorage', () => {
  it('restricts local extension data to trusted extension contexts', async () => {
    const api: LocalStorageAccessApi = {
      storage: {
        local: {
          setAccessLevel: vi.fn(() => Promise.resolve()),
        },
      },
    };

    await protectLocalStorage(api);

    expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });
});
