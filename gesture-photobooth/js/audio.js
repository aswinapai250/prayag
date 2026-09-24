/**
 * Synthesized Web Audio API Manager for Prayag Gesture Photobooth
 * 
 * Generates all sound cues in real-time with zero external audio assets:
 * 1. Countdown ticks (subtle high-pitch beeps on 3, 2, 1)
 * 2. Camera shutter / flash click (noise burst + mechanical impulse)
 * 3. Tile snap chime/click (pleasant tactile tone when piece locks in)
 * 4. Victory fanfare (jubilant major chord arpeggio)
 * 5. Dwell progress tick
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isUnlocked = false;

    // Check localStorage preference if available
    try {
      const saved = localStorage.getItem('prayag_muted');
      if (saved !== null) {
        this.isMuted = saved === 'true';
      }
    } catch (_) {
      // Storage access blocked or restricted
    }
  }

  /**
   * Lazy-initialize AudioContext upon user gesture.
   */
  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.isUnlocked = true;
  }

  /**
   * Explicitly unlock audio on user gesture.
   */
  unlock() {
    this.ensureContext();
  }

  /**
   * Toggle mute state.
   * @returns {boolean} New muted state
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    try {
      localStorage.setItem('prayag_muted', String(this.isMuted));
    } catch (_) {}
    return this.isMuted;
  }

  /**
   * Subtle countdown tick.
   * @param {number} count Value (3, 2, 1)
   */
  playTick(count = 3) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Higher pitch for the final count (1)
      const freq = count === 1 ? 1200 : 880;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {
      console.warn('Audio tick error:', e);
    }
  }

  /**
   * Realistic mechanical camera shutter sound (dual click + filtered noise snap).
   */
  playShutter() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;

      // 1. Shutter noise burst
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.09);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.setValueAtTime(3.0, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      whiteNoise.start(now);

      // 2. Mechanical dual impulse clicks (curtain open & close)
      [0, 0.045].forEach((offset, idx) => {
        const osc = this.ctx.createOscillator();
        const clickGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx === 0 ? 320 : 220, now + offset);
        osc.frequency.exponentialRampToValueAtTime(60, now + offset + 0.03);

        clickGain.gain.setValueAtTime(0.4, now + offset);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.035);

        osc.connect(clickGain);
        clickGain.connect(this.ctx.destination);

        osc.start(now + offset);
        osc.stop(now + offset + 0.04);
      });
    } catch (e) {
      console.warn('Audio shutter error:', e);
    }
  }

  /**
   * Tactile snap chime / pop when a tile locks into its slot.
   */
  playSnap() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;

      // Bright chime (sweep 520Hz -> 780Hz)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.05);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.17);

      // Subtle high harmonic sparkle
      const spark = this.ctx.createOscillator();
      const sparkGain = this.ctx.createGain();
      spark.type = 'triangle';
      spark.frequency.setValueAtTime(1560, now);

      sparkGain.gain.setValueAtTime(0.08, now);
      sparkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      spark.connect(sparkGain);
      sparkGain.connect(this.ctx.destination);

      spark.start(now);
      spark.stop(now + 0.09);
    } catch (e) {
      console.warn('Audio snap error:', e);
    }
  }

  /**
   * Victory celebration fanfare (major chord arpeggio C5 - E5 - G5 - C6).
   */
  playVictory() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [
        { freq: 523.25, time: 0.00, dur: 0.18 }, // C5
        { freq: 659.25, time: 0.11, dur: 0.18 }, // E5
        { freq: 783.99, time: 0.22, dur: 0.22 }, // G5
        { freq: 1046.50, time: 0.35, dur: 0.65 }, // C6
      ];

      notes.forEach(({ freq, time, dur }) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.linearRampToValueAtTime(0.25, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + dur + 0.05);
      });
    } catch (e) {
      console.warn('Audio victory error:', e);
    }
  }
}

export const audioManager = new AudioManager();
