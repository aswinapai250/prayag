# Rules — Gesture Puzzle Photo-Booth

## Use
- Vanilla JS, HTML, CSS only — no frameworks (React/Vue/etc.), no bundler, no npm build step
- MediaPipe Hands via CDN script tag (not npm install) — keeps setup to "open the HTML file," no build required
- Native Canvas API for all rendering (webcam frame, dots, tiles, effects)
- Native `getUserMedia` for webcam access
- CSS transitions/animations for the celebration effect and tile-snap motion (cheap, reliable, no extra library)

## Avoid
- **No third gesture state.** Only `TWO_HAND_PINCH` (capture) and `ONE_HAND_PINCH_MOVE` (drag). Do not let Cursor/AI "helpfully" add a fist-gesture, swipe-gesture, or open-palm gesture back in — this was cut deliberately for reliability, not cut for time
- **No runtime network calls.** Nothing should fetch, upload, or ping any API once the page has loaded — fest wifi is not reliable enough to depend on mid-demo
- No heavy JS frameworks or state-management libraries (Redux, etc.) — this is a small single-page app, that's unnecessary weight and unnecessary bugs
- No cloud storage / photo upload / QR sharing features — out of scope, don't let AI scope-creep this in
- No gesture-based reset — reset is button-click or timeout only, never a hand gesture
- No precision-tuned pinch thresholds — err generous, since users are excited kids, not calibrated testers
- Don't let AI silently swap the 3x3 puzzle grid for a different size "for better difficulty" — 3x3 is the tested target for demo speed

## Error Handling
- **Webcam permission denied/unavailable:** show a clear on-screen message ("Please allow camera access") instead of a blank canvas or console-only error
- **No hand detected:** system should stay in idle state indefinitely, not throw or freeze — this will happen constantly between participants
- **MediaPipe fails to load (e.g. CDN hiccup):** show a fallback message on screen, don't let the whole page silently die with no feedback — a teammate needs to see instantly that something's wrong, not debug via console mid-fest
- **Pinch detected mid-drag but hand briefly leaves frame:** tile should stay at its last known position, not disappear or snap unpredictably
- **Rapid repeated pinch (jitter):** cooldown (~1s) after capture and debounce on drag-start to prevent flicker/false triggers
- All error states should be visually obvious on the laptop screen itself — no relying on opening dev tools during the live demo

## Boundaries for AI-Assisted Coding (Cursor)
- Build **incrementally, in this exact order**, confirming each stage works before moving to the next: (1) webcam + hand tracking + landmark dots → (2) two-hand pinch capture + countdown → (3) puzzle slicing/scatter → (4) one-hand pinch drag → (5) snap-to-place logic → (6) reset button + polish
- Don't let the AI restructure the folder layout or introduce a build step "for best practices" — the constraint is zero-install, open-and-run
- Don't accept AI suggestions to add libraries beyond what's listed in "Use" above unless the team explicitly agrees first
- Every AI-generated change should be tested live (webcam on, actual hand in frame) before accepting it — don't approve gesture-logic code from reading it alone
- If AI suggests "cleaner" gesture logic that reintroduces a third state or gesture-based reset, reject it — that decision is final for this build cycle, not up for re-litigation mid-week
