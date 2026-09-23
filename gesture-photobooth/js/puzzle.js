/**
 * Slicing captured image into tiles, scatter, snap-to-slot logic.
 * Stage 3: slice + scatter. Stages 4–5: drag + snap.
 */

const GRID_SIZE = 3;
const SCATTER_PADDING = 12;
const SLOT_AVOID_MARGIN = 50;
const HITBOX_EXPANSION_MARGIN = 28; // Expands touch/grab target size by 28px around each tile
const DRAG_LERP_ALPHA = 0.65; // High-responsiveness smoothing (0.65 balances zero lag with micro-jitter suppression)

export class PuzzleTile {
  /**
   * @param {number} row
   * @param {number} col
   * @param {HTMLCanvasElement} imageCanvas
   * @param {number} slotX
   * @param {number} slotY
   * @param {number} tileW
   * @param {number} tileH
   */
  constructor(row, col, imageCanvas, slotX, slotY, tileW, tileH) {
    this.row = row;
    this.col = col;
    this.imageCanvas = imageCanvas;
    this.slotX = slotX;
    this.slotY = slotY;
    this.tileW = tileW;
    this.tileH = tileH;
    this.x = slotX;
    this.y = slotY;
    this.locked = false;
    this.isDragging = false;
    this.snapTime = 0;
  }

  /** @returns {{ x: number, y: number }} */
  get center() {
    const drawX = this.locked ? this.slotX : this.x;
    const drawY = this.locked ? this.slotY : this.y;
    return {
      x: drawX + this.tileW / 2,
      y: drawY + this.tileH / 2,
    };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [timestamp]
   */
  draw(ctx, timestamp = 0) {
    const drawX = this.locked ? this.slotX : this.x;
    const drawY = this.locked ? this.slotY : this.y;

    ctx.save();

    const isSnapping = this.snapTime > 0 && timestamp - this.snapTime < 350;

    if (this.isDragging) {
      ctx.shadowColor = '#3FBAC2';
      ctx.shadowBlur = 20;
      const scale = 1.08;
      const cx = drawX + this.tileW / 2;
      const cy = drawY + this.tileH / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    } else if (isSnapping) {
      // Golden snap bounce feedback
      const progress = (timestamp - this.snapTime) / 350;
      const bounce = 1 + 0.12 * Math.sin(progress * Math.PI);
      const cx = this.slotX + this.tileW / 2;
      const cy = this.slotY + this.tileH / 2;
      ctx.translate(cx, cy);
      ctx.scale(bounce, bounce);
      ctx.translate(-cx, -cy);
      ctx.shadowColor = '#F4A300';
      ctx.shadowBlur = 24 * (1 - progress);
    } else if (!this.locked) {
      // Floating unsolved tile — elevate above the board with drop shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
    }

    ctx.drawImage(this.imageCanvas, drawX, drawY, this.tileW, this.tileH);

    if (this.isDragging) {
      ctx.strokeStyle = '#3FBAC2';
      ctx.lineWidth = 3;
    } else if (isSnapping) {
      ctx.strokeStyle = '#F4A300';
      ctx.lineWidth = 3;
    } else if (this.locked) {
      ctx.strokeStyle = 'rgba(245, 241, 232, 0.25)';
      ctx.lineWidth = 1;
    } else {
      // Unsolved floating tile border
      ctx.strokeStyle = 'rgba(245, 241, 232, 0.95)';
      ctx.lineWidth = 2;
    }
    ctx.strokeRect(drawX, drawY, this.tileW, this.tileH);

    ctx.restore();
  }
}

export class PuzzleManager {
  constructor() {
    /** @type {PuzzleTile[]} */
    this.tiles = [];
    this.gridSize = GRID_SIZE;
    this.isActive = false;
    this.tileW = 0;
    this.tileH = 0;
    this.canvasW = 0;
    this.canvasH = 0;

    /** @type {PuzzleTile|null} */
    this.activeDragTile = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    this.solvedAt = 0;
    this.particles = [];
  }

