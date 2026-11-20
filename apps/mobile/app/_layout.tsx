/**
 * apps/mobile/app/_layout.tsx
 * Root Expo Router Stack:
 *  - Guards authenticated tabs vs /login
 *  - Registers Expo Push Token when authenticated
 *  - Runs automatic foreground offline-queue sync
 */
import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import { useOfflineQueueSync } from '@/lib/offline-queue';
import { registerDeviceForPushNotifications } from '@/lib/push-notifications';

function RootNavigationGate() {
  const router = useRouter();
  const segments = useSegments();
  const { loading, isAuthenticated } = useWorkspace();

  useOfflineQueueSync(isAuthenticated);

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    const isAuthRoute = first === 'login' || first === 'scan-ingest';

    if (!isAuthenticated && !isAuthRoute) {
      router.replace('/login');
    } else if (isAuthenticated && first === 'login') {
      router.replace('/(tabs)');
    }
  }, [loading, isAuthenticated, segments, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void registerDeviceForPushNotifications().catch(() => {});
  }, [isAuthenticated]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="scan-ingest" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <WorkspaceProvider>
      <StatusBar style="dark" />
      <RootNavigationGate />
    </WorkspaceProvider>
  );
}
