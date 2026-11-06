import assert from "node:assert/strict";
import test from "node:test";
import { searchFood } from "../dist/api.js";
import { FoodSearch } from "../dist/food-search.js";

function response(id, foodChanges = {}) {
  return {
    ok: true,
    json: async () => ({
      data: [{
        id,
        name: `Vendor ${id}`,
        vendor_type: "restaurant",
        products: [{ id: id * 10, name: "Rice", price: 250000, currency: "NGN", in_stock: true, ...foodChanges }],
      }],
    }),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("food search uses the address and dish query with the selected restaurant-menu scope", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response(2, { discount_price: 200000 }));
  const groups = await searchFood(18957, "rice", new AbortController().signal);
  const [url, options] = fetch.mock.calls[0].arguments;

  assert.equal(url.pathname, "/customer/search/product");
  assert.equal(url.searchParams.get("query"), "rice");
  assert.equal(url.searchParams.get("address_id"), "18957");
  assert.equal(url.searchParams.get("type"), "restaurant");
  assert.equal(url.searchParams.has("vendor_type"), false);
  assert.equal(options.cache, "no-store");
  assert.equal(groups[0].vendor.id, 2);
  assert.equal(groups[0].foods[0].price, 200000);
  assert.equal(groups[0].foods[0].originalPrice, 250000);
});

test("food search omits unpublished and malformed items while retaining out-of-stock items", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ data: [{
      id: 1,
      name: "Vendor",
      products: [
        { id: 1, name: "Available rice", price: 0, in_stock: true },
        { id: 2, name: "Sold-out rice", in_stock: false },
        { id: 3, name: "Unpublished", is_published: false },
        { id: 4, name: "Inactive", is_active: false },
        { id: 5, name: null },
      ],
    }, { id: 2, name: "Name-only rice vendor", products: [] }] }),
  }));

  const groups = await searchFood(18957, "rice", new AbortController().signal);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].foods.map((food) => food.id), [1, 2]);
  assert.equal(groups[0].foods[0].price, 0);
  assert.equal(groups[0].foods[1].inStock, false);
});

test("typing is debounced and a late response cannot overwrite a newer query", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    const request = { ...deferred(), url, signal: options.signal };
    requests.push(request);
    return request.promise;
  });
  const search = new FoodSearch(() => {});
  t.after(() => search.update(null, "", false));
  search.update(18957, "ri", true);
  t.mock.timers.tick(200);
  search.update(18957, "rice", true);
  t.mock.timers.tick(400);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("query"), "rice");
  assert.equal(search.update(18957, "rice", true), false);
  t.mock.timers.tick(400);
  assert.equal(requests.length, 1);
  search.update(18957, "pasta", true);
  assert.equal(requests[0].signal.aborted, true);
  t.mock.timers.tick(400);
  requests[0].resolve(response(1));
  await settle();
  assert.equal(search.state.loading, true);
  assert.equal(search.state.groups.length, 0);
  requests[1].resolve(response(2));
  await settle();
  assert.equal(search.state.groups[0].vendor.id, 2);
  assert.equal(search.state.query, "pasta");
});

test("address changes and leaving Food mode cancel requests and clear old results", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    const request = { ...deferred(), url, signal: options.signal };
    requests.push(request);
    return request.promise;
  });
  const search = new FoodSearch(() => {});
  t.after(() => search.update(null, "", false));
  search.update(18957, "rice", true);
  t.mock.timers.tick(400);
  search.update(20000, "rice", true);
  assert.equal(requests[0].signal.aborted, true);
  t.mock.timers.tick(400);
  requests[0].resolve(response(1));
  await settle();
  assert.equal(search.state.groups.length, 0);
  assert.equal(requests[1].url.searchParams.get("address_id"), "20000");
  search.update(20000, "rice", false);
  assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve(response(2));
  await settle();
  assert.equal(search.state.groups.length, 0);
  assert.equal(search.state.loading, false);
});

test("five-minute food refresh keeps current results on failure and retries with fresh data", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let calls = 0;
  const refresh = deferred();
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 2) return refresh.promise;
    return response(calls);
  });
  const search = new FoodSearch(() => {});
  t.after(() => search.update(null, "", false));
  search.update(18957, "rice", true);
  t.mock.timers.tick(400);
  await settle();
  assert.equal(search.state.groups[0].vendor.id, 1);
  t.mock.timers.tick(300000);
  assert.equal(search.state.refreshing, true);
  assert.equal(search.state.loading, false);
  assert.equal(search.state.groups[0].vendor.id, 1);
  refresh.reject(new Error("Simulated outage"));
  await settle();
  assert.equal(search.state.refreshFailed, true);
  assert.equal(search.state.groups[0].vendor.id, 1);
  t.mock.timers.tick(300000);
  await settle();
  assert.equal(search.state.groups[0].vendor.id, 3);
  assert.equal(search.state.refreshFailed, false);
});
