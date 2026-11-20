/**
 * apps/mobile/app/(tabs)/_layout.tsx
 * 3-tab mobile navigation with MobileHeaderControls (workspace switcher + logout).
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { MobileHeaderControls } from '@/components/mobile-header-controls';

export default function MobileTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTitleStyle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
        headerShadowVisible: false,
        headerRight: () => <MobileHeaderControls />,
        tabBarActiveTintColor: '#1D4ED8',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E2E8F0',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '오늘' }} />
      <Tabs.Screen name="inbox" options={{ title: '입력함' }} />
      <Tabs.Screen name="scan" options={{ title: '스캔 연동' }} />
    </Tabs>
  );
}
