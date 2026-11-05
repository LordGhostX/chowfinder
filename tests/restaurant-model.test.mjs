import assert from "node:assert/strict";
import test from "node:test";
import { filterRestaurants, normalizeVendor, sortRestaurants } from "../dist/restaurant-model.js";

const vendor = (changes = {}) => normalizeVendor({
  id: 1,
  name: "A restaurant",
  slug: "a-restaurant",
  vendor_type: "restaurant",
  location: "Lekki Phase 1",
  average_rating: "4.25",
  number_of_rating: 100,
  currency: "NGN",
  delivery_price: 100000,
  minimum_delivery_time: 20,
  maximum_delivery_time: 30,
  is_open: true,
  is_temporarily_unavailable: false,
  is_chowpass_vendor: true,
  verification_status: "verified",
  discount_text: "10% off selected items",
  discounts: [],
  ...changes,
});

const preferences = {
  rating: 4,
  fee: 1000,
  time: 30,
  discounts: true,
  open: true,
  chowpass: true,
  verified: true,
};

test("all seven preferences compose, with inclusive fee and time limits", () => {
  const matching = vendor();
  const others = [
    vendor({ id: 2, average_rating: "3.99" }),
    vendor({ id: 3, delivery_price: 100001 }),
    vendor({ id: 4, maximum_delivery_time: 31 }),
    vendor({ id: 5, discount_text: "" }),
    vendor({ id: 6, is_open: false }),
    vendor({ id: 7, is_chowpass_vendor: false }),
    vendor({ id: 8, is_chowpass_vendor: undefined }),
    vendor({ id: 9, verification_status: "pending" }),
    vendor({ id: 10, verification_status: undefined }),
  ];

  assert.deepEqual(filterRestaurants([matching, ...others], preferences), [matching]);
});

test("closest sorts numeric distances, includes zero, and places missing distances last", () => {
  const original = [
    vendor({ id: 1, distance: "10" }),
    vendor({ id: 2, distance: "2" }),
    vendor({ id: 3, distance: 0 }),
    vendor({ id: 4, distance: null }),
  ];

  assert.deepEqual(sortRestaurants(original, "distance").map((item) => item.id), [3, 2, 1, 4]);
});

test("an open kitchen that is temporarily unavailable is excluded by open now", () => {
  const unavailable = vendor({ is_temporarily_unavailable: true });
  assert.equal(filterRestaurants([unavailable], { open: true }).length, 0);
  assert.equal(filterRestaurants([unavailable], {}).length, 1);
});

test("unknown values never pass specific limits; free delivery is a real filter", () => {
  const unknown = vendor({ average_rating: null, delivery_price: null, maximum_delivery_time: null });
  assert.equal(filterRestaurants([unknown], { rating: 4 }).length, 0);
  assert.equal(filterRestaurants([unknown], { fee: 0 }).length, 0);
  assert.equal(filterRestaurants([unknown], { time: 30 }).length, 0);
  assert.equal(filterRestaurants([vendor({ delivery_price: 0 }), vendor()], { fee: 0 }).length, 1);
});

test("sorting compares numeric ratings and leaves the original order intact", () => {
  const original = [vendor(), vendor({ id: 2, average_rating: "4.9" }), vendor({ id: 3, average_rating: null })];
  assert.deepEqual(sortRestaurants(original, "rating").map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(original.map((item) => item.id), [1, 2, 3]);
});
