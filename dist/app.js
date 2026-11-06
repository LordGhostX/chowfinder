import { getRestaurantPages, getRestaurants, searchAddresses, selectAddress } from "./api.js";
import { FoodSearch } from "./food-search.js";
import {
  closingWindow,
  filterRestaurants,
  localClock,
  parseVendorIds,
  sortRestaurants,
  vendorsInView,
} from "./restaurant-model.js";

const $ = (id) => document.getElementById(id);
const LAST_ADDRESS_KEY = "chowfinder.lastAddress";
const FILTERS_KEY = "chowfinder.filters";
const FAVOURITES_KEY = "chowfinder.favourites";
const HIDDEN_KEY = "chowfinder.hiddenVendors";
const REFRESH_INTERVAL = 5 * 60 * 1000;
const state = {
  address: null,
  restaurants: [],
  hasMore: false,
  cursor: null,
  loading: false,
  error: "",
  currency: "NGN",
  pageCount: 0,
  refreshedAt: 0,
  refreshFailed: false,
  pickId: null,
  view: "all",
  favourites: readVendorIds(FAVOURITES_KEY),
  hidden: readVendorIds(HIDDEN_KEY),
  searchMode: "vendors",
};
const foodSearch = new FoodSearch(render);
let searchController;
let restaurantController;
let debounceTimer;
let suggestions = [];
let activeSuggestion = -1;
let retryLastRequest;
let refreshController;
let refreshTimer;
let refreshDueAt = 0;
let undoHiddenId = null;
let undoTimer;

function readVendorIds(key) {
  try {
    return parseVendorIds(localStorage.getItem(key));
  } catch {
    return new Set();
  }
}

function rememberVendorIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Choices still work for this visit when browser storage is unavailable.
  }
}

function focusVendorAction(id, foodId = null) {
  const foodSelector = foodId === null ? "" : `[data-food-id="${foodId}"]`;
  const favourite = document.querySelector(`[data-favourite-id="${id}"]${foodSelector}`);
  (favourite || $(`view-${state.view}`)).focus();
}

function toggleFavourite(id, foodId = null) {
  if (state.favourites.has(id)) {
    state.favourites.delete(id);
  } else {
    state.favourites.add(id);
  }

  rememberVendorIds(FAVOURITES_KEY, state.favourites);
  render();
  focusVendorAction(id, foodId);
}

function clearUndo() {
  clearTimeout(undoTimer);
  undoHiddenId = null;
  const undoFocused = document.activeElement === $("undo-hide");
  $("hidden-notice").hidden = true;
  if (undoFocused) {
    $(`view-${state.view}`).focus();
  }
}

function hideVendor(vendor) {
  state.hidden.add(vendor.id);
  rememberVendorIds(HIDDEN_KEY, state.hidden);
  clearTimeout(undoTimer);
  undoHiddenId = vendor.id;
  $("hidden-notice-text").textContent = `${vendor.name} hidden.`;
  $("hidden-notice").hidden = false;
  undoTimer = setTimeout(clearUndo, 8000);
  render();
  $("undo-hide").focus();
}

function restoreVendor(id) {
  state.hidden.delete(id);
  rememberVendorIds(HIDDEN_KEY, state.hidden);
  if (undoHiddenId === id) {
    clearUndo();
  }

  render();
  focusVendorAction(id);
}

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
    if (saved.searchMode === "food" || saved.searchMode === "vendors") {
      state.searchMode = saved.searchMode;
    }
  } catch {
    // Keep the default filters when saved preferences cannot be read.
  }
}

function rememberFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...preferences(), sort: $("sort-order").value, searchMode: state.searchMode }));
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
  syncFoodSearch();
}

function syncFoodSearch() {
  return foodSearch.update(state.address?.id ?? null, $("vendor-search").value, state.searchMode === "food");
}

