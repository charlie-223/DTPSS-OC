(() => {
  "use strict";

  const DATABASE_NAME = "one-cainta-offline";
  const DATABASE_VERSION = 1;
  const REMEMBERED_USER_KEY = "one-cainta-offline-user";
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("snapshots", { keyPath: "userId" });
        database.createObjectStore("changes", { keyPath: ["userId", "key"] });
        database.createObjectStore("conflicts", { keyPath: ["userId", "key"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the offline workspace database."));
      request.onblocked = () => reject(new Error("The offline workspace database is blocked by another open tab. Close other One Cainta tabs and try again."));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  function databaseRequest(storeName, mode, operation) {
    return openDatabase().then(database => new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Offline workspace storage failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline workspace storage transaction failed."));
    }));
  }

  function saveChangesAndSnapshot(changes, deleteKeys, snapshot) {
    return openDatabase().then(database => new Promise((resolve, reject) => {
      const transaction = database.transaction(["changes", "snapshots"], "readwrite");
      const changeStore = transaction.objectStore("changes");
      changes.forEach(change => changeStore.put(change));
      deleteKeys.forEach(key => changeStore.delete([snapshot.userId, key]));
      transaction.objectStore("snapshots").put(snapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Offline workspace save failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline workspace save was cancelled."));
    }));
  }

  window.OneCaintaOffline = Object.freeze({
    rememberUser: userId => localStorage.setItem(REMEMBERED_USER_KEY, userId),
    getRememberedUserId: () => localStorage.getItem(REMEMBERED_USER_KEY),
    clearRememberedUser: () => localStorage.removeItem(REMEMBERED_USER_KEY),
    loadSnapshot: userId => databaseRequest("snapshots", "readonly", store => store.get(userId)),
    saveSnapshot: snapshot => databaseRequest("snapshots", "readwrite", store => store.put(snapshot)),
    getChanges: userId => databaseRequest("changes", "readonly", store => store.getAll())
      .then(items => items.filter(item => item.userId === userId)),
    getChange: (userId, key) => databaseRequest("changes", "readonly", store => store.get([userId, key])),
    saveChange: change => databaseRequest("changes", "readwrite", store => store.put(change)),
    saveChangesAndSnapshot,
    deleteChange: (userId, key) => databaseRequest("changes", "readwrite", store => store.delete([userId, key])),
    getConflicts: userId => databaseRequest("conflicts", "readonly", store => store.getAll())
      .then(items => items.filter(item => item.userId === userId)),
    saveConflict: conflict => databaseRequest("conflicts", "readwrite", store => store.put(conflict)),
    deleteConflict: (userId, key) => databaseRequest("conflicts", "readwrite", store => store.delete([userId, key]))
  });

  const installButton = document.getElementById("install-app-button");
  const helpDialog = document.getElementById("install-help-dialog");
  const helpDescription = document.getElementById("install-help-description");
  const helpSteps = document.getElementById("install-help-steps");
  const closeHelpButton = document.getElementById("install-help-close");
  const isIOSDevice = /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isMobileDevice = isIOSDevice || /Android/i.test(window.navigator.userAgent);
  let installPrompt = null;

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function hideInstallButton() {
    installButton.hidden = true;
  }

  function showInstallInstructions() {
    const userAgent = window.navigator.userAgent;
    let description;
    let steps;

    if (/iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
      description = "Add One Cainta to your Home Screen to open it like an app.";
      steps = [
        "Open this page in Safari.",
        "Tap the Share button.",
        "Select Add to Home Screen, then tap Add."
      ];
    } else if (/Android/i.test(userAgent)) {
      description = "Install One Cainta from your browser menu for quick access.";
      steps = [
        "Open the browser menu (⋮).",
        "Select Install app or Add to Home screen.",
        "Confirm the installation."
      ];
    } else {
      description = "Installing One Cainta is available only on mobile devices. Open this website on an Android phone or tablet, or an iPhone or iPad, to install the app.";
      steps = [
        "On Android, open the browser menu and select Install app or Add to Home screen.",
        "On iPhone or iPad, open this site in Safari, tap Share, then select Add to Home Screen."
      ];
    }

    if (!window.isSecureContext) {
      description += " Open the site over a secure HTTPS connection (or localhost) to install it.";
    }

    helpDescription.textContent = description;
    helpSteps.replaceChildren(...steps.map(step => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }));
    helpDialog.showModal();
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (!isMobileDevice || isInstalled()) return;
    installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });

  installButton.addEventListener("click", async () => {
    if (!isMobileDevice) {
      showInstallInstructions();
      return;
    }
    if (!installPrompt) {
      showInstallInstructions();
      return;
    }

    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.error("The app installation prompt could not be opened:", error);
      showInstallInstructions();
    }
  });

  closeHelpButton.addEventListener("click", () => helpDialog.close());
  helpDialog.addEventListener("click", event => {
    if (event.target === helpDialog) helpDialog.close();
  });

  if (!isInstalled()) installButton.hidden = false;
  else hideInstallButton();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    if (hadServiceWorkerController) {
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    }
    navigator.serviceWorker.register("./sw.js").then(registration => registration.update()).catch(error => {
      console.error("The app service worker could not be registered:", error);
    });
  }
})();
