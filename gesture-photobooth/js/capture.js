/**
 * Countdown overlay, frame freeze, snapshot logic, screen flash effects,
 * and retro photobooth film strip compositor.
 */

const COUNTDOWN_SECONDS = 3;
const FLASH_DURATION_MS = 400;

export const FilterPresets = {
  NORMAL: 'normal',
  BW: 'bw',
  SEPIA: 'sepia',
  GRAIN: 'grain',
};

/**
 * Apply CSS filter string to canvas context for a given preset.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} filterName
 */
export function applyFilterToContext(ctx, filterName) {
  switch (filterName) {
    case FilterPresets.BW:
      ctx.filter = 'grayscale(100%) contrast(130%) brightness(102%)';
      break;
    case FilterPresets.SEPIA:
      ctx.filter = 'sepia(90%) contrast(115%) brightness(100%) saturate(125%)';
      break;
    case FilterPresets.GRAIN:
      ctx.filter = 'contrast(108%) brightness(102%) saturate(105%)';
      break;
    default:
      ctx.filter = 'none';
      break;
  }
}

/**
 * Procedurally overlay organic analog film grain onto a rectangular region.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
export function addFilmGrain(ctx, x, y, width, height) {
  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = 160;
  noiseCanvas.height = 120;
  const nctx = noiseCanvas.getContext('2d');
  const imgData = nctx.createImageData(160, 120);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 34; // Subtle alpha
  }
  nctx.putImageData(imgData, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.globalCompositeOperation = 'overlay';

  // Tile noise over photo
  for (let px = x; px < x + width; px += 160) {
    for (let py = y; py < y + height; py += 120) {
      const dw = Math.min(160, x + width - px);
      const dh = Math.min(120, y + height - py);
      ctx.drawImage(noiseCanvas, 0, 0, dw, dh, px, py, dw, dh);
    }
  }
  ctx.restore();
}

/**
 * Composite captured snapshot into a classic vertical retro photobooth film strip.
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {string} [filter='normal']
 * @param {'light'|'dark'} [theme='light']
 * @returns {HTMLCanvasElement}
 */
