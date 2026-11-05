Chowfinder

Run locally from this directory with npm run dev, then open http://127.0.0.1:4173. The website itself has no runtime dependencies or build step. Python 3 serves the static dist directory; Node.js runs the development checks.

Enter an address, choose a search suggestion, then filter by minimum rating, maximum delivery fee, maximum estimated delivery time, discounts, current availability, Chowpass participation, or verified status. Open and available and Verified only start on for a first visit and after Reset. Verified only requires verification_status to equal verified. Filters and sorting are remembered in this browser, including saved choices to turn off default filters. Closest sorts by Chowdeck's numeric distance field, with missing distances last. Filters and sorting apply to the loaded restaurants. Load more retrieves the next 30; the result count and pagination note show whether more remain. Selecting a restaurant opens Chowdeck in a new tab.

The browser calls Chowdeck's guest endpoints directly. Selecting an address sends the same address-selection POST as the storefront. No login or API key is used. The last selected address ID, label and country are saved in this browser's local storage. Revisits reuse that address without repeating the address lookup or selection request, and fetch fresh restaurant listings. Browser storage must be enabled to remember the address. Restaurant availability and final fees can change at checkout.

For development: npm ci installs the optional browser-testing dependency, npm test checks filter and sort behavior, and npm run check checks JavaScript syntax. The API contract and original discovery evidence are in the parent workspace.
