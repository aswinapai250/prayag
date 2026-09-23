/**
 * Photo-strip history rendering with action controls (Download, Delete, Clear All).
 * Vintage photo-booth style card stack.
 */

export class SidebarManager {
  /**
   * @param {HTMLElement} container
   * @param {HTMLElement} [emptyElement]
   * @param {HTMLElement} [badgeElement]
   * @param {HTMLElement} [countTagElement]
   */
  constructor(container, emptyElement = null, badgeElement = null, countTagElement = null) {
    this.container = container;
    this.emptyElement = emptyElement;
    this.badgeElement = badgeElement;
    this.countTagElement = countTagElement;
    this.strips = [];
    this.stripCount = 0;
    this.updateUI();
  }

  /**
   * Update count badges and empty state visibility.
   */
  updateUI() {
    const total = this.strips.length;
    if (this.emptyElement) {
      if (total === 0) {
        this.emptyElement.classList.remove('hidden');
      } else {
        this.emptyElement.classList.add('hidden');
      }
    }
    if (this.badgeElement) {
      this.badgeElement.textContent = String(total);
    }
    if (this.countTagElement) {
      this.countTagElement.textContent = `${total} ${total === 1 ? 'shot' : 'shots'}`;
    }
  }

  /**
   * Push a completed photo into the sidebar strip history with Download & Delete actions.
   * @param {HTMLCanvasElement} canvas
   */
  addStrip(canvas) {
    this.stripCount += 1;
    const currentId = this.stripCount;

    // Snapshot full resolution PNG data URL
    const highResPng = canvas.toDataURL('image/png');

    const card = document.createElement('div');
    card.className = 'strip-card';
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `Photo strip #${currentId}`);

    // Image wrapper
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'strip-img-wrapper';

    const img = document.createElement('img');
    img.src = highResPng;
    img.alt = `Photo strip #${currentId}`;
    img.className = 'strip-img';
    img.loading = 'lazy';
    imgWrapper.appendChild(img);

    // Meta bar
    const meta = document.createElement('div');
    meta.className = 'strip-meta';

    const caption = document.createElement('span');
    caption.className = 'strip-caption';
    caption.textContent = `Strip #${currentId}`;

    const time = document.createElement('span');
    time.className = 'strip-time';
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    meta.appendChild(caption);
    meta.appendChild(time);

    // Action buttons bar
    const actions = document.createElement('div');
    actions.className = 'strip-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'card-action-btn download-strip-btn';
    downloadBtn.type = 'button';
    downloadBtn.setAttribute('aria-label', `Download Photo Strip #${currentId} as PNG`);
    downloadBtn.title = 'Download high-res PNG';
    downloadBtn.innerHTML = '<span>⬇️</span> <span>Download</span>';
    downloadBtn.addEventListener('click', () => {
      this.downloadStrip(highResPng, `prayag-photostrip-${currentId}.png`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-action-btn delete-strip-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', `Delete Photo Strip #${currentId}`);
    deleteBtn.title = 'Delete photo';
    deleteBtn.innerHTML = '<span>🗑️</span>';
    deleteBtn.addEventListener('click', () => {
      this.deleteStrip(card);
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(imgWrapper);
    card.appendChild(meta);
    card.appendChild(actions);

    // Prepend so the newest photo is at the top of the sidebar
    this.container.prepend(card);
    this.strips.unshift(card);

    // Keep history at a maximum count (e.g. 15)
    if (this.strips.length > 15) {
      const removed = this.strips.pop();
      if (removed) removed.remove();
    }

    this.updateUI();
  }

  /**
   * Trigger browser file download for a strip.
   * @param {string} dataUrl
   * @param {string} filename
   */
  downloadStrip(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Delete a single card from the strip list.
   * @param {HTMLElement} card
   */
  deleteStrip(card) {
    card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.85) translateY(-10px)';
    setTimeout(() => {
      card.remove();
      this.strips = this.strips.filter((c) => c !== card);
      this.updateUI();
    }, 200);
  }

  /**
   * Flush all strips.
   */
  clearAll() {
    this.container.innerHTML = '';
    this.strips = [];
    this.updateUI();
  }

  reset() {
    this.clearAll();
    this.stripCount = 0;
  }
}
