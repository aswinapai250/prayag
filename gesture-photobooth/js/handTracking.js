/**
 * Hand Tracking & Computer Vision Pipeline for Prayag Gesture Photobooth
 * 
 * Includes:
 * 1. MediaPipe Hands setup & lifecycle management
 * 2. Exponential Moving Average (EMA) coordinate low-pass filters for jitter suppression
 * 3. Dual-threshold hysteresis pinch math (prevents grab/release flicker)
 * 4. Multi-hand tracking with persistent landmark smoothing & wrist association
 * 5. High-visibility on-screen cursor halo & gesture reticle rendering
 */

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const THUMB_TIP = 4;
const INDEX_TIP = 8;

/**
 * ============================================================================
 * TUNABLE PARAMETERS & THRESHOLDS
 * ============================================================================
 */

/**
 * Dual-Threshold Pinch Hysteresis (Normalized Euclidean Distance between Thumb & Index):
 * - PINCH_START_THRESHOLD (~0.050 / ~35-40px): Fingers must close tighter than this to trigger a grab.
 * - PINCH_END_THRESHOLD   (~0.080 / ~55-60px): Fingers must open wider than this to release a held piece.
 * The gap (~0.030) creates a hysteresis band that eliminates micro-flicker near the threshold boundary.
 */
export const PINCH_START_THRESHOLD = 0.050; // Grab threshold (Pinch-In)
export const PINCH_END_THRESHOLD = 0.080;   // Release threshold (Pinch-Out)

/**
 * Exponential Moving Average (EMA) Smoothing Factor (0.0 < ALPHA <= 1.0):
 * - ALPHA = 0.75: Instantaneous, zero-lag response with high-performance jitter suppression.
 */
export const EMA_ALPHA = 0.75;

/** Mirror front-camera display so hands move naturally like looking into a mirror. */
export const MIRROR_DISPLAY = true;

/** Maximum frames to retain hand state across momentary single-frame camera drops. */
export const MAX_LOST_FRAMES = 3;

/**
 * ============================================================================
 * EMA COORDINATE FILTER CLASS
 * ============================================================================
 * Low-pass filter for 2D coordinates: S_t = α * X_t + (1 - α) * S_{t-1}
 */
export class EMAFilter {
  /**
   * @param {number} [alpha=EMA_ALPHA] Smoothing coefficient (0 to 1)
   */
  constructor(alpha = EMA_ALPHA) {
    this.alpha = alpha;
    this.prevX = null;
    this.prevY = null;
  }

  /**
   * Apply EMA filter to raw (x, y) coordinates.
   * @param {number} x Raw X coordinate
   * @param {number} y Raw Y coordinate
   * @returns {{ x: number, y: number }} Smoothed coordinate point
   */
  filter(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: this.prevX ?? 0, y: this.prevY ?? 0 };
    }
    if (this.prevX === null || this.prevY === null || !Number.isFinite(this.prevX)) {
      this.prevX = x;
      this.prevY = y;
      return { x, y };
    }
    this.prevX = this.alpha * x + (1 - this.alpha) * this.prevX;
    this.prevY = this.alpha * y + (1 - this.alpha) * this.prevY;
    return { x: this.prevX, y: this.prevY };
  }

  /**
   * Reset filter state (called on tracking loss to prevent interpolation artifacts).
   */
  reset() {
    this.prevX = null;
    this.prevY = null;
  }

  /**
   * Dynamically update smoothing alpha.
   * @param {number} newAlpha
   */
  setAlpha(newAlpha) {
    this.alpha = Math.max(0.01, Math.min(1.0, newAlpha));
  }
}

/**
 * Convert a normalized MediaPipe landmark (0.0 to 1.0) into canvas pixel space.
 * @param {{ x: number, y: number }} lm Normalized landmark
 * @param {number} width Canvas pixel width
 * @param {number} height Canvas pixel height
 * @returns {{ x: number, y: number }} Pixel coordinates
 */
export function landmarkToCanvas(lm, width, height) {
  if (!lm || typeof lm.x !== 'number' || typeof lm.y !== 'number') {
    return { x: 0, y: 0 };
  }
  const x = MIRROR_DISPLAY ? 1 - lm.x : lm.x;
  return { x: x * width, y: lm.y * height };
}

