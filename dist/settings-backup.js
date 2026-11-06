export const SETTINGS_KEYS = {
  address: "chowfinder.lastAddress",
  preferences: "chowfinder.filters",
  favourites: "chowfinder.favourites",
  hiddenVendors: "chowfinder.hiddenVendors",
};

const OPTIONS = {
  rating: [0, 3.5, 4, 4.5],
  fee: [null, 0, 500, 1000, 1500, 2000, 3000],
  mealBudget: [null, 2000, 3000, 5000, 7500, 10000, 15000],
  closing: [null, 30, 60, 120, 180, 240],
  sort: ["recommended", "distance", "rating", "reviews", "discount", "fee", "time", "meal-price"],
  searchMode: ["vendors", "food"],
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function vendorIds(value) {
  if (!Array.isArray(value) || !value.every(validId)) {
    throw new Error("The backup contains invalid saved vendor IDs.");
  }

  return [...new Set(value)];
}

export function createSettingsBackup(settings) {
  return {
    format: "chowfinder-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...settings,
  };
}

export function parseSettingsBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("This isn’t valid JSON. Choose a Chowfinder settings export.");
  }

  if (!isObject(backup) || backup.format !== "chowfinder-settings") {
    throw new Error("Choose a JSON settings file exported by Chowfinder.");
  }
  if (backup.version !== 1) {
    throw new Error("This backup version isn’t supported by this version of Chowfinder.");
  }

  let address = null;
  if (backup.address !== null) {
    if (!isObject(backup.address) || !validId(backup.address.id)
      || typeof backup.address.label !== "string" || !backup.address.label.trim()
      || typeof backup.address.country !== "string") {
      throw new Error("The backup contains an invalid delivery address.");
    }

    address = {
      id: backup.address.id,
      label: backup.address.label.trim(),
      country: backup.address.country.trim(),
    };
  }

  const saved = backup.preferences;
  if (!isObject(saved)) {
    throw new Error("The backup is missing your preferences.");
  }

  const preferences = {};
  for (const [key, values] of Object.entries(OPTIONS)) {
    if (!values.includes(saved[key])) {
      throw new Error(`The backup contains an unsupported ${key} preference.`);
    }
    preferences[key] = saved[key];
  }

  for (const key of ["discounts", "open", "chowpass", "verified"]) {
    if (typeof saved[key] !== "boolean") {
      throw new Error(`The backup contains an invalid ${key} preference.`);
    }
    preferences[key] = saved[key];
  }

  if (typeof saved.query !== "string" || saved.query.length > 120) {
    throw new Error("The backup contains an invalid search query.");
  }
  preferences.query = saved.query;

  return {
    address,
    preferences,
    favourites: vendorIds(backup.favourites),
    hiddenVendors: vendorIds(backup.hiddenVendors),
  };
}

export function saveSettingsBackup(storage, settings) {
  const entries = Object.entries(SETTINGS_KEYS).map(([name, key]) => [
    key,
    settings[name] === null ? null : JSON.stringify(settings[name]),
  ]);
  const previous = new Map(entries.map(([key]) => [key, storage.getItem(key)]));
  const written = [];
  const write = (key, value) => {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  };

  try {
    for (const [key, value] of entries) {
      write(key, value);
      written.push(key);
    }
  } catch (error) {
    for (const key of written.reverse()) {
      write(key, previous.get(key));
    }
    throw error;
  }
}
