/**
 * apps/mobile/src/components/action-sheet-modal.tsx
 * Unified 3-Zone Mobile Long-Press / ⋯ Action Sheet matching the Web Context Menu spec.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export interface MobileActionItem {
  id: string;
  label: string;
  group: 1 | 2 | 3;
  tone?: 'default' | 'owner' | 'danger';
  onSelect: () => void;
}

export function ActionSheetModal({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: MobileActionItem[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>

          <View style={styles.list}>
            {items.map((item, idx) => {
              const prev = idx > 0 ? items[idx - 1] : null;
              const needsDivider = prev !== null && prev.group !== item.group;
              return (
                <React.Fragment key={item.id}>
                  {needsDivider && <View style={styles.divider} />}
                  <Pressable
                    onPress={() => {
                      onClose();
                      item.onSelect();
                    }}
                    style={styles.row}
                  >
                    <Text
                      style={[
                        styles.rowText,
                        item.tone === 'owner' && styles.ownerText,
                        item.tone === 'danger' && styles.dangerText,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
    padding: 14,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  list: { gap: 2 },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  row: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  rowText: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  ownerText: { color: '#115E59' },
  dangerText: { color: '#B91C1C' },
  cancelBtn: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelText: { fontSize: 13, fontWeight: '600', color: '#475569' },
});
