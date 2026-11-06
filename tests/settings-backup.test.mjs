import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsBackup,
  parseSettingsBackup,
  saveSettingsBackup,
  SETTINGS_KEYS,
} from "../dist/settings-backup.js";

const settings = () => ({
  address: { id: 18957, label: "Lekki Phase 1", country: "Nigeria" },
  preferences: {
    rating: 4,
    fee: 1500,
    mealBudget: 5000,
    closing: 60,
    discounts: true,
    open: false,
    chowpass: true,
    verified: false,
    query: "rice",
    sort: "distance",
    searchMode: "food",
  },
  favourites: [12, 34],
  hiddenVendors: [34, 56],
});

const encode = (changes = {}) => JSON.stringify({
  ...createSettingsBackup(settings()),
  ...changes,
});

test("a JSON backup round-trips every saved setting, including disabled defaults and overlapping vendor choices", () => {
  const backup = createSettingsBackup(settings());
  assert.equal(backup.format, "chowfinder-settings");
  assert.equal(backup.version, 1);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  assert.deepEqual(parseSettingsBackup(JSON.stringify(backup)), settings());
});

test("backups support no address and deduplicate vendor IDs without creating vendor records", () => {
  const parsed = parseSettingsBackup(encode({
    address: null,
    favourites: [12, 12, 34],
    hiddenVendors: [],
  }));
  assert.equal(parsed.address, null);
  assert.deepEqual(parsed.favourites, [12, 34]);
  assert.deepEqual(parsed.hiddenVendors, []);
});

test("the cheapest meal sort survives a settings backup and restore", () => {
  const preferences = { ...settings().preferences, sort: "meal-price" };
  assert.equal(parseSettingsBackup(encode({ preferences })).preferences.sort, "meal-price");
});

test("invalid or incompatible files are rejected before settings can be restored", () => {
  const preferences = settings().preferences;
  const invalidFiles = [
    "not JSON",
    "null",
    "[]",
    encode({ format: "another-app" }),
    encode({ version: 2 }),
    encode({ address: { id: "18957", label: "Lekki", country: "Nigeria" } }),
    encode({ address: { id: 18957, label: " ", country: "Nigeria" } }),
    encode({ favourites: [12, "34"] }),
    encode({ hiddenVendors: [0] }),
    encode({ hiddenVendors: [{ id: 56, name: "Cached vendor" }] }),
    encode({ preferences: { ...preferences, open: "false" } }),
    encode({ preferences: { ...preferences, fee: 1234 } }),
    encode({ preferences: { ...preferences, sort: "unknown" } }),
    encode({ preferences: { ...preferences, searchMode: "unknown" } }),
    encode({ preferences: { ...preferences, query: "x".repeat(121) } }),
    encode({ preferences: {} }),
  ];

  for (const file of invalidFiles) {
    assert.throws(() => parseSettingsBackup(file), Error);
  }
});

function memoryStorage(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("import replaces the existing saved settings and removes the old address when the backup has none", () => {
  const storage = memoryStorage({
    [SETTINGS_KEYS.address]: JSON.stringify(settings().address),
    [SETTINGS_KEYS.favourites]: "[999]",
    "unrelated.setting": "keep me",
  });
  const imported = parseSettingsBackup(encode({ address: null }));
  saveSettingsBackup(storage, imported);

  assert.equal(storage.getItem(SETTINGS_KEYS.address), null);
  assert.deepEqual(JSON.parse(storage.getItem(SETTINGS_KEYS.preferences)), imported.preferences);
  assert.deepEqual(JSON.parse(storage.getItem(SETTINGS_KEYS.favourites)), [12, 34]);
  assert.deepEqual(JSON.parse(storage.getItem(SETTINGS_KEYS.hiddenVendors)), [34, 56]);
  assert.equal(storage.getItem("unrelated.setting"), "keep me");
});

test("a failed storage write restores the settings already replaced by this import", () => {
  const original = {
    [SETTINGS_KEYS.address]: '{"id":123,"label":"Old area","country":"Ghana"}',
    [SETTINGS_KEYS.preferences]: '{"open":true}',
    [SETTINGS_KEYS.favourites]: "[999]",
  };
  const storage = memoryStorage(original);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === SETTINGS_KEYS.hiddenVendors) {
      throw new Error("Storage quota exceeded");
    }
    setItem(key, value);
  };

  assert.throws(() => saveSettingsBackup(storage, settings()), /Storage quota exceeded/);
  for (const [key, value] of Object.entries(original)) {
    assert.equal(storage.getItem(key), value);
  }
  assert.equal(storage.getItem(SETTINGS_KEYS.hiddenVendors), null);
});
