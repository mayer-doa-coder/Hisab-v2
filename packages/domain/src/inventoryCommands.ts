// inventoryCommands.ts — EVENTS.md §4. addProduct, receiveStock, recordSale,
// adjustStock.
//
// Same contract as commands.ts and written to match it line for line: errors
// are values, never thrown (AGENTS.md §6); envelope assembly and payload
// validation are delegated entirely to events.ts's buildEvent(), never
// hand-rolled; and ids, seq, hlc and created_at all arrive in a
// CommandContext, because generating them would be I/O (AGENTS.md §3.1).
//
// Split out of commands.ts rather than appended to it: commands.ts is the
// six core events and the hot path, this is Phase 4.
//
// WHAT THESE FUNCTIONS DELIBERATELY DO NOT CHECK
//
// Not that the product exists — applyCredit does not check the customer
// exists either, and under offline sync the PRODUCT_ADDED may not have
// arrived on this device yet.
//
// Not that there is enough stock on hand. EVENTS.md §8: "Anomaly detection
// never blocks a write." Selling the last bag of rice twice while offline
// produces a negative quantity, `detectAnomalies` reports NEGATIVE_STOCK
// after the fold, and the shopkeeper resolves it. Refusing the write would
// mean refusing to record goods that have already left the shop.
//
// Not that the sale's line items sum to `total_poisha`. EVENTS.md §4 is
// explicit that the total is what the shopkeeper and the customer agreed at
// the counter — "a fact about the past, not a cache of a calculation" — and
// that if they disagree, the total is right and the line items are wrong.
// There is a test asserting a mismatched sale still succeeds.

import { buildEvent } from './events';
import { subtract } from './money';
import { parseIsoDateUtc } from './inventory';
import type {
  AddProductCommand,
  AdjustStockCommand,
  AnyEvent,
  ApplyAddProduct,
  ApplyAdjustStock,
  ApplyReceiveStock,
  ApplyRecordSale,
  CommandContext,
  DomainError,
  Poisha,
  RecordSaleCommand,
} from './types';

