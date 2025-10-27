"use strict";

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const TAG_VARIANTS = {
    dev: { label: "Dev", className: "setting-tag--dev" },
    unstable: { label: "Unstable", className: "setting-tag--unstable" },
    beta: { label: "Beta", className: "setting-tag--beta" }
  };

  function applyTag(node) {
    if (!node || node.nodeType !== 1) return;
    const raw = node.getAttribute("data-setting-tag");
    const value = raw ? String(raw).trim().toLowerCase() : "";
    const variant = TAG_VARIANTS[value];
    let badge = node.querySelector(":scope > .setting-tag");
    if (!variant) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "setting-tag";
      node.appendChild(badge);
    }
    badge.textContent = variant.label;
    badge.className = `setting-tag ${variant.className}`;
  }

  function applyAll(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll("[data-setting-tag]").forEach(applyTag);
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "data-setting-tag") {
        applyTag(mutation.target);
      } else if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.hasAttribute("data-setting-tag")) applyTag(node);
            node.querySelectorAll?.("[data-setting-tag]").forEach(applyTag);
          }
        });
      }
    });
  });

  function initTags() {
    applyAll(document);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-setting-tag"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTags, { once: true });
  } else {
    initTags();
  }

  window.applySettingTags = applyAll;
})();
