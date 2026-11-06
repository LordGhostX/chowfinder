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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VENDOR_CATEGORIES = new Map([
  ["restaurant", "restaurants"],
  ["supermarket", "supermarkets"],
  ["pharmacy", "pharmacies"],
  ["local-market", "local-market"],
  ["chowstore", "chowstore"],
  ["herbal", "herbal"],
]);

function scheduleTime(value, allowMidnight = false) {
  const valueText = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^\d{1,4}$/.test(valueText)) {
    return null;
  }

  const text = valueText.padStart(4, "0");
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2));
  if (allowMidnight && hours === 24 && minutes === 0) {
    return 1440;
  }

  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function normalizeHours(raw) {
  return WEEKDAYS.map((day) => {
    const hours = raw?.[day] ?? raw?.[day.toLowerCase()] ?? raw?.default;
    if (!hours || hours.is_open === false || hours.is_open === 0) {
      return null;
    }

    const opening = scheduleTime(hours.opening);
    const closing = scheduleTime(hours.closing, true);
    if (opening === null || closing === null || opening === closing) {
      return null;
    }

    return { opening, closing };
  });
}

function normalizeDiscounts(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((offer) => {
    const percent = numberOrNull(offer?.value);
    if (offer?.type !== "percentage_off" || percent === null || percent <= 0 || percent > 100
      || ![true, 1].includes(offer.is_active) || ![true, 1].includes(offer.is_published)) {
      return [];
    }

    const startsAt = offer.published_date == null ? null : Date.parse(offer.published_date);
    const expiresAt = offer.expiry_date == null ? null : Date.parse(offer.expiry_date);
    if ((startsAt !== null && !Number.isFinite(startsAt)) || (expiresAt !== null && !Number.isFinite(expiresAt))) {
      return [];
    }

    return [{ percent, startsAt, expiresAt }];
  });
}

export function localClock(now = Date.now(), timeZone = "Africa/Lagos") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    weekday: WEEKDAYS.indexOf(values.weekday),
    minutes: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60,
  };
}

export function closingWindow(restaurant, clock) {
  for (const dayOffset of [-1, 0]) {
    const hours = restaurant.hours[(clock.weekday + dayOffset + 7) % 7];
    if (!hours) {
      continue;
    }

    const opening = dayOffset * 1440 + hours.opening;
    const closing = dayOffset * 1440 + hours.closing + (hours.closing < hours.opening ? 1440 : 0);
    if (clock.minutes >= opening && clock.minutes < closing) {
      return {
        closesAt: closing % 1440,
        dayOffset: Math.floor(closing / 1440),
        minutesRemaining: closing - clock.minutes,
      };
    }
  }

  return null;
}

export function normalizeVendor(raw) {
  if (!raw || !Number.isSafeInteger(raw.id) || typeof raw.name !== "string") {
    throw new Error("Chowdeck returned an unexpected vendor format. Please try again.");
  }

  const location = typeof raw.location === "string" ? raw.location : "";
  const slug = typeof raw.slug === "string" ? raw.slug : "";
  const rating = numberOrNull(raw.average_rating);
  const image = raw.cover_images?.find((item) => typeof item?.path === "string")?.path;
  const category = VENDOR_CATEGORIES.get(raw.vendor_type);
  let url = "https://chowdeck.com/store";
  if (category === "chowstore") {
    url += "/chowstore";
  } else if (category && location && slug) {
    url += `/${encodeURIComponent(location.replaceAll(" ", "-").toLowerCase())}/${category}/${encodeURIComponent(slug)}`;
  }

  return {
    id: raw.id,
    name: raw.name,
    location,
    url,
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
    discountOffers: normalizeDiscounts(raw.discounts),
    hours: normalizeHours(raw.available_hours),
  };
}

export function normalizeFood(raw, vendorCurrency) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.name !== "string" || !raw.name.trim()
    || raw.is_active === false || raw.is_active === 0 || raw.is_published === false || raw.is_published === 0) {
    return null;
  }

  const regularPrice = numberOrNull(raw.price);
  const discountPrice = numberOrNull(raw.discount_price);
  const discounted = discountPrice !== null && (regularPrice === null || discountPrice < regularPrice);
  const image = raw.images?.find((item) => typeof item?.path === "string")?.path;
  let inStock = null;
  if (raw.in_stock === true || raw.in_stock === 1) {
    inStock = true;
  } else if (raw.in_stock === false || raw.in_stock === 0) {
    inStock = false;
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    price: discounted ? discountPrice : regularPrice,
    originalPrice: discounted ? regularPrice : null,
    currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : vendorCurrency,
    image: imageUrl(image),
    inStock,
    priceDescription: typeof raw.price_description === "string" ? raw.price_description.trim() : "",
  };
}

export function foodMatchesFilters(food, preferences) {
  if (preferences.mealBudget !== null && preferences.mealBudget !== undefined
    && (food.price === null || food.price > preferences.mealBudget * 100)) {
    return false;
  }

  return !preferences.open || food.inStock === true;
}

export function parseVendorIds(serialized) {
  try {
    const ids = JSON.parse(serialized);
    return new Set(Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0) : []);
  } catch {
    return new Set();
  }
}

export function vendorsInView(vendors, view, favourites, hidden) {
  return vendors.filter((vendor) => view === "hidden"
    ? hidden.has(vendor.id)
    : !hidden.has(vendor.id) && (view !== "favourites" || favourites.has(vendor.id)));
}

export function filterRestaurants(restaurants, preferences, clock = localClock()) {
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

    if (preferences.discounts && !restaurant.hasDiscount) {
      return false;
    }

    if (preferences.chowpass && !restaurant.chowpass) {
      return false;
    }

    if (preferences.verified && !restaurant.verified) {
      return false;
    }

    if (preferences.closing > 0) {
      const window = closingWindow(restaurant, clock);
      if (!restaurant.open || restaurant.unavailable || !window || window.minutesRemaining < preferences.closing) {
        return false;
      }
    }

    return !preferences.open || (restaurant.open && !restaurant.unavailable);
  });
}

export function sortRestaurants(restaurants, order, now = Date.now()) {
  const copy = [...restaurants];
  if (order === "rating") {
    copy.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || right.reviewCount - left.reviewCount);
  } else if (order === "fee") {
    copy.sort((left, right) => (left.fee ?? Infinity) - (right.fee ?? Infinity));
  } else if (order === "time") {
    copy.sort((left, right) => (left.maxTime ?? Infinity) - (right.maxTime ?? Infinity));
  } else if (order === "distance") {
    copy.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
  } else if (order === "reviews") {
    copy.sort((left, right) => right.reviewCount - left.reviewCount);
  } else if (order === "discount") {
    const ranked = copy.map((restaurant) => {
      const active = restaurant.discountOffers.filter((offer) => (offer.startsAt === null || offer.startsAt <= now)
        && (offer.expiresAt === null || offer.expiresAt > now));
      const discount = active.reduce((largest, offer) => Math.max(largest, offer.percent), 0);

      return { restaurant, discount };
    });
    ranked.sort((left, right) => right.discount - left.discount);

    return ranked.map((item) => item.restaurant);
  }

  return copy;
}