export function compositeFilmStrip(sourceCanvas, filter = FilterPresets.NORMAL, theme = 'light') {
  const strip = document.createElement('canvas');
  const sWidth = 840;
  const marginSide = 48;
  const marginTop = 48;
  const photoW = sWidth - marginSide * 2;
  const photoAspect = sourceCanvas.height / sourceCanvas.width;
  const photoH = Math.round(photoW * photoAspect);
  const footerH = 120;
  const sHeight = marginTop + photoH + footerH;

  strip.width = sWidth;
  strip.height = sHeight;
  const ctx = strip.getContext('2d');

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#18181C' : '#FAF8F5';
  const frameBorderColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const textColor = isDark ? '#F4A300' : '#222226';
  const subTextColor = isDark ? 'rgba(245, 241, 232, 0.5)' : '#7A7A82';

  // 1. Film strip background card
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, sWidth, sHeight);

  // Subtle outer edge stroke
  ctx.strokeStyle = frameBorderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, sWidth - 2, sHeight - 2);

  // 2. Vintage Photo Frame Background
  const photoX = marginSide;
  const photoY = marginTop;
  ctx.fillStyle = isDark ? '#101012' : '#E8E4DC';
  ctx.fillRect(photoX, photoY, photoW, photoH);

  // 3. Draw source snapshot with selected filter
  ctx.save();
  applyFilterToContext(ctx, filter);
  ctx.drawImage(sourceCanvas, photoX, photoY, photoW, photoH);
  ctx.restore();

  // If Film Grain filter, overlay noise texture
  if (filter === FilterPresets.GRAIN) {
    addFilmGrain(ctx, photoX, photoY, photoW, photoH);
  }

  // 4. Subtle inner photo border
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(photoX, photoY, photoW, photoH);

  // 5. Watermark Footer: "PRAYAG • [Date]"
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).toUpperCase();

  const watermarkText = `PRAYAG  •  ${dateFormatted}`;

  const footerCenterY = photoY + photoH + footerH / 2;

  ctx.save();
  ctx.font = '700 24px Fredoka, "Nunito Sans", sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '2px';
  ctx.fillText(watermarkText, sWidth / 2, footerCenterY - 12);

  // Subtitle stamp
  ctx.font = '600 13px "Nunito Sans", sans-serif';
  ctx.fillStyle = subTextColor;
  ctx.letterSpacing = '3px';
  ctx.fillText('GESTURE PHOTOBOOTH  •  COLLEGE FEST', sWidth / 2, footerCenterY + 18);

  // Subtle vintage corner notch dots
  ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
  const notchOffset = 18;
  [
    [notchOffset, notchOffset],
    [sWidth - notchOffset, notchOffset],
    [notchOffset, sHeight - notchOffset],
    [sWidth - notchOffset, sHeight - notchOffset],
  ].forEach(([nx, ny]) => {
    ctx.beginPath();
    ctx.arc(nx, ny, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();

  return strip;
}

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
    /** @type {((count: number) => void)|null} */
    this.onTick = null;
    /** @type {(() => void)|null} */
    this.onFlash = null;
    this.flashUntil = 0;
    this.activeFilter = FilterPresets.NORMAL;
    this.borderTheme = 'light';
  }

  /**
   * Set active filter preset.
   * @param {string} filter
   */
  setFilter(filter) {
    this.activeFilter = filter;
  }

  /**
   * Set border framing theme ('light' or 'dark').
   * @param {'light'|'dark'} theme
   */
  setTheme(theme) {
    this.borderTheme = theme;
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
    if (this.onTick) {
      this.onTick(COUNTDOWN_SECONDS);
    }
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

    if (remaining !== this.countdownValue) {
      this.countdownValue = remaining;
      if (this.onTick) {
        this.onTick(remaining);
      }
    }

    return remaining;
  }

  /**
   * Freeze the current canvas frame into an offscreen snapshot with active filter.
   * Stores raw snapshot to allow dynamic filter updating during puzzle mode.
   * @param {HTMLCanvasElement} sourceCanvas
   */
  freezeFromCanvas(sourceCanvas) {
    this.rawCanvas = document.createElement('canvas');
    this.rawCanvas.width = sourceCanvas.width;
    this.rawCanvas.height = sourceCanvas.height;
    const rctx = this.rawCanvas.getContext('2d');
    rctx.drawImage(sourceCanvas, 0, 0);

    this.updateFrozenCanvas();

    this.isFrozen = true;
    this.flashUntil = performance.now() + FLASH_DURATION_MS;

    if (this.onFlash) {
      this.onFlash();
    }
  }

  /**
   * Re-generate frozenCanvas from rawCanvas applying current activeFilter.
   */
  updateFrozenCanvas() {
    if (!this.rawCanvas) return;
    this.frozenCanvas = document.createElement('canvas');
    this.frozenCanvas.width = this.rawCanvas.width;
    this.frozenCanvas.height = this.rawCanvas.height;
    const fctx = this.frozenCanvas.getContext('2d');

    // Draw with active filter
    applyFilterToContext(fctx, this.activeFilter);
    fctx.drawImage(this.rawCanvas, 0, 0);

    if (this.activeFilter === FilterPresets.GRAIN) {
      addFilmGrain(fctx, 0, 0, this.frozenCanvas.width, this.frozenCanvas.height);
    }
  }

  /**
   * Create the full retro film strip from the current frozen snapshot.
   * @returns {HTMLCanvasElement|null}
   */
  getCompositedStrip() {
    if (!this.frozenCanvas) return null;
    return compositeFilmStrip(this.frozenCanvas, FilterPresets.NORMAL, this.borderTheme);
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
    this.rawCanvas = null;
    this.countdownValue = 0;
    this.countdownStartTime = 0;
    this.onCountdownComplete = null;
    this.flashUntil = 0;
  }
}
