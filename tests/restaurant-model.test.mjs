import assert from "node:assert/strict";
import test from "node:test";
import {
  closingWindow,
  filterRestaurants,
  localClock,
  normalizeVendor,
  openingWindow,
  parseVendorIds,
  sortRestaurants,
  vendorsInView,
} from "../dist/restaurant-model.js";

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
  discounts: true,
  open: true,
  chowpass: true,
  verified: true,
  query: "restaurant",
};

test("saved vendor choices accept only positive integer IDs and discard duplicate IDs", () => {
  assert.deepEqual([...parseVendorIds('[1,2,1,"3",null,-1,0,1.5,{"id":4,"name":"Cached vendor"}]')], [1, 2]);
  assert.deepEqual([...parseVendorIds("invalid")], []);
  assert.deepEqual([...parseVendorIds('{"id":1}')], []);
});

test("hidden choices take precedence in browsing and favourites without removing saved favourites", () => {
  const vendors = [vendor({ id: 1 }), vendor({ id: 2 }), vendor({ id: 3 })];
  const favourites = new Set([1, 2, 999]);
  const hidden = new Set([2, 3, 888]);

  assert.deepEqual(vendorsInView(vendors, "all", favourites, hidden).map((item) => item.id), [1]);
  assert.deepEqual(vendorsInView(vendors, "favourites", favourites, hidden).map((item) => item.id), [1]);
  assert.deepEqual(vendorsInView(vendors, "hidden", favourites, hidden).map((item) => item.id), [2, 3]);
  hidden.delete(2);
  assert.deepEqual(vendorsInView(vendors, "favourites", favourites, hidden).map((item) => item.id), [1, 2]);
  assert.equal(favourites.has(2), true);
});

test("favourites render only API-loaded IDs and survive a result refresh without fallback cards", () => {
  const favourites = new Set([1]);
  const hidden = new Set();

  assert.deepEqual(vendorsInView([vendor({ id: 2 })], "favourites", favourites, hidden), []);
  const freshVendor = vendor({ id: 1, name: "Fresh API name", delivery_price: 200000 });
  assert.deepEqual(vendorsInView([freshVendor], "favourites", favourites, hidden), [freshVendor]);
  assert.deepEqual([...favourites], [1]);
});

test("name search composes with restaurant filters and an inclusive fee limit", () => {
  const matching = vendor();
  const others = [
    vendor({ id: 2, average_rating: "3.99" }),
    vendor({ id: 3, delivery_price: 100001 }),
    vendor({ id: 5, discount_text: "" }),
    vendor({ id: 6, is_open: false }),
    vendor({ id: 7, is_chowpass_vendor: false }),
    vendor({ id: 8, is_chowpass_vendor: undefined }),
    vendor({ id: 9, verification_status: "pending" }),
    vendor({ id: 10, verification_status: undefined }),
    vendor({ id: 11, name: "Another kitchen" }),
  ];

  assert.deepEqual(filterRestaurants([matching, ...others], preferences), [matching]);
});

test("name search matches literal substrings regardless of case and trims the query", () => {
  const restaurants = [
    vendor({ id: 1, name: "FoLiXx Bukka" }),
    vendor({ id: 2, name: "Bukka Hut" }),
    vendor({ id: 3, name: "The Place" }),
  ];

  assert.deepEqual(filterRestaurants(restaurants, { query: "  uKk  " }).map((item) => item.id), [1, 2]);
  assert.deepEqual(filterRestaurants(restaurants, { query: ".*" }), []);
  assert.deepEqual(filterRestaurants(restaurants, { query: "   " }), restaurants);
});

test("vendor links use the correct Chowdeck category for each supported type", () => {
  const base = "https://chowdeck.com/store/lekki-phase-1/";
  assert.equal(vendor().url, `${base}restaurants/a-restaurant`);
  assert.equal(vendor({ vendor_type: "supermarket" }).url, `${base}supermarkets/a-restaurant`);
  assert.equal(vendor({ vendor_type: "pharmacy" }).url, `${base}pharmacies/a-restaurant`);
  assert.equal(vendor({ vendor_type: "local-market" }).url, `${base}local-market/a-restaurant`);
  assert.equal(vendor({ vendor_type: "chowstore" }).url, "https://chowdeck.com/store/chowstore");
  assert.equal(vendor({ vendor_type: "another-type" }).url, "https://chowdeck.com/store");
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
  const unknown = vendor({ average_rating: null, delivery_price: null });
  assert.equal(filterRestaurants([unknown], { rating: 4 }).length, 0);
  assert.equal(filterRestaurants([unknown], { fee: 0 }).length, 0);
  assert.equal(filterRestaurants([vendor({ delivery_price: 0 }), vendor()], { fee: 0 }).length, 1);
});

