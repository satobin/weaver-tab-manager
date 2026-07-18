# Shared browser store assets

These listing images are shared by the Chrome Web Store and Microsoft Edge Add-ons.

## Current upload files

The stable top-level paths are the assets currently used for Store listings:

- [`large-promo-tile-1400x560.png`](large-promo-tile-1400x560.png) matches candidate `07-every-window-product`.
- [`small-promo-tile-440x280.png`](small-promo-tile-440x280.png) matches candidate `04-navy-tagline`.
- [`screenshots/01-active-windows-1280x800.png`](screenshots/01-active-windows-1280x800.png)
- [`screenshots/02-settings-1280x800.png`](screenshots/02-settings-1280x800.png)
- [`screenshots/03-saved-windows-1280x800.png`](screenshots/03-saved-windows-1280x800.png)

Screenshot number prefixes define the intended Store carousel order.

## Candidate library

- [`candidates/large-promo-tile-1400x560/`](candidates/large-promo-tile-1400x560/) contains the complete numbered set of large promotional images.
- [`candidates/small-promo-tile-440x280/`](candidates/small-promo-tile-440x280/) contains the complete numbered set of small promotional images.

Candidate filenames include the asset type, option number, distinguishing concept, and required dimensions so they remain identifiable when downloaded or copied elsewhere.

## Updating assets

- To change a promotional image, copy the preferred candidate over the corresponding stable top-level file.
- Replace current screenshots in place while preserving their numeric order and required dimensions.
- Use Git history for superseded screenshots instead of retaining every obsolete capture in the current tree.
- Add a screenshot to a candidate folder only when it is a meaningful reusable alternative.
