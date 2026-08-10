// Sheet.tsx — a bottom-sheet-style container, built on React Native's core
// Modal (no external bottom-sheet dependency — nothing here justifies one
// yet, AGENTS.md §3.4). Data-free: plain primitive props only.

import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { spacing } from './typography';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ visible, onClose, children }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable style={styles.sheet} onPress={() => {}}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    minHeight: 120,
  },
});
