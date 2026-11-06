import { searchFood } from "./api.js";

const REFRESH_INTERVAL = 5 * 60 * 1000;

function emptyState(addressId = null, query = "") {
  return {
    addressId,
    query,
    groups: [],
    loading: false,
    refreshing: false,
    error: "",
    refreshedAt: 0,
    refreshFailed: false,
  };
}

export class FoodSearch {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = emptyState();
    this.enabled = false;
    this.controller = null;
    this.debounceTimer = null;
    this.refreshTimer = null;
    this.refreshDueAt = 0;
  }

  update(addressId, query, enabled) {
    query = query.trim();
    const active = Boolean(enabled && addressId && query);
    if (this.state.addressId === addressId && this.state.query === query && this.enabled === active) {
      return false;
    }

    this.controller?.abort();
    this.controller = null;
    clearTimeout(this.debounceTimer);
    clearTimeout(this.refreshTimer);
    this.refreshDueAt = 0;
    this.enabled = active;
    this.state = emptyState(addressId, query);
    if (active) {
      this.state.loading = true;
      this.debounceTimer = setTimeout(() => void this.load(), 400);
    }

    this.onChange();
    return true;
  }

  async load(background = false) {
    if (!this.enabled || this.controller) {
      return;
    }

    clearTimeout(this.debounceTimer);
    clearTimeout(this.refreshTimer);
    const controller = new AbortController();
    this.controller = controller;
    this.state.loading = !background;
    this.state.refreshing = background;
    if (!background) {
      this.state.error = "";
    }

    this.onChange();
    try {
      const groups = await searchFood(this.state.addressId, this.state.query, controller.signal);
      if (this.controller === controller && !controller.signal.aborted) {
        this.state.groups = groups;
        this.state.refreshedAt = Date.now();
        this.state.refreshFailed = false;
        this.state.error = "";
      }
    } catch (error) {
      if (this.controller === controller && !controller.signal.aborted) {
        if (background) {
          this.state.refreshFailed = true;
        } else {
          this.state.error = error instanceof Error ? error.message : "Couldn’t search for food. Please try again.";
        }
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.state.loading = false;
        this.state.refreshing = false;
        this.refreshDueAt = Date.now() + REFRESH_INTERVAL;
        this.refreshTimer = setTimeout(() => void this.load(true), REFRESH_INTERVAL);
        this.onChange();
      }
    }
  }

  refreshIfDue() {
    if (this.enabled && this.refreshDueAt && Date.now() >= this.refreshDueAt) {
      void this.load(true);
    }
  }
}
