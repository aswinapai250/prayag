/**
 * MediaPipe Hands setup, Exponential Moving Average (EMA) smoothing filters,
 * hysteresis pinch math, and visual cursor rendering.
 */

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const THUMB_TIP = 4;
const INDEX_TIP = 8;

/**
 * Pinch Detection Thresholds (Normalized Euclidean Distance):
 * - PINCH_START_THRESHOLD: Distance to trigger a grab (Pinch In) ~0.055 (~35-40px)
 * - PINCH_END_THRESHOLD: Distance to release a held grab (Pinch Out) ~0.085 (~55-60px)
 * The gap (~0.030) provides hysteresis preventing jitter-induced drops.
 */
export const PINCH_START_THRESHOLD = 0.055;
export const PINCH_END_THRESHOLD = 0.085;

/** Default smoothing alpha for low-pass filter (0.35 - 0.50 balances zero-latency with jitter suppression) */
export const EMA_ALPHA = 0.42;

/** Mirror front-camera display so hands move naturally (like a selfie view). */
export const MIRROR_DISPLAY = true;

/**
 * Exponential Moving Average (EMA) Low-Pass Filter for spatial stability.
 * Formula: smoothed = alpha * new + (1 - alpha) * prev
 */
export class EMAFilter {
  constructor(alpha = EMA_ALPHA) {
    this.alpha = alpha;
    this.prevX = null;
    this.prevY = null;
  }

  filter(x, y) {
    if (this.prevX === null || this.prevY === null || !Number.isFinite(this.prevX)) {
      this.prevX = x;
      this.prevY = y;
      return { x, y };
    }
    this.prevX = this.alpha * x + (1 - this.alpha) * this.prevX;
    this.prevY = this.alpha * y + (1 - this.alpha) * this.prevY;
    return { x: this.prevX, y: this.prevY };
  }

  reset() {
    this.prevX = null;
    this.prevY = null;
  }
}

/**
 * Convert a normalized landmark to canvas coordinates.
 * @param {{ x: number, y: number }} lm
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }}
 */
export function landmarkToCanvas(lm, width, height) {
  if (!lm || typeof lm.x !== 'number' || typeof lm.y !== 'number') {
    return { x: 0, y: 0 };
  }
  const x = MIRROR_DISPLAY ? 1 - lm.x : lm.x;
  return { x: x * width, y: lm.y * height };
}

/**
 * Pinch midpoint in canvas coordinates (for drag targeting and cursor placement).
 * @param {Array<{x:number,y:number,z:number}>} landmarks
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }}
 */
