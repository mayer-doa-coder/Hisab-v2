// bn/products.ts — CONTRIBUTING.md §4.2 namespace split. Products/inventory
// is Phase 4 (EVENTS.md §4); this file exists now only because the split is
// meant to happen from day one, not because anything renders it yet.

export interface ProductsStrings {
  addProduct: string;
  outOfStock: string;
  lowStock: string;
}

export const products: ProductsStrings = {
  addProduct: 'পণ্য যোগ করুন',
  outOfStock: 'স্টক নেই',
  lowStock: 'স্টক কম',
};
