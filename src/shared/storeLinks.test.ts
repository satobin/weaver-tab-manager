import { describe, expect, it } from 'vitest';

import { getStoreReviewUrl, STORE_REVIEW_URL } from './storeLinks';

describe('store review links', () => {
  it('selects the target browser store independently of the Vite mode name', () => {
    expect(getStoreReviewUrl('chrome')).toBe(
      'https://chromewebstore.google.com/detail/weaver-window-tab-manager/lchcjicakojjacjpleolmjcjlppaeobn',
    );
    expect(getStoreReviewUrl('edge')).toBe(
      'https://microsoftedge.microsoft.com/addons/detail/weaver-window-tab-man/fncihblgmobedbbbnbdhabmjnphdoddh',
    );
  });

  it('uses the Chrome target in the normal test build', () => {
    expect(STORE_REVIEW_URL).toBe(getStoreReviewUrl('chrome'));
  });
});
