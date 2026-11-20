/**
 * apps/mobile/src/lib/push-notifications.ts
 * Registers/unregisters Expo Push Tokens with POST/DELETE /api/push/register.
 * Passes EAS projectId required by Expo SDK 52 getExpoPushTokenAsync().
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  registerExpoPushToken,
  unregisterExpoPushToken,
} from '@/lib/workspace-api';

const LAST_PUSH_TOKEN_KEY = 'ws_last_expo_push_token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function resolveEasProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? undefined;
}

export async function registerDeviceForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const projectId = resolveEasProjectId();
  if (!projectId) {
    console.warn('[push-notifications] Missing EAS projectId in app.json (extra.eas.projectId)');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '기본 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
  const expoPushToken = tokenRes.data;
  if (!expoPushToken) return null;

  await registerExpoPushToken({
    expoPushToken,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    deviceName: Device.modelName ?? undefined,
  });

  await AsyncStorage.setItem(LAST_PUSH_TOKEN_KEY, expoPushToken);
  return expoPushToken;
}

export async function unregisterDevicePushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(LAST_PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await unregisterExpoPushToken(token);
  } catch {
    // Best-effort cleanup on logout
  } finally {
    await AsyncStorage.removeItem(LAST_PUSH_TOKEN_KEY).catch(() => {});
  }
}
