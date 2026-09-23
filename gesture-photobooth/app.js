/**
 * Main Application Orchestrator for Prayag Gesture Photobooth
 * 
 * Coordinates:
 * 1. WebCam stream initialization with performance-optimized constraints (640x480)
 * 2. Asynchronous MediaPipe landmark detection decoupled from 60 FPS canvas render loop
 * 3. Single primary hand cursor rendering during puzzle interactions
 * 4. Snapshots, countdown timers, puzzle state transitions, and responsive canvas sizing
 */

import { HandTracker, MIRROR_DISPLAY, getPinchCenter } from './js/handTracking.js';
import { GestureStateMachine, AppState } from './js/gestureState.js';
import { CaptureManager } from './js/capture.js';
import { PuzzleManager } from './js/puzzle.js';
import { SidebarManager } from './js/sidebar.js';

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const bannerText = document.getElementById('banner-text');
const errorOverlay = document.getElementById('error-overlay');
const errorMessage = document.getElementById('error-message');
const retryCameraBtn = document.getElementById('retry-camera-btn');
const resetBtn = document.getElementById('reset-btn');

// Sidebar & Gallery Elements
const sidebar = document.getElementById('sidebar');
const sidebarStrips = document.getElementById('sidebar-strips');
const sidebarEmpty = document.getElementById('sidebar-empty');
const galleryBadge = document.getElementById('gallery-badge');
const stripsCountTag = document.getElementById('strips-count-tag');
const galleryToggleBtn = document.getElementById('gallery-toggle-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const clearStripsBtn = document.getElementById('clear-strips-btn');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

// Modal Elements
const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const gotItBtn = document.getElementById('got-it-btn');

// Core Subsystems
const handTracker = new HandTracker();
const stateMachine = new GestureStateMachine();
const captureManager = new CaptureManager();
const puzzleManager = new PuzzleManager();
const sidebarManager = new SidebarManager(sidebarStrips, sidebarEmpty, galleryBadge, stripsCountTag);

let lastProcessTime = 0;
const PROCESS_INTERVAL_MS = 28; // ~35 FPS vision processing interval (keeps CPU cool while canvas runs at 60 FPS)

/**
 * Display user-facing modal error.
 * @param {string} message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorOverlay.classList.remove('hidden');
}

function hideError() {
  errorOverlay.classList.add('hidden');
}

function updateBanner() {
  if (bannerText) {
    bannerText.textContent = stateMachine.getInstructionText();
  }
}

function handleReset() {
  captureManager.reset();
  stateMachine.reset();
  puzzleManager.reset();
  updateBanner();
}

function handlePuzzleSolved() {
  stateMachine.setState(AppState.SOLVED);
  updateBanner();
  if (captureManager.frozenCanvas) {
    sidebarManager.addStrip(captureManager.frozenCanvas);
  }
}

function handleCaptureComplete() {
  // Snapshot clean mirrored video frame
  drawVideoFrame(ctx, video, canvas.width, canvas.height);
  captureManager.freezeFromCanvas(canvas);
  puzzleManager.createFromSnapshot(captureManager.frozenCanvas);
  stateMachine.setState(AppState.PUZZLE);
  updateBanner();
}

stateMachine.onCaptureTrigger = () => {
  captureManager.startCountdown(handleCaptureComplete);
};

stateMachine.onPinchMove = (handLandmarks) => {
  if (!puzzleManager.isActive) return;
  const pinch = getPinchCenter(handLandmarks, canvas.width, canvas.height);
  if (!puzzleManager.activeDragTile) {
    puzzleManager.startDrag(pinch.x, pinch.y);
  } else {
    puzzleManager.updateDrag(pinch.x, pinch.y);
  }
};

stateMachine.onPinchRelease = () => {
  if (!puzzleManager.isActive || !puzzleManager.activeDragTile) return;
  const { isSolved } = puzzleManager.endDrag(performance.now());
  if (isSolved && stateMachine.state !== AppState.SOLVED) {
    handlePuzzleSolved();
  }
};

stateMachine.onAutoReset = () => {
  handleReset();
};

/**
 * Draw webcam frame, mirrored for natural front-camera interaction.
 * @param {CanvasRenderingContext2D} context
 * @param {HTMLVideoElement} source
 * @param {number} w
 * @param {number} h
 */
function drawVideoFrame(context, source, w, h) {
  if (MIRROR_DISPLAY) {
    context.save();
    context.scale(-1, 1);
    context.drawImage(source, -w, 0, w, h);
    context.restore();
  } else {
    context.drawImage(source, 0, 0, w, h);
  }
}

/**
 * Size canvas to match video aspect ratio within the stage container.
 */
function resizeCanvas() {
  const stage = document.getElementById('stage');
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;

  if (!video.videoWidth || !video.videoHeight) {
    canvas.width = stageW || 800;
    canvas.height = stageH || 600;
    return;
  }

  const videoAspect = video.videoWidth / video.videoHeight;
  const stageAspect = stageW / stageH;

  let drawW, drawH;
  if (videoAspect > stageAspect) {
    drawW = stageW;
    drawH = stageW / videoAspect;
  } else {
    drawH = stageH;
    drawW = stageH * videoAspect;
  }

  canvas.width = Math.round(drawW);
  canvas.height = Math.round(drawH);
}

/**
 * Initialize webcam with downscaled processing constraints for smooth 60 FPS performance.
 * @returns {Promise<boolean>}
 */
async function initWebcam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Camera not available. Please use a modern browser with webcam support.');
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: false,
    });

    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = () => reject(new Error('Video failed to load'));
    });

    resizeCanvas();
    hideError();
    return true;
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError('Please allow camera access in your browser settings to use the photo booth.');
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      showError('No camera found. Please connect a webcam and click Retry.');
    } else {
      showError('Camera unavailable. Please check your webcam and try again.');
    }
    return false;
  }
}

