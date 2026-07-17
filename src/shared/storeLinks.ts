const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/weaver-window-tab-manager/lchcjicakojjacjpleolmjcjlppaeobn';

// The Edge package must not direct users to another browser's extension store.
// Once Weaver has an Edge Add-ons product URL, this can select that URL for Edge builds instead.
export const STORE_REVIEW_URL = import.meta.env.MODE === 'edge' ? undefined : CHROME_WEB_STORE_URL;