function showingFood() {
  return state.searchMode === "food" && state.view !== "hidden";
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
  state.pageCount = reset ? 1 : state.pageCount + 1;
  if (reset) {
    state.refreshedAt = Date.now();
    state.refreshFailed = false;
  }

  if (state.restaurants.length) {
    state.currency = state.restaurants[0].currency;
    updateCurrency();
  }
}

async function chooseAddress(suggestion) {
  closeSuggestions();
  clearTimeout(refreshTimer);
  refreshDueAt = 0;
  refreshController?.abort();
  refreshController = null;
  restaurantController?.abort();
  const controller = new AbortController();
  restaurantController = controller;
  retryLastRequest = () => chooseAddress(suggestion);
  state.address = null;
  syncFoodSearch();
  state.restaurants = [];
  state.hasMore = false;
  state.cursor = null;
  state.pageCount = 0;
  state.refreshedAt = 0;
  state.refreshFailed = false;
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
      scheduleRefresh();
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

  refreshController?.abort();
  refreshController = null;
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
      if (reset) {
        scheduleRefresh();
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      state.error = error.message;
    }
  } finally {
    if (!controller.signal.aborted) {
      state.loading = false;
      render();
      refreshIfDue();
    }
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshDueAt = Date.now() + REFRESH_INTERVAL;
  refreshTimer = setTimeout(refreshRestaurants, REFRESH_INTERVAL);
}

function refreshIfDue() {
  if (refreshDueAt && Date.now() >= refreshDueAt) {
    void refreshRestaurants();
  }
}

async function refreshRestaurants() {
  if (!state.address || !state.pageCount || state.loading || refreshController) {
    return;
  }

  clearTimeout(refreshTimer);
  const addressId = state.address.id;
  const controller = new AbortController();
  refreshController = controller;
  renderFreshness();

  try {
    const page = await getRestaurantPages(addressId, state.pageCount, controller.signal);
    if (!controller.signal.aborted && state.address?.id === addressId) {
      acceptPage(page, true);
      state.pageCount = page.pageCount;
      state.error = "";
      render();
    }
  } catch {
    if (!controller.signal.aborted) {
      state.refreshFailed = true;
    }
  } finally {
    if (refreshController === controller) {
      refreshController = null;
      scheduleRefresh();
      renderFreshness();
    }
  }
}

function renderFreshness() {
  const food = showingFood();
  const refreshedAt = food ? foodSearch.state.refreshedAt : state.refreshedAt;
  const refreshing = food ? foodSearch.state.refreshing : Boolean(refreshController);
  const failed = food ? foodSearch.state.refreshFailed : state.refreshFailed;
  const updated = refreshedAt
    ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(refreshedAt)
    : "";
  let text = `${food ? "Food results updated" : "Updated"} at ${updated}. Refreshes every 5 minutes. Availability and final fees may change at checkout.`;
  if (refreshing) {
    text = "Refreshing availability… Your current results stay visible.";
  } else if (failed) {
    text = `Couldn’t refresh availability. Showing results from ${updated}; retrying in 5 minutes.`;
  }

  $("freshness").textContent = text;
  $("freshness").hidden = food ? !refreshedAt : state.restaurants.length === 0;
}

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths = {
    time: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    delivery: "M3 5h11v12H3zM14 9h4l3 4v4h-7M5 17a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0",
    heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  };
  path.setAttribute("d", paths[kind]);
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

