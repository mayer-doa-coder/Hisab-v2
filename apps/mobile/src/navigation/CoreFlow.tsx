// CoreFlow.tsx — the real product: Home, Customer list, Add customer,
// Record credit, Record payment, Customer detail (UI_SPEC.md's six core
// screens), wired to the real on-device event store via bootstrap.ts.
//
// A hand-rolled push/pop stack, not a navigation library — the same call
// AppShell.tsx already made for the flat Phase 4 tabs (DECISIONS.md
// 2026-08-20), extended here because this flow genuinely needs to drill down
// (Home → Who → How much → Done, Customer list → Detail → record) and back
// out again. Still no react-navigation: this is one more `useState` stack,
// not a reversal of that decision.
//
// Holds the bootstrap AppData and passes it down as plain props — not a
// context. One storage handle every screen already needs is not AGENTS.md
// §4.2's god context (~80 memoised functions over every entity loaded at
// boot); it is the same shape eventStore.ts already is.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import type { Poisha, VoidReason } from '@hisab/domain';
import type { AppData } from '../data/bootstrap';
import { createCustomerCommands } from '../data/customerCommands';
import { getCustomerRow } from '../data/customerQueries';
import { createFormatter } from '../i18n/formatter';
import { t, type Locale } from '../i18n';
import type { NumeralScript } from '../ui/formatDigits';
import type { CustomerRowVM } from '../viewmodels/customer';
import { HomeScreen } from '../screens/HomeScreen';
import { CustomerListScreen } from '../screens/CustomerListScreen';
import {
  AddCustomerScreen,
  EMPTY_ADD_CUSTOMER_DRAFT,
  type AddCustomerDraft,
} from '../screens/AddCustomerScreen';
import { RecordEntryScreen } from '../screens/RecordEntryScreen';
import { DoneScreen } from '../screens/DoneScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';

type EntryKind = 'CREDIT' | 'PAYMENT';

type ScreenState =
  | { kind: 'home' }
  | { kind: 'customerList'; mode: 'browse' | 'pick'; entryKind: EntryKind | null }
  | { kind: 'addCustomer'; entryKind: EntryKind | null }
  | {
      kind: 'recordEntry';
      entryKind: EntryKind;
      customerId: string;
      customerName: string;
      initialAmountPoisha: Poisha;
    }
  | {
      kind: 'done';
      entryKind: EntryKind;
      customerName: string;
      eventId: string;
      newBalanceDisplay: string;
    }
  | { kind: 'customerDetail'; customerId: string };

const HOME: ScreenState = { kind: 'home' };

export interface CoreFlowProps {
  appData: AppData;
}

