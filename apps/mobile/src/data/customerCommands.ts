// customerCommands.ts — the write side of the six core screens: add a
// customer, record a credit or payment, undo one.
//
// Same pattern archiveCustomer.ts already established: generate the id with
// uuidv7, call store.append() directly. This does NOT route through
// commands.ts's applyCredit/applyPayment — that gap is pre-existing across
// all four command functions (DECISIONS.md 2026-08-15, "applyArchiveCustomer
// added to the domain layer; a pre-existing gap found while wiring it") and
// fixing it (deciding whether append() itself should call into commands.ts
// for every type) is out of this step's scope, same as it was then.
// buildEvent's own Zod schema still enforces amount_poisha > 0 either way.

import type { Poisha, VoidReason } from '@hisab/domain';
import type { EventStore } from './eventStore';
import { uuidv7, type GetRandomBytes } from './uuid';

export interface CustomerCommandsConfig {
  readonly getRandomBytes: GetRandomBytes;
  readonly now?: () => number;
}

export type AddCustomerResult =
  | { readonly kind: 'OK'; readonly customerId: string }
  | { readonly kind: 'VALIDATION_ERROR' };

export type RecordEntryResult =
  | { readonly kind: 'OK'; readonly eventId: string }
  | { readonly kind: 'VALIDATION_ERROR' };

export type VoidEntryResult = { readonly kind: 'OK' } | { readonly kind: 'VALIDATION_ERROR' };

export interface CustomerCommands {
  addCustomer(displayName: string, phone: string | null): Promise<AddCustomerResult>;
  recordEntry(
    kind: 'CREDIT' | 'PAYMENT',
    customerId: string,
    amountPoisha: Poisha,
  ): Promise<RecordEntryResult>;
  voidEntry(eventId: string, reason: VoidReason): Promise<VoidEntryResult>;
}

export function createCustomerCommands(
  store: EventStore,
  config: CustomerCommandsConfig,
): CustomerCommands {
  const now = config.now ?? Date.now;

  return {
    async addCustomer(displayName, phone) {
      const customerId = uuidv7(now(), config.getRandomBytes);
      const result = await store.append('CUSTOMER_ADDED', {
        schema_version: 1,
        customer_id: customerId,
        display_name: displayName,
        phone,
      });
      return 'kind' in result ? { kind: 'VALIDATION_ERROR' } : { kind: 'OK', customerId };
    },

    async recordEntry(kind, customerId, amountPoisha) {
      const entryId = uuidv7(now(), config.getRandomBytes);
      const type = kind === 'CREDIT' ? 'CREDIT_GIVEN' : 'PAYMENT_RECEIVED';
      const result = await store.append(type, {
        schema_version: 1,
        entry_id: entryId,
        customer_id: customerId,
        amount_poisha: amountPoisha,
        note: null,
        occurred_at: null,
      });
      return 'kind' in result ? { kind: 'VALIDATION_ERROR' } : { kind: 'OK', eventId: result.id };
    },

    async voidEntry(eventId, reason) {
      const result = await store.append('ENTRY_VOIDED', {
        schema_version: 1,
        voids_event_id: eventId,
        reason,
      });
      return 'kind' in result ? { kind: 'VALIDATION_ERROR' } : { kind: 'OK' };
    },
  };
}