function card(restaurant, clock, food = null) {
  const article = element("article", "restaurant-card");
  article.classList.toggle("is-picked", restaurant.id === state.pickId);
  const label = food ? `${food.name} at ${restaurant.name}` : restaurant.name;
  const imageUrl = food?.image || restaurant.image;
  let stockText = "";
  if (food && food.inStock !== true) {
    stockText = food.inStock === false ? "Out of stock" : "Stock status unavailable";
  }

  const available = restaurant.open && !restaurant.unavailable && !stockText;
  let statusText = stockText || "Open & ready for you";
  if (!restaurant.open) {
    statusText = "Currently closed";
  } else if (restaurant.unavailable) {
    statusText = "Temporarily unavailable";
  }
  const imageLink = element("a", "card-image-link");
  imageLink.href = restaurant.url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener noreferrer";
  const membershipLabel = restaurant.chowpass ? ", Chowpass enabled" : "";
  imageLink.setAttribute("aria-label", `View ${label} on Chowdeck${membershipLabel}`);
  const fallback = () => {
    imageLink.querySelector("img")?.remove();
    imageLink.prepend(element("span", "image-fallback", (food?.name || restaurant.name).slice(0, 1)));
  };

  if (imageUrl) {
    const image = element("img", "card-image");
    image.src = imageUrl;
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
  if (!available) {
    badges.append(element("span", "closed-label", !restaurant.open ? "Closed now" : statusText));
  }

  if (restaurant.chowpass) {
    badges.append(element("span", "chowpass-badge", "Chowpass"));
  }

  if (badges.childElementCount) {
    imageLink.append(badges);
  }

  const media = element("div", `card-media${state.view === "hidden" ? " with-restore" : ""}`);
  const tools = element("div", "card-tools");
  const favourite = element("button", "card-action favourite-button");
  const saved = state.favourites.has(restaurant.id);
  favourite.type = "button";
  favourite.dataset.favouriteId = restaurant.id;
  if (food) {
    favourite.dataset.foodId = food.id;
  }
  favourite.setAttribute("aria-pressed", String(saved));
  favourite.setAttribute("aria-label", saved ? `Remove ${restaurant.name} from favourites` : `Save ${restaurant.name} to favourites`);
  favourite.title = saved ? "Remove from favourites" : "Save to favourites";
  favourite.append(icon("heart"));
  favourite.addEventListener("click", () => toggleFavourite(restaurant.id, food?.id ?? null));
  tools.append(favourite);

  if (state.view === "hidden") {
    const restore = element("button", "card-action restore-button", "Restore");
    restore.type = "button";
    restore.setAttribute("aria-label", `Restore ${restaurant.name}`);
    restore.addEventListener("click", () => restoreVendor(restaurant.id));
    tools.append(restore);
  } else {
    const menu = element("details", "vendor-menu");
    const summary = element("summary", "card-action", "⋯");
    summary.setAttribute("aria-label", `More actions for ${label}`);
    summary.title = "More actions";
    const panel = element("div", "vendor-menu-panel");
    const hide = element("button", "", "Hide vendor");
    hide.type = "button";
    hide.addEventListener("click", () => hideVendor(restaurant));
    panel.append(hide);
    menu.append(summary, panel);
    tools.append(menu);
  }

  media.append(imageLink, tools);

  const body = element("div", "card-body");
  const titleRow = element("div", "card-title-row");
  const title = element("h3", "card-title");
  const titleLink = element("a", "", food?.name || restaurant.name);
  titleLink.href = restaurant.url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.setAttribute("aria-label", `${label}, opens on Chowdeck in a new tab`);
  if (food?.description) {
    titleLink.title = food.description;
  }
  title.append(titleLink);

  const rating = element("span", "card-rating");
  rating.append(element("span", "star", "★ "));
  rating.append(document.createTextNode(restaurant.rating === null ? "New" : restaurant.rating.toFixed(1)));
  rating.append(element("span", "rating-count", `(${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(restaurant.reviewCount)})`));
  rating.setAttribute("aria-label", restaurant.rating === null ? "No rating yet" : `Rated ${restaurant.rating} out of 5 from ${restaurant.reviewCount} reviews`);
  titleRow.append(title);
  if (!food) {
    titleRow.append(rating);
  }

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

  const status = element("div", `card-status${available ? "" : " unavailable"}`);
  status.append(element("span", "status-dot"), document.createTextNode(statusText));
  const closing = element("p", "card-closing", closingText(restaurant, clock));
  closing.title = `Scheduled hours in ${state.currency === "GHS" ? "Ghana" : "Nigeria"} local time. Availability may change.`;
  const availability = element("div", "card-availability");
  availability.append(status, closing);
  body.append(titleRow);
  if (food) {
    const price = element("p", "food-price");
    price.append(document.createTextNode(food.price === null ? "Price unavailable" : money(food.price, food.currency)));
    if (food.originalPrice !== null) {
      price.append(element("s", "", money(food.originalPrice, food.currency)));
    }
    if (food.priceDescription) {
      price.append(element("small", "", food.priceDescription));
    }

    const vendor = element("div", "food-vendor");
    vendor.append(element("span", "", `From ${restaurant.name}`), rating);
    body.append(price, vendor);
  }

  body.append(element("p", "card-area", restaurant.location || "Vendor"), stats, availability);
  article.append(media, body);
  return article;
}

function renderChips(filters) {
  const labels = [];
  if (filters.rating) labels.push(`${filters.rating}+ stars`);
  if (filters.fee !== null) labels.push(filters.fee === 0 ? "Free delivery" : `Delivery ≤ ${money(filters.fee * 100)}`);
  if (filters.closing !== null) labels.push(`Open for ≥ ${$("closing-filter").selectedOptions[0].textContent}`);
  if (filters.discounts) labels.push("With discounts");
  if (filters.open) labels.push("Open now");
  if (filters.chowpass) labels.push("Chowpass only");
  if (filters.verified) labels.push("Verified only");
  $("active-filters").replaceChildren(...labels.map((label) => element("span", "filter-chip", label)));
  $("active-filters").hidden = labels.length === 0;
}

function addressClock(now = Date.now()) {
  const timeZone = state.address?.country.toLowerCase() === "ghana" ? "Africa/Accra" : "Africa/Lagos";
  return localClock(now, timeZone);
}

function loadedVendors() {
  return [...new Map([...state.restaurants, ...foodSearch.state.groups.map((group) => group.vendor)]
    .map((vendor) => [vendor.id, vendor])).values()];
}

function matchingVendors(filters, clock) {
  let source = state.restaurants;
  if (state.view === "hidden") {
    source = loadedVendors();
  } else if (showingFood()) {
    source = foodSearch.state.groups
      .filter((group) => group.foods.some((food) => !filters.open || food.inStock === true))
      .map((group) => group.vendor);
  }

  const vendors = vendorsInView(source, state.view, state.favourites, state.hidden);
  const applied = showingFood() ? { ...filters, query: "" } : filters;
  return state.view === "hidden" ? vendors : filterRestaurants(vendors, applied, clock);
}

function renderViews() {
  const managingHidden = state.view === "hidden";
  for (const view of ["all", "favourites", "hidden"]) {
    $(`view-${view}`).setAttribute("aria-pressed", String(state.view === view));
  }

  $("view-favourites").textContent = `Favourites (${state.favourites.size})`;
  $("view-hidden").textContent = `Hidden vendors (${state.hidden.size})`;
  $("view-note").hidden = state.view === "all";
  $("view-note").textContent = managingHidden
    ? "Only API-loaded hidden vendors appear here. Search and preference filters are paused so you can restore them."
    : showingFood()
      ? "Food from API-loaded favourites appears here. Your filters still apply, and hidden vendors stay hidden."
      : "Only API-loaded favourites appear here. Your filters still apply, and hidden vendors stay hidden. Load more to find saved vendors from later pages.";
  $("filter-form").inert = managingHidden;
  document.querySelector(".filters").classList.toggle("filters-paused", managingHidden);
  $("reset-filters").disabled = managingHidden;
  $("vendor-search").disabled = managingHidden;
  $("clear-vendor-search").disabled = managingHidden;
  $("search-vendors").setAttribute("aria-pressed", String(state.searchMode === "vendors"));
  $("search-food").setAttribute("aria-pressed", String(state.searchMode === "food"));
  $("search-vendors").disabled = managingHidden;
  $("search-food").disabled = managingHidden;
  const searchLabel = state.searchMode === "food" ? "What are you craving?" : "Search vendors by name";
  $("vendor-search-label").textContent = searchLabel;
  $("vendor-search").placeholder = `${searchLabel}…`;
  $("clear-vendor-search").setAttribute("aria-label", "Clear search");
  $("vendor-search-help").textContent = managingHidden
    ? "Search is paused while managing hidden vendors."
    : state.searchMode === "food"
      ? "Search restaurant menus near your address. Refine your query for different matches; vendor filters and sorting still apply."
      : "Searches the vendors you’ve loaded.";
}

function renderPick(restaurant) {
  $("pick-result").hidden = !restaurant;
  $("pick-result").replaceChildren();
  if (!restaurant) {
    return;
  }

  const link = element("a", "", `${restaurant.name} ↗`);
  link.href = restaurant.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Order from ${restaurant.name} on Chowdeck, opens in a new tab`);
  $("pick-result").append(document.createTextNode("Your pick: "), link);
}

function render() {
  const filters = preferences();
  const now = Date.now();
  const clock = addressClock(now);
  const order = $("sort-order").value;
  const food = showingFood();
  const loading = food ? foodSearch.state.loading || (!state.address && state.loading) : state.loading;
  const error = food && state.address ? foodSearch.state.error : state.error;
  const matches = sortRestaurants(matchingVendors(filters, clock), order, now);
  const groups = new Map(foodSearch.state.groups.map((group) => [group.vendor.id, group.foods]));
  const pick = state.view === "hidden" ? null : matches.find((restaurant) => restaurant.id === state.pickId);
  if (pick) {
    matches.splice(matches.indexOf(pick), 1);
    matches.unshift(pick);
  }

  const foods = food ? matches.flatMap((vendor) => groups.get(vendor.id)
    .filter((item) => !filters.open || item.inStock === true).map((item) => ({ vendor, food: item }))) : [];
  state.pickId = pick?.id ?? null;
  renderPick(pick);
  $("pick-for-me").disabled = matches.length === 0 || state.view === "hidden";
  renderViews();
  renderChips(filters);
  $("active-filters").hidden = state.view === "hidden" || $("active-filters").hidden;
  document.querySelector(".results").setAttribute("aria-busy", String(loading));
  const cards = food ? foods.map((item) => card(item.vendor, clock, item.food)) : matches.map((vendor) => card(vendor, clock));
  $("restaurant-grid").replaceChildren(...cards);
  $("discount-sort-note").hidden = order !== "discount";
  $("results-error").hidden = !error;
  $("results-error-text").textContent = error;
  $("loading-state").hidden = !loading || matches.length > 0;
  $("empty-state").hidden = loading || Boolean(error) || matches.length > 0;
  $("pagination").hidden = food || !state.address || state.restaurants.length === 0 || (!state.hasMore && matches.length === 0);
  $("load-more").hidden = !state.hasMore;
  $("load-more").disabled = state.loading;
  $("load-more").firstChild.textContent = state.loading ? "Loading vendors… " : "Load more vendors ";
  renderFreshness();
  $("clear-vendor-search").hidden = filters.query.length === 0;

  if (state.address) {
    $("results-heading").textContent = state.view === "hidden" ? "Hidden vendors" : food ? "Food near you" : state.view === "favourites" ? "Your favourites" : "Vendors near you";
    const count = state.view === "hidden" ? `${matches.length} hidden` : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
    const loadedCount = state.view === "hidden" ? loadedVendors().length : state.restaurants.length;
    $("results-summary").textContent = food
      ? `${foods.length} food ${foods.length === 1 ? "match" : "matches"} · ${matches.length} matching ${matches.length === 1 ? "vendor" : "vendors"}`
      : `${count} · ${loadedCount} vendors loaded`;
    if (state.view === "hidden") {
      $("pagination-note").textContent = state.hasMore
        ? "Showing API-loaded hidden vendors. There are more vendors to load."
        : "All currently loaded hidden vendors are shown.";
    } else {
      $("pagination-note").textContent = state.hasMore
        ? `Filters apply to ${state.restaurants.length} loaded vendors. There are more to explore.`
        : `All ${state.restaurants.length} vendors loaded. You’re seeing every match.`;
    }

    if (!matches.length && !loading && !error) {
      const searching = filters.query.trim().length > 0;
      let title = "No vendors here just yet.";
      let message = "Try a nearby street or a different delivery address.";
      if (state.restaurants.length) {
        title = searching ? "No vendors match that search." : "A little too particular?";
        message = searching ? "Try a different name or relax a filter." : "Try relaxing a filter to find something good.";
        if (state.hasMore) {
          message += " You can also load more vendors below.";
        }
      }

      if (food) {
        title = filters.query.trim() ? "No food matches just yet." : "What are you craving?";
        message = filters.query.trim()
          ? "Try a different food name or relax a vendor filter."
          : "Type a dish, ingredient or food name to search near your address.";
        if (state.view === "favourites") {
          message += " Only saved, visible vendors are included in this view.";
        }
      } else if (state.view === "favourites") {
        title = state.favourites.size ? "No favourites match just yet." : "Your favourites start here.";
        message = state.favourites.size
          ? "Favourites appear after the API loads them. Try relaxing a filter or loading more vendors."
          : "Tap the heart on a vendor to save it here.";
      } else if (state.view === "hidden") {
        title = state.hidden.size ? "No hidden vendors in these results." : "Nothing hidden.";
        message = state.hidden.size ? "Your hidden IDs are saved. Load more vendors to find them in the API results." : "Vendors you hide will appear here after the API loads them.";
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
$("pick-for-me").addEventListener("click", () => {
  if (state.view === "hidden") {
    return;
  }

  const matches = matchingVendors(preferences(), addressClock());
  const pick = matches[Math.floor(Math.random() * matches.length)];
  state.pickId = pick?.id ?? null;
  render();
});
for (const view of ["all", "favourites", "hidden"]) {
  $(`view-${view}`).addEventListener("click", () => {
    state.view = view;
    render();
  });
}
$("undo-hide").addEventListener("click", () => {
  if (undoHiddenId !== null) {
    restoreVendor(undoHiddenId);
  }
});
for (const mode of ["vendors", "food"]) {
  $(`search-${mode}`).addEventListener("click", () => {
    state.searchMode = mode;
    state.pickId = null;
    rememberFilters();
    if (!syncFoodSearch()) render();
  });
}
$("vendor-search").addEventListener("input", () => {
  rememberFilters();
  if (!syncFoodSearch()) render();
});
$("clear-vendor-search").addEventListener("click", () => {
  $("vendor-search").value = "";
  rememberFilters();
  if (!syncFoodSearch()) render();
  $("vendor-search").focus();
});
$("reset-filters").addEventListener("click", () => {
  $("filter-form").reset();
  $("vendor-search").value = "";
  state.pickId = null;
  rememberFilters();
  if (!syncFoodSearch()) render();
});
$("load-more").addEventListener("click", () => loadRestaurants());
$("retry-button").addEventListener("click", () => {
  if (showingFood() && state.address) {
    void foodSearch.load();
  } else {
    retryLastRequest?.();
  }
});

function refreshHours() {
  if (!document.hidden && (state.restaurants.length || foodSearch.state.groups.length)) {
    render();
  }
}

setInterval(refreshHours, 60000);
document.addEventListener("visibilitychange", () => {
  refreshHours();
  if (!document.hidden) {
    refreshIfDue();
    foodSearch.refreshIfDue();
  }
});

restoreFilters();
const lastAddress = readLastAddress();
if (lastAddress) {
  applyAddress(lastAddress);
  loadRestaurants(true);
} else {
  render();
}
