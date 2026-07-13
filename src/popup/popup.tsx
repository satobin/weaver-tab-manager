import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Popup } from './PopupView';
import './popup.css';

const root = document.querySelector('#popup-root');

if (!root) {
  throw new Error('Missing popup root element.');
}

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
