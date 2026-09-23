/**
 * MediaPipe Hands setup, landmark extraction, pinch-distance math, and rich visual tracking.
 */

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const THUMB_TIP = 4;
const INDEX_TIP = 8;

/** Generous pinch threshold for excited/shaky kid-hands */
export const PINCH_THRESHOLD = 0.085;

/** Mirror front-camera display so hands move naturally (like a selfie view). */
export const MIRROR_DISPLAY = true;

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
    /** @type {Array<{landmarks: Array<{x:number,y:number,z:number}>, lostFrames: number}>} */
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
   * Match newly detected hands with previous tracked hands to prevent dot flickering/disappearing.
   * Defensively guards against malformed frames in crowded rush conditions.
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

    // Match existing tracked hands to nearest detected hand by wrist/palm (landmark 0)
    for (const oldHand of this.trackedHands) {
      if (!oldHand || !oldHand.landmarks || !oldHand.landmarks[0]) continue;
      let bestIdx = -1;
      let bestDist = 0.32; // max association distance in normalized coords

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
        // Lerp slightly for jitter-free tracking
        const smoothed = validDetected[bestIdx].map((lm, li) => {
          const prevLm = (oldHand.landmarks && oldHand.landmarks[li]) ? oldHand.landmarks[li] : lm;
          return {
            x: prevLm.x * 0.25 + lm.x * 0.75,
            y: prevLm.y * 0.25 + lm.y * 0.75,
            z: lm.z,
          };
        });
        updated.push({ landmarks: smoothed, lostFrames: 0 });
      } else if (oldHand.lostFrames < this.MAX_LOST_FRAMES) {
        updated.push({
          landmarks: oldHand.landmarks,
          lostFrames: oldHand.lostFrames + 1,
        });
      }
    }

    // Add any newly detected hands not yet tracked
    for (let i = 0; i < validDetected.length; i++) {
      if (!usedDetected.has(i)) {
        updated.push({ landmarks: validDetected[i], lostFrames: 0 });
      }
    }

    // Sort by screen X position (left-to-right) so colors never flip-flop
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
   * Safe against rapid frames, unready video, or 0-dimension video frames.
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
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {number} [threshold]
   * @returns {boolean}
   */
  static isPinching(landmarks, threshold = PINCH_THRESHOLD) {
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
   * Draw high-contrast glowing tracking indicators and pinch cursor feedback.
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
      const pinching = HandTracker.isPinching(landmarks);
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

      // 3. Draw active pinch cursor & glowing beam between thumb and index
      if (pinching) {
        ctx.save();
        // Laser connection line
        ctx.beginPath();
        ctx.moveTo(thumbPos.x, thumbPos.y);
        ctx.lineTo(indexPos.x, indexPos.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.stroke();

        // Pulsing midpoint pinch cursor ring
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 22;
        ctx.fill();

        // Inner crisp white center for precise targeting
        ctx.beginPath();
        ctx.arc(pinchCenter.x, pinchCenter.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowBlur = 0;
        ctx.fill();
        ctx.restore();
      } else {
        // Subtle guiding dashed line between thumb & index when close
        const dist = HandTracker.pinchDistance(landmarks);
        if (dist < 0.2) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(thumbPos.x, thumbPos.y);
          ctx.lineTo(indexPos.x, indexPos.y);
          ctx.strokeStyle = 'rgba(244, 163, 0, 0.4)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4. Draw fingertip markers with high contrast
      tips.forEach((lm) => {
        const { x, y } = landmarkToCanvas(lm, width, height);
        const isPinchFinger = (lm === landmarks[THUMB_TIP] || lm === landmarks[INDEX_TIP]);
        const dotRadius = pinching && isPinchFinger ? 12 : 9;

        ctx.save();
        // Dark high-contrast outline
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
