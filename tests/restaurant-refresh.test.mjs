import assert from "node:assert/strict";
import test from "node:test";
import { getRestaurantPages } from "../dist/api.js";

function response(id, hasMore, cursor = null) {
  return {
    ok: true,
    json: async () => ({
      status: "success",
      data: [{ id, name: `Restaurant ${id}`, vendor_type: "restaurant" }],
      meta: { has_more: hasMore, next_cursor: cursor },
    }),
  };
}

test("refresh starts at the first page and follows fresh cursors for the loaded page count", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(1, true, "fresh-cursor") : response(2, true, "next-cursor");
  });

  const result = await getRestaurantPages(18957, 2, new AbortController().signal);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("address_id"), "18957");
  assert.equal(calls[0].url.searchParams.has("next_cursor"), false);
  assert.equal(calls[1].url.searchParams.get("next_cursor"), "fresh-cursor");
  assert.ok(calls.every(({ options }) => options.method === "GET" && options.cache === "no-store"));
  assert.deepEqual(result.restaurants.map((item) => item.id), [1, 2]);
  assert.equal(result.pageCount, 2);
  assert.equal(result.cursor, "next-cursor");
  assert.equal(result.hasMore, true);
});

test("refresh stops early when the current listing has fewer pages", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response(1, false));
  const result = await getRestaurantPages(18957, 3, new AbortController().signal);

  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.cursor, null);
});

test("a later page failure rejects the refresh instead of returning a partial replacement", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? response(1, true, "fresh-cursor") : { ok: false, status: 503 };
  });

  await assert.rejects(getRestaurantPages(18957, 2, new AbortController().signal), /couldn’t complete/);
  assert.equal(calls, 2);
});

test("cancelling a refresh prevents the next page from being requested", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return response(1, true, "fresh-cursor");
  });

  await assert.rejects(getRestaurantPages(18957, 2, controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 1);
});
