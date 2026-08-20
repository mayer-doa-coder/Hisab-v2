// demoLedger.ts — a DEV-ONLY synthetic event log, so the Phase 4 screens can
// be run and looked at on a real device before the data layer is wired to
// them.
//
// This is NOT seed data and must never ship as such. UI_SPEC.md's onboarding
// section is explicit: "Seed nothing. Let them add their first three customers
// and watch how they do it." Nothing here is written to SQLite, nothing is
// persisted, and nothing imports this from a production path — it exists so
// that `npm run android` shows real screens driven by the real fold instead of
// hand-written props that could disagree with what the domain actually
// produces.
//
// It goes through `fold()` deliberately. Every number the screens show is
// therefore computed by the same code path a real shop would hit: events →
// fold → viewmodel builder → ViewModelFormatter. A demo built from fake
// viewmodels would prove nothing about whether the pipeline works.

import { fold, type AnyEvent, type Poisha } from '@hisab/domain';

const DAY = 86_400_000;

/** A fixed "now" so the demo is deterministic and screenshots are comparable. */
export const DEMO_NOW = Date.UTC(2026, 7, 20, 6, 0, 0); // 2026-08-20, noon in Dhaka

let seq = 0;
function envelope(atMs: number, synced: boolean) {
  seq += 1;
  return {
    id: `demo-${seq}`,
    device_id: 'demo-device',
    seq,
    hlc: String(seq).padStart(8, '0'),
    shop_id: 'demo-shop',
    created_at: atMs,
    synced_at: synced ? atMs : null,
  };
}

function customer(name: string, daysAgo: number): AnyEvent {
  return {
    ...envelope(DEMO_NOW - daysAgo * DAY, true),
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: `c-${seq}`, display_name: name, phone: null },
  };
}

// Amounts below are POISHA, passed as plain integers and cast once here —
// never derived by multiplying a taka figure by 100 in this file. That
// multiplication is money arithmetic (AGENTS.md §3.2: "arithmetic on money
// happens only inside packages/domain/src/money.ts"), and it is not
// implementable correctly any other way here: `fromTaka` exists in money.ts
// for exactly this conversion but is deliberately NOT exported (index.ts's
// own header: "arithmetic happens only inside the domain... so add,
// subtract and fromTaka are not exported"). eslint's poishaArithmeticGuard
// does not catch a `taka * 100` written by hand, because it keys on
// identifiers ending in `_poisha` and a local variable named `taka` does
// not match — found during a whole-project audit and fixed by authoring
// every literal already in poisha, matching how
// packages/domain/test/generators.ts already generates amounts.
function credit(customerId: string, poisha: number, daysAgo: number, synced = true): AnyEvent {
  const at = DEMO_NOW - daysAgo * DAY;
  return {
    ...envelope(at, synced),
    type: 'CREDIT_GIVEN',
    payload: {
      schema_version: 1,
      entry_id: `e-${seq}`,
      customer_id: customerId,
      amount_poisha: poisha as Poisha,
      note: null,
      occurred_at: at,
    },
  };
}

function payment(customerId: string, poisha: number, daysAgo: number, synced = true): AnyEvent {
  const at = DEMO_NOW - daysAgo * DAY;
  return {
    ...envelope(at, synced),
    type: 'PAYMENT_RECEIVED',
    payload: {
      schema_version: 1,
      entry_id: `e-${seq}`,
      customer_id: customerId,
      amount_poisha: poisha as Poisha,
      note: null,
      occurred_at: at,
    },
  };
}

/**
 * A realistic small-shop set: 14 customers, a spread of balances and idle
 * times, one settled customer, one over-payment, and a mix of synced and
 * pending writes. Sized so the aging view's "needs a look" section is
 * genuinely over the cap — that is the case worth looking at on a device.
 */
