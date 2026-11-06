function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function imageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeVendor(raw) {
  if (!raw || !Number.isSafeInteger(raw.id) || typeof raw.name !== "string") {
    throw new Error("Chowdeck returned an unexpected restaurant format. Please try again.");
  }

  const location = typeof raw.location === "string" ? raw.location : "";
  const slug = typeof raw.slug === "string" ? raw.slug : "";
  const rating = numberOrNull(raw.average_rating);
  const image = raw.cover_images?.find((item) => typeof item?.path === "string")?.path;

  return {
    id: raw.id,
    name: raw.name,
    location,
    url: location && slug
      ? `https://chowdeck.com/store/${encodeURIComponent(location.replaceAll(" ", "-").toLowerCase())}/restaurants/${encodeURIComponent(slug)}`
      : "https://chowdeck.com/store",
    image: imageUrl(image) || imageUrl(raw.logo_url),
    rating: rating !== null && rating <= 5 ? rating : null,
    reviewCount: numberOrNull(raw.number_of_rating) ?? 0,
    currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : "NGN",
    fee: numberOrNull(raw.delivery_price),
    distance: numberOrNull(raw.distance),
    minTime: numberOrNull(raw.minimum_delivery_time),
    maxTime: numberOrNull(raw.maximum_delivery_time),
    open: raw.is_open === true || raw.is_open === 1,
    unavailable: raw.is_temporarily_unavailable === true || raw.is_temporarily_unavailable === 1,
    chowpass: raw.is_chowpass_vendor === true || raw.is_chowpass_vendor === 1,
    verified: raw.verification_status === "verified",
    offer: typeof raw.discount_text === "string" ? raw.discount_text.trim() : "",
    hasDiscount: Boolean(raw.discount_text?.trim()) || (Array.isArray(raw.discounts) && raw.discounts.length > 0),
  };
}

export function filterRestaurants(restaurants, preferences) {
  const query = (preferences.query ?? "").trim().toLowerCase();

  return restaurants.filter((restaurant) => {
    if (query && !restaurant.name.toLowerCase().includes(query)) {
      return false;
    }

    if (preferences.rating > 0 && (restaurant.rating === null || restaurant.rating < preferences.rating)) {
      return false;
    }

    if (preferences.fee !== null && preferences.fee !== undefined && (restaurant.fee === null || restaurant.fee > preferences.fee * 100)) {
      return false;
    }

    if (preferences.time !== null && preferences.time !== undefined && (restaurant.maxTime === null || restaurant.maxTime > preferences.time)) {
      return false;
    }

    if (preferences.discounts && !restaurant.hasDiscount) {
      return false;
    }

    if (preferences.chowpass && !restaurant.chowpass) {
      return false;
    }

    if (preferences.verified && !restaurant.verified) {
      return false;
    }

    return !preferences.open || (restaurant.open && !restaurant.unavailable);
  });
}

export function sortRestaurants(restaurants, order) {
  const copy = [...restaurants];
  if (order === "rating") {
    copy.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || right.reviewCount - left.reviewCount);
  } else if (order === "fee") {
    copy.sort((left, right) => (left.fee ?? Infinity) - (right.fee ?? Infinity));
  } else if (order === "time") {
    copy.sort((left, right) => (left.maxTime ?? Infinity) - (right.maxTime ?? Infinity));
  } else if (order === "distance") {
    copy.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
  }

  return copy;
}