  /**
   * Slice a frozen snapshot into a 3×3 grid and scatter tiles.
   * @param {HTMLCanvasElement} sourceCanvas
   */
  createFromSnapshot(sourceCanvas) {
    this.reset();

    this.canvasW = sourceCanvas.width;
    this.canvasH = sourceCanvas.height;
    this.tileW = this.canvasW / this.gridSize;
    this.tileH = this.canvasH / this.gridSize;

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = Math.floor(this.tileW);
        tileCanvas.height = Math.floor(this.tileH);
        const tctx = tileCanvas.getContext('2d');

        tctx.drawImage(
          sourceCanvas,
          col * this.tileW,
          row * this.tileH,
          this.tileW,
          this.tileH,
          0,
          0,
          tileCanvas.width,
          tileCanvas.height
        );

        const slotX = col * this.tileW;
        const slotY = row * this.tileH;

        this.tiles.push(
          new PuzzleTile(
            row,
            col,
            tileCanvas,
            slotX,
            slotY,
            this.tileW,
            this.tileH
          )
        );
      }
    }

    this.scatterTiles();
    this.isActive = true;
  }

  /** Randomise tile positions, keeping them away from their correct slots and dispersing them to minimize overlap. */
  scatterTiles() {
    const placedPositions = [];

    for (const tile of this.tiles) {
      if (tile.locked) continue;

      let bestX = tile.x;
      let bestY = tile.y;
      let bestDist = -1;

      for (let attempt = 0; attempt < 40; attempt++) {
        const x =
          SCATTER_PADDING +
          Math.random() *
            (this.canvasW - tile.tileW - SCATTER_PADDING * 2);
        const y =
          SCATTER_PADDING +
          Math.random() *
            (this.canvasH - tile.tileH - SCATTER_PADDING * 2);

        if (this.isNearOwnSlot(tile, x, y)) continue;

        let minOverlapDist = Infinity;
        for (const pos of placedPositions) {
          const d = Math.hypot(x - pos.x, y - pos.y);
          if (d < minOverlapDist) {
            minOverlapDist = d;
          }
        }

        if (minOverlapDist > bestDist) {
          bestDist = minOverlapDist;
          bestX = x;
          bestY = y;
        }

        if (minOverlapDist > Math.min(tile.tileW, tile.tileH) * 0.7) {
          break;
        }
      }

      tile.x = bestX;
      tile.y = bestY;
      placedPositions.push({ x: tile.x, y: tile.y });
    }
  }

  /**
   * @param {PuzzleTile} tile
   * @param {number} x
   * @param {number} y
   */
  isNearOwnSlot(tile, x, y) {
    return (
      Math.abs(x - tile.slotX) < SLOT_AVOID_MARGIN &&
      Math.abs(y - tile.slotY) < SLOT_AVOID_MARGIN
    );
  }


  /**
   * Find tile at coordinates.
   * Uses expanded bounding box hitbox (28px) for effortless, natural grabbing.
   * @param {number} px
   * @param {number} py
   * @returns {PuzzleTile|null}
   */
  findTileForPinch(px, py) {
    const padding = HITBOX_EXPANSION_MARGIN;
    // Check top tiles first (reverse order)
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const tile = this.tiles[i];
      if (tile.locked) continue;
      if (
        px >= tile.x - padding &&
        px <= tile.x + tile.tileW + padding &&
        py >= tile.y - padding &&
        py <= tile.y + tile.tileH + padding
      ) {
        return tile;
      }
    }
    return null;
  }

  /**
   * Begin dragging a tile at coordinates.
   * @param {number} px
   * @param {number} py
   * @returns {boolean}
   */
  startDrag(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    if (this.activeDragTile) return true; // Already dragging a tile, preserve it!
    const tile = this.findTileForPinch(px, py);
    if (!tile) return false;

    this.activeDragTile = tile;
    tile.isDragging = true;
    this.dragOffsetX = px - tile.x;
    this.dragOffsetY = py - tile.y;

    // Bring dragged tile to top of render stack
    const idx = this.tiles.indexOf(tile);
    if (idx !== -1) {
      this.tiles.splice(idx, 1);
      this.tiles.push(tile);
    }
    return true;
  }

  /**
   * Update position of currently held tile with high-responsiveness EMA filter.
   * @param {number} px
   * @param {number} py
   */
  updateDrag(px, py) {
    if (!this.activeDragTile || !Number.isFinite(px) || !Number.isFinite(py)) return;

    let targetX = px - this.dragOffsetX;
    let targetY = py - this.dragOffsetY;

    // Clamp inside canvas boundary
    targetX = Math.max(0, Math.min(this.canvasW - this.activeDragTile.tileW, targetX));
    targetY = Math.max(0, Math.min(this.canvasH - this.activeDragTile.tileH, targetY));

    // Responsive EMA filter (0.65 new + 0.35 prev)
    this.activeDragTile.x = this.activeDragTile.x * (1 - DRAG_LERP_ALPHA) + targetX * DRAG_LERP_ALPHA;
    this.activeDragTile.y = this.activeDragTile.y * (1 - DRAG_LERP_ALPHA) + targetY * DRAG_LERP_ALPHA;
  }

  /**
   * Release drag and check snap tolerance to slot.
   * @param {number} timestamp
   * @returns {{ snapped: boolean, isSolved: boolean }}
   */
  endDrag(timestamp = 0) {
    if (!this.activeDragTile) return { snapped: false, isSolved: this.isSolved() };

    const tile = this.activeDragTile;
    this.activeDragTile = null;
    tile.isDragging = false;

    // Snap tolerance: within ~45% of tile size
    const tolerance = Math.min(tile.tileW, tile.tileH) * 0.45;
    const dist = Math.hypot(tile.x - tile.slotX, tile.y - tile.slotY);

    let snapped = false;
    if (dist < tolerance) {
      tile.x = tile.slotX;
      tile.y = tile.slotY;
      tile.locked = true;
      tile.snapTime = timestamp || performance.now();
      snapped = true;
    }

    const solved = this.isSolved();
    if (solved && !this.solvedAt) {
      this.triggerSolved(timestamp || performance.now());
    }

    return { snapped, isSolved: solved };
  }

  /** @returns {boolean} */
  isSolved() {
    return (
      this.tiles.length > 0 && this.tiles.every((tile) => tile.locked)
    );
  }

  /**
   * Spawn celebration confetti when puzzle is solved.
   * @param {number} timestamp
   */
  triggerSolved(timestamp) {
    this.solvedAt = timestamp;
    this.particles = [];
    const colors = ['#F4A300', '#3FBAC2', '#F5F1E8', '#FF6B6B', '#51CF66'];
    for (let i = 0; i < 90; i++) {
      this.particles.push({
        x: this.canvasW * (0.2 + Math.random() * 0.6),
        y: this.canvasH * (0.3 + Math.random() * 0.4),
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 12 - 4,
        size: Math.random() * 8 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {number} [timestamp]
   */
  draw(ctx, width, height, timestamp = 0) {
    if (!this.isActive) return;

    ctx.fillStyle = '#1A1A1D';
    ctx.fillRect(0, 0, width, height);

    // Draw grid slot guidelines
    ctx.strokeStyle = 'rgba(245, 241, 232, 0.15)';
    ctx.lineWidth = 1;
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const sx = col * this.tileW;
        const sy = row * this.tileH;
        ctx.strokeRect(sx + 0.5, sy + 0.5, this.tileW - 1, this.tileH - 1);
      }
    }

    // Render tiles in strict z-index order:
    // 1. All locked tiles first (background base)
    // 2. All unlocked floating tiles on top of locked tiles
    // 3. The actively dragged tile on the very top
    const lockedTiles = [];
    const unlockedTiles = [];
    let draggedTile = null;

    for (const tile of this.tiles) {
      if (tile.isDragging) {
        draggedTile = tile;
      } else if (tile.locked) {
        lockedTiles.push(tile);
      } else {
        unlockedTiles.push(tile);
      }
    }

    for (const tile of lockedTiles) {
      tile.draw(ctx, timestamp);
    }

    for (const tile of unlockedTiles) {
      tile.draw(ctx, timestamp);
    }

    if (draggedTile) {
      draggedTile.draw(ctx, timestamp);
    }

    // Celebration effect when solved
    if (this.solvedAt > 0) {
      const elapsed = timestamp - this.solvedAt;

      // Draw confetti particles
      ctx.save();
      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.rotation += p.vRot;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      ctx.restore();

      // Celebration banner overlay
      ctx.save();
      const alpha = Math.min(0.85, elapsed / 500);
      ctx.fillStyle = `rgba(26, 26, 29, ${alpha * 0.75})`;
      ctx.fillRect(0, height * 0.38, width, height * 0.24);

      ctx.font = '700 48px Fredoka, "Baloo 2", sans-serif';
      ctx.fillStyle = '#F4A300';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(244, 163, 0, 0.8)';
      ctx.shadowBlur = 24;
      ctx.fillText('🎉 SOLVED! 🎉', width / 2, height / 2);
      ctx.restore();
    }
  }

  reset() {
    this.tiles = [];
    this.isActive = false;
    this.tileW = 0;
    this.tileH = 0;
    this.canvasW = 0;
    this.canvasH = 0;
    this.activeDragTile = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.solvedAt = 0;
    this.particles = [];
  }
}
