export const OPEN_APP_MESSAGE = 'weaver:open-app';

export interface OpenAppMessage {
  type: typeof OPEN_APP_MESSAGE;
  route?: string;
}

export type OpenAppResponse = { ok: true } | { error: string; ok: false };

export function isOpenAppResponse(value: unknown): value is OpenAppResponse {
  if (!value || typeof value !== 'object' || !('ok' in value)) {
    return false;
  }
  if (value.ok === true) {
    return true;
  }
  return value.ok === false && 'error' in value && typeof value.error === 'string';
}

export function isOpenAppMessage(value: unknown): value is OpenAppMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === OPEN_APP_MESSAGE
  );
}
