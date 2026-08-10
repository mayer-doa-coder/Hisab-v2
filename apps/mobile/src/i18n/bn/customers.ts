// bn/customers.ts — CONTRIBUTING.md §4.2 namespace split.

export interface CustomersStrings {
  addCustomer: string;
  recordCredit: string;
  recordPayment: string;
  searchPlaceholder: string;
  newCustomer: string;
}

export const customers: CustomersStrings = {
  addCustomer: 'গ্রাহক যোগ করুন',
  recordCredit: 'বাকি লিখুন',
  recordPayment: 'জমা লিখুন',
  searchPlaceholder: 'নাম বা ফোন নম্বর খুঁজুন',
  newCustomer: '+ নতুন',
};
