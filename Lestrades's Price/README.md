# Lestrade's Prices Helper Script
Enhances Lestrade's by fetching grey market value data from GG.Deals and other sources.

## Requirements

This script is intentionally compatible with **Tampermonkey** and
**Violentmonkey**. It does not use Tampermonkey's `cookiePartition` attribute.
Instead, it temporarily stores the `cf_clearance` value in the userscript
manager's storage and adds that value to later GG.Deals requests.

The script may still contain hidden bugs. Other userscript managers may use
different cookie and request APIs so read their documentation and update the
code logic.

### First-time setup

1. Install the userscript manager and install this script.
2. Enable HTTP-only cookie access using the manager-specific instructions
   below.
3. Open `https://gg.deals` in the same browser profile.
4. Solve the Cloudflare check once.
5. Open Lestrades and click a GG.Deals button.

#### Tampermonkey

1. Open **Settings → General → Config Mode → Advanced**.
2. Scroll to **Security → Allow scripts to access cookies**.
3. Set it to **All** and save.

#### Violentmonkey

1. Open **Settings → Backup**.
2. Enable **Allow GM_cookie to access HTTP-only cookies (only for scripts with
   this option enabled in their settings)**.
3. Open **Installed Scripts → Lestrades-Prices → Settings**.
4. Enable **Allow GM_cookie to access HTTP-only cookies** and save.

## Android

You can use **Firefox/Microsoft Edge + Tampermonkey/Violentmonkey** or **Anything that supports Tampermonkey/Violentmonkey**

## iOS

No solution at the moment

[Safari Issue](https://github.com/Tampermonkey/tampermonkey/issues/2252)

## Logic

1. When you visit `gg.deals`, the script looks for the `cf_clearance` cookie.
2. If the cookie is found, its value is temporarily stored in the userscript
   manager's storage.
3. When you click a GG.Deals button on a Lestrades game page, the script reads
   the stored value and adds it to the request.

The script itself does not have enough permission to read `HttpOnly` cookies.
That permission must be enabled in the userscript manager's settings.

## Compatibility and limitations

Browser cookie behavior is not identical across browsers. In particular,
Firefox and Chrome can handle cookies differently so compatibility with every
browser cannot be guaranteed.

The original tested combinations are:

- Chrome: Tampermonkey and Violentmonkey
- Firefox: Tampermonkey and Violentmonkey

## Key Features

1. **Price Fetching**
   - Fetches prices for games and items listed on Lestrades.com; just use the Soft Load button in the Tampermonkey menu.
   - Prices are cached locally to reduce redundant requests and improve performance.

2. **Caching**
   - Stores price data in local storage.
   - Configurable refresh intervals ensure stale prices are automatically updated.
   - Automatically purges items older than 30 days.

3. **Auto-Loading**
   - Automatically fetches a configurable number of prices per page at 500ms intervals.
   - Optional setting to avoid auto-loading if you prefer manual fetching only.

4. **User Interface**
   - Adds small icons/buttons next to each game/item title to fetch or refresh prices on demand.
   - Provides a “View Cached Prices” popup with search and pagination for quick navigation.
     - Shows normalized spacing and a human-readable “price age” (e.g., “22.8 hours,” “2.4 days”).
   - Includes menu commands for:
     - Viewing and searching all cached prices
     - Clearing cached data with confirmation
     - “Soft Load” (fetch missing prices only)
     - “Hard Load” (refresh all prices)

5. **Customization**
   - All settings (e.g., cache duration, auto-fetch count, etc.) can be tweaked in the script’s config.
   - Global rate limit ensures no more than 10 requests per minute.
   - Easily enable or disable specific features via built-in config constants.

## Images:

Lestrade's offer page:
![Lestrades offer page](https://i.imgur.com/DrKcJ03.png)

Lestrade's offer creation page:
![Lestrades offer creation page](https://i.imgur.com/iCB27Ev.png)

Lestrade's matches page:
![Lestrades matches page](https://i.imgur.com/C6NBAR8.png)

Lestrade's bundle page:
![Lestrade's bundle page](https://i.imgur.com/9c6fneo.png)
