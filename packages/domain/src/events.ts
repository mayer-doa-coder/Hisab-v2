// events.ts — AGENTS.md §3.1, §3.2. Runtime Zod validation (EVENTS.md §1
// invariant 6) and the schema-evolution upcast logic (EVENTS.md §10).
//
// types.ts is the shape authority; this file imports from it and never
// redefines a shape it already declares. Every schema below is checked
// against its corresponding types.ts interface with `satisfies`, so the two
// cannot silently drift (DECISIONS.md 2026-08-08, "Zod deferred to Phase 1").
//
// Zero I/O (AGENTS.md §3.1): buildEvent() and upcast() never generate id,
// hlc, or created_at themselves — those are always parameters (ctx). Zod
// itself does no I/O; it is pure validation.

import { z } from 'zod';
import type {
  AnyEvent,
  CommandContext,
  CreditGivenPayload,
  CustomerAddedPayload,
  CustomerArchivedPayload,
  CustomerRenamedPayload,
  EntryVoidedPayload,
  EventType,
  PayloadFor,
  PaymentReceivedPayload,
  Poisha,
  ProductAddedPayload,
  ProductArchivedPayload,
  ProductUpdatedPayload,
  ReorderSettingsSetPayload,
  SaleRecordedPayload,
  SeasonalMultiplierSetPayload,
  StockAdjustedPayload,
  StockReceivedPayload,
  StockSoldPayload,
} from './types';

// -----------------------------------------------------------------------------
// Poisha helpers. The brand is applied by `.transform()` after validating the
// raw number is an integer — the one place outside money.ts a Poisha value is
// constructed, and it is a cast on an already-validated integer, not
// arithmetic (AGENTS.md §3.2 is about arithmetic; this is type branding).
// -----------------------------------------------------------------------------
const poisha = z.number().int().transform((n) => n as Poisha);
const positivePoisha = z.number().int().positive().transform((n) => n as Poisha);

// -----------------------------------------------------------------------------
// §3 — Core events. Every field mirrors types.ts exactly.
// -----------------------------------------------------------------------------

const CustomerAddedSchema = z.object({
  schema_version: z.literal(1),
  customer_id: z.string(),
  display_name: z.string(),
  phone: z.string().nullable(),
}) satisfies z.ZodType<CustomerAddedPayload, z.ZodTypeDef, unknown>;

// zod's `.optional()` types its value as `T | undefined`; exactOptionalPropertyTypes
// requires the key to be genuinely ABSENT, not present-with-undefined. The
// `.transform()` below reconstructs the object with a conditional spread so an
// omitted `phone` in the input stays omitted in the output, and the arrow
// function's own return-type annotation is what's actually checked against
// CustomerRenamedPayload — not a `satisfies` on the pre-transform ZodObject.
const CustomerRenamedSchema = z
  .object({
    schema_version: z.literal(1),
    customer_id: z.string(),
    display_name: z.string(),
    phone: z.string().nullable().optional(),
  })
  .transform(
    (v): CustomerRenamedPayload => ({
      schema_version: v.schema_version,
      customer_id: v.customer_id,
      display_name: v.display_name,
      ...(v.phone !== undefined ? { phone: v.phone } : {}),
    }),
  );

const CustomerArchivedSchema = z.object({
  schema_version: z.literal(1),
  customer_id: z.string(),
  reason: z.enum(['DUPLICATE', 'INACTIVE', 'REQUESTED']),
}) satisfies z.ZodType<CustomerArchivedPayload, z.ZodTypeDef, unknown>;

const CreditGivenSchema = z.object({
  schema_version: z.literal(1),
  entry_id: z.string(),
  customer_id: z.string(),
  amount_poisha: positivePoisha,
  note: z.string().nullable(),
  occurred_at: z.number().nullable(),
}) satisfies z.ZodType<CreditGivenPayload, z.ZodTypeDef, unknown>;

const PaymentReceivedSchema = z.object({
  schema_version: z.literal(1),
  entry_id: z.string(),
  customer_id: z.string(),
  amount_poisha: positivePoisha,
  note: z.string().nullable(),
  occurred_at: z.number().nullable(),
}) satisfies z.ZodType<PaymentReceivedPayload, z.ZodTypeDef, unknown>;

const EntryVoidedSchema = z.object({
  schema_version: z.literal(1),
  voids_event_id: z.string(),
  reason: z.enum(['MISTAKE', 'DUPLICATE', 'DISPUTED']),
}) satisfies z.ZodType<EntryVoidedPayload, z.ZodTypeDef, unknown>;

