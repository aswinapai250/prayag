# PRD — Gesture Puzzle Photo-Booth

## What We're Building
A browser-based, webcam-driven photo-booth that turns into a jigsaw puzzle. No mouse, no keyboard, no touchscreen — every core action happens through hand gestures read live off the webcam feed via MediaPipe Hands.

- **Two-hand pinch** → freeze frame, 3-second countdown, capture snapshot
- **One-hand pinch + move** → grab and drag a puzzle tile
- Captured photo is sliced into a 3x3 grid and scattered as tiles
- Solving the puzzle (all tiles snapped to correct slots) triggers a celebration effect
- Reset happens via an on-screen button or auto-timeout — never a gesture

## Target Audience
- **Primary:** School students (roughly ages 10–17) visiting a college tech fest booth
- **Context:** Queue-based booth, one participant (or small group) at a time in front of a single laptop, small huddle of 2-3 onlookers watching
- **Assumed technical literacy:** None. Instructions must be visual/obvious, not read from a manual
- **Attention span:** Low. If nothing happens in ~2 seconds of them waving a hand, they walk off

## Why This Concept (Context)
- Zero hardware to source — laptop + built-in/USB webcam only, no lab dependency, no ordering parts
- Built in under a week by a 6-person team, mostly via AI-assisted ("vibe coded") generation in Cursor
- Deliberately trimmed to **two gesture states only** (two-hand pinch, one-hand pinch-drag) — a third state (originally a closed-fist reset) was cut because shaky/excited kid-hands made it easily confusable with the drag gesture. Reliability under crowd conditions took priority over feature count.

## Core Features (MVP — must work for the fest)
1. Live webcam feed rendered to canvas with visible hand-tracking dots (fingertip markers) so users can tell the system sees them
2. Two-hand pinch detection → 3-second countdown overlay → snapshot capture
3. Captured photo auto-sliced into a 3x3 grid, tiles scattered on-screen
4. One-hand pinch-drag to move a tile; tile snaps into place near its correct slot and locks
5. "Solved!" celebration effect when all 9 tiles are placed
6. On-screen Reset button + auto-reset after 5s of no hand detected post-solve
7. Sidebar showing a stack/history of previously captured photo strips (vintage photo-booth look)
8. On-screen instruction banner ("Pinch both hands to capture! Pinch one hand to drag pieces!")

## Explicitly Out of Scope (for the one-week build)
- Fist gesture or any third gesture state
- Multiplayer / two simultaneous puzzles
- Cloud upload, sharing, printing, or QR-code download of photos
- Any network dependency during runtime (must run offline after initial load — fest wifi is unreliable)
- Difficulty levels, timers, or scoring
- Projector/big-screen layout — this is a single-laptop-screen experience by design

## Success Criteria for the Demo
- A first-time user (a random school kid) can figure out the capture gesture within ~5 seconds of a teammate's one-line verbal prompt, without reading instructions
- Gesture misfire rate is low enough that a full capture → puzzle → solve loop can be completed on stage without a team member manually intervening
- The app never needs a page refresh between users — reset must work reliably every time
