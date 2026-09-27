# Licensing

## Overview

Under a Dark Star is a fork of the OpenFront.io project by January Games. This
document records what is licensed how, and the history OpenFront's own
LICENSING.md documented, because the terms attached to a given file depend on
when it entered the tree.

In short:

- **Code** (everything outside `resources/` and `branding/`): GNU AGPL-3.0,
  with OpenFront's additional §7 attribution terms (see `LICENSE`). Our
  modifications are AGPL-3.0 too, and the complete source of the version we
  host is published at <https://github.com/thomasa13813/UnderADarkStar>.
- **Open assets** (`resources/`): Creative Commons BY-SA 4.0 (see
  `LICENSE-ASSETS`).
- **Branding** (`branding/`): © January Games, All Rights Reserved (see
  `branding/LICENSE`).

## Obligations we carry as a fork

- Keep "© OpenFront and Contributors" reasonably visible. It is in the footer
  of the home page and on the game-start screen. Do not remove it.
- Do not present the game as OpenFront or imply OpenFront's endorsement. The
  game is titled "Under a Dark Star"; "OpenFront" appears only in attribution.
- Offer the source of the server we host to its players (AGPL §13). The
  footer's "Source" link is that offer and must point at the deployed code.
- Ship anything derived from `resources/` under CC BY-SA 4.0 with attribution.
- Never re-add OpenFront's proprietary assets (see below).

## Timeline

### Phase 1: MIT Only

- **Commits:** Initial commit through commit before 25d5cc370207fd39e0c3bcaa69873b8fc6c60e68
- **Date Range:** 2024 - March 25, 2025
- **License:** MIT License only
- **Applies to:** Entire project
- **Copyright Holders:** WarFront.io Team, OpenFront Inc. (and contributors)
- **Note:** OpenFront.io extensively modified/replaced almost all original code

### Phase 2: Mixed MIT/GPL

- **Starting Commit:** 25d5cc370207fd39e0c3bcaa69873b8fc6c60e68
- **Date:** March 25, 2025
- **Licenses:**
  - GPL v3.0 for `src/client` directory
  - MIT for all other directories
- **Copyright Holders:** OpenFront Inc. (and contributors)
- **Note:** Created split licensing structure with copyleft for client code

### Phase 3: AGPL + Creative Commons

- **Starting After:** 9d5c108b83937a30ab42de6b1dca5a64e577aaac
- **Date:** September 4, 2025
- **Licenses:**
  - **Code:** Licensed under AGPL v3.0 (entire codebase)
  - **Assets:** Creative Commons BY-SA 4.0 (all non-code assets)
- **Copyright Holders:** OpenFront Inc. (and contributors)
- **Changes:**
  - Unified licensing approach (no more directory-specific licenses)
  - Upgraded from GPL v3 to AGPL v3 for stronger network copyleft
  - Added Creative Commons BY-SA 4.0 for all assets
  - All new code is AGPL v3.0 only

### Phase 4: Mixed Asset Licensing

- **Starting After:** c2cf2ce65f74ac91859f68a84aec89aeda5722ee
- **Date:** September 28, 2025
- **Licenses:**
  - **Code:** AGPL v3.0 (unchanged from Phase 3)
  - **Open Assets (/resources):** Creative Commons BY-SA 4.0 (unchanged from Phase 3)
  - **Proprietary Assets (/proprietary):** All Rights Reserved
- **Copyright Holders:** OpenFront Inc. and Contributors
- **Changes:**
  - Added `/proprietary` directory for copyrighted assets
  - Established dual-track asset licensing structure
  - Open assets in `/resources` remain CC BY-SA 4.0
  - Proprietary assets override open assets during build process
  - Contributors retain copyright while granting usage rights to OpenFront Inc.

### Phase 5: Update AGPL Additional Attribution Terms

- **Starting After:** 9edf0349cb54db84d81f229091870242fabadce3
- **Date:** December 16, 2025
- **Changes:**
  - Added Section 7 additional terms to AGPL v3.0
  - Copyright notice preservation requirement in visible locations
  - Prohibition of misrepresentation for modified versions

### Phase 6: The Under a Dark Star fork

- **Date:** 2026 (fork of OpenFront.io by January Games)
- **Licenses:**
  - **Code:** AGPL v3.0 with OpenFront's §7 terms (unchanged)
  - **Open Assets (/resources):** Creative Commons BY-SA 4.0 (unchanged)
  - **Branding (/branding):** © January Games, All Rights Reserved
- **Changes:**
  - Renamed the game to "Under a Dark Star" as the §7 terms require of a
    modified version
  - Removed OpenFront's `/proprietary` directory (logos, wordmark font,
    favicon, music) from the repository and the build
  - Removed the advertising, analytics and third-party platform integrations,
    and the features that depend on OpenFront's closed API
  - Added `/branding` for January Games' own marks, on the same override
    mechanism `/proprietary` used
  - Attribution to OpenFront kept in the footer, the game-start screen and
    `CREDITS.md`

## Important Notes

### For Code:

- All code prior to September 4, 2025 remains available under its original license (MIT or GPL as applicable from historical commits)
- New code contributions from September 4, 2025 forward are licensed under AGPL v3 only
- Forks and derivative works MUST comply with AGPL v3 terms
- Historical MIT-licensed code remains available under MIT from previous commits

### Legal Considerations:

- The AGPL's network copyleft provisions are stronger than GPL v3
- When combining code, the most restrictive compatible license applies to the combined work
- This document is not legal advice; consult legal counsel for specific compliance questions

# Asset Licensing

## Repository Assets

All assets in `/resources` (graphics, sounds, music, models, fonts, map data)
are licensed under Creative Commons BY-SA 4.0. Third-party data with its own
terms is listed in `CREDITS.md`.

## Branding Assets

Everything in `/branding` is © January Games, All Rights Reserved. It exists
so the AGPL code can be reused without the "Under a Dark Star" identity, and a
modified version must replace it. See `/branding/LICENSE`.

## OpenFront's External and Proprietary Assets

The following are NOT included in this repository and are NOT covered by any
licence here:

- Assets in OpenFront's `/proprietary` folder (logos, `OpenFront.ttf`, favicon,
  menu theme, gameplay music, game-start alert)
- Assets hosted on OpenFront's CDN, servers or database
- Premium skins, patterns, models and textures served by OpenFront's API

These are Copyright © 2024-2026 OpenFront Inc., All Rights Reserved. They must
not be added to this project.

## Historical MIT License

Portions Copyright (c) 2024 WarFront.io Team
Portions Copyright (c) 2024-2025 OpenFront Inc. (and contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
