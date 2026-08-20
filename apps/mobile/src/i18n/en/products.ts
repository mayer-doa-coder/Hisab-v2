// en/products.ts — implements bn/products.ts's ProductsStrings. Adding a key
// to one file without the other is a type error (AGENTS.md §6: "Both bn and
// en keys change in the same commit").

import type { ProductsStrings } from '../bn/products';

export const products: ProductsStrings = {
  addProduct: 'Add product',
  outOfStock: 'Out of stock',
  lowStock: 'Low stock',

  productsTitle: 'Goods',
  noProducts: 'No goods added yet',
  noProductsHint: 'Add what you stock, one at a time',
  archivedLabel: 'No longer stocked',

  editProduct: 'Edit product',
  nameLabel: 'What is it',
  namePlaceholder: 'e.g. rice, lentils, soap',
  unitLabel: 'How you measure it',
  priceLabel: 'Selling price',
  pricePlaceholder: '0',
  priceOptional: 'Optional',
  thresholdLabel: 'Tell me when it drops below',
  thresholdPlaceholder: '0',
  thresholdHelp: 'Below this it shows up in the alerts list',
  nameRequired: 'A name is needed',

  unitPiece: 'piece',
  unitKg: 'kg',
  unitGram: 'g',
  unitLitre: 'litre',
  unitMl: 'ml',
  unitPacket: 'packet',
  unitDozen: 'dozen',

  alertsTitle: 'Needs looking at',
  alertsAllClear: 'All clear',
  alertsAllClearHint: 'Nothing has run out, nothing has passed its date',
  stockSection: 'Stock',
  expirySection: 'Past its date',
  stockOut: 'Run out',
  stockLowRemaining: 'Left',
  stockNegative: 'Stock count does not add up',
  // "At most", never "you have N expired" — inventory.ts can only bound this.
  expiryAtMost: 'At most',
  expirySince: 'past its date',
  writeOff: 'Write off',
};
