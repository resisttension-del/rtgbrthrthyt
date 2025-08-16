

export class Loader {
  constructor() {
    this.overlay = document.getElementById('loading-overlay');
    this.fill = document.getElementById('progress-bar-fill');
    this.text = document.getElementById('progress-text');
    this.displayedPct = 0;    // percentage currently shown
    this.targetPct = 0;        // percentage we animate toward
    this.animationFrameId = null;
    this.animationSpeed = 0.05;
    this.reset();
    // Breathing properties for the fill bar
    this.breathingAmplitude = 0.8; // How much the opacity changes (e.g., 0.4 means +/- 40% from base)
    this.breathingFrequency = 0.007; // How fast the breathing animation is
    this.startTime = null; // To keep track of animation time for breathing
  }

  reset() {
    this.itemPercentages = [];
    this.currentProgress = 0;    // overall progress [0.0, 1.0]
    this.currentLabel = '';
    this._onComplete = () => {};
    this.displayedPct = 0;
    this.targetPct = 0;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Reset fill opacity when hidden or reset
    this.fill.style.opacity = '';
    this.startTime = null; // Reset start time for breathing
  }

  show(label = 'Starting', itemPercentages = []) {
    this.reset();
    this.currentLabel = label;
    this.itemPercentages = itemPercentages;
    this.currentProgress = 0;
    this.displayedPct = 0;
    this.targetPct = 0;
    // Set initial text with 4 decimal places
    this.text.textContent = `${label} 0.0000%`;
    this.fill.style.width = '0%';
    this.overlay.classList.remove('hidden');
    // Start tracking time for the fill bar's breathing animation
    this.startTime = performance.now();
    this._animateProgress();
  }

  _animateProgress() {
    // interpolate displayedPct toward targetPct
    this.displayedPct += (this.targetPct - this.displayedPct) * this.animationSpeed;
    this.displayedPct = Math.max(0, Math.min(100, this.displayedPct));

    this.text.textContent = `${this.currentLabel} ${this.displayedPct.toFixed(4)}%`;
    this.fill.style.width = `${this.displayedPct}%`;

    // --- MODIFICATION START ---
    // Breathing effect for the fill bar's opacity
    if (this.startTime !== null) {
      const elapsed = performance.now() - this.startTime;
      // Using a sine wave for smooth opacity changes.
      // Opacity will oscillate between a minimum (e.g., 0.6) and a maximum (e.g., 1.0).
      // The `+ 1) / 2` normalizes sin output from [-1, 1] to [0, 1].
      // `1.0 - this.breathingAmplitude` sets the minimum base opacity.
      const opacity = (1.0 - this.breathingAmplitude) + (this.breathingAmplitude * (Math.sin(elapsed * this.breathingFrequency) + 1) / 2);
      this.fill.style.opacity = opacity.toFixed(4);
    }
    // --- MODIFICATION END ---

    const closeEnough = Math.abs(this.displayedPct - this.targetPct) < 0.0001;
    const fullyLoaded = this.currentProgress >= 0.9999;

    if (!closeEnough || !fullyLoaded) {
      this.animationFrameId = requestAnimationFrame(() => this._animateProgress());
    } else {
      // snap to 100%
      this.displayedPct = 100;
      this.text.textContent = `${this.currentLabel} 100.0000%`;
      this.fill.style.width = `100%`;
      this.fill.style.opacity = '1'; // Ensure full opacity at 100%
      this.animationFrameId = null;

      if (fullyLoaded) {
        setTimeout(() => {
          this.overlay.classList.add('hidden');
          this.fill.style.opacity = ''; // Reset fill opacity when hidden
          this.startTime = null; // Stop breathing animation
          this._onComplete();
        }, 250);
      }
    }
  }

  /**
   * Track an async operation, optionally receiving progress events.
   * @param {number} percentageWeight    weight of this item in [0,1]
   * @param {Promise<any>} promise        resolves when fully loaded
   * @param {function(function(ProgressEvent)):void} onProgressRegistrar
   * function that accepts a callback to receive ProgressEvent {loaded,total}
   */
  async track(percentageWeight, promise, onProgressRegistrar) {
    if (typeof onProgressRegistrar === 'function') {
      onProgressRegistrar((evt) => {
        if (evt.lengthComputable) {
          const frac = evt.loaded / evt.total;
          const logical = Math.min(1.0, this.currentProgress + percentageWeight * frac);
          this.targetPct = logical * 100;
          if (!this.animationFrameId) this._animateProgress();
        }
      });
    }

    try {
      const result = await promise;
      this.currentProgress = Math.min(1.0, this.currentProgress + percentageWeight);
      this.targetPct = this.currentProgress * 100;
      if (!this.animationFrameId) this._animateProgress();
      return result;
    } catch (err) {
      console.error('Loader.track error:', err);
      this.currentProgress = Math.min(1.0, this.currentProgress + percentageWeight);
      this.targetPct = this.currentProgress * 100;
      if (!this.animationFrameId) this._animateProgress();
      return Promise.resolve();
    }
  }

  onComplete(fn) {
    if (typeof fn === 'function') {
      this._onComplete = fn;
    } else {
      console.warn('Loader.onComplete expects a function');
    }
  }
}
