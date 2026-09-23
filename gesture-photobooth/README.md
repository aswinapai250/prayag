# Gesture Puzzle Photo-Booth

A browser-based, webcam-driven photo booth that turns captured photos into a 3×3 jigsaw puzzle — controlled entirely by hand gestures via MediaPipe Hands.

## Tech Stack

- Plain HTML5 + CSS + vanilla JavaScript (ES6+)
- MediaPipe Hands (CDN)
- HTML5 Canvas + getUserMedia

## Running Locally

Serve the folder with any static file server (required for ES modules):

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080` in Chrome or Edge and allow camera access.

> Opening `index.html` directly via `file://` may block module imports in some browsers — use a local server.

## Build Progress

| Stage | Feature | Status |
|-------|---------|--------|
| 1 | Webcam + hand tracking + landmark dots | ✅ Done |
| 2 | Two-hand pinch → countdown → capture | ✅ Done |
| 3 | Puzzle slicing + scatter | ✅ Done |
| 4 | One-hand pinch-drag | ✅ Done |
| 5 | Snap-to-slot + lock logic | ✅ Done |
| 6 | Solved celebration + sidebar history | ✅ Done |
| 7 | Reset button + timeout + polish | ✅ Done |

## Folder Structure

```
gesture-photobooth/
├── index.html
├── style.css
├── app.js
├── js/
│   ├── handTracking.js
│   ├── gestureState.js
│   ├── puzzle.js
│   ├── capture.js
│   └── sidebar.js
├── assets/
└── README.md
```
