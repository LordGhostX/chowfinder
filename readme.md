# Chowfinder

Explore Chowdeck vendors near an address and filter them by your preferences.

## Run locally

Run this command from the project directory, then open [http://127.0.0.1:4173](http://127.0.0.1:4173):

```sh
npm run dev
```

The website has no runtime package dependencies or build step. Python 3 serves the static `dist` directory; Node.js runs the development checks.

## Filter and sort vendors

Enter an address and choose a search suggestion. The shared search bar has **Vendors** and **Food** modes and keeps your text when you switch. **Vendors** searches loaded vendor names by substring, ignoring case and surrounding spaces. **Food** searches restaurant menus through Chowdeck's API and displays matching items with photos, prices, stock status and their vendors. The query and search mode are remembered alongside your filters. **Clear** removes just the search; **Reset** clears the search and random pick, and restores the default filters. Available filters are:

- Minimum rating
- Maximum delivery fee
- Minimum time before closing: 30 minutes, 1 hour, 2 hours, 3 hours or 4 hours
- Discounts
- Open and available now
- Chowpass participation
- Verified status

**Ready when you are** and **Trust issues welcome** (verified only) start on for a first visit and after **Reset**. The verified filter requires `verification_status` to equal `verified`. Filters and sorting are remembered in this browser, including saved choices to turn off default filters.

**Closest** sorts by Chowdeck's numeric `distance` field, with missing distances last. Filters and sorting apply to the loaded vendors. The initial request and **Load more** each retrieve up to 100 vendors; the result count and pagination note show whether more remain. Selecting a vendor opens Chowdeck in a new tab.

In **Food**, filters and sorting use the item's vendor. **Ready when you are** also requires the food to be in stock. Food search returns a batch without pagination metadata, so **Load more** is available only in Vendors mode; refine the food query for different matches. Item links open the vendor on Chowdeck, where options and final prices can be checked.

**Most reviewed** sorts by review count. **Largest discount** sorts by the biggest active, published percentage offer on selected items, excluding expired or future-published offers. Cash discounts and text-only offers have no comparable percentage and sort after percentage offers.

**Pick for me** randomly chooses from the loaded vendors matching your current search and filters, moves its highlighted card to the front and shows an order link. In Food mode, it chooses a vendor offering matching food and moves that vendor's matching items first. The other cards keep your selected sort order. Each click makes a fresh choice, so picks can repeat. The choice clears if it no longer matches after a filter change or data refresh.

Use the heart on a card to save or remove a favourite. **Favourites** shows API-loaded saved vendors that match your current filters. The card's **⋯ → Hide vendor** action removes it from browsing, favourites and random picks, with an **Undo** option for eight seconds. **Hidden vendors** shows API-loaded hidden vendors with **Restore** buttons; search and preference filters are paused in that view, and random picking is disabled. Hiding a favourite keeps its favourite status, so restoring it brings it back to Favourites. **Reset** changes filters without clearing saved or hidden choices.

Cards show scheduled closing times in the delivery country's local time (Nigeria or Ghana), including overnight service from the previous day. Day-specific hours take precedence over default hours. **Stays open for at least** requires an open, available vendor with a known active schedule and at least the selected time remaining. Missing or invalid hours and schedules that do not cover the current time are excluded from this filter. Closing-time calculations update every minute while the page is visible and when returning to it, independently of API refreshes. Closing hours are scheduled times and do not guarantee availability until then.

## Data and browser storage

The browser calls Chowdeck's guest endpoints directly. Vendor listing requests omit `vendor_type` and keep all returned vendor types, including restaurants, supermarkets and pharmacies. Food mode calls `/customer/search/product` with `type=restaurant` to search restaurant menus. Card links use the vendor's Chowdeck category. Selecting an address sends the same address-selection POST as the storefront. No login or API key is used.

The last selected address ID, label and country are saved in this browser's local storage. Revisits reuse that address without repeating the address lookup or selection request, and fetch fresh vendor listings. Browser storage must be enabled to remember the address and preferences. Vendor availability and final fees can change at checkout.

Favourites and hidden choices are separate arrays of vendor IDs in `chowfinder.favourites` and `chowfinder.hiddenVendors`. No vendor names, images, prices or other card details are saved. The IDs survive reloads and address changes in this browser, but cards appear only when their vendors are present in the current API-loaded results. **Load more** in Vendors mode can bring saved or hidden vendors from later pages into view; Food mode uses the current menu search results. No extra detail requests or fallback cards are used. The selected view starts at **All vendors** on each visit.

Vendor results are cached in memory while the page is open and refreshed in the background every five minutes. Refreshes fetch the same number of pages already loaded, starting with a fresh pagination cursor, and replace the cached results only after the whole refresh succeeds. Your address, filters and sorting stay selected. Failed refreshes keep the previous results and retry after five minutes; the note below the cards shows the last update or refresh failure. Changing addresses or loading more cancels an in-flight refresh. If a browser delays a background timer, returning to the tab triggers an overdue refresh. These are listing GET requests; refreshing does not repeat address selection.

Food searches run after a brief pause in typing and refresh every five minutes while Food mode is selected. Changing the query, address or search mode cancels previous work and clears its results. Failed background refreshes keep the previous food results and retry after five minutes. Food results stay in memory only, including API-loaded vendors needed to restore a vendor hidden from a food card; no product or vendor card details are written to browser storage.

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
