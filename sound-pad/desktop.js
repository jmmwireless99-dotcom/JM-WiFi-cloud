(() => {
  "use strict";

  const isElectron = Boolean(window.jjDesktop?.isElectron);
  const isWideScreen = window.matchMedia("(min-width: 900px) and (hover: hover)").matches;
  const installBanner = document.getElementById("install-banner");
  const note = document.querySelector(".note");
  const shortcutsEl = document.getElementById("desktop-shortcuts");

  if (!isElectron && !isWideScreen) return;

  document.body.classList.add("desktop-app");

  if (installBanner) installBanner.classList.add("hidden");

  if (note) {
    note.textContent = isElectron
      ? "Click = play · Right-click = upload MP3/WAV · Space = Stop All"
      : "Click = play · Right-click = upload MP3/WAV";
  }

  if (shortcutsEl) shortcutsEl.classList.remove("hidden");

  function waitForPadApi() {
    return new Promise((resolve) => {
      if (window.jjPad) {
        resolve(window.jjPad);
        return;
      }
      const timer = setInterval(() => {
        if (window.jjPad) {
          clearInterval(timer);
          resolve(window.jjPad);
        }
      }, 50);
    });
  }

  document.addEventListener("keydown", async (e) => {
    const api = await waitForPadApi();
    const tag = e.target.tagName;

    if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA") {
      e.preventDefault();
      api.stopAll();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    const shortcuts = api.getShortcuts?.() || {};
    const padId = shortcuts[key];
    if (padId) {
      e.preventDefault();
      api.triggerById(padId);
    }
  });

  if (window.jjDesktop?.onAction) {
    window.jjDesktop.onAction(async (action) => {
      const api = await waitForPadApi();
      if (action === "stop-all") api.stopAll();
      if (action === "show-shortcuts") shortcutsEl?.scrollIntoView({ behavior: "smooth" });
    });
    window.jjDesktop.ready?.();
  }
})();
