import { getRestaurants, searchAddresses, selectAddress } from "./api.js";
import { closingWindow, filterRestaurants, localClock, sortRestaurants } from "./restaurant-model.js";

const $ = (id) => document.getElementById(id);
const LAST_ADDRESS_KEY = "chowfinder.lastAddress";
const FILTERS_KEY = "chowfinder.filters";
const state = {
  address: null,
  restaurants: [],
  hasMore: false,
  cursor: null,
  loading: false,
  error: "",
  currency: "NGN",
};
let searchController;
let restaurantController;
let debounceTimer;
let suggestions = [];
let activeSuggestion = -1;
let retryLastRequest;

function readLastAddress() {
  try {
    const address = JSON.parse(localStorage.getItem(LAST_ADDRESS_KEY));
    if (!Number.isSafeInteger(address?.id) || address.id <= 0
      || typeof address.label !== "string" || !address.label.trim()
      || typeof address.country !== "string") {
      return null;
    }

    return { id: address.id, label: address.label.trim(), country: address.country };
  } catch {
    return null;
  }
}

function rememberAddress(address) {
  try {
    localStorage.setItem(LAST_ADDRESS_KEY, JSON.stringify(address));
  } catch {
    // Address selection still works when browser storage is unavailable.
  }
}

function restoreFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    if (!saved || typeof saved !== "object") {
      return;
    }

    const rating = [...document.querySelectorAll('input[name="rating"]')]
      .find((input) => Number(input.value) === saved.rating);
    if (rating) {
      rating.checked = true;
    }

    for (const [key, id] of [
      ["fee", "fee-filter"],
      ["time", "time-filter"],
      ["closing", "closing-filter"],
      ["sort", "sort-order"],
    ]) {
      const value = saved[key] === null ? "" : String(saved[key]);
      if ([...$(id).options].some((option) => option.value === value)) {
        $(id).value = value;
      }
    }

    for (const [key, id] of [
      ["discounts", "discount-filter"],
      ["open", "open-filter"],
      ["chowpass", "chowpass-filter"],
      ["verified", "verified-filter"],
    ]) {
      if (typeof saved[key] === "boolean") {
        $(id).checked = saved[key];
      }
    }

    if (typeof saved.query === "string") {
      $("vendor-search").value = saved.query.slice(0, $("vendor-search").maxLength);
    }
  } catch {
    // Keep the default filters when saved preferences cannot be read.
  }
}

function rememberFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...preferences(), sort: $("sort-order").value }));
  } catch {
    // Filtering still works when browser storage is unavailable.
  }
}

function applyAddress(address) {
  state.address = address;
  state.currency = address.country.toLowerCase() === "ghana" ? "GHS" : "NGN";
  updateCurrency();
  $("selected-address").textContent = address.label;
  $("address-input").value = address.label;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function money(minorUnits, currency = state.currency) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minorUnits / 100);
}

function preferences() {
  return {
    rating: Number(document.querySelector('input[name="rating"]:checked').value),
    fee: $("fee-filter").value === "" ? null : Number($("fee-filter").value),
    time: $("time-filter").value === "" ? null : Number($("time-filter").value),
    closing: $("closing-filter").value === "" ? null : Number($("closing-filter").value),
    discounts: $("discount-filter").checked,
    open: $("open-filter").checked,
    chowpass: $("chowpass-filter").checked,
    verified: $("verified-filter").checked,
    query: $("vendor-search").value,
  };
}

function updateCurrency() {
  for (const option of $("fee-filter").options) {
    if (option.value !== "" && option.value !== "0") {
      option.textContent = `Up to ${money(Number(option.value) * 100)}`;
    }
  }
}

function closeSuggestions() {
  searchController?.abort();
  clearTimeout(debounceTimer);
  suggestions = [];
  activeSuggestion = -1;
  $("address-suggestions").hidden = true;
  $("address-input").setAttribute("aria-expanded", "false");
  $("address-input").removeAttribute("aria-activedescendant");
}