/**
 * Calculate the smoothed pinch center in canvas pixel coordinates.
 * Used for drag targeting, piece grabbing, and on-screen cursor halo placement.
 * @param {Array<{x:number,y:number,z:number}>} landmarks
 * @param {number} width Canvas pixel width
 * @param {number} height Canvas pixel height
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

/**
 * ============================================================================
 * HAND TRACKER CLASS
 * ============================================================================
 */
export class HandTracker {
  constructor() {
    this.hands = null;
    this.isReady = false;
    this.loadError = null;
    /** @type {Array<Array<{x:number,y:number,z:number}>>} */
    this.landmarks = [];
    this.isProcessing = false;
    this.pendingFrame = false;

    // Tracked hands with persistent per-landmark EMA filters across frames
    /** @type {Array<{landmarks: Array<{x:number,y:number,z:number}>, lostFrames: number, filters: EMAFilter[]}>} */
    this.trackedHands = [];
    this.MAX_LOST_FRAMES = MAX_LOST_FRAMES;
  }

  /**
   * Initialize MediaPipe Hands instance from CDN.
   * @returns {Promise<boolean>}
   */
  async init() {
    try {
      if (typeof Hands === 'undefined') {
        throw new Error('MediaPipe Hands library not found. Check network connection and refresh.');
      }

      this.hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this.hands.setOptions({
        maxNumHands: 4, // Support crowds during 2-hand capture trigger
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
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
   * Match detected hands across frames using spatial wrist proximity and smooth all 21 landmarks via EMA.
   * @param {Array<Array<{x:number,y:number,z:number}>>} detected
   */
  updateTrackedHands(detected) {
    if (!Array.isArray(detected) || detected.length === 0) {
      for (const hand of this.trackedHands) {
        hand.lostFrames += 1;
      }
      this.trackedHands = this.trackedHands.filter((h) => h.lostFrames <= this.MAX_LOST_FRAMES);
      this.landmarks = this.trackedHands.map((h) => h.landmarks);
      return;
    }

    // Filter incomplete hands
    const validDetected = detected.filter(
      (hand) => Array.isArray(hand) && hand.length >= 21 && hand[0] && typeof hand[0].x === 'number'
    );

    if (validDetected.length === 0) {
      for (const hand of this.trackedHands) {
        hand.lostFrames += 1;
      }
      this.trackedHands = this.trackedHands.filter((h) => h.lostFrames <= this.MAX_LOST_FRAMES);
      this.landmarks = this.trackedHands.map((h) => h.landmarks);
      return;
    }

    const updated = [];
    const usedDetected = new Set();

    // 1. Match existing tracked hands to nearest newly detected hand by wrist landmark
    for (const oldHand of this.trackedHands) {
      if (!oldHand || !oldHand.landmarks || !oldHand.landmarks[0]) continue;
      let bestIdx = -1;
      let bestDist = 0.35; // Maximum spatial association radius in normalized space

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

        // Smooth all 21 landmarks through per-landmark EMA filters
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

    // 2. Register any newly detected hands not yet tracked
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

    // Sort hands left-to-right on screen
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
   * Asynchronously send video frame to MediaPipe pipeline without blocking rendering.
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
   * Compute 2D normalized Euclidean distance between thumb-tip and index-tip.
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
    return Math.hypot(thumb.x - index.x, thumb.y - index.y);
  }

  /**
   * Dual-threshold hysteresis pinch evaluation.
   * - When NOT holding: Requires distance < PINCH_START_THRESHOLD (~0.050) to start grab.
   * - When ALREADY holding: Requires distance >= PINCH_END_THRESHOLD (~0.080) to release grab.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {boolean|number} [isHoldingOrThreshold=false]
   * @returns {boolean} True if pinching/grabbing
   */
  static isPinching(landmarks, isHoldingOrThreshold = false) {
    let threshold = PINCH_START_THRESHOLD;
    if (typeof isHoldingOrThreshold === 'number') {
      threshold = isHoldingOrThreshold;
    } else if (isHoldingOrThreshold === true) {
      threshold = PINCH_END_THRESHOLD;
    }
    return HandTracker.pinchDistance(landmarks) < threshold;
  }

  /**
   * Extract fingertip landmark coordinates.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  static getFingertips(landmarks) {
    if (!Array.isArray(landmarks)) return [];
    return FINGERTIP_INDICES.map((i) => landmarks[i]).filter(Boolean);
  }

  /**
   * Render high-contrast glowing tracking indicators, translucent target rings, cursor halo,
   * and smooth dwell circular progress rings for 2-hand capture.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<Array<{x:number,y:number,z:number}>>} allLandmarks
   * @param {number} width
   * @param {number} height
   * @param {number} [dwellProgress=0] 0.0 to 1.0 dwell hold progress
   */
  static drawTrackingDots(ctx, allLandmarks, width, height, dwellProgress = 0) {
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

      // 1. Subtle skeletal connectors between wrist and knuckles
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

      // 2. Palm / wrist anchor dot
      ctx.save();
      ctx.beginPath();
      ctx.arc(wristPos.x, wristPos.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 241, 232, 0.45)';
      ctx.fill();
      ctx.restore();

      // 3. Visual Cursor Halo & Grab Reticle at smoothed pinch point
      ctx.save();
      if (pinching) {
        // Active locked pinch beam between thumb and index
        ctx.beginPath();
        ctx.moveTo(thumbPos.x, thumbPos.y);
        ctx.lineTo(indexPos.x, indexPos.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.stroke();

        // If dwelling for capture, render circular dwell progress ring
        if (dwellProgress > 0) {
          const dwellRadius = 32;

          // Translucent track background
          ctx.beginPath();
          ctx.arc(pinchCenter.x, pinchCenter.y, dwellRadius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(244, 163, 0, 0.3)';
          ctx.lineWidth = 5;
          ctx.stroke();

          // Glowing animated progress arc
          ctx.beginPath();
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + (Math.PI * 2 * dwellProgress);
          ctx.arc(pinchCenter.x, pinchCenter.y, dwellRadius, startAngle, endAngle);
          ctx.strokeStyle = '#F4A300';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.shadowColor = '#F4A300';
          ctx.shadowBlur = 20;
          ctx.stroke();

          // Inner dwell pulse
          ctx.beginPath();
          ctx.arc(pinchCenter.x, pinchCenter.y, 10 + dwellProgress * 6, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(244, 163, 0, ${0.4 + dwellProgress * 0.4})`;
          ctx.fill();
        } else {
          // Standard pulsing active grab halo
          ctx.beginPath();
          ctx.arc(pinchCenter.x, pinchCenter.y, 16, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 24;
          ctx.fill();
        }

        // Crisp white inner bullseye
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowBlur = 0;
        ctx.fill();
      } else {
        // Hover cursor halo: immediate visual placement feedback before pinch-in
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(244, 163, 0, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#F4A300';
        ctx.shadowBlur = 8;
        ctx.stroke();

        // Glowing center dot
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#F4A300';
        ctx.fill();
      }
      ctx.restore();

      // 4. Translucent target rings & high-contrast fingertip markers
      tips.forEach((lm) => {
        const { x, y } = landmarkToCanvas(lm, width, height);
        const isPinchFinger = (lm === landmarks[THUMB_TIP] || lm === landmarks[INDEX_TIP]);
        const dotRadius = pinching && isPinchFinger ? 12 : 9;

        ctx.save();

        // Translucent target ring on active index and thumb
        if (isPinchFinger) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = pinching ? 'rgba(244, 163, 0, 0.6)' : 'rgba(63, 186, 194, 0.45)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Contrast dark background outline
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(26, 26, 29, 0.9)';
        ctx.fill();

        // Glowing colored ring
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = isPinchFinger && pinching ? '#F4A300' : color;
        ctx.shadowColor = isPinchFinger && pinching ? '#F4A300' : color;
        ctx.shadowBlur = isPinchFinger ? 18 : 10;
        ctx.fill();

        // Crisp center core
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
