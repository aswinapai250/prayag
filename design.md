# Design — Gesture Puzzle Photo-Booth

## Visual Direction
Vintage photo-booth aesthetic meets a playful arcade feel — this needs to read as "fun and inviting" to a school kid walking past a booth, not as a technical demo. Warm, high-contrast, big and legible from a couple feet away since it's a small huddle watching, not one person up close.

## Color Palette
- **Background:** deep charcoal / near-black (`#1A1A1D`) — makes the webcam feed and UI elements pop, and hides camera noise/grain
- **Primary accent (capture/success):** warm amber/gold (`#F4A300`) — used for the countdown numbers, capture flash, and "Solved!" celebration
- **Secondary accent (in-progress/drag):** soft teal (`#3FBAC2`) — used for active tile highlighting and drag-state indicators
- **Alert/error:** muted red (`#E1523D`) — reserved only for camera/permission error states, not used decoratively
- **Sidebar background:** slightly lighter charcoal (`#242428`) to separate the photo-strip history from the main stage without competing with it
- **Text/instruction banner:** off-white (`#F5F1E8`) for warmth, avoid pure white (too harsh against the camera feed)

Keep the palette to these 5-6 colors total — no gradients, no neon overload. The captured photos and tracking dots provide the visual "noise"; the UI chrome should stay calm around them.

## Typography
- **Headings / countdown numbers / "Solved!" text:** a bold, rounded display font (e.g. "Fredoka", "Baloo 2", or "Poppins Bold" from Google Fonts) — friendly, chunky, readable at a glance, fits the playful vintage-booth tone
- **Instruction banner / body text:** a clean, highly legible sans-serif (e.g. "Inter" or "Nunito Sans") at a large size (minimum ~20px equivalent) — this is read quickly by someone standing, not sitting and reading closely
- **Countdown numbers specifically:** oversized (dominate center-screen), bold weight, high contrast against the frozen frame

## Component Styling Notes
- **Tracking dots** (fingertip markers): small, bright teal or amber circles with a subtle glow/drop-shadow — visible against any hand/skin tone or lighting condition, this is the user's only feedback that the system sees them
- **Countdown overlay:** large numbers centered on screen, semi-transparent dark backdrop behind them so they stay legible over any frame content
- **Puzzle tiles:** thin light border around each tile so grid seams are visible even mid-scatter; a subtle glow or scale-up effect on the tile currently being dragged, so it's obvious which one is "held"
- **Snap-to-place feedback:** quick scale-bounce + brief amber flash when a tile locks correctly — this is the main positive-feedback moment before final "Solved!"
- **Sidebar photo strips:** framed like classic vertical photo-booth strips (thin white border, slight rotation/stacking effect) to sell the vintage-booth feel
- **Instruction banner:** persistent, top of screen, short imperative text ("Pinch both hands to capture!") — swap text contextually as state changes (idle → countdown → puzzle → solved)
- **Reset button:** clearly visible, high-contrast, always in the same corner — this is a manual fallback and needs to be findable instantly by a teammate, not hunted for

## What to Avoid
- No dense text blocks — nobody reads a paragraph at a fest booth
- No small fonts anywhere in the primary interaction path
- No low-contrast color combos (e.g. teal text on charcoal is fine; amber-on-white is not — test everything against the actual webcam feed background, not a blank page)
- No skeuomorphic camera-shutter clutter — keep the chrome minimal so the puzzle and photo are the visual focus