function renderSuggestions() {
  $("address-options").replaceChildren();
  suggestions.forEach((suggestion, index) => {
    const item = element("li");
    const button = element("button", "address-option", suggestion.description);
    button.type = "button";
    button.id = `address-option-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === activeSuggestion));
    button.tabIndex = -1;
    button.addEventListener("click", () => chooseAddress(suggestion));
    item.append(button);
    $("address-options").append(item);
  });

  $("address-input").setAttribute("aria-expanded", "true");
  if (activeSuggestion >= 0) {
    $("address-input").setAttribute("aria-activedescendant", `address-option-${activeSuggestion}`);
  } else {
    $("address-input").removeAttribute("aria-activedescendant");
  }
}

async function findAddresses() {
  const query = $("address-input").value.trim();
  searchController?.abort();
  if (query.length < 3) {
    closeSuggestions();
    return;
  }

  const controller = new AbortController();
  searchController = controller;
  suggestions = [];
  activeSuggestion = -1;
  $("address-options").replaceChildren();
  $("address-suggestions").hidden = false;
  $("address-input").setAttribute("aria-expanded", "true");
  $("suggestions-status").textContent = "Looking for your address…";
  $("address-error").hidden = true;

  try {
    const results = await searchAddresses(query, controller.signal);
    if (controller.signal.aborted) {
      return;
    }

    suggestions = results;
    renderSuggestions();
    $("suggestions-status").textContent = results.length
      ? "Choose your delivery area"
      : "No addresses found. Try a nearby street, area or landmark.";
  } catch (error) {
    if (!controller.signal.aborted) {
      $("suggestions-status").textContent = error.message;
    }
  }
}

function acceptPage(page, reset) {
  const merged = reset ? page.restaurants : [...state.restaurants, ...page.restaurants];
  state.restaurants = [...new Map(merged.map((restaurant) => [restaurant.id, restaurant])).values()];
  state.hasMore = page.hasMore;
  state.cursor = page.cursor;
  if (state.restaurants.length) {
    state.currency = state.restaurants[0].currency;
    updateCurrency();
  }
}

async function chooseAddress(suggestion) {
  closeSuggestions();
  restaurantController?.abort();
  const controller = new AbortController();
  restaurantController = controller;
  retryLastRequest = () => chooseAddress(suggestion);
  state.address = null;
  state.restaurants = [];
  state.hasMore = false;
  state.cursor = null;
  state.loading = true;
  state.error = "";
  $("address-input").value = suggestion.description;
  $("selected-address").textContent = `Locating ${suggestion.description}…`;
  render();

  try {
    const address = await selectAddress(suggestion.placeId, controller.signal);
    if (controller.signal.aborted) {
      return;
    }

    applyAddress(address);
    rememberAddress(address);
    retryLastRequest = () => loadRestaurants(true);
    const page = await getRestaurants(address.id, null, controller.signal);
    if (!controller.signal.aborted) {
      acceptPage(page, true);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      state.error = error.message;
      if (!state.address) {
        $("selected-address").textContent = "Choose another address or try again";
      }
    }
  } finally {
    if (!controller.signal.aborted) {
      state.loading = false;
      render();
    }
  }
}

async function loadRestaurants(reset = false) {
  if (!state.address || state.loading || (!reset && !state.hasMore)) {
    return;
  }

  restaurantController?.abort();
  const controller = new AbortController();
  restaurantController = controller;
  retryLastRequest = () => loadRestaurants(reset);
  state.loading = true;
  state.error = "";
  render();

  try {
    const page = await getRestaurants(state.address.id, reset ? null : state.cursor, controller.signal);
    if (!controller.signal.aborted) {
      acceptPage(page, reset);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      state.error = error.message;
    }
  } finally {
    if (!controller.signal.aborted) {
      state.loading = false;
      render();
    }
  }
}

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", kind === "time"
    ? "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
    : "M3 5h11v12H3zM14 9h4l3 4v4h-7M5 17a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0");
  svg.append(path);
  return svg;
}

function closingTime(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}`;
}

function closingText(restaurant, clock) {
  const window = closingWindow(restaurant, clock);
  if (restaurant.open && window) {
    return `Closes at ${closingTime(window.closesAt)}${window.dayOffset ? " tomorrow" : ""}`;
  }

  const hours = restaurant.hours[clock.weekday];
  if (!hours) {
    return "Closing time unavailable";
  }

  const tomorrow = hours.closing < hours.opening || hours.closing === 1440;
  return `Scheduled close: ${closingTime(hours.closing)}${tomorrow ? " tomorrow" : ""}`;
}

function card(restaurant, clock) {
  const article = element("article", "restaurant-card");
  const imageLink = element("a", "card-image-link");
  imageLink.href = restaurant.url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener noreferrer";
  const membershipLabel = restaurant.chowpass ? ", Chowpass enabled" : "";
  imageLink.setAttribute("aria-label", `View ${restaurant.name} on Chowdeck${membershipLabel}`);
  const fallback = () => {
    imageLink.querySelector("img")?.remove();
    imageLink.prepend(element("span", "image-fallback", restaurant.name.slice(0, 1)));
  };

  if (restaurant.image) {
    const image = element("img", "card-image");
    image.src = restaurant.image;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", fallback, { once: true });
    imageLink.append(image);
  } else {
    fallback();
  }

  if (restaurant.hasDiscount) {
    const offer = element("span", "offer-badge", `✳ ${restaurant.offer || "Discounts available"}`);
    offer.title = `${restaurant.offer || "Discounts available"}. Offers may apply to selected items.`;
    imageLink.append(offer);
  }

  const badges = element("div", "card-badges");
  if (!restaurant.open || restaurant.unavailable) {
    badges.append(element("span", "closed-label", restaurant.open ? "Unavailable now" : "Closed now"));
  }

  if (restaurant.chowpass) {
    badges.append(element("span", "chowpass-badge", "Chowpass"));
  }

  if (badges.childElementCount) {
    imageLink.append(badges);
  }

  const body = element("div", "card-body");
  const titleRow = element("div", "card-title-row");
  const title = element("h3", "card-title");
  const titleLink = element("a", "", restaurant.name);
  titleLink.href = restaurant.url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.setAttribute("aria-label", `${restaurant.name}, opens on Chowdeck in a new tab`);
  title.append(titleLink);

  const rating = element("span", "card-rating");
  rating.append(element("span", "star", "★ "));
  rating.append(document.createTextNode(restaurant.rating === null ? "New" : restaurant.rating.toFixed(1)));
  rating.append(element("span", "rating-count", `(${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(restaurant.reviewCount)})`));
  rating.setAttribute("aria-label", restaurant.rating === null ? "No rating yet" : `Rated ${restaurant.rating} out of 5 from ${restaurant.reviewCount} reviews`);
  titleRow.append(title, rating);

  const stats = element("div", "card-stats");
  const delivery = element("span");
  delivery.append(icon("delivery"), document.createTextNode(restaurant.fee === null ? "Fee unavailable" : restaurant.fee === 0 ? "Free delivery" : money(restaurant.fee, restaurant.currency)));
  const time = element("span");
  const timeText = restaurant.maxTime === null
    ? "Time unavailable"
    : restaurant.minTime === null || restaurant.minTime === restaurant.maxTime
      ? `${restaurant.maxTime} mins`
      : `${restaurant.minTime}–${restaurant.maxTime} mins`;
  time.append(icon("time"), document.createTextNode(timeText));
  stats.append(delivery, time);

  const available = restaurant.open && !restaurant.unavailable;
  const status = element("div", `card-status${available ? "" : " unavailable"}`);
  status.append(element("span", "status-dot"), document.createTextNode(available ? "Open & ready for you" : restaurant.open ? "Temporarily unavailable" : "Currently closed"));
  const closing = element("p", "card-closing", closingText(restaurant, clock));
  closing.title = `Scheduled hours in ${state.currency === "GHS" ? "Ghana" : "Nigeria"} local time. Availability may change.`;
  const availability = element("div", "card-availability");
  availability.append(status, closing);
  body.append(titleRow, element("p", "card-area", restaurant.location || "Restaurant"), stats, availability);
  article.append(imageLink, body);
  return article;
}

function renderChips(filters) {
  const labels = [];
  if (filters.rating) labels.push(`${filters.rating}+ stars`);
  if (filters.fee !== null) labels.push(filters.fee === 0 ? "Free delivery" : `Delivery ≤ ${money(filters.fee * 100)}`);
  if (filters.time !== null) labels.push(`Within ${filters.time} mins`);
  if (filters.closing !== null) labels.push(`Open for ≥ ${$("closing-filter").selectedOptions[0].textContent}`);
  if (filters.discounts) labels.push("With discounts");
  if (filters.open) labels.push("Open now");
  if (filters.chowpass) labels.push("Chowpass only");
  if (filters.verified) labels.push("Verified only");
  $("active-filters").replaceChildren(...labels.map((label) => element("span", "filter-chip", label)));
  $("active-filters").hidden = labels.length === 0;
}

function render() {
  const filters = preferences();
  const now = Date.now();
  const timeZone = state.address?.country.toLowerCase() === "ghana" ? "Africa/Accra" : "Africa/Lagos";
  const clock = localClock(now, timeZone);
  const order = $("sort-order").value;
  const matches = sortRestaurants(filterRestaurants(state.restaurants, filters, clock), order, now);
  renderChips(filters);
  document.querySelector(".results").setAttribute("aria-busy", String(state.loading));
  $("restaurant-grid").replaceChildren(...matches.map((restaurant) => card(restaurant, clock)));
  $("discount-sort-note").hidden = order !== "discount";
  $("results-error").hidden = !state.error;
  $("results-error-text").textContent = state.error;
  $("loading-state").hidden = !state.loading || state.restaurants.length > 0;
  $("empty-state").hidden = state.loading || Boolean(state.error) || matches.length > 0;
  $("pagination").hidden = !state.address || state.restaurants.length === 0 || (!state.hasMore && matches.length === 0);
  $("load-more").hidden = !state.hasMore;
  $("load-more").disabled = state.loading;
  $("load-more").firstChild.textContent = state.loading ? "Loading restaurants… " : "Load more restaurants ";
  $("freshness").hidden = state.restaurants.length === 0;
  $("clear-vendor-search").hidden = filters.query.length === 0;

  if (state.address) {
    $("results-heading").textContent = "Restaurants near you";
    $("results-summary").textContent = `${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${state.restaurants.length} restaurants loaded`;
    $("pagination-note").textContent = state.hasMore
      ? `Filters apply to ${state.restaurants.length} loaded restaurants. There are more to explore.`
      : `All ${state.restaurants.length} restaurants loaded. You’re seeing every match.`;

    if (!matches.length && !state.loading && !state.error) {
      const searching = filters.query.trim().length > 0;
      let title = "No restaurants here just yet.";
      let message = "Try a nearby street or a different delivery address.";
      if (state.restaurants.length) {
        title = searching ? "No restaurants match that search." : "A little too particular?";
        message = searching ? "Try a different name or relax a filter." : "Try relaxing a filter to find something good.";
        if (state.hasMore) {
          message += " You can also load more restaurants below.";
        }
      }

      const heading = element("h3", "", title);
      const description = element("p", "", message);
      $("empty-state").replaceChildren(heading, description);
    }
  } else if (state.loading) {
    $("results-summary").textContent = "Setting your delivery area…";
  } else {
    $("results-summary").textContent = "Pick an address to see what’s nearby.";
  }
}

$("address-input").addEventListener("input", () => {
  $("address-error").hidden = true;
  closeSuggestions();
  if ($("address-input").value.trim().length >= 3) {
    debounceTimer = setTimeout(findAddresses, 350);
  }
});

$("address-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSuggestions();
  } else if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
    event.preventDefault();
    activeSuggestion = (activeSuggestion + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    renderSuggestions();
    $(`address-option-${activeSuggestion}`).scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && activeSuggestion >= 0) {
    event.preventDefault();
    chooseAddress(suggestions[activeSuggestion]);
  }
});