export function buildDemoEvents(): AnyEvent[] {
  seq = 0;
  const events: AnyEvent[] = [];

  // owesPoisha: ৳500 = 50,000 poisha, etc. — already in poisha, per the note above.
  const people: { name: string; owesPoisha: number; idle: number }[] = [
    { name: 'রহিম ভাই', owesPoisha: 50_000, idle: 45 },
    { name: 'করিম স্টোর', owesPoisha: 320_000, idle: 62 },
    { name: 'চেয়ারম্যান সাহেব', owesPoisha: 1_200_000, idle: 91 },
    { name: 'দর্জি', owesPoisha: 25_000, idle: 38 },
    { name: 'সালমা আপা', owesPoisha: 78_000, idle: 120 },
    { name: 'মিন্টু', owesPoisha: 150_000, idle: 33 },
    { name: 'বাবুল মিয়া', owesPoisha: 64_000, idle: 4 },
    { name: 'নাসিমা', owesPoisha: 22_000, idle: 1 },
    { name: 'জসিম', owesPoisha: 410_000, idle: 9 },
    { name: 'হারুন', owesPoisha: 9_000, idle: 12 },
    { name: 'শাহিন', owesPoisha: 180_000, idle: 2 },
    { name: 'রুবেল', owesPoisha: 36_000, idle: 20 },
  ];

  for (const person of people) {
    const added = customer(person.name, person.idle + 5);
    events.push(added);
    const id = added.type === 'CUSTOMER_ADDED' ? added.payload.customer_id : '';
    // A couple of recent entries stay unsynced, so the per-row sync dot has
    // something to show (UI_SPEC.md: "each row carries its own sync dot").
    events.push(credit(id, person.owesPoisha, person.idle, person.idle > 3));
  }

  // Settled up long ago — must be SILENT on the aging view at any age.
  const settled = customer('মোহাম্মদ আলী', 400);
  events.push(settled);
  const settledId = settled.type === 'CUSTOMER_ADDED' ? settled.payload.customer_id : '';
  events.push(credit(settledId, 90_000, 390)); // ৳900
  events.push(payment(settledId, 90_000, 380));

  // The same ৳300 payment recorded on two offline devices — a NEGATIVE_BALANCE
  // anomaly (EVENTS.md §8), which the aging view must surface first and
  // explain once, without calling anyone anything.
  const overpaid = customer('ফরিদা', 30);
  events.push(overpaid);
  const overpaidId = overpaid.type === 'CUSTOMER_ADDED' ? overpaid.payload.customer_id : '';
  events.push(credit(overpaidId, 30_000, 6)); // ৳300
  events.push(payment(overpaidId, 30_000, 1));
  events.push(payment(overpaidId, 30_000, 1, false));

  // A few of today's entries, so the daily summary is not an empty state on
  // first launch. Deliberately small: this is a demo, not a busy shop.
  const walkIn = customer('আজকের খদ্দের', 1);
  events.push(walkIn);
  const walkInId = walkIn.type === 'CUSTOMER_ADDED' ? walkIn.payload.customer_id : '';
  events.push(credit(walkInId, 45_000, 0, false)); // ৳450
  events.push(payment(walkInId, 20_000, 0, false)); // ৳200

  // Goods, so the product list and the alerts screen have content. One low,
  // one out, one healthy, and one with an expired batch still partly on hand.
  events.push(...goods());

  return events;
}

/**
 * Stock spread across every bucket the alerts screen can show:
 * LOW, OUT, OK, and an expiry risk whose reported number is an upper bound.
 */
function goods(): AnyEvent[] {
  const events: AnyEvent[] = [];

  const add = (
    id: string,
    name: string,
    unit: 'PIECE' | 'KG' | 'LITRE' | 'PACKET',
    pricePoisha: number,
    threshold: number | null,
  ): void => {
    events.push({
      ...envelope(DEMO_NOW - 60 * DAY, true),
      type: 'PRODUCT_ADDED',
      payload: {
        schema_version: 1,
        product_id: id,
        name,
        unit,
        sale_price_poisha: pricePoisha as Poisha,
        low_stock_threshold_units: threshold,
      },
    });
  };

  const receive = (id: string, qty: number, expiry: string | null, daysAgo: number): void => {
    const at = DEMO_NOW - daysAgo * DAY;
    events.push({
      ...envelope(at, true),
      type: 'STOCK_RECEIVED',
      payload: {
        schema_version: 1,
        movement_id: `mv-${seq}`,
        product_id: id,
        quantity_units: qty,
        cost_price_poisha: null,
        expiry_date: expiry,
        occurred_at: at,
      },
    });
  };

  const sell = (id: string, qty: number, daysAgo: number): void => {
    const at = DEMO_NOW - daysAgo * DAY;
    events.push({
      ...envelope(at, daysAgo > 0),
      type: 'STOCK_SOLD',
      payload: {
        schema_version: 1,
        movement_id: `mv-${seq}`,
        product_id: id,
        quantity_units: qty,
        sale_price_poisha: 6_000 as Poisha, // ৳60
        sale_id: null,
        occurred_at: at,
      },
    });
  };

  add('p-rice', 'চাল', 'KG', 6_200, 20); // ৳62/kg
  receive('p-rice', 80, null, 40);
  sell('p-rice', 65, 3);
  sell('p-rice', 4, 0); // today, feeds the summary's goods-sold count

  add('p-oil', 'সয়াবিন তেল', 'LITRE', 17_500, 6); // ৳175/litre
  receive('p-oil', 24, null, 30);
  sell('p-oil', 24, 5); // OUT

  add('p-soap', 'সাবান', 'PIECE', 2_500, 10); // ৳25/piece
  receive('p-soap', 120, null, 25); // healthy — raises nothing

  // 30 received with an expiry date now long past, 30 fine, 52 sold. 8 remain,
  // so AT MOST 8 of them can be from the expired batch — the bound the domain
  // reports, sound under any consumption order (no FEFO).
  add('p-milk', 'গুঁড়া দুধ', 'PACKET', 9_000, 5); // ৳90/packet
  receive('p-milk', 30, '2026-05-10', 45);
  receive('p-milk', 30, '2027-06-30', 20);
  sell('p-milk', 52, 6);

  return events;
}

export function buildDemoState() {
  const events = buildDemoEvents();
  return { events, state: fold(events) };
}
