/**
 * Countdown overlay, frame freeze, snapshot logic, and screen flash effects.
 */

const COUNTDOWN_SECONDS = 3;
const FLASH_DURATION_MS = 400;

export class CaptureManager {
  constructor() {
    this.isCountingDown = false;
    this.isFrozen = false;
    this.countdownValue = 0;
    /** @type {HTMLCanvasElement|null} */
    this.frozenCanvas = null;
    this.countdownStartTime = 0;
    /** @type {(() => void)|null} */
    this.onCountdownComplete = null;
    this.flashUntil = 0;
  }

  /**
   * Begin the 3-second countdown.
   * @param {() => void} onComplete
   */
  startCountdown(onComplete) {
    this.isCountingDown = true;
    this.countdownValue = COUNTDOWN_SECONDS;
    this.countdownStartTime = performance.now();
    this.onCountdownComplete = onComplete;
  }

  /**
   * Advance countdown timer; returns current number or 0 when done.
   * @param {number} timestamp
   * @returns {number|null}
   */
  update(timestamp) {
    if (!this.isCountingDown) return null;

    const elapsed = Math.max(0, timestamp - this.countdownStartTime);
    const remaining = Math.ceil(COUNTDOWN_SECONDS - elapsed / 1000);

    if (remaining <= 0) {
      this.isCountingDown = false;
      this.countdownValue = 0;
      const cb = this.onCountdownComplete;
      this.onCountdownComplete = null;
      if (cb) cb();
      return null;
    }

    this.countdownValue = remaining;
    return remaining;
  }

  /**
   * Freeze the current canvas frame into an offscreen snapshot.
   * @param {HTMLCanvasElement} sourceCanvas
   */
  freezeFromCanvas(sourceCanvas) {
    this.frozenCanvas = document.createElement('canvas');
    this.frozenCanvas.width = sourceCanvas.width;
    this.frozenCanvas.height = sourceCanvas.height;
    const fctx = this.frozenCanvas.getContext('2d');
    fctx.drawImage(sourceCanvas, 0, 0);
    this.isFrozen = true;
    this.flashUntil = performance.now() + FLASH_DURATION_MS;
  }

  /**
   * Draw animated 3-2-1 countdown overlay with glowing rings and cues.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} value
   * @param {number} width
   * @param {number} height
   */
  drawCountdown(ctx, value, width, height) {
    ctx.save();
    // Semi-transparent cinematic dark vignette
    ctx.fillStyle = 'rgba(18, 18, 20, 0.65)';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    // Outer pulsing ring
    const elapsedSec = (performance.now() - this.countdownStartTime) / 1000;
    const subProgress = elapsedSec % 1.0;
    const ringRadius = 90 + (1 - subProgress) * 30;

    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(244, 163, 0, ${0.8 - subProgress * 0.5})`;
    ctx.lineWidth = 4;
    ctx.shadowColor = '#F4A300';
    ctx.shadowBlur = 18;
    ctx.stroke();

    // Central countdown number
    ctx.font = '700 130px Fredoka, "Baloo 2", sans-serif';
    ctx.fillStyle = '#F4A300';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(244, 163, 0, 0.85)';
    ctx.shadowBlur = 28;
    ctx.fillText(String(value), cx, cy - 8);

    // Subtitle cue
    ctx.font = '600 24px "Nunito Sans", sans-serif';
    ctx.fillStyle = '#F5F1E8';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 12;
    ctx.fillText('📸 Smile & hold still…', cx, cy + 90);

    ctx.restore();
  }

  /**
   * Dual-phase bright white-to-amber photo shutter flash.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {number} timestamp
   */
  drawFlash(ctx, width, height, timestamp) {
    if (timestamp >= this.flashUntil) return;

    const remaining = this.flashUntil - timestamp;
    const progress = 1 - (remaining / FLASH_DURATION_MS); // 0 (start) to 1 (end)

    ctx.save();
    if (progress < 0.3) {
      // Peak bright white flash
      const whiteAlpha = (1 - progress / 0.3) * 0.9;
      ctx.fillStyle = `rgba(255, 255, 255, ${whiteAlpha})`;
      ctx.fillRect(0, 0, width, height);
    } else {
      // Warm amber glow fading out
      const amberAlpha = (1 - (progress - 0.3) / 0.7) * 0.5;
      ctx.fillStyle = `rgba(244, 163, 0, ${amberAlpha})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  reset() {
    this.isCountingDown = false;
    this.isFrozen = false;
    this.frozenCanvas = null;
    this.countdownValue = 0;
    this.countdownStartTime = 0;
    this.onCountdownComplete = null;
    this.flashUntil = 0;
  }
}
