export const OPEN_MANAGER_COMMAND = 'open-manager';

const CHROME_SHORTCUT_SETTINGS_URL = 'chrome://extensions/shortcuts';
const EDGE_SHORTCUT_SETTINGS_URL = 'edge://extensions/shortcuts';

export type ShortcutSettingsTabsApi = Pick<typeof chrome.tabs, 'create'>;

export type OpenExtensionShortcutSettingsResult =
  | { ok: true; openedUrl: string }
  | { cause: unknown; manualUrl: string; ok: false };

export type CommandShortcutState =
  | { display: string; status: 'assigned' }
  | { status: 'missing' | 'unassigned' };

export function getSuggestedOpenManagerShortcut(platform: string): string {
  return platform.toLowerCase().includes('mac') ? '⌘⇧1' : 'Ctrl+Shift+1';
}

export function formatCommandShortcut(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const compact = parts.some((part) => /command|macctrl|⌘/iu.test(part));
  const formatted = parts.map((part) => {
    switch (part.toLowerCase()) {
      case 'command':
      case '⌘':
        return '⌘';
      case 'shift':
        return compact ? '⇧' : 'Shift';
      case 'alt':
      case 'option':
        return compact ? '⌥' : 'Alt';
      case 'ctrl':
      case 'control':
      case 'macctrl':
        return compact ? '⌃' : 'Ctrl';
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
  return formatted.join(compact ? '' : '+');
}

export function getCommandShortcutState(
  commands: readonly chrome.commands.Command[],
  commandName: string,
): CommandShortcutState {
  const command = commands.find((candidate) => candidate.name === commandName);
  if (!command) {
    return { status: 'missing' };
  }
  const shortcut = command.shortcut?.trim();
  return shortcut
    ? { display: formatCommandShortcut(shortcut), status: 'assigned' }
    : { status: 'unassigned' };
}

export function getShortcutSettingsUrls(userAgent: string): readonly [string, ...string[]] {
  return /\bEdg\//u.test(userAgent)
    ? [EDGE_SHORTCUT_SETTINGS_URL, CHROME_SHORTCUT_SETTINGS_URL]
    : [CHROME_SHORTCUT_SETTINGS_URL];
}

export async function openExtensionShortcutSettings(
  tabs: ShortcutSettingsTabsApi,
  userAgent: string,
): Promise<OpenExtensionShortcutSettingsResult> {
  const urls = getShortcutSettingsUrls(userAgent);
  let cause: unknown;
  for (const url of urls) {
    try {
      await tabs.create({ url });
      return { ok: true, openedUrl: url };
    } catch (error) {
      cause = error;
    }
  }
  return { cause, manualUrl: urls[0], ok: false };
}