export function getPinchCenter(landmarks, width, height) {
  if (!Array.isArray(landmarks) || !landmarks[THUMB_TIP] || !landmarks[INDEX_TIP]) {
    return { x: width / 2, y: height / 2 };
  }
  const thumb = landmarkToCanvas(landmarks[THUMB_TIP], width, height);
  const index = landmarkToCanvas(landmarks[INDEX_TIP], width, height);
  return {
    x: (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
  };
}

export class HandTracker {
  constructor() {
    this.hands = null;
    this.isReady = false;
    this.loadError = null;
    /** @type {Array<Array<{x:number,y:number,z:number}>>} */
    this.landmarks = [];
    this.isProcessing = false;
    this.pendingFrame = false;

    // Cache tracked hands to survive single-frame drops (up to 4 frames of persistence)
    /** @type {Array<{landmarks: Array<{x:number,y:number,z:number}>, lostFrames: number, filters: EMAFilter[]}>} */
    this.trackedHands = [];
    this.MAX_LOST_FRAMES = 4;
  }

  /**
   * Initialize MediaPipe Hands from CDN globals.
   * @returns {Promise<boolean>}
   */
  async init() {
    try {
      if (typeof Hands === 'undefined') {
        throw new Error('MediaPipe Hands failed to load. Check your internet connection and refresh.');
      }

      this.hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this.hands.setOptions({
        maxNumHands: 4, // Support crowds and multiple hands during capture
        modelComplexity: 1,
        minDetectionConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });

      this.hands.onResults((results) => {
        try {
          const detected = results && results.multiHandLandmarks ? results.multiHandLandmarks : [];
          this.updateTrackedHands(detected);
        } catch (err) {
          console.warn('Hand tracking result processing error:', err);
        } finally {
          this.isProcessing = false;
          if (this.pendingFrame) {
            this.pendingFrame = false;
          }
        }
      });

      await this.hands.initialize();
      this.isReady = true;
      return true;
    } catch (err) {
      this.loadError = err.message || 'MediaPipe Hands failed to initialize.';
      this.isReady = false;
      return false;
    }
  }

  /**
   * Match newly detected hands with previous tracked hands and apply EMA smoothing.
   * @param {Array<Array<{x:number,y:number,z:number}>>} detected
   */
  updateTrackedHands(detected) {
    if (!Array.isArray(detected) || detected.length === 0) {
      for (const hand of this.trackedHands) {
        hand.lostFrames += 1;
      }
      this.trackedHands = this.trackedHands.filter(
        (h) => h.lostFrames <= this.MAX_LOST_FRAMES
      );
      this.landmarks = this.trackedHands.map((h) => h.landmarks);
      return;
    }

    // Filter out incomplete hands (< 21 landmarks or missing wrist)
    const validDetected = detected.filter(
      (hand) => Array.isArray(hand) && hand.length >= 21 && hand[0] && typeof hand[0].x === 'number'
    );

    if (validDetected.length === 0) {
      for (const hand of this.trackedHands) {
        hand.lostFrames += 1;
      }
      this.trackedHands = this.trackedHands.filter(
        (h) => h.lostFrames <= this.MAX_LOST_FRAMES
      );
      this.landmarks = this.trackedHands.map((h) => h.landmarks);
      return;
    }

    const updated = [];
    const usedDetected = new Set();

    // Match existing tracked hands to nearest detected hand by wrist (landmark 0)
    for (const oldHand of this.trackedHands) {
      if (!oldHand || !oldHand.landmarks || !oldHand.landmarks[0]) continue;
      let bestIdx = -1;
      let bestDist = 0.35; // max association distance in normalized coords

      for (let i = 0; i < validDetected.length; i++) {
        if (usedDetected.has(i)) continue;
        const oldWrist = oldHand.landmarks[0];
        const newWrist = validDetected[i][0];
        const dist = Math.hypot(oldWrist.x - newWrist.x, oldWrist.y - newWrist.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        usedDetected.add(bestIdx);
        const filters = oldHand.filters || Array.from({ length: 21 }, () => new EMAFilter(EMA_ALPHA));
        
        // Apply Exponential Moving Average filter across all 21 landmarks
        const smoothed = validDetected[bestIdx].map((lm, li) => {
          if (!filters[li]) filters[li] = new EMAFilter(EMA_ALPHA);
          const filtered = filters[li].filter(lm.x, lm.y);
          return {
            x: filtered.x,
            y: filtered.y,
            z: lm.z,
          };
        });
        updated.push({ landmarks: smoothed, lostFrames: 0, filters });
      } else if (oldHand.lostFrames < this.MAX_LOST_FRAMES) {
        updated.push({
          landmarks: oldHand.landmarks,
          lostFrames: oldHand.lostFrames + 1,
          filters: oldHand.filters,
        });
      }
    }

    // Add any newly detected hands not yet tracked
    for (let i = 0; i < validDetected.length; i++) {
      if (!usedDetected.has(i)) {
        const filters = Array.from({ length: 21 }, () => new EMAFilter(EMA_ALPHA));
        const smoothed = validDetected[i].map((lm, li) => {
          const filtered = filters[li].filter(lm.x, lm.y);
          return {
            x: filtered.x,
            y: filtered.y,
            z: lm.z,
          };
        });
        updated.push({ landmarks: smoothed, lostFrames: 0, filters });
      }
    }

    // Sort by screen X position (left-to-right)
    updated.sort((a, b) => {
      const ax = (a.landmarks && a.landmarks[0])
        ? (MIRROR_DISPLAY ? 1 - a.landmarks[0].x : a.landmarks[0].x)
        : 0;
      const bx = (b.landmarks && b.landmarks[0])
        ? (MIRROR_DISPLAY ? 1 - b.landmarks[0].x : b.landmarks[0].x)
        : 0;
      return ax - bx;
    });

    this.trackedHands = updated.slice(0, 4);
    this.landmarks = this.trackedHands.map((h) => h.landmarks);
  }

  /**
   * Send a video frame to MediaPipe for landmark detection.
   * @param {HTMLVideoElement} video
   */
  sendFrame(video) {
    if (!this.isReady || !this.hands || this.isProcessing) return;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!video.videoWidth || !video.videoHeight) return;

    this.isProcessing = true;
    try {
      this.hands
        .send({ image: video })
        .catch(() => {
          this.isProcessing = false;
        });
    } catch (err) {
      this.isProcessing = false;
    }
  }

  /**
   * 2D Euclidean distance between thumb-tip and index-tip landmarks.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {number}
   */
  static pinchDistance(landmarks) {
    if (!Array.isArray(landmarks) || !landmarks[THUMB_TIP] || !landmarks[INDEX_TIP]) {
      return Infinity;
    }
    const thumb = landmarks[THUMB_TIP];
    const index = landmarks[INDEX_TIP];
    if (typeof thumb.x !== 'number' || typeof index.x !== 'number') {
      return Infinity;
    }
    return Math.hypot(
      thumb.x - index.x,
      thumb.y - index.y
    );
  }

  /**
   * Hysteresis-aware pinch detection.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {boolean|number} [isHoldingOrThreshold]
   * @returns {boolean}
   */
  static isPinching(landmarks, isHoldingOrThreshold = false) {
    let threshold = PINCH_START_THRESHOLD; // 0.055 to start grab
    if (typeof isHoldingOrThreshold === 'number') {
      threshold = isHoldingOrThreshold;
    } else if (isHoldingOrThreshold === true) {
      threshold = PINCH_END_THRESHOLD; // 0.085 to release held object (Hysteresis)
    }
    return HandTracker.pinchDistance(landmarks) < threshold;
  }

  /**
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  static getFingertips(landmarks) {
    if (!Array.isArray(landmarks)) return [];
    return FINGERTIP_INDICES.map((i) => landmarks[i]).filter(Boolean);
  }

  /**
   * Draw high-contrast glowing tracking indicators, cursor halo, and pinch reticle.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<Array<{x:number,y:number,z:number}>>} allLandmarks
   * @param {number} width
   * @param {number} height
   */
  static drawTrackingDots(ctx, allLandmarks, width, height) {
    if (!Array.isArray(allLandmarks) || allLandmarks.length === 0) return;

    const colors = ['#3FBAC2', '#F4A300', '#FF6B6B', '#51CF66'];

    allLandmarks.forEach((landmarks, handIndex) => {
      if (!Array.isArray(landmarks) || landmarks.length < 21) return;

      const color = colors[handIndex % colors.length];
      const pinching = HandTracker.isPinching(landmarks, false);
      const tips = HandTracker.getFingertips(landmarks);

      const thumb = landmarks[THUMB_TIP];
      const index = landmarks[INDEX_TIP];
      const wrist = landmarks[0];
      if (!thumb || !index || !wrist) return;

      const thumbPos = landmarkToCanvas(thumb, width, height);
      const indexPos = landmarkToCanvas(index, width, height);
      const wristPos = landmarkToCanvas(wrist, width, height);
      const pinchCenter = getPinchCenter(landmarks, width, height);

      // 1. Draw subtle skeletal connectors between wrist and knuckles
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 241, 232, 0.2)';
      ctx.lineWidth = 1.5;
      [5, 9, 13, 17].forEach((knuckleIdx) => {
        if (landmarks[knuckleIdx]) {
          const kPos = landmarkToCanvas(landmarks[knuckleIdx], width, height);
          ctx.beginPath();
          ctx.moveTo(wristPos.x, wristPos.y);
          ctx.lineTo(kPos.x, kPos.y);
          ctx.stroke();
        }
      });
      ctx.restore();

      // 2. Draw subtle palm/wrist anchor dot
      ctx.save();
      ctx.beginPath();
      ctx.arc(wristPos.x, wristPos.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 241, 232, 0.45)';
      ctx.fill();
      ctx.restore();

      // 3. Render Active Cursor Halo at the pinch coordinate
      ctx.save();
      if (pinching) {
        // Active locked grab beam
        ctx.beginPath();
        ctx.moveTo(thumbPos.x, thumbPos.y);
        ctx.lineTo(indexPos.x, indexPos.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        ctx.stroke();

        // Pulsing active grab reticle
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 24;
        ctx.fill();

        // Inner crisp white center for exact targeting
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowBlur = 0;
        ctx.fill();
      } else {
        // Idle cursor halo: provides visual feedback before pinching
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(244, 163, 0, 0.65)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#F4A300';
        ctx.fill();
      }
      ctx.restore();

      // 4. Draw fingertip markers with high contrast
      tips.forEach((lm) => {
        const { x, y } = landmarkToCanvas(lm, width, height);
        const isPinchFinger = (lm === landmarks[THUMB_TIP] || lm === landmarks[INDEX_TIP]);
        const dotRadius = pinching && isPinchFinger ? 12 : 9;

        ctx.save();
        // Dark contrast outline
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(26, 26, 29, 0.9)';
        ctx.fill();

        // Glowing colored ring
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = pinching && isPinchFinger ? 20 : 12;
        ctx.fill();

        // Crisp offwhite center
        ctx.beginPath();
        ctx.arc(x, y, dotRadius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#F5F1E8';
        ctx.shadowBlur = 0;
        ctx.fill();

        ctx.restore();
      });
    });
  }
}
