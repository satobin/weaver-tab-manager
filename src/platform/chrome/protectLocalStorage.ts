export interface LocalStorageAccessApi {
  storage: {
    local: {
      setAccessLevel: (accessOptions: {
        accessLevel: `${chrome.storage.AccessLevel}`;
      }) => Promise<void>;
    };
  };
}

export async function protectLocalStorage(api: LocalStorageAccessApi = chrome): Promise<void> {
  await api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
