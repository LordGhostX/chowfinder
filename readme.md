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
- Minimum time before closing: 30 minutes, 1 hour, 2 hours, 3 hours or 4 hours
- Discounts
- Open and available now
- Chowpass participation
- Verified status

**Ready when you are** and **Trust issues welcome** (verified only) start on for a first visit and after **Reset**. The verified filter requires `verification_status` to equal `verified`. Filters and sorting are remembered in this browser, including saved choices to turn off default filters.

**Closest** sorts by Chowdeck's numeric `distance` field, with missing distances last. Filters and sorting apply to the loaded restaurants. **Load more** retrieves the next 30; the result count and pagination note show whether more remain. Selecting a restaurant opens Chowdeck in a new tab.

**Most reviewed** sorts by review count. **Largest discount** sorts by the biggest active, published percentage offer on selected items, excluding expired or future-published offers. Cash discounts and text-only offers have no comparable percentage and sort after percentage offers.

**Pick for me** randomly chooses from the loaded restaurants matching your current search and filters, moves its highlighted card to the front and shows an order link. The other cards keep your selected sort order. Each click makes a fresh choice, so picks can repeat. The choice clears if it no longer matches after a filter change or data refresh.

Cards show scheduled closing times in the delivery country's local time (Nigeria or Ghana), including overnight service from the previous day. Day-specific hours take precedence over default hours. **Stays open for at least** requires an open, available restaurant with a known active schedule and at least the selected time remaining. Missing or invalid hours and schedules that do not cover the current time are excluded from this filter. Closing-time calculations update every minute while the page is visible and when returning to it, independently of API refreshes. Closing hours are scheduled times and do not guarantee availability until then.

## Data and browser storage

The browser calls Chowdeck's guest endpoints directly. Selecting an address sends the same address-selection POST as the storefront. No login or API key is used.

The last selected address ID, label and country are saved in this browser's local storage. Revisits reuse that address without repeating the address lookup or selection request, and fetch fresh restaurant listings. Browser storage must be enabled to remember the address and preferences. Restaurant availability and final fees can change at checkout.

Restaurant results are cached in memory while the page is open and refreshed in the background every five minutes. Refreshes fetch the same number of pages already loaded, starting with a fresh pagination cursor, and replace the cached results only after the whole refresh succeeds. Your address, filters and sorting stay selected. Failed refreshes keep the previous results and retry after five minutes; the note below the cards shows the last update or refresh failure. Changing addresses or loading more cancels an in-flight refresh. If a browser delays a background timer, returning to the tab triggers an overdue refresh. These are listing GET requests; refreshing does not repeat address selection.

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
