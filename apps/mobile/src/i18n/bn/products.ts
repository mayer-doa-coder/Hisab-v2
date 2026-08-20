// bn/products.ts — CONTRIBUTING.md §4.2 namespace split. Covers the product
// list, the add/edit form, and the alerts screen (low stock and expiry) —
// all of it inventory, all of it one namespace.
//
// NATIVE-CHECK CANDIDATE. Every string added in Step 13 is counter Bangla
// written by an agent, not agreed copy. Register matters here and formal
// written Bangla is not what a shopkeeper says (CLAUDE.md). Flagged for a
// native read before the pilot, exactly as bn/common.ts's PIN strings were.
//
// FACTS, NOT SCORES (AGENTS.md §4.8, SECURITY.md §7, UI_SPEC.md "Uncertainty
// and risk"). Nothing here labels a product or a person. `stockNegative` says
// the count does not match, not that someone made a mistake; the expiry
// string says "at most", because that is genuinely all the events support
// (packages/domain/src/inventory.ts) and overstating it would send the
// shopkeeper to throw away saleable stock.

export interface ProductsStrings {
  addProduct: string;
  outOfStock: string;
  lowStock: string;

  // ---- Product list (Step 13) ----------------------------------------------
  productsTitle: string;
  noProducts: string;
  noProductsHint: string;
  archivedLabel: string;

  // ---- Add / edit form -----------------------------------------------------
  editProduct: string;
  nameLabel: string;
  namePlaceholder: string;
  unitLabel: string;
  priceLabel: string;
  pricePlaceholder: string;
  priceOptional: string;
  thresholdLabel: string;
  thresholdPlaceholder: string;
  thresholdHelp: string;
  nameRequired: string;

  // ---- Units ---------------------------------------------------------------
  unitPiece: string;
  unitKg: string;
  unitGram: string;
  unitLitre: string;
  unitMl: string;
  unitPacket: string;
  unitDozen: string;

  // ---- Alerts screen -------------------------------------------------------
  alertsTitle: string;
  alertsAllClear: string;
  alertsAllClearHint: string;
  stockSection: string;
  expirySection: string;
  stockOut: string;
  stockLowRemaining: string;
  stockNegative: string;
  expiryAtMost: string;
  expirySince: string;
  writeOff: string;
}

export const products: ProductsStrings = {
  addProduct: 'পণ্য যোগ করুন',
  outOfStock: 'স্টক নেই',
  lowStock: 'স্টক কম',

  productsTitle: 'মাল',
  noProducts: 'এখনো কোনো মাল যোগ করেননি',
  noProductsHint: 'যেসব মাল দোকানে আছে, একটা একটা করে যোগ করুন',
  archivedLabel: 'আর রাখি না',

  editProduct: 'মাল বদলান',
  nameLabel: 'কী মাল',
  namePlaceholder: 'যেমন চাল, ডাল, সাবান',
  unitLabel: 'কীভাবে মাপেন',
  priceLabel: 'বিক্রির দাম',
  pricePlaceholder: '০',
  priceOptional: 'না দিলেও চলবে',
  thresholdLabel: 'কত কমলে জানাব',
  thresholdPlaceholder: '০',
  thresholdHelp: 'এর নিচে নামলে সতর্ক তালিকায় দেখাবে',
  nameRequired: 'মালের নাম লাগবে',

  unitPiece: 'পিস',
  unitKg: 'কেজি',
  unitGram: 'গ্রাম',
  unitLitre: 'লিটার',
  unitMl: 'মিলি',
  unitPacket: 'প্যাকেট',
  unitDozen: 'ডজন',

  alertsTitle: 'দেখা দরকার',
  alertsAllClear: 'সব ঠিক আছে',
  alertsAllClearHint: 'কোনো মাল ফুরায়নি, কোনো তারিখও পার হয়নি',
  stockSection: 'স্টক',
  expirySection: 'তারিখ পার হয়েছে',
  stockOut: 'শেষ হয়ে গেছে',
  // {0} = remaining quantity, already formatted with unit by the formatter.
  stockLowRemaining: 'আর আছে',
  stockNegative: 'স্টকের হিসাব মিলছে না',
  // Deliberately "at most" — inventory.ts can only bound this, not count it.
  expiryAtMost: 'সর্বোচ্চ',
  expirySince: 'তারিখ পার হয়েছে',
  writeOff: 'বাদ দিন',
};
