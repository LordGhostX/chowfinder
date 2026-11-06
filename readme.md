# Chowfinder

Explore Chowdeck restaurants near an address and filter them by your preferences.

## Run locally

Run this command from the project directory, then open [http://127.0.0.1:4173](http://127.0.0.1:4173):

```sh
npm run dev
```

The website has no runtime package dependencies or build step. Python 3 serves the static `dist` directory; Node.js runs the development checks.

## Filter and sort restaurants

Enter an address and choose a search suggestion. Search restaurant names by substring; matching ignores case and surrounding spaces. The search works alongside the other filters and is remembered with them. **Clear** removes just the search; **Reset** clears the search and restores the default filters. Available filters are:

- Minimum rating
- Maximum delivery fee
- Maximum estimated delivery time
- Discounts
- Open and available now
- Chowpass participation
- Verified status

**Ready when you are** and **Trust issues welcome** (verified only) start on for a first visit and after **Reset**. The verified filter requires `verification_status` to equal `verified`. Filters and sorting are remembered in this browser, including saved choices to turn off default filters.

**Closest** sorts by Chowdeck's numeric `distance` field, with missing distances last. Filters and sorting apply to the loaded restaurants. **Load more** retrieves the next 30; the result count and pagination note show whether more remain. Selecting a restaurant opens Chowdeck in a new tab.

## Data and browser storage

The browser calls Chowdeck's guest endpoints directly. Selecting an address sends the same address-selection POST as the storefront. No login or API key is used.

The last selected address ID, label and country are saved in this browser's local storage. Revisits reuse that address without repeating the address lookup or selection request, and fetch fresh restaurant listings. Browser storage must be enabled to remember the address and preferences. Restaurant availability and final fees can change at checkout.

## Development checks

Install the development dependencies with:

```sh
npm ci
```

Run the filter and sorting tests, then check JavaScript syntax:

```sh
npm test
npm run check
```

Playwright is a development-only dependency for browser testing. The API contract and original discovery evidence are in the parent workspace.
