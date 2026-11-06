import { normalizeVendor } from "./restaurant-model.js";

const BASE_URL = "https://api.chowdeck.com";
const HEADERS = {
  Accept: "application/json",
  "X-App-Name": "storefront",
  "X-App-OS": "web",
  "x-app-version": "3.0.7",
};

async function request(path, { params = {}, body, signal, cache } = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      credentials: "omit",
      cache,
      headers: body ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new Error(error.name === "TimeoutError"
      ? "Chowdeck took too long to respond. Please try again."
      : "Couldn’t reach Chowdeck. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error(response.status === 429
      ? "Chowdeck is receiving too many requests. Give it a moment, then try again."
      : "Chowdeck couldn’t complete this request. Please try again.");
  }

  const payload = await response.json();
  if (payload.status === "failed") {
    throw new Error(typeof payload.message === "string" ? payload.message : "Chowdeck couldn’t complete this request.");
  }

  return payload;
}

export async function searchAddresses(query, signal) {
  const payload = await request("/place/autocomplete/json", { params: { input: query }, signal });
  if (payload.status === "ZERO_RESULTS") {
    return [];
  }

  if (payload.status !== "OK" || !Array.isArray(payload.predictions)) {
    throw new Error("Address search is unavailable. Please try again.");
  }

  return payload.predictions
    .filter((item) => typeof item.description === "string" && item.place_id != null)
    .map((item) => ({ description: item.description, placeId: String(item.place_id) }));
}

export async function selectAddress(placeId, signal) {
  const details = await request("/place/details/json", { params: { placeid: placeId }, signal });
  const place = details.result;
  const coordinates = place?.geometry?.location;
  if (details.status !== "OK" || !Number.isFinite(coordinates?.lat) || !Number.isFinite(coordinates?.lng) || !Array.isArray(place.address_components)) {
    throw new Error("We couldn’t locate that address. Try a nearby street or landmark.");
  }

  const components = {};
  for (const component of place.address_components) {
    for (const type of component.types) {
      components[type] = component.long_name;
    }
  }

  const city = components.neighborhood || components.sublocality || components.sublocality_level_1 || components.locality || components.administrative_area_level_2 || "nil";
  const payload = await request("/customer/address", {
    signal,
    body: {
      place_id: String(place.place_id ?? placeId),
      house_no: components.street_number || "",
      street: place.name || place.formatted_address || "",
      pretty_name: place.formatted_address || "",
      longitude: coordinates.lng,
      latitude: coordinates.lat,
      city,
      area: city,
      state: components.administrative_area_level_1 || "",
      country: components.country || "",
    },
  });

  if (!Number.isSafeInteger(payload.data?.id)) {
    throw new Error("Chowdeck couldn’t select this delivery address. Try another nearby address.");
  }

  return {
    id: payload.data.id,
    label: typeof payload.data.pretty_name === "string" ? payload.data.pretty_name : place.formatted_address,
    country: components.country || "",
  };
}

export async function getRestaurants(addressId, cursor, signal) {
  const payload = await request("/customer/vendor/v2", {
    signal,
    cache: "no-store",
    params: {
      address_id: addressId,
      vendor_type: "restaurant",
      page_size: 100,
      next_cursor: cursor,
    },
  });

  if (!Array.isArray(payload.data) || typeof payload.meta?.has_more !== "boolean" || (payload.meta.has_more && typeof payload.meta.next_cursor !== "string")) {
    throw new Error("Chowdeck returned an unexpected restaurant list. Please try again.");
  }

  return {
    restaurants: payload.data.filter((item) => item.vendor_type === "restaurant").map(normalizeVendor),
    hasMore: payload.meta.has_more,
    cursor: payload.meta.has_more ? payload.meta.next_cursor : null,
  };
}

export async function getRestaurantPages(addressId, pageCount, signal) {
  const restaurants = [];
  let page;
  let cursor = null;
  let fetched = 0;

  while (fetched < pageCount) {
    signal.throwIfAborted();
    page = await getRestaurants(addressId, cursor, signal);
    restaurants.push(...page.restaurants);
    cursor = page.cursor;
    fetched += 1;
    if (!page.hasMore) {
      break;
    }
  }

  signal.throwIfAborted();
  return { restaurants, hasMore: page.hasMore, cursor, pageCount: fetched };
}