/**
 * Decoupled 60 FPS Game & Canvas Render Loop.
 * @param {number} timestamp
 */
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  const w = canvas.width;
  const h = canvas.height;
  const isFrozen = captureManager.isFrozen;
  const isCountingDown = captureManager.isCountingDown;
  const inPuzzle = puzzleManager.isActive;
  const showLiveFeed = !isFrozen && !inPuzzle;

  // 1. Render primary scene background (video feed, puzzle canvas, or snapshot)
  if (showLiveFeed && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawVideoFrame(ctx, video, w, h);
  } else if (inPuzzle) {
    puzzleManager.draw(ctx, w, h, timestamp);
  } else if (isFrozen && captureManager.frozenCanvas) {
    ctx.drawImage(captureManager.frozenCanvas, 0, 0, w, h);
  }

  // 2. Render visual cursor & tracking dots with Single-Hand Lock during puzzle
  if ((showLiveFeed || inPuzzle) && handTracker.landmarks.length > 0) {
    if (inPuzzle) {
      // SINGLE-HAND LOCK: Only render visual cursor for the active primary hand
      const activeHand = stateMachine.getActivePuzzleHand(handTracker.landmarks);
      if (activeHand) {
        HandTracker.drawTrackingDots(ctx, [activeHand], w, h);
      }
    } else {
      // Idle / Countdown: render all hands for 2-hand pinch feedback
      HandTracker.drawTrackingDots(ctx, handTracker.landmarks, w, h);
    }
  }

  // 3. Countdown & Flash FX
  if (isCountingDown && captureManager.countdownValue > 0) {
    captureManager.drawCountdown(ctx, captureManager.countdownValue, w, h);
  }

  if (isFrozen && !inPuzzle) {
    captureManager.drawFlash(ctx, w, h, timestamp);
  } else if (inPuzzle && timestamp < captureManager.flashUntil) {
    captureManager.drawFlash(ctx, w, h, timestamp);
  }

  captureManager.update(timestamp);

  // 4. Asynchronously send video frame to MediaPipe pipeline (throttled to ~35 FPS)
  if (timestamp - lastProcessTime >= PROCESS_INTERVAL_MS) {
    lastProcessTime = timestamp;

    if (showLiveFeed || isCountingDown || inPuzzle) {
      handTracker.sendFrame(video);
    }

    stateMachine.update({ landmarks: handTracker.landmarks }, timestamp);
    updateBanner();
  }
}

/**
 * Mouse interaction fallback for testing without webcam.
 */
function setupMouseFallback() {
  let isMouseDown = false;

  canvas.addEventListener('mousedown', (e) => {
    if (stateMachine.state !== AppState.PUZZLE) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    isMouseDown = true;
    puzzleManager.startDrag(px, py);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown || stateMachine.state !== AppState.PUZZLE) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    puzzleManager.updateDrag(px, py);
  });

  window.addEventListener('mouseup', () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    if (stateMachine.state !== AppState.PUZZLE) return;
    const { isSolved } = puzzleManager.endDrag(performance.now());
    if (isSolved && stateMachine.state !== AppState.SOLVED) {
      handlePuzzleSolved();
    }
  });
}

/**
 * UI buttons and event listeners.
 */
function setupUIListeners() {
  resetBtn.addEventListener('click', handleReset);

  if (retryCameraBtn) {
    retryCameraBtn.addEventListener('click', async () => {
      const ok = await initWebcam();
      if (ok) {
        hideError();
      }
    });
  }

  if (clearStripsBtn) {
    clearStripsBtn.addEventListener('click', () => {
      sidebarManager.clearAll();
    });
  }

  const openGallery = () => {
    sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('open');
  };

  const closeGallery = () => {
    sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
  };

  if (galleryToggleBtn) galleryToggleBtn.addEventListener('click', openGallery);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeGallery);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeGallery);

  // How to Play Modal
  const openModal = () => {
    helpModal.classList.remove('hidden');
  };

  const closeModal = () => {
    helpModal.classList.add('hidden');
  };

  if (helpBtn) helpBtn.addEventListener('click', openModal);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (gotItBtn) gotItBtn.addEventListener('click', closeModal);

  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeGallery();
    }
  });

  window.addEventListener('resize', resizeCanvas);
}

async function init() {
  setupUIListeners();
  setupMouseFallback();
  updateBanner();

  const webcamOk = await initWebcam();
  if (!webcamOk) return;

  const trackingOk = await handTracker.init();
  if (!trackingOk) {
    showError(
      handTracker.loadError ||
        'MediaPipe Hands failed to load. Please refresh the page.'
    );
    return;
  }

  gameLoop(0);
}

init();
