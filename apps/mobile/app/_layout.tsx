/**
 * apps/mobile/app/_layout.tsx
 * Root Expo Router Stack:
 *  - Guards authenticated tabs vs /login
 *  - Registers Expo Push Token when authenticated
 *  - Opens the matching tab when a deadline / original-expiry notification is tapped
 *  - Runs automatic foreground offline-queue sync
 */
import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
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

  // Notification taps: task reminders open Today, original-expiry warnings open the inbox.
  useEffect(() => {
    if (!isAuthenticated) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: unknown } | undefined;
      if (data?.type === 'original_expiry') {
        router.push('/(tabs)/inbox');
      } else if (data?.type === 'task_reminder') {
        router.push('/(tabs)');
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated, router]);

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
