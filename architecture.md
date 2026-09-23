# Architecture — Gesture Puzzle Photo-Booth

## Tech Stack
- **HTML5** — single-page structure
- **CSS** — layout, banner, sidebar, countdown overlay styling
- **Vanilla JavaScript (ES6+)** — no framework, no bundler, no build step
- **MediaPipe Hands (CDN)** — hand landmark detection (21 points per hand, up to 2 hands)
- **HTML5 Canvas API** — renders webcam feed, tracking dots, puzzle tiles, effects
- **getUserMedia** — webcam access

Deliberately no React/Vue/npm pipeline — this needs to run by opening an HTML file or a trivial static server, with zero install friction the morning of the fest.

## App Flow
1. **Load** → request webcam permission → start MediaPipe Hands on the video stream
2. **Idle state** → live feed + tracking dots shown, instruction banner visible, waiting for two-hand pinch
3. **Capture trigger** → both hands pinched simultaneously → 3-second countdown overlay → frame frozen → snapshot taken from canvas
4. **Puzzle state** → snapshot sliced into a 3x3 grid → 9 tiles scattered at random positions on the right/main area
5. **Drag loop** → one-hand pinch detected near a tile → tile follows hand position → pinch released → tile checked against its correct slot → snap + lock if close enough, otherwise stays where dropped
6. **Solved state** → all 9 tiles locked → celebration effect plays → completed strip pushed into sidebar history
7. **Reset** → via Reset button (click) or automatically after 5s of no hand detected post-solve → return to Idle state
8. Loop repeats for the next participant

## Gesture State Machine
Only two detectable states — this is a hard boundary, not a starting point to expand from mid-week:
- `TWO_HAND_PINCH` → capture trigger (with cooldown after each use)
- `ONE_HAND_PINCH_MOVE` → drag active tile

No third gesture. Reset is UI-driven (button/timeout), never gesture-driven — this was a direct fix for gesture-confusion risk under excited/shaky hand movement.

## Folder / File Structure
```
gesture-photobooth/
├── index.html              # single page: video/canvas, sidebar, banner, reset button
├── style.css               # layout, banner, countdown overlay, sidebar styling
├── app.js                  # entry point — wires up webcam, MediaPipe, and game loop
├── /js
│   ├── handTracking.js      # MediaPipe setup, landmark extraction, pinch-distance math
│   ├── gestureState.js      # state machine: idle / countdown / dragging / solved
│   ├── puzzle.js            # slicing captured image into tiles, scatter, snap-to-slot logic
│   ├── capture.js           # countdown overlay, frame freeze, snapshot logic
│   └── sidebar.js           # photo-strip history rendering
├── /assets
│   └── (fonts, icons, confetti/celebration graphics if any)
└── README.md
```

## Key Implementation Notes
- Pinch distance = Euclidean distance between thumb-tip and index-tip landmarks; threshold should be generous (tuned for messy, imprecise kid-hands, not precision users)
- Add a ~1 second cooldown after each capture to prevent immediate re-trigger
- Snap-to-slot logic: on pinch-release, compare dropped tile's center to its correct slot's center; if within a tolerance radius, animate into place and mark locked (no longer draggable)
- Everything must run **fully offline after initial page load** — no runtime API calls, since fest wifi may drop mid-demo
- Target: single laptop screen + built-in/USB webcam. Not designed for projector distances or multiple simultaneous users
