// ArchiveCustomerAction.tsx — the minimal UI entry point for the
// CUSTOMER_ARCHIVED erasure path. Step 11 audit item 7, same "functional
// now, refine later" allowance as Step 10's PinScreen.
//
// OWNERSHIP, flagged exactly like PinScreen was: this is a UI component and
// naturally belongs beside a customer-detail SCREEN, which is B's
// (apps/mobile/src/screens/) and does not exist yet (Step 8 has not run).
// Placed in apps/mobile/src/data/ — A's directory per .github/CODEOWNERS —
// as a self-contained, screen-agnostic component B can drop into a real
// customer-detail screen once one exists, the same call CLAUDE.md's "stop
// and say so" produced for the PIN screen.
//
// WHAT THIS DOES: one button, one reason picker (three options matching
// CustomerArchiveReason), one tap to confirm — no second confirmation
// dialog (AGENTS.md §3.5 is about high-frequency actions specifically, and
// archiving a customer is rare and already deliberate, so a SINGLE explicit
// step — picking the reason — is the confirmation; a second "are you sure"
// on top of that would be exactly the over-confirmation CLAUDE.md warns
// against for a low-frequency but not accidental-prone action).
//
// WHAT THIS DELIBERATELY DOES NOT DO: no undo (ENTRY_VOIDED cannot target
// CUSTOMER_ARCHIVED's effect the way it targets a credit/payment — there is
// no CUSTOMER_UNARCHIVED event by design, per EVENTS.md §3's own note on
// widening ENTRY_VOIDED's target). No bulk archive. No "why are you
// archiving them" free-text field beyond the three fixed reasons — a free
// text field is exactly the data-minimisation problem SECURITY.md §6 warns
// about for a person who isn't a user of this app. No styling beyond the
// existing design-system primitives; no i18n keys added here — the caller
// supplies display strings, matching PinScreen's own boundary (this
// component never calls t() itself).

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CustomerArchiveReason } from '@hisab/domain';
import { fontFamily, fontSize, minTouchTarget, spacing } from '../ui/typography';
import { archiveCustomer, type ArchiveCustomerResult } from './archiveCustomer';
import type { EventStore } from './eventStore';
import type { Database } from './db';

const REASONS: readonly CustomerArchiveReason[] = ['DUPLICATE', 'INACTIVE', 'REQUESTED'];

export interface ArchiveCustomerActionStrings {
  readonly prompt: string;
  readonly reasonLabel: Record<CustomerArchiveReason, string>;
  readonly confirm: string;
  readonly unknownCustomer: string;
  readonly failed: string;
}

export interface ArchiveCustomerActionProps {
  readonly db: Database;
  readonly store: EventStore;
  readonly customerId: string;
  readonly strings: ArchiveCustomerActionStrings;
  readonly onArchived: () => void;
}

export function ArchiveCustomerAction({
  db,
  store,
  customerId,
  strings,
  onArchived,
}: ArchiveCustomerActionProps) {
  const [reason, setReason] = useState<CustomerArchiveReason>('REQUESTED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result: ArchiveCustomerResult = await archiveCustomer(db, store, customerId, reason);
      if (result.kind === 'OK') {
        onArchived();
        return;
      }
      setError(result.kind === 'UNKNOWN_CUSTOMER' ? strings.unknownCustomer : strings.failed);
    } finally {
      setBusy(false);
    }
  }, [db, store, customerId, reason, onArchived, strings]);

  return (
    <View style={styles.container}>
      <Text style={styles.prompt}>{strings.prompt}</Text>

      <View style={styles.reasons}>
        {REASONS.map((r) => (
          <Pressable
            key={r}
            accessibilityRole="radio"
            accessibilityState={{ checked: reason === r }}
            onPress={() => setReason(r)}
            style={[styles.reasonRow, reason === r && styles.reasonRowSelected]}
          >
            <Text style={styles.reasonLabel}>{strings.reasonLabel[r]}</Text>
          </Pressable>
        ))}
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={[styles.confirmButton, busy && styles.disabled]}
      >
        <Text style={styles.confirmLabel}>{strings.confirm}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  prompt: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: fontSize.md * 1.6,
    color: '#14231C',
  },
  reasons: { gap: spacing.xs },
  reasonRow: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8DED9',
  },
  reasonRowSelected: {
    borderColor: '#1B6E4A',
    backgroundColor: '#F1F4F2',
  },
  reasonLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: '#14231C',
  },
  error: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#8A3324',
  },
  confirmButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#8A3324',
  },
  disabled: { opacity: 0.6 },
  confirmLabel: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: '#FFFFFF',
  },
});
