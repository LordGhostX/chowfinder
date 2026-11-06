# Chowfinder

Find Chowdeck vendors and food near your address, compare options, and order on Chowdeck.

[Open Chowfinder](https://chowfinder-nearby.restedpigeon616670.chatgpt.site/)

## Run locally

Requires Node.js/npm and Python 3. From the project directory:

```sh
npm run dev
```

Open [localhost:4173](http://127.0.0.1:4173). The app is static HTML, CSS and JavaScript, with no build step or runtime dependencies.

## Features

- Search vendor names or restaurant menus using the shared **Vendors / Food** search bar.
- Filter by rating, delivery fee, meal budget (Food mode), discounts, opening hours, Chowpass and verification. Open and verified start on by default.
- Sort by distance, rating, reviews, discount, delivery fee or delivery time. Food mode also offers **Cheapest meal**.
- Save favourites, hide vendors, or let **Pick for me** choose from your matches.
- See scheduled opening/closing times and preorder availability. Links open the vendor on Chowdeck.

## Data and saved settings

The browser calls Chowdeck’s guest API directly; no login or API key is needed. Filters apply to loaded results: Vendors loads up to 100 per page, while Food returns a search batch. Results refresh in the background every five minutes. Meal prices exclude delivery, packaging and extras; availability and final fees are confirmed on Chowdeck.

Your address, filters, sorting, search text/mode, and favourite/hidden vendor IDs are saved in this browser. **Export JSON** backs them up, including your address; **Import JSON** replaces the saved settings and reloads fresh API results. Vendor and food cards always come from the API, including in Favourites and Hidden vendors.

**Reset** restores default filters and clears the search and random pick. It keeps your address, favourites and hidden vendors.

## Development

Install development dependencies and run the checks:

```sh
npm ci
npm test
npm run check
```