export function CoreFlow({ appData }: CoreFlowProps) {
  const [locale] = useState<Locale>('bn');
  const [numeralScript] = useState<NumeralScript>('arabic');
  const format = useMemo(() => createFormatter(locale, numeralScript), [locale, numeralScript]);

  const [stack, setStack] = useState<ScreenState[]>([HOME]);
  const current = stack[stack.length - 1] ?? HOME;

  const [refreshToken, setRefreshToken] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const [addCustomerDraft, setAddCustomerDraft] = useState<AddCustomerDraft>(EMPTY_ADD_CUSTOMER_DRAFT);

  // FIXED — found during a whole-project audit: handleConfirmEntry and
  // handleAddCustomerSubmit both used to just `return` on a VALIDATION_ERROR
  // with nothing shown — Confirm/Save did nothing visible at all, reading as
  // a frozen app. Cleared on every navigation (push/pop/replaceTop) so a
  // stale error from a previous screen never bleeds into the next one.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const push = useCallback((screen: ScreenState) => {
    setErrorMessage(null);
    setStack((s) => [...s, screen]);
  }, []);
  const pop = useCallback(() => {
    setErrorMessage(null);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const replaceTop = useCallback((screen: ScreenState) => {
    setErrorMessage(null);
    setStack((s) => [...s.slice(0, -1), screen]);
  }, []);
  const resetToHome = useCallback(() => {
    setErrorMessage(null);
    setStack([HOME]);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const commands = useMemo(
    () => createCustomerCommands(appData.store, { getRandomBytes: appData.getRandomBytes }),
    [appData.store, appData.getRandomBytes],
  );

  const goToRecordEntry = useCallback(
    async (entryKind: EntryKind, customerId: string, knownRow: CustomerRowVM | null = null) => {
      const row = knownRow ?? (await getCustomerRow(appData.db, customerId, Date.now(), format));
      if (row === null) return;
      const initialAmountPoisha = entryKind === 'PAYMENT' ? (row.balancePoisha as Poisha) : (0 as Poisha);
      push({
        kind: 'recordEntry',
        entryKind,
        customerId: row.id,
        customerName: row.displayName,
        initialAmountPoisha,
      });
    },
    [appData.db, format, push],
  );

  const handleStartCreditEntry = useCallback(() => {
    void appData.timingLogger.log('credit_entry', 'start');
    push({ kind: 'customerList', mode: 'pick', entryKind: 'CREDIT' });
  }, [appData.timingLogger, push]);

  const handleConfirmEntry = useCallback(
    async (screen: Extract<ScreenState, { kind: 'recordEntry' }>, amountPoisha: Poisha) => {
      const result = await commands.recordEntry(screen.entryKind, screen.customerId, amountPoisha);
      if (result.kind !== 'OK') {
        setErrorMessage(t(locale, 'common', 'actionFailed'));
        return;
      }

      void appData.timingLogger.log(
        screen.entryKind === 'CREDIT' ? 'credit_entry' : 'payment_entry',
        'confirm',
      );
      bumpRefresh();

      const row = await getCustomerRow(appData.db, screen.customerId, Date.now(), format);
      replaceTop({
        kind: 'done',
        entryKind: screen.entryKind,
        customerName: screen.customerName,
        eventId: result.eventId,
        newBalanceDisplay: row?.balanceDisplay ?? '',
      });
    },
    [appData.db, appData.timingLogger, bumpRefresh, commands, format, locale, replaceTop],
  );

  const handleUndo = useCallback(
    async (screen: Extract<ScreenState, { kind: 'done' }>) => {
      const reason: VoidReason = 'MISTAKE';
      await commands.voidEntry(screen.eventId, reason);
      bumpRefresh();
      resetToHome();
    },
    [bumpRefresh, commands, resetToHome],
  );

  const handleAddCustomerSubmit = useCallback(
    async (screen: Extract<ScreenState, { kind: 'addCustomer' }>) => {
      const name = addCustomerDraft.name.trim();
      const result = await commands.addCustomer(
        name,
        addCustomerDraft.phone.trim() === '' ? null : addCustomerDraft.phone.trim(),
      );
      if (result.kind !== 'OK') {
        setErrorMessage(t(locale, 'common', 'actionFailed'));
        return;
      }
      setAddCustomerDraft(EMPTY_ADD_CUSTOMER_DRAFT);
      bumpRefresh();

      if (screen.entryKind !== null) {
        // A customer who was just added has no CREDIT_GIVEN/PAYMENT_RECEIVED
        // yet, so the starting balance is 0 regardless of entryKind — no
        // fetch needed, unlike goToRecordEntry's general case.
        replaceTop({
          kind: 'recordEntry',
          entryKind: screen.entryKind,
          customerId: result.customerId,
          customerName: name,
          initialAmountPoisha: 0 as Poisha,
        });
      } else {
        replaceTop({ kind: 'customerDetail', customerId: result.customerId });
      }
    },
    [addCustomerDraft, bumpRefresh, commands, locale, replaceTop],
  );

  switch (current.kind) {
    case 'home':
      return (
        <HomeScreen
          db={appData.db}
          format={format}
          locale={locale}
          onRecordCredit={handleStartCreditEntry}
          onViewCustomers={() => push({ kind: 'customerList', mode: 'browse', entryKind: null })}
          refreshToken={refreshToken}
        />
      );

    case 'customerList':
      return (
        <CustomerListScreen
          db={appData.db}
          format={format}
          locale={locale}
          mode={current.mode}
          refreshToken={refreshToken}
          onSelectCustomer={(customer) => {
            if (current.entryKind !== null) {
              void goToRecordEntry(current.entryKind, customer.id, customer);
            } else {
              push({ kind: 'customerDetail', customerId: customer.id });
            }
          }}
          onAddCustomer={() => push({ kind: 'addCustomer', entryKind: current.entryKind })}
          onBack={pop}
        />
      );

    case 'addCustomer':
      return (
        <AddCustomerScreen
          draft={addCustomerDraft}
          onChange={setAddCustomerDraft}
          onSubmit={() => void handleAddCustomerSubmit(current)}
          onCancel={() => {
            setAddCustomerDraft(EMPTY_ADD_CUSTOMER_DRAFT);
            pop();
          }}
          locale={locale}
          errorMessage={errorMessage}
        />
      );

    case 'recordEntry':
      return (
        <RecordEntryScreen
          entryKind={current.entryKind}
          customerName={current.customerName}
          initialAmountPoisha={current.initialAmountPoisha}
          locale={locale}
          numeralScript={numeralScript}
          onConfirm={(amountPoisha) => void handleConfirmEntry(current, amountPoisha)}
          onCancel={pop}
          errorMessage={errorMessage}
        />
      );

    case 'done':
      return (
        <DoneScreen
          entryKind={current.entryKind}
          customerName={current.customerName}
          newBalanceDisplay={current.newBalanceDisplay}
          locale={locale}
          onUndo={() => void handleUndo(current)}
          onContinue={resetToHome}
        />
      );

    case 'customerDetail':
      return (
        <CustomerDetailScreen
          db={appData.db}
          store={appData.store}
          format={format}
          locale={locale}
          customerId={current.customerId}
          refreshToken={refreshToken}
          onRecordCredit={() => void goToRecordEntry('CREDIT', current.customerId)}
          onRecordPayment={() => void goToRecordEntry('PAYMENT', current.customerId)}
          onBack={pop}
        />
      );

    default: {
      // Exhaustive over ScreenState — unreachable, kept only so a function
      // component satisfies "not all code paths return a value" under
      // noImplicitReturns without a runtime fallback UI nobody can reach.
      const _exhaustive: never = current;
      return null;
    }
  }
}