test("sorting compares numeric ratings and leaves the original order intact", () => {
  const original = [vendor(), vendor({ id: 2, average_rating: "4.9" }), vendor({ id: 3, average_rating: null })];
  assert.deepEqual(sortRestaurants(original, "rating").map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(original.map((item) => item.id), [1, 2, 3]);
});

test("most reviewed sorts numeric review counts and keeps missing counts last", () => {
  const restaurants = [
    vendor({ id: 1, number_of_rating: "20" }),
    vendor({ id: 2, number_of_rating: "100" }),
    vendor({ id: 3, number_of_rating: null }),
  ];

  assert.deepEqual(sortRestaurants(restaurants, "reviews").map((item) => item.id), [2, 1, 3]);
});

test("largest discount compares active percentage offers, ignoring expired and unpublished offers", () => {
  const now = Date.parse("2026-11-06T00:00:00Z");
  const offer = (value, changes = {}) => ({
    type: "percentage_off",
    value,
    is_active: true,
    is_published: true,
    expiry_date: "2026-11-07T00:00:00Z",
    ...changes,
  });
  const restaurants = [
    vendor({ id: 1, discounts: [offer("10"), offer(25)] }),
    vendor({ id: 2, discounts: [offer(30)] }),
    vendor({ id: 3, discounts: [
      offer(90, { expiry_date: "2026-11-06T00:00:00Z" }),
      offer(80, { is_active: false }),
      offer(70, { is_published: false }),
      offer(60, { published_date: "2026-11-07T00:00:00Z" }),
      offer(50, { expiry_date: "invalid" }),
      offer(100000, { type: "amount_off" }),
    ] }),
  ];

  assert.deepEqual(sortRestaurants(restaurants, "discount", now).map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(restaurants.map((item) => item.id), [1, 2, 3]);
});

test("closing hours use the restaurant's local weekday and carry yesterday's overnight service", () => {
  const now = Date.parse("2026-11-06T00:00:00Z");
  const clock = localClock(now, "Africa/Lagos");
  const restaurant = vendor({ available_hours: {
    Thursday: { opening: "2200", closing: "0200" },
    Friday: { opening: 900, closing: "2300" },
  } });

  assert.equal(clock.weekday, 5);
  assert.equal(clock.minutes, 60);
  assert.equal(localClock(now, "Africa/Accra").minutes, 0);
  assert.deepEqual(closingWindow(restaurant, clock), { closesAt: 120, dayOffset: 0, minutesRemaining: 60 });
  assert.deepEqual(closingWindow(restaurant, localClock(Date.parse("2026-11-05T22:00:00Z"))), {
    closesAt: 120,
    dayOffset: 1,
    minutesRemaining: 180,
  });
});

test("weekday hours override defaults; closed days and invalid hours do not invent a closing time", () => {
  const clock = localClock(Date.parse("2026-11-06T11:00:00Z"));
  const restaurant = vendor({ available_hours: {
    default: { opening: "0900", closing: "2100" },
    Friday: { opening: "1000", closing: "1500" },
    friday: { opening: "1000", closing: "1600" },
  } });

  assert.equal(closingWindow(restaurant, clock).minutesRemaining, 180);
  assert.equal(closingWindow(vendor({ available_hours: { default: { opening: "0900", closing: "2500" } } }), clock), null);
  assert.equal(closingWindow(vendor({ available_hours: { default: { opening: "", closing: "2100" } } }), clock), null);
  assert.equal(closingWindow(vendor({ available_hours: { default: { opening: "0900", closing: "0900" } } }), clock), null);
  assert.equal(closingWindow(vendor({ available_hours: { Friday: { is_open: false, opening: "0900", closing: "2100" } } }), clock), null);
});

test("minimum time before closing includes the boundary and excludes closed, unavailable, or unknown hours", () => {
  const clock = localClock(Date.parse("2026-11-06T00:00:00Z"));
  const hours = { default: { opening: "1800", closing: "0200" } };
  const restaurants = [
    vendor({ id: 1, available_hours: hours }),
    vendor({ id: 2, available_hours: { default: { opening: "1800", closing: "0159" } } }),
    vendor({ id: 3, available_hours: hours, is_open: false }),
    vendor({ id: 4, available_hours: hours, is_temporarily_unavailable: true }),
    vendor({ id: 5 }),
  ];

  assert.deepEqual(filterRestaurants(restaurants, { closing: 60 }, clock).map((item) => item.id), [1]);
  assert.equal(filterRestaurants(restaurants, { closing: null }, clock).length, 5);
  assert.equal(filterRestaurants(restaurants, { closing: 60 }, { ...clock, minutes: 60 + 1 / 60 }).length, 0);
  assert.equal(closingWindow(restaurants[0], { ...clock, minutes: 120 }), null);
});

test("overnight hours carry from Saturday to Sunday, and 2400 closes at midnight", () => {
  const clock = localClock(Date.parse("2026-11-07T23:30:00Z"));
  const restaurant = vendor({ available_hours: {
    Saturday: { opening: "1800", closing: "0200" },
    Sunday: { is_open: false },
  } });

  assert.equal(clock.weekday, 0);
  assert.equal(closingWindow(restaurant, clock).minutesRemaining, 90);
  const midnight = vendor({ available_hours: { default: { opening: "0900", closing: "2400" } } });
  assert.deepEqual(closingWindow(midnight, { weekday: 6, minutes: 1410 }), {
    closesAt: 0,
    dayOffset: 1,
    minutesRemaining: 30,
  });
});

test("next opening uses today's future hours or the next scheduled weekday across closed days and week boundaries", () => {
  const restaurant = vendor({ is_open: false, available_hours: {
    Friday: { opening: "1000", closing: "2200" },
    Saturday: { is_open: false },
    Sunday: { opening: "1800", closing: "0200" },
  } });

  assert.deepEqual(openingWindow(restaurant, { weekday: 5, minutes: 540 }), { opensAt: 600, dayOffset: 0 });
  assert.deepEqual(openingWindow(restaurant, { weekday: 5, minutes: 1320 }), { opensAt: 1080, dayOffset: 2 });
  assert.deepEqual(openingWindow(restaurant, { weekday: 6, minutes: 600 }), { opensAt: 1080, dayOffset: 1 });
  assert.deepEqual(openingWindow(restaurant, { weekday: 0, minutes: 1200 }), { opensAt: 600, dayOffset: 5 });
  assert.equal(restaurant.open, false);
});

test("next opening skips elapsed overnight openings and finds weekly-only schedules without inventing unknown hours", () => {
  const overnight = vendor({ available_hours: { default: { opening: "1800", closing: "0200" } } });
  assert.deepEqual(openingWindow(overnight, { weekday: 5, minutes: 60 }), { opensAt: 1080, dayOffset: 0 });
  assert.deepEqual(openingWindow(overnight, { weekday: 5, minutes: 1380 }), { opensAt: 1080, dayOffset: 1 });
  const weekly = vendor({ available_hours: { Friday: { opening: "0900", closing: "2100" } } });
  assert.deepEqual(openingWindow(weekly, { weekday: 5, minutes: 600 }), { opensAt: 540, dayOffset: 7 });
  assert.equal(openingWindow(vendor(), { weekday: 5, minutes: 600 }), null);
});

test("preorder badges follow the API availability flag rather than guessing from vendor class", () => {
  assert.equal(vendor({ can_pre_order: true }).preorder, true);
  assert.equal(vendor({ can_pre_order: 1 }).preorder, true);
  assert.equal(vendor({ can_pre_order: false, vendor_class: "preorder" }).preorder, false);
  assert.equal(vendor({ can_pre_order: "true" }).preorder, false);
  assert.equal(vendor().preorder, false);
});