// -----------------------------------------------------------------------------
// §4 — Inventory events. Not folded until Step 12; validated here regardless,
// per EVENTS.md §9's checklist ("Zod schema in events.ts" for every type
// already in the catalogue, independent of fold.ts's current scope).
// -----------------------------------------------------------------------------

const unitSchema = z.enum(['PIECE', 'KG', 'GRAM', 'LITRE', 'ML', 'PACKET', 'DOZEN']);

const ProductAddedSchema = z.object({
  schema_version: z.literal(1),
  product_id: z.string(),
  name: z.string(),
  unit: unitSchema,
  sale_price_poisha: poisha.nullable(),
  low_stock_threshold_units: z.number().nullable(),
}) satisfies z.ZodType<ProductAddedPayload, z.ZodTypeDef, unknown>;

// Same conditional-spread reconstruction as CustomerRenamedSchema above, for
// the same exactOptionalPropertyTypes reason — four optional fields here.
const ProductUpdatedSchema = z
  .object({
    schema_version: z.literal(1),
    product_id: z.string(),
    name: z.string().optional(),
    unit: unitSchema.optional(),
    sale_price_poisha: poisha.nullable().optional(),
    low_stock_threshold_units: z.number().nullable().optional(),
  })
  .transform(
    (v): ProductUpdatedPayload => ({
      schema_version: v.schema_version,
      product_id: v.product_id,
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.unit !== undefined ? { unit: v.unit } : {}),
      ...(v.sale_price_poisha !== undefined ? { sale_price_poisha: v.sale_price_poisha } : {}),
      ...(v.low_stock_threshold_units !== undefined
        ? { low_stock_threshold_units: v.low_stock_threshold_units }
        : {}),
    }),
  );

const ProductArchivedSchema = z.object({
  schema_version: z.literal(1),
  product_id: z.string(),
}) satisfies z.ZodType<ProductArchivedPayload, z.ZodTypeDef, unknown>;

const StockReceivedSchema = z.object({
  schema_version: z.literal(1),
  movement_id: z.string(),
  product_id: z.string(),
  quantity_units: z.number().positive(),
  cost_price_poisha: poisha.nullable(),
  expiry_date: z.string().nullable(),
  occurred_at: z.number().nullable(),
}) satisfies z.ZodType<StockReceivedPayload, z.ZodTypeDef, unknown>;

const StockSoldSchema = z.object({
  schema_version: z.literal(1),
  movement_id: z.string(),
  product_id: z.string(),
  quantity_units: z.number().positive(),
  sale_price_poisha: poisha,
  sale_id: z.string().nullable(),
  occurred_at: z.number().nullable(),
}) satisfies z.ZodType<StockSoldPayload, z.ZodTypeDef, unknown>;

const StockAdjustedSchema = z.object({
  schema_version: z.literal(1),
  movement_id: z.string(),
  product_id: z.string(),
  delta_units: z.number(), // signed — can be negative
  reason: z.enum(['DAMAGE', 'EXPIRY', 'COUNT_CORRECTION', 'GIFT', 'OTHER']),
  note: z.string().nullable(),
}) satisfies z.ZodType<StockAdjustedPayload, z.ZodTypeDef, unknown>;

const SaleRecordedSchema = z.object({
  schema_version: z.literal(1),
  sale_id: z.string(),
  customer_id: z.string().nullable(),
  total_poisha: poisha,
  payment_method: z.enum(['CASH', 'CREDIT', 'MIXED']),
  cash_paid_poisha: poisha,
  occurred_at: z.number().nullable(),
}) satisfies z.ZodType<SaleRecordedPayload, z.ZodTypeDef, unknown>;

// -----------------------------------------------------------------------------
// §5 — Configuration events.
// -----------------------------------------------------------------------------

const SeasonalMultiplierSetSchema = z.object({
  schema_version: z.literal(1),
  product_id: z.string().nullable(),
  season: z.enum(['RAMADAN', 'EID_UL_FITR', 'EID_UL_ADHA', 'MONSOON', 'HARVEST']),
  multiplier: z.number(),
}) satisfies z.ZodType<SeasonalMultiplierSetPayload, z.ZodTypeDef, unknown>;

const ReorderSettingsSetSchema = z.object({
  schema_version: z.literal(1),
  product_id: z.string().nullable(),
  lead_time_days: z.number().nullable(),
  service_level: z.number().min(0).max(1).nullable(),
}) satisfies z.ZodType<ReorderSettingsSetPayload, z.ZodTypeDef, unknown>;