function validationErrorToDomainError(
  eventLabel: string,
  fallbackCode: DomainError['code'],
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): DomainError {
  return {
    code: fallbackCode,
    message: `${eventLabel} payload failed validation: ${issues.map((i) => i.message).join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// addProduct
// ---------------------------------------------------------------------------

/**
 * `low_stock_threshold_units` of 0 is meaningful and allowed — it means "tell
 * me only when it runs out" (stockLevel returns OUT at 0, and never LOW below
 * a 0 threshold). Only a negative threshold is rejected.
 */
export const addProduct: ApplyAddProduct = (_state, cmd: AddProductCommand) => {
  if (cmd.name.trim() === '') {
    return { code: 'NAME_EMPTY', message: 'PRODUCT_ADDED name must not be blank.' };
  }
  if (cmd.sale_price_poisha !== null && cmd.sale_price_poisha <= 0) {
    return {
      code: 'AMOUNT_NOT_POSITIVE',
      message: 'PRODUCT_ADDED sale_price_poisha must be a positive integer, or null.',
    };
  }
  if (cmd.low_stock_threshold_units !== null && cmd.low_stock_threshold_units < 0) {
    return {
      code: 'THRESHOLD_NEGATIVE',
      message: 'PRODUCT_ADDED low_stock_threshold_units must be >= 0, or null.',
    };
  }

  const built = buildEvent(
    'PRODUCT_ADDED',
    {
      schema_version: 1,
      product_id: cmd.product_id,
      name: cmd.name,
      unit: cmd.unit,
      sale_price_poisha: cmd.sale_price_poisha,
      low_stock_threshold_units: cmd.low_stock_threshold_units,
    },
    cmd.ctx,
  );
  if ('kind' in built) {
    return validationErrorToDomainError('PRODUCT_ADDED', 'AMOUNT_NOT_INTEGER', built.issues);
  }
  return [built];
};

// ---------------------------------------------------------------------------
// receiveStock
// ---------------------------------------------------------------------------

/**
 * `quantity_units` is not required to be an integer: `unit` can be KG, GRAM,
 * LITRE or ML, so 1.5 is a legitimate receipt. Only `_poisha` fields are
 * integers (EVENTS.md §2), and the Zod schema enforces that separately.
 *
 * `expiry_date` is validated for shape here because the schema types it as a
 * bare `z.string()`. It is recorded and never folded — see inventory.ts's
 * expiryRisks() for the whole of what the system can honestly say about it.
 */
export const receiveStock: ApplyReceiveStock = (_state, cmd) => {
  if (!(cmd.quantity_units > 0) || !Number.isFinite(cmd.quantity_units)) {
    return {
      code: 'QUANTITY_NOT_POSITIVE',
      message: 'STOCK_RECEIVED quantity_units must be a finite positive number.',
    };
  }
  if (cmd.cost_price_poisha !== null && cmd.cost_price_poisha <= 0) {
    return {
      code: 'AMOUNT_NOT_POSITIVE',
      message: 'STOCK_RECEIVED cost_price_poisha must be a positive integer, or null.',
    };
  }
  if (cmd.expiry_date !== null && parseIsoDateUtc(cmd.expiry_date) === null) {
    return {
      code: 'INVALID_EXPIRY_DATE',
      message: `STOCK_RECEIVED expiry_date must be an ISO YYYY-MM-DD date, or null; got ${cmd.expiry_date}.`,
    };
  }

  const built = buildEvent(
    'STOCK_RECEIVED',
    {
      schema_version: 1,
      movement_id: cmd.movement_id,
      product_id: cmd.product_id,
      quantity_units: cmd.quantity_units,
      cost_price_poisha: cmd.cost_price_poisha,
      expiry_date: cmd.expiry_date,
      occurred_at: cmd.occurred_at,
    },
    cmd.ctx,
  );
  if ('kind' in built) {
    return validationErrorToDomainError('STOCK_RECEIVED', 'AMOUNT_NOT_INTEGER', built.issues);
  }
  return [built];
};

// ---------------------------------------------------------------------------
// adjustStock
// ---------------------------------------------------------------------------

/**
 * `delta_units` is signed: DAMAGE and EXPIRY are negative, GIFT is negative,
 * COUNT_CORRECTION can be either. Zero is rejected — it records nothing and
 * would only ever be a caller bug.
 */
export const adjustStock: ApplyAdjustStock = (_state, cmd: AdjustStockCommand) => {
  if (cmd.delta_units === 0 || !Number.isFinite(cmd.delta_units)) {
    return {
      code: 'DELTA_IS_ZERO',
      message: 'STOCK_ADJUSTED delta_units must be a finite non-zero number.',
    };
  }

  const built = buildEvent(
    'STOCK_ADJUSTED',
    {
      schema_version: 1,
      movement_id: cmd.movement_id,
      product_id: cmd.product_id,
      delta_units: cmd.delta_units,
      reason: cmd.reason,
      note: cmd.note,
    },
    cmd.ctx,
  );
  if ('kind' in built) {
    return validationErrorToDomainError('STOCK_ADJUSTED', 'AMOUNT_NOT_INTEGER', built.issues);
  }
  return [built];
};

// ---------------------------------------------------------------------------
// recordSale — the multi-event command
// ---------------------------------------------------------------------------

/**
 * The credit portion of a sale: what was agreed minus what was handed over.
 * Goes through money.ts because it is arithmetic on money (AGENTS.md §3.2),
 * which the eslint poishaArithmeticGuard also enforces on this file.
 */
function creditPortion(cmd: RecordSaleCommand): Poisha {
  return subtract(cmd.total_poisha, cmd.cash_paid_poisha);
}

/**
 * How many events `recordSale` will emit, and therefore how many
 * `CommandContext`s it needs:
 *
 *     1 SALE_RECORDED
 *   + 1 STOCK_SOLD per line item
 *   + 1 CREDIT_GIVEN, only when cash paid is short of the total
 *
 * The familiar "three-event" case is a single-line-item credit sale. A cash
 * sale of one item is two events; a four-item credit sale is six. Exported
 * because the data layer allocates `seq` one value at a time against
 * `UNIQUE (device_id, seq)` (see eventStore.ts's nextSeq chain) and has to
 * know how many to draw BEFORE it calls this function.
 *
 * Safe to call on an invalid command: it never throws, and recordSale
 * re-validates everything anyway.
 */
export function saleEventCount(cmd: RecordSaleCommand): number {
  return 1 + cmd.line_items.length + (creditPortion(cmd) > 0 ? 1 : 0);
}

/**
 * EVENTS.md §4: "A MIXED or CREDIT sale emits both a SALE_RECORDED and a
 * CREDIT_GIVEN in the same batch, sharing occurred_at. The domain layer
 * produces both from one command; the UI never emits two separately."
 *
 * Returned in emission order: SALE_RECORDED, then one STOCK_SOLD per line item
 * in the order given, then CREDIT_GIVEN if there is one. All of them carry the
 * command's single `occurred_at`, which is what makes them one transaction in
 * the log rather than three things that happened to arrive together.
 *
 * The caller supplies exactly `saleEventCount(cmd)` contexts and this function
 * consumes them in that order. A count mismatch is an error rather than a
 * silent slice, because the alternative failure — reusing or skipping a `seq` —
 * either collides on `UNIQUE (device_id, seq)` at insert time or leaves a
 * permanent hole in the device's sequence.
 */
export const recordSale: ApplyRecordSale = (_state, cmd) => {
  if (cmd.line_items.length === 0) {
    return {
      code: 'NO_LINE_ITEMS',
      message: 'SALE_RECORDED must have at least one line item.',
    };
  }
  for (const item of cmd.line_items) {
    if (!(item.quantity_units > 0) || !Number.isFinite(item.quantity_units)) {
      return {
        code: 'QUANTITY_NOT_POSITIVE',
        message: `STOCK_SOLD quantity_units must be a finite positive number (line item ${item.movement_id}).`,
      };
    }
  }
  if (cmd.total_poisha <= 0) {
    // A giveaway is not a zero-value sale: STOCK_ADJUSTED carries a GIFT reason
    // for exactly that, and routing it through here would put a ৳0 line in the
    // customer's history that neither party agreed to.
    return {
      code: 'AMOUNT_NOT_POSITIVE',
      message: 'SALE_RECORDED total_poisha must be positive. For a giveaway use STOCK_ADJUSTED with reason GIFT.',
    };
  }
  if (cmd.cash_paid_poisha < 0 || cmd.cash_paid_poisha > cmd.total_poisha) {
    return {
      code: 'CASH_PAID_OUT_OF_RANGE',
      message: 'SALE_RECORDED cash_paid_poisha must be between 0 and total_poisha inclusive.',
    };
  }

  const credit = creditPortion(cmd);

  // Coherence between the declared method and the numbers. Not a state check —
  // this is the "could never be valid in any state" kind that SECURITY.md §5
  // says the server may reject too. Without it a payment_method of CASH could
  // silently emit a CREDIT_GIVEN, putting a debt on a customer who paid in
  // full.
  const methodMatches =
    cmd.payment_method === 'CASH'
      ? credit === 0
      : cmd.payment_method === 'CREDIT'
        ? cmd.cash_paid_poisha === 0
        : credit > 0 && cmd.cash_paid_poisha > 0; // MIXED: some cash, some credit
  if (!methodMatches) {
    return {
      code: 'PAYMENT_METHOD_INCONSISTENT',
      message: `SALE_RECORDED payment_method ${cmd.payment_method} does not match cash_paid_poisha against total_poisha.`,
    };
  }

  if (credit > 0 && cmd.customer_id === null) {
    return {
      code: 'CUSTOMER_REQUIRED_FOR_CREDIT',
      message: 'A sale that leaves credit outstanding needs a customer_id; baki cannot be owed by a walk-in.',
    };
  }
  if (credit > 0 && cmd.credit_entry_id === null) {
    return {
      code: 'CREDIT_ENTRY_ID_REQUIRED',
      message: 'A sale that leaves credit outstanding needs credit_entry_id for the CREDIT_GIVEN it emits.',
    };
  }

  const expected = saleEventCount(cmd);
  if (cmd.ctxs.length !== expected) {
    return {
      code: 'CONTEXT_COUNT_MISMATCH',
      message: `recordSale needs exactly ${expected} CommandContexts (see saleEventCount), got ${cmd.ctxs.length}.`,
    };
  }

  const events: AnyEvent[] = [];
  const nextCtx = (index: number): CommandContext => {
    const ctx = cmd.ctxs[index];
    if (ctx === undefined) {
      throw new Error('unreachable: ctxs.length was checked against saleEventCount above');
    }
    return ctx;
  };

  const sale = buildEvent(
    'SALE_RECORDED',
    {
      schema_version: 1,
      sale_id: cmd.sale_id,
      customer_id: cmd.customer_id,
      total_poisha: cmd.total_poisha,
      payment_method: cmd.payment_method,
      cash_paid_poisha: cmd.cash_paid_poisha,
      occurred_at: cmd.occurred_at,
    },
    nextCtx(0),
  );
  if ('kind' in sale) {
    return validationErrorToDomainError('SALE_RECORDED', 'AMOUNT_NOT_INTEGER', sale.issues);
  }
  events.push(sale);

  for (const [i, item] of cmd.line_items.entries()) {
    const sold = buildEvent(
      'STOCK_SOLD',
      {
        schema_version: 1,
        movement_id: item.movement_id,
        product_id: item.product_id,
        quantity_units: item.quantity_units,
        sale_price_poisha: item.sale_price_poisha,
        sale_id: cmd.sale_id,
        occurred_at: cmd.occurred_at,
      },
      nextCtx(1 + i),
    );
    if ('kind' in sold) {
      return validationErrorToDomainError('STOCK_SOLD', 'AMOUNT_NOT_INTEGER', sold.issues);
    }
    events.push(sold);
  }

  if (credit > 0) {
    if (cmd.customer_id === null || cmd.credit_entry_id === null) {
      throw new Error('unreachable: both were checked above when credit > 0');
    }
    const given = buildEvent(
      'CREDIT_GIVEN',
      {
        schema_version: 1,
        entry_id: cmd.credit_entry_id,
        customer_id: cmd.customer_id,
        amount_poisha: credit,
        note: cmd.note,
        occurred_at: cmd.occurred_at,
      },
      nextCtx(1 + cmd.line_items.length),
    );
    if ('kind' in given) {
      return validationErrorToDomainError('CREDIT_GIVEN', 'AMOUNT_NOT_INTEGER', given.issues);
    }
    events.push(given);
  }

  return events;
};
