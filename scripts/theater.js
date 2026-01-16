"use strict";

(function () {
  const THEATER_CLASS = "theater-mode";
  const DEFAULT_GUTTER_PX = 16;

  function getVideoFrame() {
    if (typeof document === "undefined") return null;
    return document.querySelector("#playerScreen .mm-video-frame");
  }

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.max(min, Math.min(max, numeric));
  }

  function updateTheaterSizing() {
    try {
      const frame = getVideoFrame();
      if (!frame) return;
      if (!document.body.classList.contains(THEATER_CLASS)) {
        frame.style.removeProperty("--mm-theater-height");
        return;
      }
      const rect = frame.getBoundingClientRect();
      const gutter = DEFAULT_GUTTER_PX;
      const height = clamp(window.innerHeight - rect.top - gutter, 240, window.innerHeight);
      frame.style.setProperty("--mm-theater-height", `${height}px`);
    } catch {}
  }

  function setTheaterEnabled(enabled) {
    const next = enabled === true;
    try {
      document.body.classList.toggle(THEATER_CLASS, next);
      if (typeof theaterBtn !== "undefined" && theaterBtn) {
        theaterBtn.setAttribute("aria-pressed", next ? "true" : "false");
        theaterBtn.classList.toggle("is-active", next);
      }
      updateTheaterSizing();
    } catch {}
  }

  function toggleTheater() {
    const next = !document.body.classList.contains(THEATER_CLASS);
    setTheaterEnabled(next);
  }

  if (typeof window !== "undefined") {
    window.MM_setTheaterMode = setTheaterEnabled;
    window.MM_toggleTheaterMode = toggleTheater;
  }

  if (typeof theaterBtn !== "undefined" && theaterBtn && !theaterBtn.dataset.boundTheater) {
    theaterBtn.addEventListener("click", () => toggleTheater());
    theaterBtn.dataset.boundTheater = "1";
  }

  window.addEventListener("resize", () => updateTheaterSizing());
  window.addEventListener("orientationchange", () => updateTheaterSizing());
  window.addEventListener("scroll", () => updateTheaterSizing(), { passive: true });
})();

