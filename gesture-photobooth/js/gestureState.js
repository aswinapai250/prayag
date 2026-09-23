/**
 * State machine: idle / countdown / dragging / solved
 */

import { HandTracker } from './handTracking.js';

export const AppState = {
  IDLE: 'idle',
  COUNTDOWN: 'countdown',
  PUZZLE: 'puzzle',
  SOLVED: 'solved',
};

export const GestureType = {
  TWO_HAND_PINCH: 'TWO_HAND_PINCH',
  ONE_HAND_PINCH_MOVE: 'ONE_HAND_PINCH_MOVE',
};

const CAPTURE_COOLDOWN_MS = 1000;
const PINCH_DEBOUNCE_FRAMES = 5;

export class GestureStateMachine {
  constructor() {
    /** @type {string} */
    this.state = AppState.IDLE;
    this.pinchHoldFrames = 0;
    this.lastCaptureTime = 0;
    /** @type {(() => void)|null} */
    this.onCaptureTrigger = null;
    /** @type {((handLandmarks: Array<{x:number,y:number,z:number}>) => void)|null} */
    this.onPinchMove = null;
    /** @type {(() => void)|null} */
    this.onPinchRelease = null;
    /** @type {(() => void)|null} */
    this.onAutoReset = null;
    this.noHandSince = 0;
    this.solvedAt = 0;
    this.activeDragWrist = null;
    this.isPinchingActive = false;
  }

  /**
   * Check if any 2 hands in the frame are pinching simultaneously.
   * Works reliably in crowds where multiple hands or multiple people are present.
   * @param {Array<Array<{x:number,y:number,z:number}>>} landmarks
   * @returns {boolean}
   */
  detectTwoHandPinch(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 2) return false;
    let pinchCount = 0;
    for (const hand of landmarks) {
      if (HandTracker.isPinching(hand)) {
        pinchCount += 1;
      }
    }
    return pinchCount >= 2;
  }

  /**
   * Selects and locks onto a single hand for puzzle interactions.
   * Prevents multiple hands in the frame from interfering or cluttering the puzzle.
   * @param {Array<Array<{x:number,y:number,z:number}>>} landmarks
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  getActivePuzzleHand(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length === 0) {
      this.activeDragWrist = null;
      return null;
    }

    let activeHand = null;

    // 1. If already locked onto a hand, find that same hand in current frame by wrist proximity
    if (this.activeDragWrist) {
      let bestDist = 0.35;
      for (const hand of landmarks) {
        if (!hand || !hand[0]) continue;
        const d = Math.hypot(hand[0].x - this.activeDragWrist.x, hand[0].y - this.activeDragWrist.y);
        if (d < bestDist) {
          bestDist = d;
          activeHand = hand;
        }
      }
    }

    // 2. If no locked hand or lost tracking, prioritize any pinching hand
    if (!activeHand) {
      for (const hand of landmarks) {
        if (HandTracker.isPinching(hand)) {
          activeHand = hand;
          break;
        }
      }
    }

    // 3. Fallback to the first detected hand if none is pinching
    if (!activeHand && landmarks.length > 0) {
      activeHand = landmarks[0];
    }

    // Update locked wrist position
    if (activeHand && activeHand[0]) {
      this.activeDragWrist = { x: activeHand[0].x, y: activeHand[0].y };
    } else {
      this.activeDragWrist = null;
    }

    return activeHand;
  }

  /**
   * @param {{ landmarks: Array<Array<{x:number,y:number,z:number}>> }} handData
   * @param {number} timestamp
   * @returns {string}
   */
  update(handData, timestamp) {
    const landmarks = (handData && Array.isArray(handData.landmarks)) ? handData.landmarks : [];

    if (this.state === AppState.IDLE) {
      if (timestamp - this.lastCaptureTime < CAPTURE_COOLDOWN_MS) {
        this.pinchHoldFrames = 0;
        return this.state;
      }

      if (this.detectTwoHandPinch(landmarks)) {
        this.pinchHoldFrames += 1;
        if (
          this.pinchHoldFrames >= PINCH_DEBOUNCE_FRAMES &&
          this.onCaptureTrigger
        ) {
          this.pinchHoldFrames = 0;
          this.lastCaptureTime = timestamp;
          this.state = AppState.COUNTDOWN;
          this.onCaptureTrigger();
        }
      } else {
        this.pinchHoldFrames = 0;
      }
    } else if (this.state === AppState.PUZZLE) {
      // Limit to exactly ONE active hand during puzzle solving
      const activeHand = this.getActivePuzzleHand(landmarks);

      if (activeHand && HandTracker.isPinching(activeHand)) {
        this.isPinchingActive = true;
        if (this.onPinchMove) {
          this.onPinchMove(activeHand);
        }
      } else {
        if (this.isPinchingActive) {
          this.isPinchingActive = false;
          if (this.onPinchRelease) {
            this.onPinchRelease();
          }
        }
      }
    } else if (this.state === AppState.SOLVED) {
      // Auto-reset when crowd steps away (5s of no hands), or max 15s queue timeout
      if (landmarks.length === 0) {
        if (!this.noHandSince) {
          this.noHandSince = timestamp;
        } else if (timestamp - this.noHandSince >= 5000) {
          if (this.onAutoReset) {
            this.onAutoReset();
          }
        }
      } else {
        this.noHandSince = 0;
      }

      // Hard timeout of 15 seconds so queue keeps moving
      if (this.solvedAt > 0 && timestamp - this.solvedAt >= 15000) {
        if (this.onAutoReset) {
          this.onAutoReset();
        }
      }
    }

    return this.state;
  }

  /** @returns {string} */
  getInstructionText() {
    switch (this.state) {
      case AppState.IDLE:
        return 'Pinch both hands to capture! Pinch one hand to drag pieces!';
      case AppState.COUNTDOWN:
        return 'Get ready…';
      case AppState.PUZZLE:
        return 'Pinch one hand to drag a piece into place!';
      case AppState.SOLVED:
        return '🎉 Solved! Step back or click Reset for the next photo.';
      default:
        return 'Pinch both hands to capture! Pinch one hand to drag pieces!';
    }
  }

  /** @param {string} newState */
  setState(newState) {
    this.state = newState;
    if (newState === AppState.SOLVED) {
      this.solvedAt = performance.now();
    } else {
      this.noHandSince = 0;
      this.solvedAt = 0;
      this.activeDragWrist = null;
      this.isPinchingActive = false;
    }
  }

  reset() {
    this.state = AppState.IDLE;
    this.pinchHoldFrames = 0;
    this.noHandSince = 0;
    this.solvedAt = 0;
    this.activeDragWrist = null;
    this.isPinchingActive = false;
  }
}