// -----------------------------------------------------------------------------
// Registry — one entry per EventType. `satisfies Record<EventType, ...>`
// means adding a new event type to types.ts without a schema here fails
// typecheck, not silently.
// -----------------------------------------------------------------------------
const schemaFor = {
  CUSTOMER_ADDED: CustomerAddedSchema,
  CUSTOMER_RENAMED: CustomerRenamedSchema,
  CUSTOMER_ARCHIVED: CustomerArchivedSchema,
  CREDIT_GIVEN: CreditGivenSchema,
  PAYMENT_RECEIVED: PaymentReceivedSchema,
  ENTRY_VOIDED: EntryVoidedSchema,
  PRODUCT_ADDED: ProductAddedSchema,
  PRODUCT_UPDATED: ProductUpdatedSchema,
  PRODUCT_ARCHIVED: ProductArchivedSchema,
  STOCK_RECEIVED: StockReceivedSchema,
  STOCK_SOLD: StockSoldSchema,
  STOCK_ADJUSTED: StockAdjustedSchema,
  SALE_RECORDED: SaleRecordedSchema,
  SEASONAL_MULTIPLIER_SET: SeasonalMultiplierSetSchema,
  REORDER_SETTINGS_SET: ReorderSettingsSetSchema,
} as const satisfies Record<EventType, z.ZodType>;

function isEventType(type: string): type is EventType {
  return Object.hasOwn(schemaFor, type);
}

// -----------------------------------------------------------------------------
// buildEvent — the write-time validation gate (EVENTS.md §1 invariant 6).
// `type` is a plain `string`, not `EventType`, because the whole point of
// this function is validating input that has NOT yet been proven safe — a
// freshly-typed call site and a deserialized-JSON call site both go through
// exactly this gate. id/hlc/created_at/etc. are read only from `ctx`, never
// generated here (AGENTS.md §3.1); `synced_at` is always `null` because that
// is what "just built, not yet pushed" means, a fixed value, not a read.
// -----------------------------------------------------------------------------
export interface ValidationError {
  readonly kind: 'VALIDATION_ERROR';
  readonly type: string;
  readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
}

export function buildEvent(
  type: string,
  payload: unknown,
  ctx: CommandContext,
): AnyEvent | ValidationError {
  if (!isEventType(type)) {
    return {
      kind: 'VALIDATION_ERROR',
      type,
      issues: [{ path: ['type'], message: `Unrecognized event type: ${type}` }],
    };
  }

  const schema = schemaFor[type];
  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      kind: 'VALIDATION_ERROR',
      type,
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };
  }

  // `type` is narrowed to a specific EventType member here, but `schemaFor`'s
  // index access can't carry that narrowing through to `result.data`'s
  // static type — the same correlation gap `AnyEvent` exists to name in
  // types.ts. The cast is the accepted mechanism for it, not a shortcut.
  return {
    id: ctx.event_id,
    device_id: ctx.device_id,
    seq: ctx.seq,
    hlc: ctx.hlc,
    shop_id: ctx.shop_id,
    type,
    payload: result.data,
    created_at: ctx.created_at,
    synced_at: null,
  } as AnyEvent;
}

// -----------------------------------------------------------------------------
// upcast — EVENTS.md §10. Read-time schema migration, the opposite direction
// from buildEvent: it runs on previously-stored payloads that were valid
// under an older schema_version, never on fresh input. Every payload in the
// catalogue is still schema_version 1 today, so every branch is currently an
// identity transform — this function exists so the first real migration is
// an additive case, not a rewrite (EVENTS.md §10's own rule: "fields are
// never removed, only deprecated and ignored").
//
// An unrecognized schema_version here is not a validation failure the way a
// bad user input is (that is buildEvent's job, and it returns errors as
// values) — it means either corrupted storage or a genuinely missing
// migration, i.e. a programmer/deployment error. AGENTS.md §6 permits
// throwing for that case: "Exceptions are reserved for programmer error."
// -----------------------------------------------------------------------------
export function upcast<T extends EventType>(type: T, payload: unknown): PayloadFor<T> {
  const version = (payload as { schema_version?: unknown }).schema_version;
  if (version !== 1) {
    throw new Error(
      `upcast: ${type} has unrecognized schema_version ${String(version)} — no migration defined yet`,
    );
  }
  return payload as PayloadFor<T>;
}
