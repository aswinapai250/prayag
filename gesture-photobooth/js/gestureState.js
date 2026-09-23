/**
 * Gesture State Machine & Primary Hand Lock Controller
 * 
 * Manages photo booth transitions: IDLE -> COUNTDOWN -> PUZZLE -> SOLVED
 * Implements:
 * 1. Dual-hand pinch detection for photo capture in crowded frames
 * 2. Strict Single-Hand Lock during puzzle dragging (ignores secondary/background hands)
 * 3. Hysteresis drag state persistence with frame-loss debouncing
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

/** Cooldown period in ms after photo capture before another capture can trigger. */
const CAPTURE_COOLDOWN_MS = 1000;

/** Consecutive frames of 2-hand pinch required to start countdown (filters out transient noise). */
const PINCH_DEBOUNCE_FRAMES = 4;

/** Consecutive frames of opened fingers required before firing drag release (guards against tracking loss). */
const RELEASE_DEBOUNCE_FRAMES = 2;

export class GestureStateMachine {
  constructor() {
    /** @type {string} */
    this.state = AppState.IDLE;
    this.pinchHoldFrames = 0;
    this.lastCaptureTime = 0;

    /** Callbacks */
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

    // Single-Hand Lock state for puzzle dragging
    this.activeDragWrist = null;
    this.isPinchingActive = false;
    this.releaseFramesCount = 0;
  }

  /**
   * Detect if any two distinct hands in the frame are pinching simultaneously.
   * Allows groups or individuals to easily trigger the photo booth countdown.
   * @param {Array<Array<{x:number,y:number,z:number}>>} landmarks
   * @returns {boolean}
   */
  detectTwoHandPinch(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 2) return false;
    let pinchCount = 0;
    for (const hand of landmarks) {
      if (HandTracker.isPinching(hand, false)) {
        pinchCount += 1;
      }
    }
    return pinchCount >= 2;
  }

  /**
   * Selects and strictly locks onto a SINGLE primary hand during puzzle solving.
   * Filters out extraneous hands in the background to prevent piece stealing or cursor jitter.
   * 
   * Strategy:
   * 1. If already locked onto a hand, track the closest hand by wrist proximity.
   * 2. If not locked, prioritize any actively pinching hand.
   * 3. Otherwise, fall back to the first detected hand in the viewport.
   * 
   * @param {Array<Array<{x:number,y:number,z:number}>>} landmarks
   * @returns {Array<{x:number,y:number,z:number}>|null} Primary hand landmarks
   */
  getActivePuzzleHand(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length === 0) {
      this.activeDragWrist = null;
      return null;
    }

    let activeHand = null;

    // 1. If currently tracking a hand, maintain lock using spatial wrist tracking
    if (this.activeDragWrist) {
      let bestDist = 0.35; // Maximum association radius in normalized coordinates
      for (const hand of landmarks) {
        if (!hand || !hand[0]) continue;
        const d = Math.hypot(hand[0].x - this.activeDragWrist.x, hand[0].y - this.activeDragWrist.y);
        if (d < bestDist) {
          bestDist = d;
          activeHand = hand;
        }
      }
    }

    // 2. If no locked hand or tracking was lost, pick the first pinching hand
    if (!activeHand) {
      for (const hand of landmarks) {
        if (HandTracker.isPinching(hand, false)) {
          activeHand = hand;
          break;
        }
      }
    }

    // 3. Fallback to primary hand (first detected)
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
   * Main state machine evaluation tick.
   * @param {{ landmarks: Array<Array<{x:number,y:number,z:number}>> }} handData
   * @param {number} timestamp
   * @returns {string} Current AppState
   */
  update(handData, timestamp) {
    const landmarks = (handData && Array.isArray(handData.landmarks)) ? handData.landmarks : [];

    if (this.state === AppState.IDLE) {
      // Respect capture cooldown
      if (timestamp - this.lastCaptureTime < CAPTURE_COOLDOWN_MS) {
        this.pinchHoldFrames = 0;
        return this.state;
      }

      // Check for dual-hand pinch trigger
      if (this.detectTwoHandPinch(landmarks)) {
        this.pinchHoldFrames += 1;
        if (this.pinchHoldFrames >= PINCH_DEBOUNCE_FRAMES && this.onCaptureTrigger) {
          this.pinchHoldFrames = 0;
          this.lastCaptureTime = timestamp;
          this.state = AppState.COUNTDOWN;
          this.onCaptureTrigger();
        }
      } else {
        this.pinchHoldFrames = 0;
      }
    } else if (this.state === AppState.PUZZLE) {
      // Strictly bound to SINGLE primary hand
      const activeHand = this.getActivePuzzleHand(landmarks);

      if (activeHand) {
        // Evaluate pinch using dual-threshold hysteresis:
        // isPinchingActive: true -> requires PINCH_END_THRESHOLD (0.080) to release
        // isPinchingActive: false -> requires PINCH_START_THRESHOLD (0.050) to grab
        const isCurrentlyPinching = HandTracker.isPinching(activeHand, this.isPinchingActive);

        if (isCurrentlyPinching) {
          this.releaseFramesCount = 0;
          this.isPinchingActive = true;
          if (this.onPinchMove) {
            this.onPinchMove(activeHand);
          }
        } else {
          // Hand opened fingers: debounce over consecutive frames to avoid camera noise drops
          if (this.isPinchingActive) {
            this.releaseFramesCount += 1;
            if (this.releaseFramesCount >= RELEASE_DEBOUNCE_FRAMES) {
              this.isPinchingActive = false;
              this.releaseFramesCount = 0;
              if (this.onPinchRelease) {
                this.onPinchRelease();
              }
            }
          }
        }
      } else {
        // Hand completely lost from camera view
        if (this.isPinchingActive) {
          this.isPinchingActive = false;
          this.releaseFramesCount = 0;
          if (this.onPinchRelease) {
            this.onPinchRelease();
          }
        }
      }
    } else if (this.state === AppState.SOLVED) {
      // Auto-reset when users walk away (5s with no hands detected), or 15s max queue limit
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

      if (this.solvedAt > 0 && timestamp - this.solvedAt >= 15000) {
        if (this.onAutoReset) {
          this.onAutoReset();
        }
      }
    }

    return this.state;
  }

  /** @returns {string} Instruction banner prompt text */
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
      this.releaseFramesCount = 0;
    }
  }

  reset() {
    this.state = AppState.IDLE;
    this.pinchHoldFrames = 0;
    this.noHandSince = 0;
    this.solvedAt = 0;
    this.activeDragWrist = null;
    this.isPinchingActive = false;
    this.releaseFramesCount = 0;
  }
}
