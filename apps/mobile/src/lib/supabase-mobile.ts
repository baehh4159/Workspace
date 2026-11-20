/**
 * apps/mobile/src/lib/supabase-mobile.ts
 * Supabase mobile client with:
 *  - UTF-8 safe Chunked SecureStore adapter (650 chars * max 3 bytes <= 1,950 bytes < 2,048-byte limit)
 *  - Google / Kakao PKCE deep-link OAuth via expo-web-browser + expo-linking
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

WebBrowser.maybeCompleteAuthSession();

// 650 chars guarantees <= 1,950 bytes even for 100% 3-byte Hangul UTF-8 strings (< 2,048-byte cap)
const CHUNK_SIZE = 650;
const metaKey = (key: string) => `${key}__chunks`;
const chunkKey = (key: string, idx: number) => `${key}__chunk_${idx}`;

const chunkedSecureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(metaKey(key));
    if (!countRaw) {
      return SecureStore.getItemAsync(key);
    }
    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i)))
    );
    if (parts.some((p) => p === null)) return null;
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const prevCountRaw = await SecureStore.getItemAsync(metaKey(key));
    const prevCount = prevCountRaw ? Number.parseInt(prevCountRaw, 10) : 0;

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((part, i) => SecureStore.setItemAsync(chunkKey(key, i), part))
    );
    await SecureStore.setItemAsync(metaKey(key), String(chunks.length));

    if (Number.isFinite(prevCount) && prevCount > chunks.length) {
      await Promise.all(
        Array.from({ length: prevCount - chunks.length }, (_, i) =>
          SecureStore.deleteItemAsync(chunkKey(key, chunks.length + i))
        )
      );
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },

  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(metaKey(key));
    const count = countRaw ? Number.parseInt(countRaw, 10) : 0;

    const deletes: Promise<void>[] = [
      SecureStore.deleteItemAsync(metaKey(key)).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
    ];
    if (Number.isFinite(count) && count > 0) {
      for (let i = 0; i < count; i += 1) {
        deletes.push(SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => {}));
      }
    }
    await Promise.all(deletes);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase-mobile] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY'
  );
}

export const supabaseMobile = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: chunkedSecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabaseMobile.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithSocialOAuth(
  provider: 'google' | 'kakao'
): Promise<{ ok: boolean; error?: string }> {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabaseMobile.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    return { ok: false, error: '로그인 페이지를 열지 못했습니다.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) {
    return { ok: false, error: '로그인이 취소되었습니다.' };
  }

  const parsedUrl = new URL(result.url);
  const code = parsedUrl.searchParams.get('code');
  if (!code) {
    return { ok: false, error: '인증 코드를 받지 못했습니다.' };
  }

  const { error: exchangeErr } = await supabaseMobile.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return { ok: false, error: '세션 인증에 실패했습니다. 다시 시도해 주세요.' };
  }

  return { ok: true };
}
