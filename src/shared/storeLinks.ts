const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/weaver-window-tab-manager/lchcjicakojjacjpleolmjcjlppaeobn';
const EDGE_ADDONS_URL =
  'https://microsoftedge.microsoft.com/addons/detail/weaver-window-tab-man/fncihblgmobedbbbnbdhabmjnphdoddh';

export type StoreTarget = 'chrome' | 'edge';

export function getStoreReviewUrl(target: StoreTarget): string {
  return target === 'edge' ? EDGE_ADDONS_URL : CHROME_WEB_STORE_URL;
}

// The Edge package must not direct users to another browser's extension store.
export const STORE_REVIEW_URL = getStoreReviewUrl(
  import.meta.env.MODE === 'edge' ? 'edge' : 'chrome',
);
