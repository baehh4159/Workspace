/**
 * apps/mobile/app/login.tsx
 * 1-click Google & Kakao PKCE OAuth login screen for Expo Mobile.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { signInWithSocialOAuth } from '@/lib/supabase-mobile';

export default function MobileLoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<'google' | 'kakao' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOAuth = async (provider: 'google' | 'kakao') => {
    if (busy) return;
    setBusy(provider);
    setErrorMsg(null);
    try {
      const res = await signInWithSocialOAuth(provider);
      if (!res.ok) {
        setErrorMsg(res.error ?? '로그인에 실패했습니다.');
        return;
      }
      router.replace('/(tabs)');
    } catch {
      setErrorMsg('로그인 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>WORKSPACE</Text>
        <Text style={styles.title}>스캔부터 실행까지 한 곳에서</Text>
        <Text style={styles.subtitle}>
          가입 즉시 개인 워크스페이스가 자동 생성됩니다.{'\n'}
          모든 문서와 메모는 기본값으로 <Text style={styles.bold}>나만 보기</Text>로 저장됩니다.
        </Text>

        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Pressable
            disabled={busy !== null}
            onPress={() => void handleOAuth('google')}
            style={[styles.googleBtn, busy !== null && styles.disabled]}
          >
            <Text style={styles.googleText}>
              {busy === 'google' ? 'Google 연결 중...' : 'Google로 계속하기'}
            </Text>
          </Pressable>

          <Pressable
            disabled={busy !== null}
            onPress={() => void handleOAuth('kakao')}
            style={[styles.kakaoBtn, busy !== null && styles.disabled]}
          >
            <Text style={styles.kakaoText}>
              {busy === 'kakao' ? '카카오 연결 중...' : '카카오로 계속하기'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
    letterSpacing: 1,
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
    textAlign: 'center',
  },
  bold: { fontWeight: '700', color: '#334155' },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
  },
  errorText: { fontSize: 12, color: '#B91C1C', textAlign: 'center' },
  actions: { marginTop: 8, gap: 10 },
  googleBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  googleText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  kakaoBtn: {
    backgroundColor: '#FEE500',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  kakaoText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  disabled: { opacity: 0.6 },
});