$("address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(debounceTimer);
  if ($("address-input").value.trim().length < 3) {
    $("address-error").textContent = "Enter at least three characters to find your address.";
    $("address-error").hidden = false;
    $("address-input").focus();
  } else {
    findAddresses();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".address-search")) {
    closeSuggestions();
  }
});

$("example-address").addEventListener("click", (event) => {
  event.stopPropagation();
  $("address-input").value = "Lekki Phase 1 Lagos";
  $("address-input").focus();
  findAddresses();
});

$("filter-form").addEventListener("change", () => {
  rememberFilters();
  render();
});
$("sort-order").addEventListener("change", () => {
  rememberFilters();
  render();
});
$("vendor-search").addEventListener("input", () => {
  rememberFilters();
  render();
});
$("clear-vendor-search").addEventListener("click", () => {
  $("vendor-search").value = "";
  rememberFilters();
  render();
  $("vendor-search").focus();
});
$("reset-filters").addEventListener("click", () => {
  $("filter-form").reset();
  $("vendor-search").value = "";
  rememberFilters();
  render();
});
$("load-more").addEventListener("click", () => loadRestaurants());
$("retry-button").addEventListener("click", () => retryLastRequest?.());

function refreshHours() {
  if (!document.hidden && state.restaurants.length) {
    render();
  }
}

setInterval(refreshHours, 60000);
document.addEventListener("visibilitychange", refreshHours);

restoreFilters();
const lastAddress = readLastAddress();
if (lastAddress) {
  applyAddress(lastAddress);
  loadRestaurants(true);
} else {
  render();
}
