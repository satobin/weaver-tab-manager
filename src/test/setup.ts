import '@testing-library/jest-dom/vitest';

afterEach(() => {
  window.location.hash = '';
  delete document.documentElement.dataset.colorMode;
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
});
