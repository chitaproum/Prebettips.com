# Advertising setup

All six display-ad placements are managed in **ads.js**. Affiliate bookmaker
cards are separate and unchanged. No real advertiser code or IDs are included.

## Upload to GitHub Pages
Upload the files INSIDE this folder to your existing site's publishing folder.
Keep index.html, app.js, styles.css, data.js, theme.js and ads.js together.
The updated index.html loads ads.js after app.js. The updated app.js names its
dynamically created sidebar and in-table placements. Do not upload only ads.js
unless you also add `<script src="ads.js"></script>` after app.js yourself.
The script can detect the older layout, but explicit slot names are preferred.

## Placements
- top: banner above Featured matches
- below: banner below the predictions table
- inTable: repeat banners inserted by the existing match-table renderer
- sidebar: rectangle below Countries
- footer: banner above the footer
- anchor: dismissible sticky bottom banner

## Option 1: image banner
In ads.js, change the relevant CONFIG.slots entry to:

```js
top: {
  enabled: true,
  type: 'image',
  image: 'images/banner.jpg',
  href: 'https://YOUR-SPONSOR.example',
  alt: 'Your sponsor'
},
```
Upload the image at that relative path. Relative paths work with a GitHub Pages
repository subfolder. A leading slash points to the domain root instead.
Use an image that fits the reserved placement dimensions; large images shrink.

## Option 2: paste provider code

```js
sidebar: {
  enabled: true,
  type: 'html',
  html: `<PASTE YOUR TRUSTED PROVIDER'S EMBED CODE HERE>`
},
```
Replace the example placeholder with the actual HTML, not those words.
Backticks allow multiline snippets. Escape literal backticks as \` and template
interpolation sequences as \${ if they appear in your provider's code.
Only insert code from providers you trust: scripts run with your website's
permissions. Providers using document.write or expecting parser-time execution
need custom integration; this loader cannot support every ad network.
For an iframe embed, use the provider's HTTPS URL and suitable dimensions.
The custom anchor remains 54px high, so use a compatible small creative.

## Option 3: AdSense
Set adsenseClient to your real ca-pub-NUMBERS publisher ID. Then set an entry:

```js
top: { enabled: true, type: 'adsense', slot: 'YOUR_NUMERIC_AD_UNIT_ID', format: 'auto' },
```
Use real numeric IDs, not the example strings. The loader is included once and
initializes units when visible. Do not paste the AdSense loader again.
An approved account/site and policy-compliant setup are required; this file
does not provide approval. Check provider rules for betting-related content.
Prefer top/below/sidebar/footer placements; disable inTable to avoid repeated
units and excessive ad density. Do not use this custom sticky anchor for
AdSense: use Google's managed anchor format through its own settings instead.
Site verification tags and ads.txt, if requested by your provider, are separate
setup steps. Ad blockers, pending approval or no ad inventory can leave blanks.

## Hide or disable ads
- Disable one: `anchor: { enabled: false }`
- Disable all: set CONFIG.enabled to false.
- Hide unconfigured placeholders: set CONFIG.showPlaceholders to false.
- Defaults keep the existing placeholder banners; they are not real ads.

## Consent
CONFIG.consentGranted defaults to true: configured ads will load without a
consent gate. Where consent is required, change it to false BEFORE deployment
and connect your consent platform to `PreBetAds.setConsent(true)` after consent.
`PreBetAds.setConsent(false)` hides/removes current creative content and stops
new loads, but cannot undo trackers or cookies from previously executed code.
Use your provider's required CMP and revocation procedure. This script is not
a consent-management platform, legal compliance guarantee, or ad-network SDK.

## Testing
After deployment, hard-refresh. Check browser Console and Network for failed
loads. Test desktop/mobile, theme switching, table filtering and sticky close.
If a snippet relies on unique IDs, do not repeat it in inTable placements.
External networks and real browser rendering were not tested during packaging.
