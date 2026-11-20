/**
 * apps/mobile/src/components/mobile-header-controls.tsx
 * Compact workspace switcher modal + logout action mounted in tab headerRight.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabaseMobile } from '@/lib/supabase-mobile';
import { useWorkspace } from '@/lib/workspace-context';
import { unregisterDevicePushToken } from '@/lib/push-notifications';

export function MobileHeaderControls() {
  const router = useRouter();
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!activeWorkspace) return null;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await unregisterDevicePushToken();
      await supabaseMobile.auth.signOut();
      setOpen(false);
      router.replace('/login');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable onPress={() => setOpen(true)} style={styles.pill}>
        <Text numberOfLines={1} style={styles.pillText}>
          {activeWorkspace.type === 'team' ? `[팀] ${activeWorkspace.name}` : `[개인] ${activeWorkspace.name}`} ▾
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>워크스페이스 전환</Text>

            <View style={styles.list}>
              {workspaces.map((ws) => {
                const selected = ws.id === activeWorkspace.id;
                return (
                  <Pressable
                    key={ws.id}
                    onPress={() => {
                      selectWorkspace(ws.id);
                      setOpen(false);
                    }}
                    style={[styles.wsItem, selected && styles.wsItemSelected]}
                  >
                    <Text style={[styles.wsName, selected && styles.wsNameSelected]}>
                      {ws.type === 'team' ? `[팀] ${ws.name}` : `[개인] ${ws.name}`}
                    </Text>
                    <Text style={styles.wsPlan}>{ws.plan.toUpperCase()}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              disabled={signingOut}
              onPress={() => void handleSignOut()}
              style={styles.logoutBtn}
            >
              <Text style={styles.logoutText}>{signingOut ? '로그아웃 중...' : '로그아웃'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginRight: 12 },
  pill: {
    maxWidth: 165,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: '#1E293B' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  list: { gap: 8 },
  wsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  wsItemSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  wsName: { fontSize: 13, fontWeight: '600', color: '#334155' },
  wsNameSelected: { color: '#1D4ED8' },
  wsPlan: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  logoutBtn: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingVertical: 10,
    alignItems: 'center',
  },
  logoutText: { fontSize: 13, fontWeight: '600', color: '#B91C1C' },
});
