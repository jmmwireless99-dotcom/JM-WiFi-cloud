(() => {
  "use strict";

  const installBanner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-btn");
  const installDismiss = document.getElementById("install-dismiss");
  let deferredPrompt = null;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem("jj-pad-install-dismissed")) {
      installBanner?.classList.remove("hidden");
    }
  });

  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBanner?.classList.add("hidden");
  });

  installDismiss?.addEventListener("click", () => {
    localStorage.setItem("jj-pad-install-dismissed", "1");
    installBanner?.classList.add("hidden");
  });

  window.jjHaptic = (ms = 12) => {
    if (navigator.vibrate) navigator.vibrate(ms);
    if (window.Capacitor?.Plugins?.Haptics) {
      window.Capacitor.Plugins.Haptics.impact({ style: "LIGHT" }).catch(() => {});
    }
  };

  if (window.Capacitor?.isNativePlatform?.()) {
    document.body.classList.add("native-app");
    const statusBar = window.Capacitor.Plugins?.StatusBar;
    statusBar?.setBackgroundColor({ color: "#1a1208" }).catch(() => {});
    statusBar?.setStyle({ style: "DARK" }).catch(() => {});
  }
})();
