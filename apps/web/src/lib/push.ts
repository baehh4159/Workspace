/**
 * apps/web/src/lib/push.ts
 * Minimal Expo Push API client (https://exp.host/--/api/v2/push/send) used by the maintenance cron.
 * No SDK dependency; messages are sent in chunks of 100 as the API requires.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  channelId?: string;
}

export interface ExpoPushResult {
  to: string;
  ok: boolean;
  /** Expo error code, e.g. "DeviceNotRegistered" (the token should then be deleted). */
  error?: string;
}

interface ExpoTicket {
  status?: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export async function sendExpoPush(
  messages: ExpoPushMessage[],
  options: { accessToken?: string; fetchImpl?: typeof fetch } = {}
): Promise<ExpoPushResult[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const results: ExpoPushResult[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

    let tickets: ExpoTicket[] = [];
    try {
      const res = await doFetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(chunk) });
      if (!res.ok) {
        results.push(...chunk.map((m) => ({ to: m.to, ok: false, error: `HTTP_${res.status}` })));
        continue;
      }
      const body = (await res.json()) as { data?: ExpoTicket[] };
      tickets = Array.isArray(body.data) ? body.data : [];
    } catch {
      results.push(...chunk.map((m) => ({ to: m.to, ok: false, error: 'NETWORK_ERROR' })));
      continue;
    }

    chunk.forEach((m, idx) => {
      const ticket = tickets[idx];
      if (ticket?.status === 'ok') {
        results.push({ to: m.to, ok: true });
      } else {
        results.push({ to: m.to, ok: false, error: ticket?.details?.error ?? ticket?.message ?? 'UNKNOWN' });
      }
    });
  }

  return results;
}
