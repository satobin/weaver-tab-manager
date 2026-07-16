import { APP_ROUTES } from '../app/routes';
import { focusOrOpenApp } from '../platform/chrome/openApp';
import { protectLocalStorage } from '../platform/chrome/protectLocalStorage';
import { createRestoredTabMetadataService } from '../platform/chrome/restoredTabMetadata';
import { isOpenAppMessage } from '../shared/messages';
import { installRestoredTabMetadataListeners } from './restoredTabMetadataListeners';

const restoredTabMetadataService = createRestoredTabMetadataService(chrome);

function reportBackgroundFailure(context: string, error: unknown) {
  console.error(`[Weaver] ${context}`, error);
}

function runBackgroundTask(context: string, operation: Promise<unknown>) {
  void operation.catch((error: unknown) => reportBackgroundFailure(context, error));
}

runBackgroundTask('Could not protect local storage.', protectLocalStorage());

chrome.runtime.onInstalled.addListener(() => {
  runBackgroundTask('Could not protect local storage after installation.', protectLocalStorage());
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-manager') {
    runBackgroundTask(
      'Could not open the window manager from its command.',
      focusOrOpenApp(chrome, APP_ROUTES.windows),
    );
  }
});

installRestoredTabMetadataListeners(chrome, restoredTabMetadataService);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOpenAppMessage(message)) {
    return false;
  }

  void focusOrOpenApp(chrome, message.route)
    .then(
      () => sendResponse({ ok: true }),
      (error: unknown) => {
        reportBackgroundFailure('Could not open the window manager.', error);
        sendResponse({ error: 'The browser could not open the Window Manager.', ok: false });
      },
    )
    .catch((error: unknown) => reportBackgroundFailure('Could not reply to the popup.', error));
  return true;
});
