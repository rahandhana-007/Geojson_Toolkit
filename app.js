(() => {
  "use strict";

  const DEFAULT_CENTER = [3.5952, 98.6722];
  const DEFAULT_ZOOM = 13;
  const EARTH_RADIUS = 6371008.8;
  const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
  const READER_EDIT_PIN = "663322";
  const READER_COORD_CAP = 1500;
  const TAB_NAMES = ["maker", "reader", "renamer", "tracker"];
  const TRACKER_MAX_TARGETS = 60;
  const TRACKER_ROUTE_API = "https://router.project-osrm.org/route/v1/driving";
  const TRACKER_ROUTE_TIMEOUT_MS = 12000;
  const TRACKER_ROUTE_MIN_REFRESH_MS = 15000;
  const TRACKER_ROUTE_MOVE_THRESHOLD_M = 25;

  let deferredInstallPrompt = null;

  const state = {
    activeTab: "maker",
    maker: {
      points: [],
      map: null,
      layerGroup: null,
      myLocationLayer: null,
      trailWatchId: null,
      trailPositions: [],
      trailPath: null,
      trailMarker: null,
      trailAccuracyLayer: null,
      trailDistance: 0,
      trailBearing: 0,
      trailPaused: false,
      bsreLayer: null,
      bsreLoading: false,
      identityConfirmed: false,
      isLocating: false
    },
    reader: {
      data: null,
      file: null,
      selectedIndex: -1,
      dirty: false,
      map: null,
      allLayer: null,
      selectedLayer: null,
      bsreLayer: null,
      bsreLoading: false,
      bsreVisible: false,
      editUnlocked: false,
      editMode: false,
      editState: null,
      coordsScope: "all",
      coordsQuery: "",
      coordsRound: true,
      coordsDms: false,
      coordsRenderQueued: false,
      coordMarker: null,
      areaStale: false,
      areaAutoSync: true,
      areaNote: "",
      currentHa: null,
      storedHa: null
    },
    renamer: {
      data: null,
      file: null
    },
    tracker: {
      map: null,
      data: null,
      index: null,
      ids: [],
      featureCount: 0,
      loading: false,
      loadPromise: null,
      targets: [],
      group: null,
      contextLayer: null,
      contextVisible: false,
      locateLayer: null,
      watchId: null,
      myPosition: null,
      activePolygonLayers: [],
      badges: [],
      selectedTarget: -1,
      destination: null,
      routeLayer: null,
      routeMarker: null,
      routeInfo: null,
      routeLoading: false,
      routeRequest: 0,
      routePending: false,
      lastError: null
    }
  };

  const el = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    setupPwa();

    if (typeof window.L === "undefined") {
      document.body.insertAdjacentHTML(
        "afterbegin",
        '<div class="noscript">Peta gagal dimuat. Pastikan file <code>vendor/leaflet.js</code> tersedia, lalu muat ulang.</div>'
      );
      return;
    }

    setupTabs();
    initMaps();
    setupMaker();
    setupReader();
    setupRenamer();
    setupTracker();

    window.addEventListener("beforeunload", (event) => {
      if (state.reader.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Progressive Web App                                                        */
  /* -------------------------------------------------------------------------- */

  function setupPwa() {
    const installButton = el("installAppBtn");
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

    if (isStandalone) installButton.hidden = true;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!isStandalone) installButton.hidden = false;
    });

    installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        showToast(
          "Gunakan menu browser",
          "Pilih “Install app” atau “Tambahkan ke layar utama” pada menu Chrome.",
          "warning"
        );
        return;
      }

      installButton.disabled = true;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.disabled = false;
      installButton.hidden = true;

      if (choice.outcome === "accepted") {
        showToast("Instalasi dimulai", "GeoJSON Toolkit sedang dipasang di perangkat.", "success");
      } else {
        showToast("Instalasi dibatalkan", "Aplikasi tetap dapat digunakan melalui browser.", "warning");
      }
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      installButton.hidden = true;
      showToast("Aplikasi terpasang", "GeoJSON Toolkit siap dibuka dari layar utama.", "success");
    });

    if (!("serviceWorker" in navigator)) return;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              showToast("Pembaruan tersedia", "Muat ulang aplikasi untuk menggunakan versi terbaru.", "success");
            }
          });
        });
      } catch (_error) {
        // Service workers require HTTPS or localhost; the browser version remains usable.
      }
    };

    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker, { once: true });
  }

  /* -------------------------------------------------------------------------- */
  /* Navigation                                                                  */
  /* -------------------------------------------------------------------------- */

  function setupTabs() {
    const tabs = $$(".nav-item[data-tab]");

    tabs.forEach((tab, tabIndex) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = tabIndex;
        if (event.key === "ArrowLeft") nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") nextIndex = (tabIndex + 1) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        tabs[nextIndex].focus();
        switchTab(tabs[nextIndex].dataset.tab);
      });
    });

    document.querySelector(".brand").addEventListener("click", (event) => {
      event.preventDefault();
      switchTab("maker");
    });

    const requestedTab = window.location.hash.replace("#", "");
    if (TAB_NAMES.includes(requestedTab)) {
      switchTab(requestedTab, false);
    }

    // PWA shortcuts and back/forward only change the hash, so follow it too.
    window.addEventListener("hashchange", () => {
      const tab = window.location.hash.replace("#", "");
      if (TAB_NAMES.includes(tab) && tab !== state.activeTab) switchTab(tab, false);
    });
  }

  function switchTab(tabName, updateHistory = true) {
    if (!TAB_NAMES.includes(tabName)) return;
    state.activeTab = tabName;

    $$(".workspace").forEach((panel) => {
      const active = panel.id === tabName;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });

    $$(".nav-item[data-tab]").forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    if (updateHistory) {
      window.history.replaceState(null, "", `#${tabName}`);
    }

    const map = state[tabName]?.map;
    if (map) {
      window.setTimeout(() => map.invalidateSize({ pan: false }), 80);
    }

    if (tabName === "tracker") {
      ensureTrackerData().catch(() => {
        // Failure is surfaced by the Tracker status badge and on the next search.
      });
    } else if (state.tracker.watchId !== null) {
      stopTrackerLocate();
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Maps                                                                        */
  /* -------------------------------------------------------------------------- */

  function initMaps() {
    state.maker.map = createMap("makerMap");
    const bsrePane = state.maker.map.createPane("bsrePane");
    bsrePane.style.zIndex = "350";
    bsrePane.style.pointerEvents = "none";
    const trailPane = state.maker.map.createPane("trailPane");
    trailPane.style.zIndex = "450";
    trailPane.style.pointerEvents = "none";
    state.maker.layerGroup = L.featureGroup().addTo(state.maker.map);
    state.reader.map = createMap("readerMap");
    const readerBsrePane = state.reader.map.createPane("readerBsrePane");
    readerBsrePane.style.zIndex = "390";
    readerBsrePane.style.pointerEvents = "none";

    state.tracker.map = createMap("trackerMap");
    const trackerContextPane = state.tracker.map.createPane("trackerContextPane");
    trackerContextPane.style.zIndex = "360";
    trackerContextPane.style.pointerEvents = "none";
    const trackerTargetPane = state.tracker.map.createPane("trackerTargetPane");
    trackerTargetPane.style.zIndex = "420";
    const trackerRoutePane = state.tracker.map.createPane("trackerRoutePane");
    trackerRoutePane.style.zIndex = "460";
    trackerRoutePane.style.pointerEvents = "none";
    state.tracker.group = L.featureGroup().addTo(state.tracker.map);
  }

  function createMap(elementId) {
    const map = L.map(elementId, {
      zoomControl: true,
      preferCanvas: true
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    const gridPane = map.createPane("gridPane");
    gridPane.style.zIndex = "250";
    gridPane.style.pointerEvents = "none";

    const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    map.attributionControl.setPrefix(false);
    L.control.scale({ imperial: false, maxWidth: 120, position: "bottomleft" }).addTo(map);

    attachOfflineHandling(map, tileLayer);
    return map;
  }

  /* Offline: swap the OSM basemap for a coordinate grid so Manual Coordinate
     input stays usable without a network connection. */
  function attachOfflineHandling(map, tileLayer) {
    let graticule = null;
    let offline = false;
    let errorStreak = 0;
    let lastErrorAt = 0;

    const getGraticule = () => {
      if (!graticule) graticule = createGraticule();
      return graticule;
    };

    const setOffline = (value) => {
      if (offline === value) return;
      offline = value;
      if (value) {
        const layer = getGraticule();
        if (!map.hasLayer(layer)) layer.addTo(map);
        if (tileLayer) tileLayer.setOpacity(0);
      } else {
        if (graticule && map.hasLayer(graticule)) map.removeLayer(graticule);
        if (tileLayer) tileLayer.setOpacity(1);
      }
      updateOfflinePanel(map, value);
    };

    // Successful tiles + a confirmed online state -> back to the normal basemap.
    tileLayer.on("tileload", () => {
      if (navigator.onLine) setOffline(false);
    });
    // A burst of tile errors (no network) -> switch to the grid basemap.
    tileLayer.on("tileerror", () => {
      const now = performance.now();
      if (now - lastErrorAt > 2500) errorStreak = 0;
      lastErrorAt = now;
      errorStreak += 1;
      if (errorStreak >= 2 && !offline) setOffline(true);
    });

    window.addEventListener("offline", () => setOffline(true));
    window.addEventListener("online", () => setOffline(false));
    setOffline(!navigator.onLine);
  }

  function updateOfflinePanel(map, value) {
    const panel = map.getContainer().closest(".map-panel");
    if (!panel) return;
    panel.classList.toggle("is-offline", value);
    const span = panel.querySelector(".map-caption span");
    if (span) span.textContent = value ? "OFFLINE · GRID MODE" : "OPENSTREETMAP";
  }

  function niceStep(span) {
    const steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 45, 90];
    for (const step of steps) {
      if (span / step <= 7) return step;
    }
    return steps[steps.length - 1];
  }

  function gridLabel(value, interval) {
    const decimals = interval >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(interval)));
    return `${value < 0 ? "-" : ""}${Math.abs(value).toFixed(decimals)}°`;
  }

  // A lightweight graticule (lat/lng grid) rendered as canvas tiles, dark-friendly.
  function createGraticule() {
    const Graticule = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const ctx = tile.getContext("2d");
        const z = coords.z;
        const span = 360 / Math.pow(2, z);
        const interval = niceStep(span);
        const map = this._map;
        const originX = coords.x * size.x;
        const originY = coords.y * size.y;
        const nw = this._tileCoordsToBounds(coords).getNorthWest();
        const se = this._tileCoordsToBounds(coords).getSouthEast();

        ctx.lineWidth = 1;
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.fillStyle = "rgba(255,255,255,0.32)";

        const lngStart = Math.floor(nw.lng / interval) * interval;
        for (let lng = lngStart; lng <= se.lng + 1e-9; lng += interval) {
          const px = map.project([0, lng], z).x - originX;
          if (px < -1 || px > size.x + 1) continue;
          ctx.beginPath();
          ctx.moveTo(px, 0);
          ctx.lineTo(px, size.y);
          ctx.stroke();
          ctx.fillText(gridLabel(lng, interval), px + 4, 12);
        }

        const latStart = Math.floor(se.lat / interval) * interval;
        for (let lat = latStart; lat <= nw.lat + 1e-9; lat += interval) {
          const py = map.project([lat, 0], z).y - originY;
          if (py < -1 || py > size.y + 1) continue;
          ctx.beginPath();
          ctx.moveTo(0, py);
          ctx.lineTo(size.x, py);
          ctx.stroke();
          ctx.fillText(gridLabel(lat, interval), 4, py - 4);
        }
        return tile;
      }
    });
    return new Graticule({ pane: "gridPane" });
  }

  function fitLeafletLayer(map, layer, maxZoom = 18) {
    try {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [34, 34], maxZoom });
        return true;
      }
    } catch (_error) {
      // Layer types without bounds are safely ignored.
    }
    return false;
  }

  /* -------------------------------------------------------------------------- */
  /* Maker                                                                       */
  /* -------------------------------------------------------------------------- */

  function setupMaker() {
    el("makerName").addEventListener("input", updateMakerAvailability);
    el("makerOwner").addEventListener("input", updateMakerAvailability);
    el("confirmIdentityBtn").addEventListener("click", confirmMakerIdentity);
    el("myLocationBtn").addEventListener("click", findMyLocation);
    el("trailToggleBtn").addEventListener("click", toggleMakerTrail);
    el("takePointBtn").addEventListener("click", takeGpsPoint);
    el("loadBsreBtn").addEventListener("click", loadBsreLayer);
    el("resetMakerBtn").addEventListener("click", resetMaker);
    el("downloadMakerBtn").addEventListener("click", downloadMakerGeoJSON);
    el("manualCoordinateBtn").addEventListener("click", toggleManualCoordinatePanel);
    el("closeManualCoordinateBtn").addEventListener("click", () => closeManualCoordinatePanel(false));
    el("cancelManualCoordinateBtn").addEventListener("click", () => closeManualCoordinatePanel(false));
    el("addManualCoordinatesBtn").addEventListener("click", addManualCoordinates);
    el("manualCoordinatesInput").addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        addManualCoordinates();
      }
    });

    el("pointTableBody").addEventListener("click", (event) => {
      const button = event.target.closest(".delete-point");
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;
      state.maker.points.splice(index, 1);
      if (!state.maker.points.length) stopMakerTrail(true);
      renderMaker(true);
      showToast("Titik dihapus", `Titik ${index + 1} telah dikeluarkan dari polygon.`, "warning");
    });

    updateMakerAvailability();
  }

  function confirmMakerIdentity() {
    const name = el("makerName").value.trim();
    const owner = el("makerOwner").value.trim();

    if (!name || !owner) {
      showToast("Identitas belum lengkap", "Isi nama lahan dan nama pemilik sebelum menekan Confirm.", "warning");
      (!name ? el("makerName") : el("makerOwner")).focus();
      return;
    }

    state.maker.identityConfirmed = true;
    el("makerIdentityPanel").hidden = true;
    setGpsStatus("", "Siap mengambil lokasi", "Identitas terkunci. Aktifkan izin lokasi pada browser Anda.");
    updateMakerAvailability();

    window.setTimeout(() => {
      state.maker.map.invalidateSize({ pan: false });
      el("takePointBtn").focus();
    }, 80);

    showToast("Identitas dikonfirmasi", `${name} · Pemilik: ${owner}`, "success");
  }

  function toggleManualCoordinatePanel() {
    if (!state.maker.identityConfirmed) {
      showToast("Konfirmasi identitas terlebih dahulu", "Isi identitas lahan lalu tekan Confirm.", "warning");
      el("makerName").focus();
      return;
    }

    const panel = el("manualCoordinatePanel");
    const shouldOpen = panel.hidden;
    panel.hidden = !shouldOpen;
    el("manualCoordinateBtn").setAttribute("aria-expanded", String(shouldOpen));
    setInlineMessage("manualCoordinateMessage", "", "", true);

    if (shouldOpen) {
      window.setTimeout(() => el("manualCoordinatesInput").focus(), 40);
    }
  }

  function closeManualCoordinatePanel(clearInput) {
    el("manualCoordinatePanel").hidden = true;
    el("manualCoordinateBtn").setAttribute("aria-expanded", "false");
    setInlineMessage("manualCoordinateMessage", "", "", true);
    if (clearInput) el("manualCoordinatesInput").value = "";
  }

  function addManualCoordinates() {
    if (!state.maker.identityConfirmed) return;

    const input = el("manualCoordinatesInput");
    const order = el("manualCoordinateOrder").value;
    const lines = input.value
      .split(/\r?\n/)
      .map((line, index) => ({ text: line.trim(), number: index + 1 }))
      .filter((line) => line.text);

    if (!lines.length) {
      setInlineMessage(
        "manualCoordinateMessage",
        "Belum ada koordinat. Paste minimal satu baris latitude dan longitude.",
        "error",
        false
      );
      input.focus();
      return;
    }

    const parsedPoints = [];
    const errors = [];
    const numberPattern = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)/g;

    lines.forEach((line) => {
      const matches = line.text.match(numberPattern) || [];
      if (matches.length !== 2) {
        errors.push(`Baris ${line.number}: harus berisi tepat dua angka koordinat.`);
        return;
      }

      const first = Number(matches[0]);
      const second = Number(matches[1]);
      const lat = order === "lnglat" ? second : first;
      const lng = order === "lnglat" ? first : second;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        errors.push(`Baris ${line.number}: koordinat bukan angka yang valid.`);
        return;
      }
      if (lat < -90 || lat > 90) {
        errors.push(`Baris ${line.number}: latitude harus antara -90 dan 90.`);
        return;
      }
      if (lng < -180 || lng > 180) {
        errors.push(`Baris ${line.number}: longitude harus antara -180 dan 180.`);
        return;
      }

      parsedPoints.push({
        lat: roundCoordinate(lat),
        lng: roundCoordinate(lng),
        accuracy: null,
        source: "manual",
        capturedAt: new Date().toISOString()
      });
    });

    if (errors.length) {
      const shown = errors.slice(0, 8);
      const remainder = errors.length > shown.length ? `\n• …dan ${errors.length - shown.length} kesalahan lain.` : "";
      setInlineMessage(
        "manualCoordinateMessage",
        `Koordinat belum ditambahkan:\n• ${shown.join("\n• ")}${remainder}`,
        "error",
        false
      );
      return;
    }

    clearMyLocationPreview();
    state.maker.points.push(...parsedPoints);
    closeManualCoordinatePanel(true);
    renderMaker(true);
    showToast(
      "Koordinat manual ditambahkan",
      `${parsedPoints.length} titik baru dimasukkan ke Capture Log.`,
      "success"
    );
  }

  async function loadBsreLayer() {
    const button = el("loadBsreBtn");

    if (state.maker.bsreLayer) {
      if (!state.maker.map.hasLayer(state.maker.bsreLayer)) {
        state.maker.bsreLayer.addTo(state.maker.map);
      }
      fitLeafletLayer(state.maker.map, state.maker.bsreLayer, 17);
      showToast("BSRE sudah aktif", "Peta diarahkan kembali ke polygon BSRE.", "success");
      return;
    }
    if (state.maker.bsreLoading) return;

    state.maker.bsreLoading = true;
    button.disabled = true;
    button.classList.add("is-loading");
    button.querySelector("span").textContent = "Loading…";

    try {
      const response = await fetch("assets/bsre.geojson", { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const validationErrors = validateGeoJSON(data);
      if (validationErrors.length) {
        throw new Error(validationErrors[0]);
      }

      const bsreLayer = L.geoJSON(data, {
        pane: "bsrePane",
        style: {
          pane: "bsrePane",
          color: "#0284c7",
          weight: 1.4,
          opacity: 0.95,
          fillColor: "#38bdf8",
          fillOpacity: 0.28,
          interactive: false
        },
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
          pane: "bsrePane",
          radius: 5,
          color: "#ffffff",
          weight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: 1,
          interactive: false
        })
      }).addTo(state.maker.map);

      state.maker.bsreLayer = bsreLayer;
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
      button.title = "Fokuskan peta ke polygon BSRE";
      fitLeafletLayer(state.maker.map, bsreLayer, 17);
      updateMakerAvailability();

      showToast(
        "Polygon BSRE ditampilkan",
        `${formatNumber(getFeatures(data).length, 0)} feature dimuat dengan warna sky blue.`,
        "success"
      );
    } catch (error) {
      showToast("BSRE gagal dimuat", `File polygon BSRE tidak dapat dibuka: ${error.message}`, "error");
    } finally {
      state.maker.bsreLoading = false;
      button.disabled = false;
      button.classList.remove("is-loading");
      button.querySelector("span").textContent = "Load BSRE";
    }
  }

  function findMyLocation() {
    if (state.maker.isLocating) return;
    if (!state.maker.identityConfirmed) {
      showToast("Konfirmasi identitas terlebih dahulu", "Isi identitas lahan lalu tekan Confirm.", "warning");
      return;
    }
    if (state.maker.points.length) {
      showToast("Pengambilan titik sudah dimulai", "My Location hanya tersedia sebelum titik pertama ditambahkan.", "warning");
      return;
    }
    if (!("geolocation" in navigator)) {
      setGpsStatus("error", "Geolocation tidak tersedia", "Browser ini tidak mendukung Location API.");
      updateGpsQuality(null);
      showToast("GPS tidak tersedia", "Gunakan browser modern dengan dukungan geolocation.", "error");
      return;
    }

    const button = el("myLocationBtn");
    state.maker.isLocating = true;
    button.classList.add("is-loading");
    button.querySelector("strong").textContent = "Mencari Lokasi…";
    setGpsQualityPending();
    setGpsStatus("loading", "Mencari lokasi Anda…", "Posisi ini hanya untuk memusatkan peta dan belum disimpan sebagai titik.");
    updateMakerAvailability();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = roundCoordinate(position.coords.latitude);
        const lng = roundCoordinate(position.coords.longitude);
        const accuracy = Number.isFinite(position.coords.accuracy)
          ? Math.max(1, Math.round(position.coords.accuracy * 10) / 10)
          : null;

        clearMyLocationPreview();
        const group = L.featureGroup();
        if (accuracy !== null) {
          L.circle([lat, lng], {
            radius: accuracy,
            color: "#38bdf8",
            weight: 1.5,
            opacity: 0.9,
            fillColor: "#7dd3fc",
            fillOpacity: 0.14,
            interactive: false
          }).addTo(group);
        }
        L.circleMarker([lat, lng], {
          radius: 9,
          color: "#ffffff",
          weight: 3,
          fillColor: "#0284c7",
          fillOpacity: 1
        })
          .bindPopup(`<div class="map-popup"><strong>Lokasi Anda</strong><code>${lat.toFixed(7)}<br>${lng.toFixed(7)}</code><br><small>Belum disimpan sebagai titik</small></div>`)
          .addTo(group);

        state.maker.myLocationLayer = group.addTo(state.maker.map);
        state.maker.isLocating = false;
        button.classList.remove("is-loading");
        button.classList.add("is-active");
        button.querySelector("strong").textContent = "Lokasi Ditemukan";
        fitLeafletLayer(state.maker.map, group, 19);
        const quality = updateGpsQuality(accuracy);
        setGpsStatus(
          "success",
          "Lokasi Anda ditemukan",
          accuracy !== null
            ? `Akurasi ±${formatNumber(accuracy, 1)} m · ${quality.label}. Tekan Ambil Titik untuk menyimpan koordinat.`
            : `${quality.label}. Tekan Ambil Titik untuk menyimpan koordinat.`
        );
        updateMakerAvailability();
        showToast("Peta dipusatkan ke lokasi Anda", "Lokasi belum masuk Capture Log. Tekan Ambil Titik untuk menyimpannya.", "success");
      },
      (error) => {
        state.maker.isLocating = false;
        button.classList.remove("is-loading");
        button.querySelector("strong").textContent = state.maker.myLocationLayer ? "Lokasi Ditemukan" : "My Location";
        const messages = {
          1: ["Izin lokasi ditolak", "Izinkan akses lokasi pada pengaturan browser, lalu coba lagi."],
          2: ["Posisi tidak tersedia", "Sinyal GPS belum tersedia. Pindah ke area terbuka dan coba lagi."],
          3: ["Pencarian lokasi timeout", "GPS terlalu lama merespons. Coba sekali lagi."]
        };
        const [title, detail] = messages[error.code] || ["Gagal mencari lokasi", error.message || "Terjadi kesalahan geolocation."];
        updateGpsQuality(null);
        setGpsStatus("error", title, detail);
        updateMakerAvailability();
        showToast(title, detail, "error");
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  }

  function clearMyLocationPreview() {
    if (state.maker.myLocationLayer) {
      state.maker.map.removeLayer(state.maker.myLocationLayer);
      state.maker.myLocationLayer = null;
    }
    const button = el("myLocationBtn");
    button.classList.remove("is-active", "is-loading");
    button.querySelector("strong").textContent = "My Location";
  }

  function startOrExtendMakerTrail(point) {
    if (state.maker.trailPath) {
      recordMakerTrailPosition(point, point.accuracy ?? null, true);
      return;
    }

    if (typeof navigator.geolocation?.watchPosition !== "function") {
      showToast("Live Trail tidak tersedia", "Browser ini tidak mendukung pemantauan posisi berkelanjutan.", "warning");
      return;
    }

    state.maker.trailPositions = [{ lat: point.lat, lng: point.lng }];
    state.maker.trailDistance = 0;
    state.maker.trailBearing = 0;
    state.maker.trailPaused = false;
    state.maker.trailPath = L.polyline([[point.lat, point.lng]], {
      pane: "trailPane",
      color: "#f59e0b",
      weight: 3.5,
      opacity: 0.95,
      dashArray: "2 9",
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(state.maker.map);

    updateTrailDirectionMarker(point);
    updateTrailAccuracy(point, point.accuracy ?? null);
    el("trailStatus").hidden = false;
    beginTrailWatch();
    updateTrailStatus();
    showToast("Live Trail aktif", "Garis titik akan mengikuti pergerakan menuju titik berikutnya.", "success");
  }

  function beginTrailWatch() {
    if (state.maker.trailWatchId !== null || !state.maker.trailPath) return;
    state.maker.trailPaused = false;
    state.maker.trailWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const current = {
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude)
        };
        const accuracy = Number.isFinite(position.coords.accuracy)
          ? Math.max(1, Math.round(position.coords.accuracy * 10) / 10)
          : null;
        recordMakerTrailPosition(current, accuracy, false);
      },
      (error) => {
        updateGpsQuality(null);
        if (error.code === 1) {
          pauseMakerTrail();
          el("trailStatusText").textContent = "Izin lokasi dicabut · trail dijeda";
          showToast("Live Trail dijeda", "Izin pemantauan lokasi tidak tersedia.", "warning");
        } else {
          el("trailStatusText").textContent = "Menunggu sinyal GPS berikutnya…";
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 1000
      }
    );
  }

  function recordMakerTrailPosition(point, accuracy, forceCommit) {
    if (!state.maker.trailPath) return;
    const positions = state.maker.trailPositions;
    const previous = positions[positions.length - 1];
    const distance = previous ? haversineDistance(previous, point) : 0;

    if (previous && distance >= 0.8) {
      state.maker.trailBearing = calculateBearing(previous, point);
    }

    if (!previous) {
      positions.push({ lat: point.lat, lng: point.lng });
    } else if (distance >= 1.5 || (forceCommit && distance >= 0.2)) {
      positions.push({ lat: point.lat, lng: point.lng });
      state.maker.trailDistance += distance;
    }

    if (positions.length > 5000) {
      state.maker.trailPositions = positions.filter((_item, index) => index === 0 || index === positions.length - 1 || index % 2 === 0);
    }

    const committed = state.maker.trailPositions;
    const lastCommitted = committed[committed.length - 1];
    const tailDistance = lastCommitted ? haversineDistance(lastCommitted, point) : 0;
    const displayPositions = committed.map((item) => [item.lat, item.lng]);
    if (tailDistance >= 0.2) displayPositions.push([point.lat, point.lng]);
    state.maker.trailPath.setLatLngs(displayPositions);

    updateTrailDirectionMarker(point);
    updateTrailAccuracy(point, accuracy);
    if (accuracy !== null) updateGpsQuality(accuracy);
    updateTrailStatus(state.maker.trailDistance + tailDistance);
    state.maker.map.panInside([point.lat, point.lng], {
      paddingTopLeft: [55, 75],
      paddingBottomRight: [55, 75],
      animate: true
    });
  }

  function updateTrailDirectionMarker(point) {
    const bearing = Math.round(state.maker.trailBearing * 10) / 10;
    const icon = L.divIcon({
      className: "trail-direction-icon",
      html: `<span style="transform:rotate(${bearing}deg)"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 20 21l-8-4-8 4L12 2Z"/></svg></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    if (state.maker.trailMarker) {
      state.maker.trailMarker.setLatLng([point.lat, point.lng]).setIcon(icon);
    } else {
      state.maker.trailMarker = L.marker([point.lat, point.lng], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 800
      }).addTo(state.maker.map);
    }
  }

  function updateTrailAccuracy(point, accuracy) {
    if (accuracy === null) return;
    if (state.maker.trailAccuracyLayer) {
      state.maker.trailAccuracyLayer.setLatLng([point.lat, point.lng]).setRadius(accuracy);
    } else {
      state.maker.trailAccuracyLayer = L.circle([point.lat, point.lng], {
        pane: "trailPane",
        radius: accuracy,
        color: "#f59e0b",
        weight: 1,
        opacity: 0.45,
        fillColor: "#fbbf24",
        fillOpacity: 0.06,
        interactive: false
      }).addTo(state.maker.map);
    }
  }

  function calculateBearing(from, to) {
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function updateTrailStatus(distance = state.maker.trailDistance) {
    if (!state.maker.trailPath) return;
    const status = el("trailStatus");
    status.hidden = false;
    status.classList.toggle("is-paused", state.maker.trailPaused);
    el("trailStatusText").textContent = state.maker.trailPaused
      ? `Dijeda · ${formatTrailDistance(distance)}`
      : `Aktif · ${formatTrailDistance(distance)} · arah ${Math.round(state.maker.trailBearing)}°`;

    const button = el("trailToggleBtn");
    button.querySelector("span").textContent = state.maker.trailPaused ? "Resume" : "Pause";
    button.querySelector("svg").innerHTML = state.maker.trailPaused
      ? '<path d="m7 4 12 8-12 8V4Z"/>'
      : '<path d="M8 5v14M16 5v14"/>';
  }

  function formatTrailDistance(distance) {
    return distance >= 1000
      ? `${formatNumber(distance / 1000, 2)} km`
      : `${formatNumber(distance, 1)} m`;
  }

  function toggleMakerTrail() {
    if (!state.maker.trailPath) return;
    if (state.maker.trailPaused) {
      beginTrailWatch();
      updateTrailStatus();
      showToast("Live Trail dilanjutkan", "Pemantauan pergerakan GPS kembali aktif.", "success");
    } else {
      pauseMakerTrail();
      showToast("Live Trail dijeda", "Jejak tetap terlihat dan dapat dilanjutkan kembali.", "warning");
    }
  }

  function pauseMakerTrail() {
    if (state.maker.trailWatchId !== null) {
      navigator.geolocation.clearWatch(state.maker.trailWatchId);
      state.maker.trailWatchId = null;
    }
    state.maker.trailPaused = true;
    updateTrailStatus();
  }

  function stopMakerTrail(clearLayers) {
    if (state.maker.trailWatchId !== null) {
      navigator.geolocation.clearWatch(state.maker.trailWatchId);
      state.maker.trailWatchId = null;
    }
    if (clearLayers) {
      [state.maker.trailPath, state.maker.trailMarker, state.maker.trailAccuracyLayer].forEach((layer) => {
        if (layer && state.maker.map.hasLayer(layer)) state.maker.map.removeLayer(layer);
      });
      state.maker.trailPath = null;
      state.maker.trailMarker = null;
      state.maker.trailAccuracyLayer = null;
      state.maker.trailPositions = [];
      state.maker.trailDistance = 0;
      state.maker.trailBearing = 0;
      state.maker.trailPaused = false;
      el("trailStatus").hidden = true;
    }
  }

  function takeGpsPoint() {
    if (state.maker.isLocating) return;
    if (!state.maker.identityConfirmed) {
      showToast("Konfirmasi identitas terlebih dahulu", "Isi identitas lahan lalu tekan Confirm.", "warning");
      el("makerIdentityPanel").hidden = false;
      el("makerName").focus();
      return;
    }

    if (!("geolocation" in navigator)) {
      setGpsStatus("error", "Geolocation tidak tersedia", "Browser ini tidak mendukung Location API.");
      updateGpsQuality(null);
      showToast("GPS tidak tersedia", "Gunakan browser modern dengan dukungan geolocation.", "error");
      return;
    }

    state.maker.isLocating = true;
    el("takePointBtn").disabled = true;
    setGpsQualityPending();
    setGpsStatus("loading", "Mencari posisi akurat…", "Tetap diam beberapa detik di titik pengukuran.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
          accuracy: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy * 10) / 10
            : null,
          source: "gps",
          capturedAt: new Date().toISOString()
        };

        clearMyLocationPreview();
        state.maker.points.push(point);
        state.maker.isLocating = false;
        const quality = updateGpsQuality(point.accuracy);
        setGpsStatus(
          "success",
          `Titik ${state.maker.points.length} berhasil direkam`,
          point.accuracy !== null
            ? `Akurasi perangkat ±${formatNumber(point.accuracy, 1)} m · ${quality.label}.`
            : `${quality.label} · akurasi perangkat tidak tersedia.`
        );
        renderMaker(true);
        startOrExtendMakerTrail(point);
        showToast("Koordinat tersimpan", `${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`, "success");
      },
      (error) => {
        state.maker.isLocating = false;
        const messages = {
          1: ["Izin lokasi ditolak", "Izinkan akses lokasi pada pengaturan browser, lalu coba lagi."],
          2: ["Posisi tidak tersedia", "Sinyal GPS belum tersedia. Pindah ke area terbuka dan coba lagi."],
          3: ["Pencarian lokasi timeout", "GPS terlalu lama merespons. Coba ambil titik sekali lagi."]
        };
        const [title, detail] = messages[error.code] || ["Gagal mengambil lokasi", error.message || "Terjadi kesalahan geolocation."];
        updateGpsQuality(null);
        setGpsStatus("error", title, detail);
        updateMakerAvailability();
        showToast(title, detail, "error");
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  }

  function setGpsStatus(type, title, detail) {
    const status = el("gpsStatus");
    status.className = `gps-status${type ? ` is-${type}` : ""}`;
    status.querySelector("strong").textContent = title;
    status.querySelector("small").textContent = detail;
  }

  function classifyGpsAccuracy(accuracy) {
    if (!Number.isFinite(accuracy)) return { key: "bad", label: "Bad Signal" };
    if (accuracy <= 5) return { key: "very", label: "Sangat Akurat" };
    if (accuracy <= 10) return { key: "good", label: "Akurat" };
    if (accuracy <= 25) return { key: "low", label: "Kurang Akurat" };
    return { key: "bad", label: "Bad Signal" };
  }

  function updateGpsQuality(accuracy) {
    const panel = el("gpsQualityPanel");
    const quality = classifyGpsAccuracy(accuracy);
    panel.dataset.quality = quality.key;
    el("gpsQualityLabel").textContent = quality.label;
    el("gpsAccuracyValue").textContent = Number.isFinite(accuracy)
      ? `±${formatNumber(accuracy, 1)} m`
      : "NO FIX";
    return quality;
  }

  function setGpsQualityPending() {
    const panel = el("gpsQualityPanel");
    panel.removeAttribute("data-quality");
    el("gpsQualityLabel").textContent = "Mengukur sinyal…";
    el("gpsAccuracyValue").textContent = "…";
  }

  function resetGpsQuality() {
    const panel = el("gpsQualityPanel");
    panel.removeAttribute("data-quality");
    el("gpsQualityLabel").textContent = "Menunggu GPS";
    el("gpsAccuracyValue").textContent = "—";
  }

  function renderMaker(refitMap = false) {
    const points = state.maker.points;
    const body = el("pointTableBody");
    body.replaceChildren();

    if (!points.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      row.innerHTML = '<td colspan="5">Belum ada titik yang direkam.</td>';
      body.append(row);
    } else {
      points.forEach((point, index) => {
        const row = document.createElement("tr");
        const pointQuality = classifyGpsAccuracy(point.accuracy);
        const accuracyDisplay = point.source === "manual"
          ? '<span class="manual-source-badge">Manual</span>'
          : `<span class="gps-accuracy-cell"><span>${point.accuracy === null ? "—" : `±${formatNumber(point.accuracy, 1)} m`}</span><b class="gps-quality-badge quality-${pointQuality.key}">${pointQuality.label}</b></span>`;
        row.innerHTML = `
          <td><span class="point-number">${index + 1}</span></td>
          <td>${point.lat.toFixed(7)}</td>
          <td>${point.lng.toFixed(7)}</td>
          <td>${accuracyDisplay}</td>
          <td>
            <button class="delete-point" type="button" data-index="${index}" aria-label="Hapus titik ${index + 1}" title="Hapus titik">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
            </button>
          </td>`;
        body.append(row);
      });
    }

    renderMakerMap(refitMap);
    updateMakerAvailability();
  }

  function renderMakerMap(refitMap) {
    const points = state.maker.points;
    const layerGroup = state.maker.layerGroup;
    layerGroup.clearLayers();

    points.forEach((point, index) => {
      const icon = L.divIcon({
        className: "numbered-marker",
        html: `<span>${index + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker([point.lat, point.lng], { icon, keyboard: true });
      marker.bindPopup(
        `<div class="map-popup"><strong>Titik ${index + 1}</strong><code>${point.lat.toFixed(7)}<br>${point.lng.toFixed(7)}</code></div>`
      );
      marker.addTo(layerGroup);
    });

    if (points.length >= 3) {
      L.polygon(
        points.map((point) => [point.lat, point.lng]),
        { color: "#72d64f", weight: 3, fillColor: "#8ee879", fillOpacity: 0.2, lineJoin: "miter" }
      ).addTo(layerGroup);
    } else if (points.length >= 2) {
      L.polyline(
        points.map((point) => [point.lat, point.lng]),
        { color: "#72d64f", weight: 3, dashArray: "8 7", lineCap: "square" }
      ).addTo(layerGroup);
    }

    if (refitMap && points.length) {
      fitLeafletLayer(state.maker.map, layerGroup, points.length === 1 ? 19 : 18);
    }
  }

  function updateMakerAvailability() {
    const pointCount = state.maker.points.length;
    const polygonReady = pointCount >= 3;
    const area = polygonReady ? calculateSphericalArea(state.maker.points) : 0;
    const perimeter = polygonReady ? calculatePerimeter(state.maker.points) : 0;
    const name = el("makerName").value.trim();
    const owner = el("makerOwner").value.trim();
    const identityConfirmed = state.maker.identityConfirmed;
    const filename = `${strictSlug(name || "nama_lahan")}.geojson`;
    const bsreSuffix = state.maker.bsreLayer ? " · BSRE aktif" : "";

    el("makerFileHint").textContent = filename;
    el("confirmIdentityBtn").disabled = !name || !owner || state.maker.isLocating;
    el("manualCoordinateBtn").disabled = !identityConfirmed || state.maker.isLocating;
    el("gpsQualityPanel").hidden = !identityConfirmed;
    el("myLocationAction").hidden = !identityConfirmed || pointCount > 0;
    el("myLocationBtn").disabled = !identityConfirmed || pointCount > 0 || state.maker.isLocating;
    el("pointCount").textContent = String(pointCount);
    el("pointCountBadge").textContent = String(pointCount);
    el("areaM2").textContent = polygonReady ? formatNumber(area, area < 100 ? 2 : 0) : "—";
    el("areaHa").textContent = polygonReady ? formatNumber(area / 10000, 4) : "—";
    el("perimeter").textContent = polygonReady ? formatNumber(perimeter, 1) : "—";
    el("resetMakerBtn").disabled = (pointCount === 0 && !identityConfirmed) || state.maker.isLocating;
    el("takePointBtn").disabled = state.maker.isLocating || !identityConfirmed;
    el("downloadMakerBtn").disabled = !identityConfirmed || !polygonReady || !name || !owner || state.maker.isLocating;

    const message = el("makerMessage");
    message.className = "inline-alert inline-alert-info";
    if (!identityConfirmed) {
      message.textContent = "Isi nama lahan dan nama pemilik, lalu tekan Confirm untuk memulai pengambilan titik.";
    } else if (pointCount === 0) {
      message.textContent = "Gunakan My Location untuk memusatkan peta, lalu ambil minimal 3 titik untuk membentuk polygon.";
    } else if (pointCount < 3) {
      message.textContent = `${3 - pointCount} titik lagi diperlukan. Garis saat ini masih berupa preview terbuka.`;
    } else if (!name || !owner) {
      message.textContent = `Polygon siap — lengkapi ${!name && !owner ? "Nama Lahan dan Nama Pemilik" : !name ? "Nama Lahan" : "Nama Pemilik"} untuk mengaktifkan download.`;
    } else {
      message.className = "inline-alert success";
      message.textContent = `Polygon siap — ${pointCount} titik, luas ${formatNumber(area, 2)} m² (${formatNumber(area / 10000, 4)} ha).`;
    }

    el("makerMapCaption").textContent = !identityConfirmed
      ? `Konfirmasi identitas lahan untuk memulai${bsreSuffix}`
      : polygonReady
        ? `Polygon tertutup otomatis · ${pointCount} titik · ${formatNumber(area / 10000, 4)} ha${bsreSuffix}`
        : pointCount
          ? `Preview garis aktif · ${pointCount} dari minimal 3 titik${bsreSuffix}`
          : state.maker.myLocationLayer
            ? "Lokasi Anda ditampilkan · belum disimpan ke Capture Log"
            : state.maker.bsreLayer
              ? "Polygon BSRE aktif · warna sky blue"
              : "Gunakan My Location atau ambil titik pertama untuk memulai.";
  }

  function resetMaker() {
    if (state.maker.points.length && !window.confirm("Hapus seluruh titik dan buka kembali Identitas Lahan?")) return;
    state.maker.points = [];
    state.maker.identityConfirmed = false;
    clearMyLocationPreview();
    stopMakerTrail(true);
    closeManualCoordinatePanel(true);
    el("makerIdentityPanel").hidden = false;
    setGpsStatus("", "Menunggu konfirmasi identitas", "Periksa identitas lahan, lalu tekan Confirm.");
    resetGpsQuality();
    renderMaker(false);
    if (state.maker.bsreLayer) {
      fitLeafletLayer(state.maker.map, state.maker.bsreLayer, 17);
    } else {
      state.maker.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
    window.setTimeout(() => {
      state.maker.map.invalidateSize({ pan: false });
      el("makerName").focus();
    }, 80);
    showToast(
      "Maker direset",
      state.maker.bsreLayer
        ? "Titik GPS dihapus, Identitas Lahan dibuka kembali, dan layer BSRE tetap ditampilkan."
        : "Titik GPS dihapus dan Identitas Lahan dibuka kembali.",
      "warning"
    );
  }

  function downloadMakerGeoJSON() {
    const name = el("makerName").value.trim();
    const owner = el("makerOwner").value.trim();
    const points = state.maker.points;

    if (!name) {
      showToast("Nama lahan belum diisi", "Isi nama lahan sebelum mengunduh.", "error");
      el("makerName").focus();
      return;
    }
    if (!owner) {
      showToast("Nama pemilik belum diisi", "Isi nama pemilik lahan sebelum mengunduh.", "error");
      el("makerOwner").focus();
      return;
    }
    if (points.length < 3) {
      showToast("Polygon belum lengkap", "Ambil minimal 3 titik GPS.", "error");
      return;
    }

    const area = calculateSphericalArea(points);
    const ring = points.map((point) => [point.lng, point.lat]);
    ring.push([...ring[0]]);

    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            nama_lahan: name,
            nama_pemilik: owner,
            luas_hektar: Number((area / 10000).toFixed(4)),
            tanggal_pembuatan: new Date().toISOString(),
            jumlah_titik: points.length
          },
          geometry: {
            type: "Polygon",
            coordinates: [ring]
          }
        }
      ]
    };

    const filename = `${strictSlug(name)}.geojson`;
    downloadJSON(data, filename);
    showToast("GeoJSON dibuat", `${filename} berhasil diunduh.`, "success");
  }

  function calculateSphericalArea(points) {
    if (points.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const lat1 = toRadians(current.lat);
      const lat2 = toRadians(next.lat);
      let deltaLng = toRadians(next.lng - current.lng);
      if (deltaLng > Math.PI) deltaLng -= Math.PI * 2;
      if (deltaLng < -Math.PI) deltaLng += Math.PI * 2;
      total += deltaLng * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
  }

  function calculatePerimeter(points) {
    if (points.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < points.length; i += 1) {
      total += haversineDistance(points[i], points[(i + 1) % points.length]);
    }
    return total;
  }

  function haversineDistance(a, b) {
    const deltaLat = toRadians(b.lat - a.lat);
    const deltaLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* -------------------------------------------------------------------------- */
  /* Reader                                                                      */
  /* -------------------------------------------------------------------------- */

  function setupReader() {
    setupDropZone("readerDropZone", "readerFileInput", loadReaderFile);
    el("readerReplaceBtn").addEventListener("click", () => {
      if (state.reader.editMode) {
        showToast("Selesaikan mode edit dulu", "Keluar dari mode Edit Polygon sebelum mengganti file.", "warning");
        return;
      }
      if (state.reader.dirty && !window.confirm("Perubahan belum disimpan. Tetap ganti file?")) return;
      el("readerFileInput").click();
    });
    el("readerCompareBtn").addEventListener("click", showReaderBsreOverlay);
    el("readerHideBsreBtn").addEventListener("click", hideReaderBsreOverlay);

    el("readerFeatureList").addEventListener("click", (event) => {
      const button = event.target.closest(".feature-item");
      if (!button) return;
      selectReaderFeature(Number(button.dataset.index));
    });

    el("addPropertyBtn").addEventListener("click", () => {
      if (state.reader.selectedIndex < 0) return;
      const empty = el("propertyEditor").querySelector(".empty-properties");
      if (empty) empty.remove();
      el("propertyEditor").append(createPropertyRow("", "", "string"));
      markReaderDirty();
      const rows = $$(".property-row", el("propertyEditor"));
      rows[rows.length - 1]?.querySelector(".property-key")?.focus();
    });

    el("propertyEditor").addEventListener("input", markReaderDirty);
    el("propertyEditor").addEventListener("change", (event) => {
      if (event.target.classList.contains("property-type")) {
        configurePropertyValueInput(event.target.closest(".property-row"));
      }
      markReaderDirty();
    });
    el("propertyEditor").addEventListener("click", (event) => {
      const button = event.target.closest(".delete-property");
      if (!button) return;
      button.closest(".property-row").remove();
      if (!el("propertyEditor").querySelector(".property-row")) appendEmptyPropertyState();
      markReaderDirty();
    });

    el("savePropertiesBtn").addEventListener("click", () => saveReaderProperties(true));
    el("downloadReaderBtn").addEventListener("click", downloadReaderGeoJSON);

    el("readerEditUnlockBtn").addEventListener("click", openPinModal);
    el("readerEditPolygonBtn").addEventListener("click", toggleReaderEditMode);
    el("pinConfirmBtn").addEventListener("click", submitPin);
    el("pinCancelBtn").addEventListener("click", closePinModal);
    el("pinCloseBtn").addEventListener("click", closePinModal);
    el("pinInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitPin();
      } else if (event.key === "Escape") {
        closePinModal();
      }
    });
    el("pinModal").addEventListener("click", (event) => {
      if (event.target === el("pinModal")) closePinModal();
    });

    setupReaderCoordinates();
    setupReaderAreaSync();
    updateReaderBsreControls();
  }

  async function showReaderBsreOverlay() {
    if (!state.reader.data) {
      showToast("File pembanding belum tersedia", "Upload GeoJSON utama terlebih dahulu.", "warning");
      return;
    }
    if (state.reader.bsreLoading) return;

    if (state.reader.bsreLayer) {
      if (!state.reader.map.hasLayer(state.reader.bsreLayer)) {
        state.reader.bsreLayer.addTo(state.reader.map);
      }
      state.reader.bsreVisible = true;
      updateReaderBsreControls();
      showToast("Compare aktif", "Polygon BSRE ditampilkan sebagai overlay sky blue.", "success");
      return;
    }

    const button = el("readerCompareBtn");
    state.reader.bsreLoading = true;
    button.disabled = true;
    button.classList.add("is-loading");
    button.querySelector("span").textContent = "Loading…";

    try {
      const response = await fetch("assets/bsre.geojson", { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const validationErrors = validateGeoJSON(data);
      if (validationErrors.length) throw new Error(validationErrors[0]);

      state.reader.bsreLayer = L.geoJSON(data, {
        pane: "readerBsrePane",
        style: {
          pane: "readerBsrePane",
          color: "#22b8f0",
          weight: 2,
          opacity: 1,
          fillColor: "#38bdf8",
          fillOpacity: 0.2,
          interactive: false
        },
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
          pane: "readerBsrePane",
          radius: 5,
          color: "#ffffff",
          weight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: 1,
          interactive: false
        })
      }).addTo(state.reader.map);
      state.reader.bsreVisible = true;

      showToast(
        "Compare BSRE aktif",
        `${formatNumber(getFeatures(data).length, 0)} feature BSRE ditampilkan di bawah geometry hijau.`,
        "success"
      );
    } catch (error) {
      state.reader.bsreLayer = null;
      state.reader.bsreVisible = false;
      showToast("Compare gagal", `File BSRE tidak dapat dimuat: ${error.message}`, "error");
    } finally {
      state.reader.bsreLoading = false;
      button.classList.remove("is-loading");
      button.querySelector("span").textContent = "Compare";
      updateReaderBsreControls();
    }
  }

  function hideReaderBsreOverlay() {
    if (!state.reader.bsreLayer || !state.reader.bsreVisible) return;
    state.reader.map.removeLayer(state.reader.bsreLayer);
    state.reader.bsreVisible = false;
    updateReaderBsreControls();
    showToast("BSRE disembunyikan", "Geometry utama tetap ditampilkan dalam warna hijau terang.", "warning");
  }

  function updateReaderBsreControls() {
    const compareButton = el("readerCompareBtn");
    const hideButton = el("readerHideBsreBtn");
    if (!compareButton || !hideButton) return;
    compareButton.disabled = state.reader.bsreLoading;
    compareButton.classList.toggle("is-active", state.reader.bsreVisible);
    compareButton.setAttribute("aria-pressed", String(state.reader.bsreVisible));
    compareButton.title = state.reader.bsreVisible
      ? "Overlay BSRE aktif"
      : "Tampilkan file BSRE sebagai overlay sky blue";
    hideButton.disabled = !state.reader.bsreVisible || state.reader.bsreLoading;
  }

  async function loadReaderFile(file) {
    try {
      const data = await readAndValidateGeoJSON(file);
      state.reader.data = data;
      state.reader.file = file;
      state.reader.selectedIndex = getFeatures(data).length ? 0 : -1;
      state.reader.dirty = false;

      el("readerDropZone").hidden = true;
      el("readerWorkspace").hidden = false;
      setInlineMessage("readerUploadMessage", "", "", true);
      el("readerOriginalName").textContent = file.name;
      el("readerFileMeta").textContent = `${formatBytes(file.size)} · ${getFeatures(data).length} feature`;
      el("readerDownloadName").value = ensureGeoJSONExtension(stripJsonExtension(file.name));
      renderReaderSummary();
      renderFeatureList();
      renderReaderMap(true);
      renderPropertyEditor();
      renderReaderCoordinates();
      updateReaderAreaStatus();
      window.setTimeout(() => state.reader.map.invalidateSize(), 100);
      showToast("GeoJSON valid", `${file.name} berhasil dibuka.`, "success");
    } catch (error) {
      setInlineMessage("readerUploadMessage", error.message, "error", false);
      showToast("File tidak dapat dibuka", firstLine(error.message), "error");
    }
  }

  function renderReaderSummary() {
    const features = getFeatures(state.reader.data);
    const types = geometryTypeCounts(features);
    const chips = el("readerGeometryChips");
    chips.replaceChildren();

    if (!types.size) {
      const chip = document.createElement("span");
      chip.className = "geometry-chip";
      chip.textContent = "NO GEOMETRY";
      chips.append(chip);
    } else {
      types.forEach((count, type) => {
        const chip = document.createElement("span");
        chip.className = "geometry-chip";
        chip.textContent = `${type.toUpperCase()} × ${count}`;
        chips.append(chip);
      });
    }
    el("readerFeatureCount").textContent = String(features.length);
  }

  function renderFeatureList() {
    const features = getFeatures(state.reader.data);
    const list = el("readerFeatureList");
    list.replaceChildren();

    if (!features.length) {
      const empty = document.createElement("div");
      empty.className = "empty-properties";
      empty.innerHTML = "<strong>Tidak ada feature</strong>FeatureCollection ini kosong.";
      list.append(empty);
      return;
    }

    features.forEach((feature, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `feature-item${index === state.reader.selectedIndex ? " is-active" : ""}`;
      button.dataset.index = String(index);
      button.setAttribute("aria-pressed", String(index === state.reader.selectedIndex));

      const number = document.createElement("span");
      number.className = "feature-index";
      number.textContent = String(index + 1).padStart(2, "0");

      const copy = document.createElement("span");
      copy.className = "feature-copy";
      const name = document.createElement("strong");
      name.textContent = getFeatureName(feature, index);
      const type = document.createElement("small");
      type.textContent = getGeometryLabel(feature.geometry);
      copy.append(name, type);

      const arrow = document.createElement("span");
      arrow.className = "feature-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";
      button.append(number, copy, arrow);
      list.append(button);
    });
  }

  function selectReaderFeature(index) {
    const features = getFeatures(state.reader.data);
    if (!Number.isInteger(index) || index < 0 || index >= features.length || index === state.reader.selectedIndex) return;

    if (state.reader.editMode) {
      showToast("Selesaikan mode edit dulu", "Keluar dari mode Edit Polygon sebelum memilih feature lain.", "warning");
      return;
    }

    if (state.reader.dirty && !window.confirm("Perubahan pada feature ini belum disimpan. Buang perubahan dan pindah feature?")) {
      return;
    }

    state.reader.selectedIndex = index;
    state.reader.dirty = false;
    renderFeatureList();
    renderReaderSelection(true);
    renderPropertyEditor();
    renderReaderCoordinates();
    updateReaderAreaStatus();
  }

  function renderReaderMap(fitAll = false) {
    const map = state.reader.map;
    if (state.reader.allLayer) map.removeLayer(state.reader.allLayer);
    if (state.reader.selectedLayer) map.removeLayer(state.reader.selectedLayer);

    if (!state.reader.data) return;

    state.reader.allLayer = L.geoJSON(state.reader.data, {
      style: {
        color: "#72d64f",
        weight: 2.5,
        opacity: 1,
        fillColor: "#8ee879",
        fillOpacity: 0.2
      },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#72d64f",
        fillOpacity: 1
      })
    }).addTo(map);

    if (fitAll && !fitLeafletLayer(map, state.reader.allLayer, 17)) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
    renderReaderSelection(false);
  }

  function renderReaderSelection(refit = false) {
    const map = state.reader.map;
    if (state.reader.selectedLayer) map.removeLayer(state.reader.selectedLayer);
    state.reader.selectedLayer = null;

    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    if (!feature) {
      el("readerMapSelection").textContent = "NO SELECTION";
      return;
    }

    state.reader.selectedLayer = L.geoJSON(feature, {
      style: {
        color: "#72d64f",
        weight: 4,
        opacity: 1,
        fillColor: "#8ee879",
        fillOpacity: 0.28
      },
      pointToLayer: (_item, latlng) => L.circleMarker(latlng, {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: "#72d64f",
        fillOpacity: 1
      })
    }).addTo(map);

    el("readerMapSelection").textContent = `FEATURE ${String(state.reader.selectedIndex + 1).padStart(2, "0")} / ${getGeometryLabel(feature.geometry).toUpperCase()}`;
    if (refit) fitLeafletLayer(map, state.reader.selectedLayer, 18);
  }

  function renderPropertyEditor() {
    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    const editor = el("propertyEditor");
    editor.replaceChildren();
    setInlineMessage("readerEditorMessage", "", "", true);

    if (!feature) {
      appendEmptyPropertyState("Tidak ada feature", "Pilih atau upload GeoJSON yang memiliki feature.");
      el("propertyEditorTitle").textContent = "Properties";
      el("addPropertyBtn").disabled = true;
      el("savePropertiesBtn").disabled = true;
      updateReaderEditState();
      return;
    }

    el("propertyEditorTitle").textContent = `${getFeatureName(feature, state.reader.selectedIndex)} — Properties`;
    el("addPropertyBtn").disabled = false;
    el("savePropertiesBtn").disabled = false;
    const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
    const entries = Object.entries(properties);

    if (!entries.length) {
      appendEmptyPropertyState();
    } else {
      entries.forEach(([key, value]) => editor.append(createPropertyRow(key, value)));
    }
    updateReaderEditState();
  }

  function createPropertyRow(key, value, forcedType = null) {
    const row = document.createElement("div");
    row.className = "property-row";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "property-key";
    keyInput.value = key;
    keyInput.placeholder = "nama_field";
    keyInput.setAttribute("aria-label", "Nama properti");

    const typeSelect = document.createElement("select");
    typeSelect.className = "property-type";
    typeSelect.setAttribute("aria-label", "Tipe nilai");
    ["string", "number", "boolean", "null", "json"].forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type.toUpperCase();
      typeSelect.append(option);
    });
    typeSelect.value = forcedType || detectValueType(value);

    const valueInput = document.createElement("textarea");
    valueInput.className = "property-value";
    valueInput.rows = 1;
    valueInput.value = serializePropertyValue(value, typeSelect.value);
    valueInput.placeholder = "Nilai properti";
    valueInput.setAttribute("aria-label", "Nilai properti");

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-property";
    deleteButton.title = "Hapus properti";
    deleteButton.setAttribute("aria-label", `Hapus properti ${key || "baru"}`);
    deleteButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';

    row.append(keyInput, typeSelect, valueInput, deleteButton);
    configurePropertyValueInput(row);
    return row;
  }

  function appendEmptyPropertyState(title = "Belum ada properties", detail = "Tambahkan key-value pertama untuk feature ini.") {
    const empty = document.createElement("div");
    empty.className = "empty-properties";
    const strong = document.createElement("strong");
    strong.textContent = title;
    empty.append(strong, document.createTextNode(detail));
    el("propertyEditor").append(empty);
  }

  function configurePropertyValueInput(row) {
    if (!row) return;
    const type = row.querySelector(".property-type").value;
    const input = row.querySelector(".property-value");
    input.disabled = type === "null";
    if (type === "null") {
      input.value = "";
      input.placeholder = "null";
    } else if (type === "boolean") {
      const normalized = input.value.trim().toLowerCase();
      if (!["true", "false"].includes(normalized)) input.value = "true";
      input.placeholder = "true atau false";
    } else if (type === "number") {
      input.placeholder = "0";
    } else if (type === "json") {
      input.placeholder = '{"key": "value"} atau [1, 2]';
      input.rows = Math.max(2, input.rows);
    } else {
      input.placeholder = "Nilai properti";
      input.rows = 1;
    }
  }

  function markReaderDirty() {
    if (state.reader.selectedIndex < 0) return;
    state.reader.dirty = true;
    updateReaderEditState();
    setInlineMessage("readerEditorMessage", "", "", true);
  }

  function updateReaderEditState() {
    const status = el("readerEditState");
    status.classList.toggle("is-dirty", state.reader.dirty);
    status.innerHTML = state.reader.dirty ? "<i></i> BELUM DISIMPAN" : "<i></i> TERSIMPAN";
  }

  function saveReaderProperties(showSuccess) {
    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    if (!feature) return false;

    const result = Object.create(null);
    const seenKeys = new Set();
    const rows = $$(".property-row", el("propertyEditor"));

    try {
      rows.forEach((row, index) => {
        const key = row.querySelector(".property-key").value.trim();
        const type = row.querySelector(".property-type").value;
        const rawValue = row.querySelector(".property-value").value;

        if (!key) throw new Error(`Baris ${index + 1}: key properti tidak boleh kosong.`);
        if (seenKeys.has(key)) throw new Error(`Key “${key}” muncul lebih dari satu kali.`);
        seenKeys.add(key);
        result[key] = parsePropertyValue(rawValue, type, index);
      });
    } catch (error) {
      setInlineMessage("readerEditorMessage", error.message, "error", false);
      showToast("Properties belum tersimpan", error.message, "error");
      return false;
    }

    feature.properties = result;
    state.reader.dirty = false;
    updateReaderEditState();
    renderFeatureList();
    renderReaderCoordinates();
    updateReaderAreaStatus();
    if (showSuccess) {
      setInlineMessage("readerEditorMessage", "Perubahan properties tersimpan di memory browser.", "success", false);
      showToast("Perubahan disimpan", "GeoJSON di memory telah diperbarui.", "success");
    }
    return true;
  }

  function parsePropertyValue(rawValue, type, rowIndex) {
    if (type === "string") return rawValue;
    if (type === "null") return null;
    if (type === "number") {
      if (!rawValue.trim()) throw new Error(`Baris ${rowIndex + 1}: nilai number tidak boleh kosong.`);
      const number = Number(rawValue);
      if (!Number.isFinite(number)) throw new Error(`Baris ${rowIndex + 1}: “${rawValue}” bukan number yang valid.`);
      return number;
    }
    if (type === "boolean") {
      const value = rawValue.trim().toLowerCase();
      if (!['true', 'false'].includes(value)) {
        throw new Error(`Baris ${rowIndex + 1}: boolean harus bernilai true atau false.`);
      }
      return value === "true";
    }
    if (type === "json") {
      try {
        return JSON.parse(rawValue);
      } catch (_error) {
        throw new Error(`Baris ${rowIndex + 1}: object/array JSON tidak valid.`);
      }
    }
    return rawValue;
  }

  /* -------------------------------------------------------------------------- */
  /* Reader: keep stored area properties in step with an edited shape            */
  /* -------------------------------------------------------------------------- */

  /* Dragging a vertex changes geometry only; `luas_hektar` in the file is just a
     stored number. These helpers offer (or apply) the sync explicitly. */
  function updateReaderAreaStatus() {
    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    const feature = features[state.reader.selectedIndex];
    const type = feature?.geometry?.type;

    if (!["Polygon", "MultiPolygon"].includes(type)) {
      state.reader.areaStale = false;
      state.reader.areaNote = "";
      state.reader.currentHa = null;
      state.reader.storedHa = null;
      renderReaderAreaSync();
      return;
    }

    const entry = readerFeatureCoordinates(feature, state.reader.selectedIndex);
    const ha = Number((entry.area / 10000).toFixed(4));
    const stored = Number(feature?.properties?.luas_hektar);

    state.reader.currentHa = ha;
    state.reader.storedHa = Number.isFinite(stored) ? stored : null;
    state.reader.areaStale = Number.isFinite(stored) && Math.abs(stored - ha) > 0.00005;

    if (state.reader.areaStale && state.reader.areaAutoSync && state.reader.editMode) {
      applyReaderAreaSync({ silent: true });
      return;
    }

    if (!state.reader.areaStale && Number.isFinite(stored)) state.reader.areaNote = "";
    if (!Number.isFinite(stored)) {
      state.reader.areaNote = `Luas bentuk ini ${formatNumber(ha, 4)} ha — file tidak punya property luas, jadi tidak ada nilai yang diubah.`;
    }
    renderReaderAreaSync();
  }

  function applyReaderAreaSync(options = {}) {
    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    if (!feature?.properties || !feature?.geometry) return false;

    const entry = readerFeatureCoordinates(feature, state.reader.selectedIndex);
    const ha = Number((entry.area / 10000).toFixed(4));
    const squareMeters = Number(entry.area.toFixed(2));
    const updates = [];

    if (Object.prototype.hasOwnProperty.call(feature.properties, "luas_hektar")) {
      feature.properties.luas_hektar = ha;
      updates.push(["luas_hektar", ha]);
    }
    if (Object.prototype.hasOwnProperty.call(feature.properties, "luas_m2")) {
      feature.properties.luas_m2 = squareMeters;
      updates.push(["luas_m2", squareMeters]);
    }

    if (!updates.length) {
      state.reader.areaStale = false;
      renderReaderAreaSync();
      return false;
    }

    // Keep the visible editor rows in step without discarding other unsaved edits.
    updates.forEach(([key, value]) => setReaderPropertyRow(key, value));

    state.reader.areaStale = false;
    state.reader.areaNote = "";
    markReaderDirty();
    renderReaderAreaSync();
    renderReaderCoordinates();

    if (!options.silent) {
      showToast(
        "Luas diperbarui",
        `${updates.map(([key]) => key).join(" + ")} sekarang ${formatNumber(ha, 4)} ha · ${formatNumber(squareMeters, 2)} m². Tekan Simpan Perubahan bila belum.`,
        "success"
      );
    }
    return true;
  }

  function setReaderPropertyRow(key, value) {
    const rows = $$(".property-row", el("propertyEditor"));
    const row = rows.find((item) => item.querySelector(".property-key")?.value.trim() === key);
    if (!row) return;
    const input = row.querySelector(".property-value");
    if (input) input.value = String(value);
    const typeSelect = row.querySelector(".property-type");
    if (typeSelect) typeSelect.value = "number";
  }

  function renderReaderAreaSync() {
    const box = el("readerAreaSync");
    if (!box) return;
    const title = el("readerAreaSyncTitle");
    const text = el("readerAreaSyncText");
    const button = el("readerAreaSyncBtn");
    const auto = el("readerAreaAutoChk");

    auto.checked = state.reader.areaAutoSync;

    if (state.reader.areaStale) {
      box.hidden = false;
      box.classList.add("is-stale");
      button.hidden = false;
      title.textContent = "Luas property belum mengikuti bentuk baru";
      const delta = state.reader.currentHa - state.reader.storedHa;
      text.textContent = `luas_hektar masih ${formatNumber(state.reader.storedHa, 4)} ha, bentuk sekarang ${formatNumber(state.reader.currentHa, 4)} ha (selisih ${delta >= 0 ? "+" : "−"}${formatNumber(Math.abs(delta), 4)} ha).`;
      return;
    }

    if (state.reader.areaNote) {
      box.hidden = false;
      box.classList.remove("is-stale");
      button.hidden = true;
      title.textContent = "Luas dihitung ulang";
      text.textContent = state.reader.areaNote;
      return;
    }

    box.hidden = true;
    box.classList.remove("is-stale");
  }

  function setupReaderAreaSync() {
    el("readerAreaSyncBtn").addEventListener("click", () => {
      if (!applyReaderAreaSync()) {
        showToast("Tidak ada property luas", "File ini tidak punya luas_hektar atau luas_m2 untuk diperbarui.", "warning");
      }
    });
    el("readerAreaAutoChk").addEventListener("change", (event) => {
      state.reader.areaAutoSync = event.target.checked;
      if (state.reader.areaAutoSync && state.reader.areaStale) applyReaderAreaSync({ silent: true });
      renderReaderAreaSync();
    });
  }

  function downloadReaderGeoJSON() {
    if (!state.reader.data) return;
    if (state.reader.dirty) {
      setInlineMessage("readerEditorMessage", "Ada perubahan belum disimpan. Simpan perubahan sebelum mengunduh file.", "error", false);
      el("savePropertiesBtn").focus();
      showToast("Ada perubahan belum tersimpan", "Klik “Simpan Perubahan” terlebih dahulu.", "warning");
      return;
    }

    const inputName = el("readerDownloadName").value.trim();
    const fallback = stripJsonExtension(state.reader.file?.name || "hasil_edit");
    const filename = ensureGeoJSONExtension(inputName || fallback);
    downloadJSON(state.reader.data, filename);
    showToast("File hasil edit dibuat", `${filename} berhasil diunduh.`, "success");
  }

  /* -------------------------------------------------------------------------- */
  /* Reader · Edit Polygon (PIN-gated)                                            */
  /* -------------------------------------------------------------------------- */

  function openPinModal() {
    el("pinModal").hidden = false;
    el("pinError").hidden = true;
    el("pinError").textContent = "";
    el("pinInput").value = "";
    window.setTimeout(() => el("pinInput").focus(), 40);
  }

  function closePinModal() {
    el("pinModal").hidden = true;
    el("pinError").hidden = true;
    el("pinError").textContent = "";
    el("pinInput").value = "";
  }

  function submitPin() {
    const value = el("pinInput").value.trim();
    if (value !== READER_EDIT_PIN) {
      el("pinError").hidden = false;
      el("pinError").className = "inline-alert error";
      el("pinError").textContent = "PIN salah. Coba lagi.";
      el("pinInput").select();
      return;
    }
    state.reader.editUnlocked = true;
    el("readerEditUnlockBtn").hidden = true;
    el("readerEditPolygonBtn").hidden = false;
    closePinModal();
    showToast("Edit Polygon dibuka", "Klik “Edit Polygon” untuk menyeret titik polygon.", "success");
  }

  function toggleReaderEditMode() {
    if (!state.reader.editUnlocked) {
      openPinModal();
      return;
    }
    if (state.reader.editMode) {
      stopReaderEditMode();
    } else {
      startReaderEditMode();
    }
  }

  function readerEditTargetName() {
    return `FEATURE ${String(state.reader.selectedIndex + 1).padStart(2, "0")} · EDIT`;
  }

  function startReaderEditMode() {
    updateReaderAreaStatus();
    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    const geo = feature?.geometry;
    if (!feature || !geo || !["Polygon", "MultiPolygon"].includes(geo.type)) {
      showToast("Tidak dapat diedit", "Feature yang dipilih bukan Polygon/MultiPolygon.", "warning");
      renderReaderSelection(false);
      return;
    }

    // Clear the styled overlays; they get rebuilt from the (possibly new) data on exit.
    const map = state.reader.map;
    if (state.reader.allLayer) map.removeLayer(state.reader.allLayer);
    if (state.reader.selectedLayer) map.removeLayer(state.reader.selectedLayer);
    state.reader.allLayer = null;
    state.reader.selectedLayer = null;

    const edit = buildEditableGeometry(geo);
    state.reader.editState = edit;
    state.reader.editMode = true;

    const button = el("readerEditPolygonBtn");
    button.classList.add("is-active");
    button.setAttribute("aria-pressed", "true");
    button.querySelector(".edit-polygon-label").textContent = "Selesai Edit";
    button.title = "Seret titik untuk mengubah bentuk; klik lagi untuk selesai.";

    el("readerMapSelection").textContent = readerEditTargetName();
    fitEditableGeometry(map, edit);
  }

  function stopReaderEditMode() {
    if (!state.reader.editMode) return;
    const map = state.reader.map;
    const edit = state.reader.editState;
    if (edit) {
      (edit.polys || []).forEach((poly) => {
        if (map.hasLayer(poly.layer)) map.removeLayer(poly.layer);
      });
      (edit.markers || []).forEach((entry) => {
        if (map.hasLayer(entry.marker)) map.removeLayer(entry.marker);
      });
    }
    state.reader.editState = null;
    state.reader.editMode = false;

    const button = el("readerEditPolygonBtn");
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
    button.querySelector(".edit-polygon-label").textContent = "Edit Polygon";
    button.title = "Seret titik-titik polygon untuk mengubah bentuk";

    // Rebuild the styled preview from the updated in-memory geometry.
    if (state.reader.data) renderReaderMap(false);
    renderReaderCoordinates();
    updateReaderAreaStatus();
  }

  function buildEditableGeometry(geo) {
    // Strip a duplicated closing vertex so each vertex gets exactly one draggable
    // handle; the ring is re-closed on commit.
    const ringCoordinates = (ring) => {
      const closed = ring.length > 1
        && ring[0][0] === ring[ring.length - 1][0]
        && ring[0][1] === ring[ring.length - 1][1];
      return closed ? ring.slice(0, -1) : ring;
    };
    const latLngFromCoord = (coord) => L.latLng(coord[1], coord[0]);

    if (geo.type === "Polygon") {
      const rings = geo.coordinates.map((ring) => ringCoordinates(ring).map(latLngFromCoord));
      const layer = L.polygon(rings, editablePolygonStyle()).addTo(state.reader.map);
      const edit = { kind: "Polygon", polys: [{ rings, layer }], markers: [] };
      buildEditMarkers(edit);
      return edit;
    }

    // MultiPolygon
    const polys = geo.coordinates.map((polygon) => {
      const rings = polygon.map((ring) => ringCoordinates(ring).map(latLngFromCoord));
      const layer = L.polygon(rings, editablePolygonStyle()).addTo(state.reader.map);
      return { rings, layer };
    });
    const edit = { kind: "MultiPolygon", polys, markers: [] };
    buildEditMarkers(edit);
    return edit;
  }

  function editablePolygonStyle() {
    return {
      color: "#72d64f",
      weight: 3,
      opacity: 1,
      fillColor: "#8ee879",
      fillOpacity: 0.18,
      dashArray: "4 4"
    };
  }

  const EDIT_VERTEX_ICON = L.divIcon({
    className: "edit-vertex-icon",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: '<span class="edit-vertex-dot"></span>'
  });

  function buildEditMarkers(edit) {
    edit.polys.forEach((poly, polyIndex) => {
      poly.rings.forEach((ring, ringIndex) => {
        ring.forEach((latlng, vertexIndex) => {
          const marker = L.marker(latlng, {
            icon: EDIT_VERTEX_ICON,
            draggable: true
          }).addTo(state.reader.map);

          marker.on("drag", () => {
            const next = marker.getLatLng();
            latlng.lat = next.lat;
            latlng.lng = next.lng;
            poly.layer.setLatLngs(poly.rings);
          });

          marker.on("dragend", () => {
            commitEditedGeometry(edit, polyIndex, ringIndex, vertexIndex);
          });

          edit.markers.push({ marker, polyIndex, ringIndex, vertexIndex });
        });
      });
    });
  }

  function commitEditedGeometry(edit, polyIndex, ringIndex, vertexIndex) {
    const features = getFeatures(state.reader.data);
    const feature = features[state.reader.selectedIndex];
    if (!feature?.geometry) return;

    const geo = feature.geometry;
    const coordsForRings = (rings) => rings.map((ring) => {
      const coords = ring.map((ll) => [ll.lng, ll.lat]);
      closePolygonRing(coords);
      return coords;
    });

    if (geo.type === "Polygon") {
      geo.coordinates = coordsForRings(edit.polys[0].rings);
    } else if (geo.type === "MultiPolygon") {
      geo.coordinates = edit.polys.map((poly) => coordsForRings(poly.rings));
    }

    state.reader.dirty = true;
    updateReaderEditState();
    scheduleReaderCoordinates();
    updateReaderAreaStatus();
    setInlineMessage("readerEditorMessage", "", "", true);
    showToast("Bentuk diperbarui", `Titik ${vertexIndex + 1} pada polygon digeser.`, "success");
  }

  function closePolygonRing(coordinates) {
    if (!coordinates || !coordinates.length) return;
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (!last || last[0] !== first[0] || last[1] !== first[1]) {
      coordinates.push([first[0], first[1]]);
    }
  }

  function fitEditableGeometry(map, edit) {
    try {
      const bounds = L.latLngBounds(edit.polys.flatMap((poly) => poly.rings.flat()));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
    } catch (_e) {
      /* ignore */
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Reader: coordinate sheet                                                    */
  /* -------------------------------------------------------------------------- */

  function setupReaderCoordinates() {
    el("readerCoordScopeAll").addEventListener("click", () => setReaderCoordScope("all"));
    el("readerCoordScopeSelected").addEventListener("click", () => setReaderCoordScope("selected"));
    el("readerCoordRoundBtn").addEventListener("click", () => {
      state.reader.coordsRound = !state.reader.coordsRound;
      syncReaderCoordToggles();
      renderReaderCoordinates();
    });
    el("readerCoordDmsBtn").addEventListener("click", () => {
      state.reader.coordsDms = !state.reader.coordsDms;
      syncReaderCoordToggles();
      renderReaderCoordinates();
    });
    el("readerCoordSearch").addEventListener("input", (event) => {
      state.reader.coordsQuery = event.target.value.trim().toLowerCase();
      scheduleReaderCoordinates();
    });
    el("readerCoordSearch").addEventListener("search", (event) => {
      state.reader.coordsQuery = event.target.value.trim().toLowerCase();
      scheduleReaderCoordinates();
    });
    el("readerCoordCopyBtn").addEventListener("click", async () => {
      const csv = buildReaderCoordinatesCsv();
      if (!csv) {
        showToast("Tidak ada koordinat", "Muat file GeoJSON yang berisi geometry terlebih dahulu.", "warning");
        return;
      }
      const copied = await copyTextToClipboard(csv);
      showToast(copied ? "Koordinat disalin" : "Penyalinan diblokir browser", copied ? `${csv.split("\n").length - 1} baris siap ditempel.` : "Gunakan tombol Unduh CSV sebagai gantinya.", copied ? "success" : "error");
    });
    el("readerCoordCsvBtn").addEventListener("click", () => {
      const csv = buildReaderCoordinatesCsv();
      if (!csv) {
        showToast("Tidak ada koordinat", "Muat file GeoJSON yang berisi geometry terlebih dahulu.", "warning");
        return;
      }
      const base = strictSlug(stripJsonExtension(el("readerDownloadName").value.trim())) || "koordinat";
      downloadTextFile(`${base}_koordinat.csv`, csv, "text/csv;charset=utf-8");
      showToast("CSV diunduh", `${formatNumber(csv.split("\n").length - 1, 0)} baris koordinat tersimpan sebagai file CSV.`, "success");
    });

    el("readerCoordTable").addEventListener("click", (event) => {
      const action = event.target.closest("button[data-coord-action]");
      if (action) {
        const index = Number(action.dataset.index);
        if (action.dataset.coordAction === "zoom") {
          selectReaderFeature(index);
          fitReaderFeature(index);
        }
        else if (action.dataset.coordAction === "copy") void copyReaderFeatureCoordinates(index);
        return;
      }
      const row = event.target.closest("tr[data-coord-row]");
      if (row) focusReaderCoordinate(Number(row.dataset.feature), Number(row.dataset.group), Number(row.dataset.point));
    });

    syncReaderCoordToggles();
  }

  function setReaderCoordScope(scope) {
    state.reader.coordsScope = scope;
    syncReaderCoordToggles();
    renderReaderCoordinates();
  }

  function syncReaderCoordToggles() {
    const isAll = state.reader.coordsScope === "all";
    const allButton = el("readerCoordScopeAll");
    const selectedButton = el("readerCoordScopeSelected");
    allButton.classList.toggle("is-active", isAll);
    allButton.setAttribute("aria-pressed", String(isAll));
    selectedButton.classList.toggle("is-active", !isAll);
    selectedButton.setAttribute("aria-pressed", String(!isAll));

    const roundButton = el("readerCoordRoundBtn");
    roundButton.classList.toggle("is-active", state.reader.coordsRound);
    roundButton.setAttribute("aria-pressed", String(state.reader.coordsRound));
    roundButton.textContent = state.reader.coordsRound ? "6 DESIMAL" : "PRESISI PENUH";
    roundButton.title = state.reader.coordsRound
      ? "Dibulatkan ke 6 desimal (±0,1 m). Klik untuk menampilkan angka persis seperti di file."
      : "Menampilkan nilai persis dari file. Klik untuk membulatkan ke 6 desimal.";

    const dmsButton = el("readerCoordDmsBtn");
    dmsButton.classList.toggle("is-active", state.reader.coordsDms);
    dmsButton.setAttribute("aria-pressed", String(state.reader.coordsDms));
  }

  /* Coalesce the many renders a vertex drag produces into one per frame. */
  function scheduleReaderCoordinates() {
    if (state.reader.coordsRenderQueued) return;
    state.reader.coordsRenderQueued = true;
    window.requestAnimationFrame(() => {
      state.reader.coordsRenderQueued = false;
      renderReaderCoordinates();
    });
  }

  /* One flat list of rings for every geometry type, with survey-style labels. */
  function readerGeometryRings(geometry) {
    const rings = [];
    const push = (positions, label, kind) => rings.push({ label, kind, positions: Array.isArray(positions) ? positions : [] });

    if (!geometry || typeof geometry !== "object") return rings;

    switch (geometry.type) {
      case "Polygon":
        (geometry.coordinates || []).forEach((ring, index) => push(ring, index === 0 ? "Cincin luar" : `Lubang ${index}`, index === 0 ? "outer" : "hole"));
        break;
      case "MultiPolygon": {
        const polys = geometry.coordinates || [];
        polys.forEach((poly, polyIndex) => poly.forEach((ring, ringIndex) => {
          const suffix = ringIndex === 0 ? "cincin luar" : `lubang ${ringIndex}`;
          push(ring, polys.length > 1 ? `Poligon ${polyIndex + 1} · ${suffix}` : suffix, ringIndex === 0 ? "outer" : "hole");
        }));
        break;
      }
      case "LineString":
        push(geometry.coordinates, "Garis", "line");
        break;
      case "MultiLineString":
        (geometry.coordinates || []).forEach((line, index) => push(line, `Garis ${index + 1}`, "line"));
        break;
      case "Point":
        push([geometry.coordinates], "Titik", "point");
        break;
      case "MultiPoint":
        push(geometry.coordinates, "Kumpulan titik", "point");
        break;
      case "GeometryCollection":
        (geometry.geometries || []).forEach((child, index) => {
          readerGeometryRings(child).forEach((ring) => push(ring.positions, `${index + 1}. ${ring.label}`, ring.kind));
        });
        break;
      default:
        break;
    }

    return rings;
  }

  function readerFeatureCoordinates(feature, index) {
    const rings = readerGeometryRings(feature?.geometry);
    let uniquePoints = 0;
    let area = 0;
    let perimeter = 0;

    const groups = rings.map((ring) => {
      const raw = ring.positions
        .filter((position) => Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]))
        .map((position) => ({ lat: position[1], lng: position[0], alt: Number.isFinite(position[2]) ? position[2] : null }));

      const isRing = ring.kind === "outer" || ring.kind === "hole";
      const closed = isRing && raw.length > 3 && ring.positions.length > 1 && positionsEqual(ring.positions[0], ring.positions[ring.positions.length - 1]);
      const unique = closed ? raw.slice(0, -1) : raw;
      uniquePoints += unique.length;

      const shape = unique.length > 2 ? calculatePerimeter(unique) : 0;
      const size = isRing && unique.length > 2 ? calculateSphericalArea(unique) : 0;
      // Holes subtract from the polygon area; only the outer ring bounds it.
      if (ring.kind === "outer") {
        area += size;
        perimeter += shape;
      } else if (ring.kind === "hole") {
        area -= size;
      }
      const signedArea = size;

      const rows = raw.map((point, position) => ({
        lat: point.lat,
        lng: point.lng,
        alt: point.alt,
        segment: position > 0 ? haversineDistance(raw[position - 1], point) : null,
        closing: closed && position === raw.length - 1
      }));

      return { label: ring.label, kind: ring.kind, rows, unique: unique.length, closed, area: signedArea, perimeter: shape };
    });

    return {
      featureIndex: index,
      name: getFeatureName(feature, index),
      type: feature?.geometry?.type || "Null geometry",
      groups,
      pointCount: uniquePoints,
      area,
      perimeter
    };
  }

  function collectReaderCoordinates() {
    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    let entries = features.map(readerFeatureCoordinates).filter((entry) => entry.groups.some((group) => group.rows.length));
    if (state.reader.coordsScope === "selected") {
      entries = entries.filter((entry) => entry.featureIndex === state.reader.selectedIndex);
    }

    const query = state.reader.coordsQuery;
    if (query) {
      entries = entries
        .map((entry) => {
          const nameHit = entry.name.toLowerCase().includes(query) || entry.type.toLowerCase().includes(query);
          const groups = entry.groups
            .map((group) => {
              if (nameHit) return { ...group, filteredOut: 0 };
              const rows = group.rows.filter((row) => readerRowMatchesQuery(row, query));
              return { ...group, rows, filteredOut: group.rows.length - rows.length };
            })
            .filter((group) => group.rows.length);
          return { ...entry, groups, pointCount: groups.reduce((sum, group) => sum + group.rows.length, 0) };
        })
        .filter((entry) => entry.groups.length);
    }

    return entries;
  }

  function readerRowMatchesQuery(row, query) {
    const digits = query.replace(/[^0-9.,-]/g, "");
    if (!digits) return false;
    return [row.lat, row.lng].some((value) => {
      const plain = String(value);
      const rounded = value.toFixed(7);
      return plain.includes(digits) || rounded.includes(digits) || rounded.replace(".", ",").includes(digits);
    });
  }

  function renderReaderCoordinates() {
    const table = el("readerCoordTable");
    const entries = collectReaderCoordinates();
    const columns = state.reader.coordsDms ? 7 : 5;

    const totals = entries.reduce((acc, entry) => {
      acc.points += entry.pointCount;
      acc.area += entry.area;
      acc.perimeter += entry.perimeter;
      acc.polygons += entry.groups.some((group) => group.kind === "outer") ? 1 : 0;
      acc.bands.push(...entry.groups.flatMap((group) => group.rows.map((row) => row.lat)));
      acc.bujur.push(...entry.groups.flatMap((group) => group.rows.map((row) => row.lng)));
      return acc;
    }, { points: 0, area: 0, perimeter: 0, polygons: 0, bands: [], bujur: [] });

    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    el("readerCoordCount").textContent = `${formatNumber(totals.points, 0)} TITIK`;

    const stats = el("readerCoordStats");
    stats.replaceChildren();
    const addStat = (label, value) => {
      const box = document.createElement("div");
      box.className = "coord-stat";
      const name = document.createElement("small");
      name.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      box.append(name, strong);
      stats.append(box);
    };
    addStat("Fitur terbaca", `${formatNumber(entries.length, 0)}${entries.length !== features.length ? ` / ${formatNumber(features.length, 0)}` : ""}`);
    addStat("Polygon", `${formatNumber(totals.polygons, 0)}`);
    addStat("Total titik", formatNumber(totals.points, 0));
    addStat("Luas terhitung", totals.area ? `${formatNumber(totals.area / 10000, 4)} ha` : "—");
    addStat("Keliling", totals.perimeter ? formatReaderLength(totals.perimeter) : "—");
    addStat("Rentang", totals.bands.length
      ? `${formatReaderCoord(Math.min(...totals.bands))} – ${formatReaderCoord(Math.max(...totals.bands))} LU · ${formatReaderCoord(Math.min(...totals.bujur))} – ${formatReaderCoord(Math.max(...totals.bujur))} BT`
      : "—");
    addStat("Sistem", "WGS84 · DD");

    const headerCells = ["Titik", "Lintang", "Bujur"];
    if (state.reader.coordsDms) headerCells.push("Lintang DMS", "Bujur DMS");
    headerCells.push("Segmen", "Keterangan");

    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>${headerCells.map((label) => `<th scope="col">${label}</th>`).join("")}</tr>`;

    const tbody = document.createElement("tbody");
    let rendered = 0;
    let skipped = 0;
    let currentScope = state.reader.coordsScope;

    entries.forEach((entry) => {
      const groupCount = entry.groups.filter((group) => group.rows.length).length;
      if (groupCount === 0) return;

      const meta = [
        entry.type,
        `${formatNumber(entry.pointCount, 0)} titik`,
        entry.groups.length > 1 ? `${groupCount} cincin` : null,
        entry.area ? `${formatNumber(entry.area / 10000, 4)} ha` : null,
        entry.perimeter ? `keliling ${formatReaderLength(entry.perimeter)}` : null
      ].filter(Boolean).join(" · ");

      const groupRow = document.createElement("tr");
      groupRow.className = "coord-group";
      groupRow.innerHTML = `<th scope="colgroup" colspan="${columns}">
        <span class="coord-group-id"><i>${String(entry.featureIndex + 1).padStart(2, "0")}</i>${escapeHtml(entry.name)}</span>
        <span class="coord-group-meta">${escapeHtml(meta)}</span>
        <span class="coord-group-actions">
          <button type="button" class="coord-mini" data-coord-action="zoom" data-index="${entry.featureIndex}" title="Pilih dan zoom ke feature ini">Lihat</button>
          <button type="button" class="coord-mini" data-coord-action="copy" data-index="${entry.featureIndex}" title="Salin daftar koordinat feature ini">Salin</button>
        </span>
      </th>`;
      tbody.append(groupRow);

      entry.groups.forEach((group, groupIndex) => {
        if (!group.rows.length) return;
        if (rendered >= READER_COORD_CAP) {
          skipped += group.rows.length;
          return;
        }

        const ringRow = document.createElement("tr");
        ringRow.className = "coord-ring";
        const ringMeta = [
          `${formatNumber(group.unique, 0)} titik unik`,
          group.kind === "hole" ? "lubang · mengurangi luas" : null,
          group.closed ? "cincin tertutup" : null,
          group.area ? `${group.kind === "hole" ? "−" : ""}${formatNumber(Math.abs(group.area) / 10000, 4)} ha` : null,
          group.perimeter ? `keliling ${formatReaderLength(group.perimeter)}` : null,
          group.filteredOut ? `${formatNumber(group.filteredOut, 0)} titik disembunyikan filter` : null
        ].filter(Boolean).join(" · ");
        ringRow.innerHTML = `<td colspan="${columns}"><b>${escapeHtml(group.label)}</b><span>${escapeHtml(ringMeta)}</span></td>`;
        tbody.append(ringRow);

        for (let pointIndex = 0; pointIndex < group.rows.length; pointIndex += 1) {
          if (rendered >= READER_COORD_CAP) {
            skipped += group.rows.length - pointIndex;
            break;
          }
          const row = group.rows[pointIndex];
          rendered += 1;
          const tr = document.createElement("tr");
          tr.className = `coord-row${row.closing ? " is-closing" : ""}`;
          tr.dataset.feature = String(entry.featureIndex);
          tr.dataset.group = String(groupIndex);
          tr.dataset.point = String(pointIndex);
          tr.dataset.coordRow = "true";
          tr.tabIndex = 0;

          const notes = [];
          if (pointIndex === 0) notes.push("awal");
          if (row.closing) notes.push("penutup · sama dengan titik 1");
          if (Number.isFinite(row.alt)) notes.push(`tinggi ${formatNumber(row.alt, 1)} m`);

          const cells = [
            `<td class="coord-num"><span>${pointIndex + 1}</span></td>`,
            `<td class="coord-val">${formatReaderCoord(row.lat)}</td>`,
            `<td class="coord-val">${formatReaderCoord(row.lng)}</td>`
          ];
          if (state.reader.coordsDms) {
            cells.push(`<td class="coord-dms">${readerDms(row.lat, "lat")}</td>`);
            cells.push(`<td class="coord-dms">${readerDms(row.lng, "lng")}</td>`);
          }
          cells.push(`<td class="coord-val coord-seg">${row.segment === null ? "—" : formatReaderLength(row.segment)}</td>`);
          cells.push(`<td class="coord-note-cell">${notes.length ? escapeHtml(notes.join(" · ")) : ""}</td>`);
          tr.innerHTML = cells.join("");
          tbody.append(tr);
        }
      });
    });

    table.replaceChildren(thead, tbody);

    const note = el("readerCoordNote");
    const messages = [];
    if (skipped > 0) messages.push(`Menampilkan ${formatNumber(rendered, 0)} titik pertama dari ${formatNumber(rendered + skipped, 0)} — tekan Unduh CSV untuk daftar lengkap.`);
    if (!entries.length) messages.push(features.length ? "Tidak ada koordinat yang cocok dengan filter/lingkup ini." : "Muat file GeoJSON untuk melihat koordinatnya di sini.");
    if (currentScope === "selected" && entries.length === 1) messages.push("Lingkup: hanya feature terpilih.");
    if (!state.reader.coordsRound && entries.length) messages.push("Presisi penuh: angka persis seperti tersimpan di file.");
    note.hidden = !messages.length;
    note.textContent = messages.join(" ");

    el("readerCoordPanel").classList.toggle("is-empty", !entries.length);
  }

  function formatReaderCoord(value) {
    if (!Number.isFinite(value)) return "—";
    return state.reader.coordsRound ? value.toFixed(6) : String(value);
  }

  function formatReaderLength(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${formatNumber(meters, 2)} m`;
    return `${formatNumber(meters / 1000, 3)} km`;
  }

  /* Degrees / minutes / seconds with Indonesian hemisphere labels (LU LS BT BU). */
  function readerDms(value, axis) {
    if (!Number.isFinite(value)) return "—";
    let abs = Math.abs(value);
    let degrees = Math.floor(abs);
    let minutes = Math.floor((abs - degrees) * 60);
    let seconds = Math.round(((abs - degrees) * 3600) - minutes * 60);
    if (seconds >= 60) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    const hemisphere = axis === "lat" ? (value >= 0 ? "LU" : "LS") : (value >= 0 ? "BT" : "BU");
    return `${degrees}° ${String(minutes).padStart(2, "0")}′ ${String(Math.min(59, seconds)).padStart(2, "0")}″ ${hemisphere}`;
  }

  function readerCoordinatesMatrix(entries) {
    const rows = [["fitur", "tipe_geometry", "cincin", "titik", "lintang", "bujur", "tinggi_m", "semen_m", "keterangan"]];
    entries.forEach((entry) => {
      entry.groups.forEach((group) => {
        group.rows.forEach((row, index) => {
          const notes = [];
          if (index === 0) notes.push("awal");
          if (row.closing) notes.push("penutup");
          rows.push([
            entry.name,
            entry.type,
            group.label,
            String(index + 1),
            String(row.lat),
            String(row.lng),
            Number.isFinite(row.alt) ? String(row.alt) : "",
            row.segment === null ? "" : row.segment.toFixed(2),
            notes.join(" ")
          ]);
        });
      });
    });
    return rows;
  }

  function visibleReaderCoordinates() {
    return collectReaderCoordinates();
  }

  function buildReaderCoordinatesCsv() {
    const rows = readerCoordinatesMatrix(visibleReaderCoordinates());
    if (rows.length <= 1) return "";
    return rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
  }

  function buildReaderFeatureCoordinates(index) {
    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    const entry = readerFeatureCoordinates(features[index], index);
    if (!entry) return "";
    const lines = [];
    entry.groups.forEach((group) => {
      group.rows.forEach((row) => lines.push(`${row.lat}, ${row.lng}`));
    });
    return lines.join("\n");
  }

  async function copyReaderFeatureCoordinates(index) {
    const text = buildReaderFeatureCoordinates(index);
    if (!text) {
      showToast("Tidak ada koordinat", "Feature ini tidak memiliki koordinat yang valid.", "warning");
      return;
    }
    const copied = await copyTextToClipboard(text);
    showToast(
      copied ? "Koordinat disalin" : "Penyalinan diblokir browser",
      copied ? `${formatNumber(text.split("\n").length, 0)} baris "lintang, bujur" siap ditempel.` : "Salin manual dari tabel, atau gunakan Unduh CSV.",
      copied ? "success" : "error"
    );
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_error) {
      // Falls through to the legacy path below.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "sr-only";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    }
    area.remove();
    return copied;
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fitReaderFeature(index) {
    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    const feature = features[index];
    if (!feature?.geometry) return;
    const temp = L.geoJSON(feature);
    if (!fitLeafletLayer(state.reader.map, temp, 18)) state.reader.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    temp.remove();
  }

  /* Row click: show that vertex on the map without losing the current edit state. */
  function focusReaderCoordinate(featureIndex, groupIndex, pointIndex) {
    const features = state.reader.data ? getFeatures(state.reader.data) : [];
    const entry = readerFeatureCoordinates(features[featureIndex], featureIndex);
    const row = entry?.groups?.[groupIndex]?.rows?.[pointIndex];
    if (!row) return;

    const map = state.reader.map;
    if (state.reader.selectedIndex !== featureIndex && !state.reader.dirty && !state.reader.editMode) {
      state.reader.selectedIndex = featureIndex;
      renderFeatureList();
      renderReaderSelection(false);
      renderPropertyEditor();
    }

    map.panTo([row.lat, row.lng], { animate: true });
    if (state.reader.coordMarker) map.removeLayer(state.reader.coordMarker);
    state.reader.coordMarker = L.circleMarker([row.lat, row.lng], {
      radius: 9,
      color: "#111111",
      weight: 3,
      fillColor: "#e60012",
      fillOpacity: 1
    })
      .bindPopup(`<div class="map-popup"><strong>Titik ${pointIndex + 1} · ${escapeHtml(entry.name)}</strong><code>${row.lat}, ${row.lng}</code><small>${escapeHtml(entry.groups[groupIndex].label)}</small></div>`)
      .addTo(map)
      .openPopup();

    state.reader.map.once("popupclose", () => {
      if (state.reader.coordMarker) {
        map.removeLayer(state.reader.coordMarker);
        state.reader.coordMarker = null;
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Renamer                                                                     */
  /* -------------------------------------------------------------------------- */

  function setupRenamer() {
    setupDropZone("renamerDropZone", "renamerFileInput", loadRenamerFile);
    el("renamerReplaceBtn").addEventListener("click", () => el("renamerFileInput").click());
    el("renamerNewName").addEventListener("input", updateRenamerPreview);
    el("renamerSyncProperties").addEventListener("change", () => {
      updateRenamerSyncControls();
      updateRenamerPreview();
    });
    $$('input[name="renameField"]').forEach((input) => input.addEventListener("change", updateRenamerPreview));
    el("renamerCustomField").addEventListener("input", updateRenamerPreview);
    el("renamerCreateMissing").addEventListener("change", updateRenamerPreview);
    el("downloadRenamerBtn").addEventListener("click", downloadRenamedGeoJSON);
    updateRenamerSyncControls();
  }

  async function loadRenamerFile(file) {
    try {
      const data = await readAndValidateGeoJSON(file);
      state.renamer.data = data;
      state.renamer.file = file;

      const features = getFeatures(data);
      const types = Array.from(geometryTypeCounts(features).keys());
      el("renamerDropZone").hidden = true;
      el("renamerWorkspace").hidden = false;
      setInlineMessage("renamerUploadMessage", "", "", true);
      el("renamerOriginalName").textContent = file.name;
      el("renamerFileMeta").textContent = `${formatBytes(file.size)} · GeoJSON valid`;
      el("renamerRootType").textContent = data.type;
      el("renamerFeatureCount").textContent = String(features.length);
      el("renamerGeometryTypes").textContent = types.length ? types.join(", ") : "None";
      el("renamerNewName").value = stripJsonExtension(file.name);
      updateRenamerPreview();
      el("renamerNewName").focus();
      showToast("File siap di-rename", `${file.name} lolos validasi.`, "success");
    } catch (error) {
      setInlineMessage("renamerUploadMessage", error.message, "error", false);
      showToast("File tidak dapat dibuka", firstLine(error.message), "error");
    }
  }

  function updateRenamerSyncControls() {
    const enabled = el("renamerSyncProperties").checked;
    const options = el("renamerSyncOptions");
    options.setAttribute("aria-disabled", String(!enabled));
    $$('input', options).forEach((input) => { input.disabled = !enabled; });
  }

  function selectedRenameFields() {
    const fields = $$('input[name="renameField"]:checked').map((input) => input.value);
    const custom = el("renamerCustomField").value.trim();
    if (custom) fields.push(custom);
    return Array.from(new Set(fields));
  }

  function updateRenamerPreview() {
    const original = state.renamer.file?.name || "source.geojson";
    const rawName = el("renamerNewName").value.trim();
    const output = `${strictSlug(rawName || "nama_baru")}.geojson`;
    const sync = el("renamerSyncProperties").checked;
    const fields = selectedRenameFields();

    el("renamerFileHint").textContent = output;
    el("renameFromPreview").textContent = original;
    el("renameToPreview").textContent = output;
    el("downloadRenamerBtn").disabled = !state.renamer.data || !rawName;

    if (!sync) {
      el("renameSyncPreview").textContent = "Isi GeoJSON tidak diubah.";
      return;
    }

    if (!fields.length) {
      el("renameSyncPreview").textContent = "Sinkronisasi aktif, tetapi belum ada field yang dipilih.";
      return;
    }

    const count = countMatchingProperties(state.renamer.data, fields);
    const create = el("renamerCreateMissing").checked;
    el("renameSyncPreview").textContent = create
      ? `${fields.join(", ")} akan diperbarui/dibuat pada setiap feature.`
      : `${count} nilai existing pada field ${fields.join(", ")} akan diperbarui.`;
  }

  function countMatchingProperties(data, fields) {
    let count = 0;
    getFeatures(data).forEach((feature) => {
      const properties = feature.properties;
      if (!properties || typeof properties !== "object") return;
      fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(properties, field)) count += 1;
      });
    });
    return count;
  }

  function downloadRenamedGeoJSON() {
    if (!state.renamer.data) return;
    const rawName = el("renamerNewName").value.trim();
    if (!rawName) {
      showToast("Nama baru belum diisi", "Masukkan nama file sebelum mengunduh.", "error");
      el("renamerNewName").focus();
      return;
    }

    const output = deepClone(state.renamer.data);
    let changedCount = 0;

    if (el("renamerSyncProperties").checked) {
      const fields = selectedRenameFields();
      const createMissing = el("renamerCreateMissing").checked;
      getFeatures(output).forEach((feature) => {
        if (!feature.properties || typeof feature.properties !== "object") {
          if (!createMissing) return;
          feature.properties = {};
        }
        fields.forEach((field) => {
          if (createMissing || Object.prototype.hasOwnProperty.call(feature.properties, field)) {
            feature.properties[field] = rawName;
            changedCount += 1;
          }
        });
      });
    }

    const filename = `${strictSlug(rawName)}.geojson`;
    downloadJSON(output, filename);
    const detail = changedCount
      ? `${filename} diunduh; ${changedCount} nilai properties diperbarui.`
      : `${filename} diunduh tanpa mengubah isi data.`;
    showToast("Rename selesai", detail, "success");
  }

  /* -------------------------------------------------------------------------- */
  /* Tracker: locate BSRE polygons by ID                                         */
  /* -------------------------------------------------------------------------- */

  function setupTracker() {
    const input = el("trackerIdInput");
    if (!input) {
      // Stale index.html (e.g. an unfinished deploy) must not break Maker/Reader.
      showToast("Modul Tracker belum tersedia", "Muat ulang halaman atau deploy ulang file index.html terbaru.", "error");
      return;
    }

    updateTrackerDataState();
    updateTrackerTargetCount();
    updateTrackerDestinationControls();

    el("trackerMarkBtn").addEventListener("click", () => {
      void runTrackerSearch();
    });
    el("trackerClearBtn").addEventListener("click", () => clearTracker(true));
    el("trackerFitBtn").addEventListener("click", () => fitTrackedPolygons());
    el("trackerContextBtn").addEventListener("click", () => {
      void toggleTrackerContext();
    });
    el("trackerLocateBtn").addEventListener("click", toggleTrackerLocate);
    el("trackerSetDestinationBtn").addEventListener("click", () => setTrackerDestination(state.tracker.selectedTarget));
    el("trackerRouteMapBtn").addEventListener("click", () => {
      const index = state.tracker.selectedTarget;
      if (index < 0 || !state.tracker.targets[index]) {
        showToast("Pilih polygon dulu", "Klik polygon di peta atau barisnya di daftar Polygon Terlacak.", "warning");
        return;
      }
      setTrackerDestination(index);
    });
    el("trackerRouteCloseBtn").addEventListener("click", clearTrackerDestination);
    el("trackerRouteRefreshBtn").addEventListener("click", () => {
      if (state.tracker.destination) void requestTrackerRoute({ force: true });
    });

    input.addEventListener("input", updateTrackerTargetCount);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void runTrackerSearch();
      }
    });

    // Row actions are delegated so the list can be re-rendered freely.
    el("trackerResultList").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-tracker-action]");
      if (!button) return;
      const index = Number(button.dataset.index);
      const action = button.dataset.trackerAction;
      if (action === "focus") focusTrackerTarget(index);
      else if (action === "route") {
        selectTrackerTarget(index);
        setTrackerDestination(index);
      } else if (action === "remove") removeTrackerTarget(index);
      else if (action === "use") applyTrackerSuggestion(index, button.dataset.id);
    });

    if (window.location.hash.replace("#", "") === "tracker") void ensureTrackerData();
  }

  async function ensureTrackerData() {
    if (state.tracker.data) return state.tracker.data;
    if (state.tracker.loadPromise) return state.tracker.loadPromise;

    state.tracker.loading = true;
    updateTrackerDataState();

    const load = (async () => {
      try {
        const response = await fetch("assets/bsre.geojson", { cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const features = getFeatures(data);
        const index = new Map();
        const ids = [];

        features.forEach((feature, featureIndex) => {
          const id = String(feature?.properties?.id ?? "").trim().toUpperCase();
          if (!id) return;
          const entry = { id, featureIndex, feature };
          if (!index.has(id)) index.set(id, []);
          index.get(id).push(entry);
          ids.push(id);
        });

        state.tracker.data = data;
        state.tracker.index = index;
        state.tracker.ids = ids;
        state.tracker.featureCount = ids.length;
        state.tracker.lastError = null;
        return data;
      } catch (error) {
        state.tracker.lastError = error;
        throw error;
      } finally {
        state.tracker.loading = false;
        state.tracker.loadPromise = null;
        updateTrackerDataState();
        updateTrackerMapStatus();
      }
    })();

    state.tracker.loadPromise = load;
    return load;
  }

  function updateTrackerDataState() {
    const badge = el("trackerDataState");
    if (!badge) return;
    if (state.tracker.data) {
      badge.textContent = `BSRE ${formatNumber(state.tracker.featureCount, 0)} POLYGON`;
      return;
    }
    badge.textContent = state.tracker.loading ? "MEMUAT BSRE…" : "BSRE BELUM SIAP";
  }

  function parseTrackerIds(rawText) {
    const seen = new Set();
    const tokens = [];

    String(rawText || "")
      .split(/[\s,;]+/)
      .map((token) => token.replace(/^["'`.,;:]+|["'`.,;:]+$/g, "").trim().toUpperCase())
      .filter(Boolean)
      .forEach((token) => {
        if (seen.has(token)) return;
        seen.add(token);
        tokens.push(token);
      });

    return tokens;
  }

  /* Exact ID first; a bare block ID (BSRE ids are "BLOCK-n") then matches
     every sub-polygon of that block. */
  function matchTrackerToken(token) {
    const index = state.tracker.index;
    if (!index) return { matches: [], mode: "unavailable" };

    const exact = index.get(token);
    if (exact && exact.length) return { matches: exact, mode: "exact" };

    const block = [];
    index.forEach((entries, id) => {
      if (id.split("-")[0] === token) block.push(...entries);
    });
    if (block.length) return { matches: block, mode: "block" };

    return { matches: [], mode: "none" };
  }

  function suggestTrackerIds(token, limit = 4) {
    const core = token.replace(/-/g, "");
    if (core.length < 4) return [];
    return (state.tracker.ids || []).filter((id) => id.replace(/-/g, "").includes(core)).slice(0, limit);
  }

  async function runTrackerSearch() {
    const tokens = parseTrackerIds(el("trackerIdInput").value);

    if (!tokens.length) {
      clearTracker(false);
      setInlineMessage("trackerMessage", "Masukkan minimal satu ID polygon BSRE, misalnya AA00021551-1.", "error");
      return;
    }

    const button = el("trackerMarkBtn");
    button.disabled = true;
    try {
      await ensureTrackerData();
    } catch (error) {
      setInlineMessage("trackerMessage", `Data BSRE tidak dapat dimuat: ${error.message}`, "error");
      return;
    } finally {
      button.disabled = false;
    }

    const limited = tokens.slice(0, TRACKER_MAX_TARGETS);
    const keepSelection = state.tracker.targets[state.tracker.selectedTarget]?.token || null;
    const keepDestination = state.tracker.destination?.token || null;

    state.tracker.targets = limited.map((token) => buildTrackerTarget(token));
    restoreTrackerSelection(keepSelection, keepDestination);

    renderTrackerResults();
    renderTrackerMap();

    const found = state.tracker.targets.filter((target) => target.bounds);
    const missing = state.tracker.targets.filter((target) => target.mode === "none");
    const polygonCount = state.tracker.targets.reduce((sum, target) => sum + target.polygons.length, 0);

    if (el("trackerFitToggle").checked) {
      fitTrackedPolygons();
      // On narrow screens the map sits below the form; keep the result in view.
      if (window.matchMedia("(max-width: 960px)").matches) {
        document.querySelector(".tracker-map-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    const lines = [
      `${formatNumber(found.length, 0)} dari ${formatNumber(state.tracker.targets.length, 0)} ID ditandai · ${formatNumber(polygonCount, 0)} polygon BSRE.`
    ];
    if (tokens.length > limited.length) {
      lines.push(`Hanya ${TRACKER_MAX_TARGETS} ID pertama yang diproses.`);
    }
    if (missing.length) {
      lines.push(...missing.map((target) => `${target.token}: tidak ditemukan${target.suggestions.length ? ` · mirip: ${target.suggestions.join(", ")}` : ""}.`));
    }
    setInlineMessage("trackerMessage", missing.length ? lines.join("\n") : lines[0], missing.length ? "warning" : "success");
  }

  function buildTrackerTarget(token) {
    const { matches, mode } = matchTrackerToken(token);
    const polygons = matches.map((entry) => {
      const metrics = trackerMetrics(entry.feature);
      return {
        id: entry.id,
        feature: entry.feature,
        ha: Number(entry.feature?.properties?.HA),
        metrics,
        polys: geometryPolys(entry.feature?.geometry)
      };
    });

    let bounds = null;
    polygons.forEach((poly) => {
      if (!poly.metrics) return;
      bounds = bounds ? bounds.extend(poly.metrics.bounds) : L.latLngBounds(poly.metrics.bounds);
    });

    return {
      token,
      mode,
      polygons,
      bounds,
      suggestions: mode === "none" ? suggestTrackerIds(token) : [],
      layer: null,
      markers: [],
      proximity: null
    };
  }

  function trackerTargetStyle(active = false) {
    return active
      ? { pane: "trackerTargetPane", color: "#111111", weight: 5, opacity: 1, fillColor: "#e60012", fillOpacity: 0.42 }
      : { pane: "trackerTargetPane", color: "#e60012", weight: 3, opacity: 1, fillColor: "#ff4d5a", fillOpacity: 0.26 };
  }

  function renderTrackerResults() {
    const list = el("trackerResultList");
    const targets = state.tracker.targets;
    const marked = targets.filter((target) => target.mode !== "none").length;

    el("trackerTargetCount").textContent = formatNumber(targets.length, 0);
    el("trackerResultCount").textContent = formatNumber(marked, 0);
    el("trackerFitBtn").disabled = !targets.some((target) => target.bounds);

    if (!targets.length) {
      list.replaceChildren(
        Object.assign(document.createElement("p"), {
          className: "tracker-empty",
          innerHTML: 'Belum ada ID ditandai. Masukkan ID polygon di kolom atas lalu tekan <strong>Tandai Polygon</strong>.'
        })
      );
      return;
    }

    const listElement = document.createElement("ul");
    listElement.className = "tracker-rows";
    listElement.innerHTML = targets.map((target, index) => renderTrackerRow(target, index)).join("");
    list.replaceChildren(listElement);
    updateTrackerDestinationControls();
  }

  function renderTrackerRow(target, index) {
    const missing = target.mode === "none";
    const area = target.polygons.reduce((sum, poly) => sum + (Number.isFinite(poly.ha) ? poly.ha : 0), 0);
    const vertices = target.polygons.reduce((sum, poly) => sum + (poly.metrics ? poly.metrics.vertices : 0), 0);
    const detail = missing
      ? "ID tidak ada di data BSRE"
      : [
          target.polygons.length > 1 ? `${formatNumber(target.polygons.length, 0)} sub-polygon` : null,
          target.polygons.length === 1 ? escapeHtml(target.polygons[0].id) : null,
          `${formatNumber(area, 3)} ha`,
          `${formatNumber(vertices, 0)} titik`
        ].filter(Boolean).join(" · ");

    const selected = state.tracker.selectedTarget === index;

    return `<li class="tracker-row${missing ? " is-missing" : ""}${selected ? " is-selected" : ""}" data-index="${index}">
  <button class="tracker-row-main" type="button" data-tracker-action="${missing ? "noop" : "focus"}" data-index="${index}" title="${missing ? "ID tidak ditemukan" : "Pilih polygon ini dan zoom ke petanya"}">
    <span class="tracker-row-number">${index + 1}</span>
    <span class="tracker-row-copy">
      <strong>${escapeHtml(target.token)}</strong>
      <small>${detail}</small>
      <span class="tracker-row-status" data-status-for="${index}">${missing ? "TIDAK DITEMUKAN" : "DITANDAI"}</span>
    </span>
    ${target.mode === "block" ? '<span class="tracker-row-tag" title="ID blok cocok dengan beberapa sub-polygon">BLOK</span>' : ""}
  </button>
  ${target.suggestions.length
    ? `<span class="tracker-row-suggest">${target.suggestions.map((id) => `<button class="tracker-chip" type="button" data-tracker-action="use" data-index="${index}" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join("")}</span>`
    : ""}
  ${missing ? "" : `<button class="tracker-row-flag" type="button" data-tracker-action="route" data-index="${index}" aria-label="Jadikan ${escapeHtml(target.token)} sebagai tujuan" title="Set as destination">
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>
  </button>`}
  <button class="tracker-row-x" type="button" data-tracker-action="remove" data-index="${index}" aria-label="Hapus ${escapeHtml(target.token)}" title="Hapus dari daftar">×</button>
</li>`;
  }

  function renderTrackerMap() {
    const group = state.tracker.group;
    group.clearLayers();
    state.tracker.targets.forEach((target) => {
      target.layer = null;
      target.markers = [];
    });

    state.tracker.targets.forEach((target, index) => {
      if (!target.polygons.length) return;

      const layer = L.geoJSON(
        { type: "FeatureCollection", features: target.polygons.map((poly) => poly.feature) },
        {
          pane: "trackerTargetPane",
          style: () => trackerTargetStyle(Boolean(target.proximity && target.proximity.inside)),
          onEachFeature: (feature, subLayer) => {
            const id = String(feature?.properties?.id ?? "—");
            const ha = Number(feature?.properties?.HA);
            subLayer.bindTooltip(`#${index + 1} · ${id}`, { sticky: true, direction: "top", className: "tracker-tooltip" });
            subLayer.on("click", () => selectTrackerTarget(index));
            subLayer.bindPopup(
              `<div class="map-popup"><strong>#${index + 1} · ${escapeHtml(id)}</strong>` +
              `<code>${Number.isFinite(ha) ? `${formatNumber(ha, 3)} ha` : "area tidak tersedia"}</code>` +
              `<small>${target.polygons.length > 1 ? "Bagian dari ID blok " : ""}${escapeHtml(target.token)}</small></div>`,
              { autoPan: true }
            );
          }
        }
      ).addTo(group);

      target.layer = layer;

      target.polygons.forEach((poly, polyIndex) => {
        if (!poly.metrics) return;
        const label = target.polygons.length > 1 ? `${index + 1}${String.fromCharCode(97 + polyIndex)}` : String(index + 1);
        const marker = L.marker(poly.metrics.center, {
          icon: L.divIcon({ className: "tracker-badge-icon", html: `<span>${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
          keyboard: false,
          riseOnHover: true
        }).addTo(group);
        marker.bindTooltip(`${poly.id} · klik untuk zoom`, { direction: "top", offset: [0, -14], className: "tracker-tooltip" });
        marker.on("click", () => focusTrackerTarget(index));
        target.markers.push(marker);
      });
    });

    updateTrackerMapStatus();
  }

  function focusTrackerTarget(index) {
    const target = state.tracker.targets[index];
    if (!target) return;
    if (!target.bounds) {
      showToast("Polygon tidak ditemukan", `ID ${target.token} tidak ada di data BSRE.`, "warning");
      return;
    }

    selectTrackerTarget(index);
    state.tracker.map.fitBounds(target.bounds, { padding: [42, 42], maxZoom: 18 });
    if (target.layer) {
      target.layer.setStyle(trackerTargetStyle(true));
      window.setTimeout(() => {
        if (!target.layer) return;
        target.layer.setStyle(trackerTargetStyle(Boolean(target.proximity && target.proximity.inside)));
      }, 1400);
    }
  }

  /* Re-marking rebuilds the target list, so selection is tracked by ID instead of index. */
  function restoreTrackerSelection(keepSelection, keepDestination) {
    const foundIndex = (token) => state.tracker.targets.findIndex((target) => target.token === token && target.mode !== "none");

    if (keepDestination) {
      const index = foundIndex(keepDestination);
      if (index === -1) {
        clearTrackerDestination({ silent: true });
      } else {
        state.tracker.destination.index = index;
      }
    }

    if (keepSelection) state.tracker.selectedTarget = foundIndex(keepSelection);
    if (state.tracker.selectedTarget === -1) {
      const single = state.tracker.targets.filter((target) => target.mode !== "none");
      if (single.length === 1) state.tracker.selectedTarget = state.tracker.targets.indexOf(single[0]);
    }
  }

  function selectTrackerTarget(index) {
    if (index >= 0) {
      const candidate = state.tracker.targets[index];
      if (!candidate || !candidate.bounds) return;
    }
    const target = state.tracker.targets[index];
    const changed = state.tracker.selectedTarget !== index;
    state.tracker.selectedTarget = index;
    // Classes only: re-rendering the list inside a click handler detaches the
    // element Playwright/the browser is still acting on.
    $$(".tracker-row").forEach((row) => {
      row.classList.toggle("is-selected", Number(row.dataset.index) === index);
    });
    updateTrackerDestinationControls();
    if (changed && state.tracker.destination && state.tracker.destination.index !== index) {
      setInlineMessage("trackerRouteMessage", "", "info", true);
    }
  }

  /* Guarded DOM writes: an older cached index.html has no route markup. */
  const setNodeText = (id, value) => { const node = el(id); if (node) node.textContent = value; };
  const setNodeHidden = (id, value) => { const node = el(id); if (node) node.hidden = value; };

  function updateTrackerDestinationControls() {
    const panel = el("trackerRoutePanel");
    const button = el("trackerSetDestinationBtn");
    if (!panel || !button) return;
    const label = button.querySelector(".tracker-destination-label");
    const target = state.tracker.targets[state.tracker.selectedTarget];
    const destinationIndex = state.tracker.destination ? state.tracker.destination.index : -1;
    const isCurrentTarget = Boolean(target && destinationIndex === state.tracker.selectedTarget);

    // The panel stays visible from the start, otherwise the button looks missing.
    panel.hidden = false;
    setNodeText("trackerRouteTitle", target ? `Tujuan · #${state.tracker.selectedTarget + 1}` : "Set as Destination");

    const hint = el("trackerRouteHint");
    if (target) {
      if (hint) hint.hidden = true;
    } else if (hint) {
      hint.hidden = false;
      hint.innerHTML = state.tracker.targets.length
        ? 'Pilih salah satu polygon di daftar <strong>Polygon Terlacak</strong>, lalu tekan tombol di bawah untuk mengambil jalur tercepat dari posisi GPS Anda.'
        : 'Masukkan ID polygon di kolom <strong>ID Polygon</strong> lalu tekan <strong>Tandai Polygon</strong>. Setelah itu pilih barisnya dan tekan <strong>Set as Destination</strong> untuk mengambil jalur tercepat dari posisi GPS Anda.';
    }

    button.hidden = isCurrentTarget && destinationIndex >= 0;
    button.disabled = !target;
    button.title = target ? "Hitung jalur tercepat ke polygon ini" : "Pilih dulu salah satu polygon yang ditandai";

    const mapButton = el("trackerRouteMapBtn");
    if (!mapButton) return;
    mapButton.disabled = !target;
    mapButton.classList.toggle("is-active", Boolean(isCurrentTarget && destinationIndex >= 0));
    mapButton.title = target
      ? `Set as Destination · ${target.token}`
      : "Pilih dulu salah satu polygon (klik petanya di peta atau barisnya di daftar)";

    if (isCurrentTarget && destinationIndex >= 0) {
      label.textContent = target.token;
      setNodeText("trackerRouteTitle", `Tujuan · ${target.token}`);
    } else {
      label.textContent = target ? `Set as Destination · ${target.token}` : "Set as Destination";
    }

    setNodeHidden("trackerRouteStats", !state.tracker.routeInfo);
    setNodeHidden("trackerRouteActions", !state.tracker.routeInfo);
    setNodeHidden("trackerRouteSteps", !(state.tracker.routeInfo && state.tracker.routeInfo.steps.length));
  }

  function fitTrackedPolygons(maxZoom = 18) {
    const targets = state.tracker.targets.filter((target) => target.bounds);
    if (!targets.length) {
      showToast("Belum ada polygon ditandai", "Masukkan ID polygon BSRE lalu tekan Tandai Polygon.", "warning");
      return;
    }

    const bounds = targets.reduce(
      (acc, target) => (acc ? acc.extend(target.bounds) : L.latLngBounds(target.bounds)),
      null
    );

    if (state.tracker.myPosition) {
      bounds.extend(L.latLng([state.tracker.myPosition.lat, state.tracker.myPosition.lng]));
    }

    state.tracker.map.fitBounds(bounds, { padding: [36, 36], maxZoom });
  }

  function removeTrackerTarget(index) {
    const targets = state.tracker.targets;
    if (!targets[index]) return;
    if (state.tracker.destination && state.tracker.destination.index === index) clearTrackerDestination();
    else if (state.tracker.selectedTarget === index) selectTrackerTarget(-1);
    el("trackerIdInput").value = targets
      .filter((_, position) => position !== index)
      .map((target) => target.token)
      .join("\n");
    void runTrackerSearch();
  }

  function applyTrackerSuggestion(index, id) {
    const targets = state.tracker.targets;
    if (!targets[index] || !id) return;
    targets[index] = { ...targets[index], token: id };
    el("trackerIdInput").value = targets.map((target) => target.token).join("\n");
    void runTrackerSearch();
  }

  function clearTracker(clearInput) {
    if (clearInput) el("trackerIdInput").value = "";
    state.tracker.targets.forEach((target) => {
      target.layer = null;
      target.markers = [];
      target.proximity = null;
    });
    state.tracker.targets = [];
    state.tracker.selectedTarget = -1;
    if (state.tracker.destination) clearTrackerDestination();
    if (state.tracker.group) state.tracker.group.clearLayers();
    el("trackerFitBtn").disabled = true;
    renderTrackerResults();
    updateTrackerTargetCount();
    setInlineMessage("trackerMessage", "", "info", true);
    updateTrackerMapStatus();
  }

  function updateTrackerTargetCount() {
    const count = parseTrackerIds(el("trackerIdInput").value).length;
    el("trackerTargetCount").textContent = formatNumber(count, 0);
  }

  async function toggleTrackerContext() {
    const button = el("trackerContextBtn");
    const label = button.querySelector("span");

    if (state.tracker.contextLayer) {
      if (state.tracker.contextVisible) {
        state.tracker.map.removeLayer(state.tracker.contextLayer);
        state.tracker.contextVisible = false;
        showToast("Konteks BSRE disembunyikan", "Hanya polygon yang ditandai yang ditampilkan.", "warning");
      } else {
        state.tracker.contextLayer.addTo(state.tracker.map);
        state.tracker.contextVisible = true;
      }
      updateTrackerContextButton();
      return;
    }

    if (state.tracker.contextLoading) return;
    state.tracker.contextLoading = true;
    button.disabled = true;
    label.textContent = "Memuat…";

    try {
      await ensureTrackerData();
      state.tracker.contextLayer = L.geoJSON(state.tracker.data, {
        pane: "trackerContextPane",
        interactive: false,
        style: { color: "#9aa0a6", weight: 1, opacity: 0.5, fillColor: "#7dd3fc", fillOpacity: 0.06 }
      }).addTo(state.tracker.map);
      state.tracker.contextVisible = true;
      showToast(
        "Konteks BSRE aktif",
        `${formatNumber(state.tracker.featureCount, 0)} polygon BSRE ditampilkan sebagai latar; target tetap merah di atasnya.`,
        "success"
      );
    } catch (error) {
      showToast("Konteks BSRE gagal", `File polygon BSRE tidak dapat dibuka: ${error.message}`, "error");
    } finally {
      state.tracker.contextLoading = false;
      button.disabled = false;
      label.textContent = "Konteks BSRE";
      updateTrackerContextButton();
    }
  }

  function updateTrackerContextButton() {
    const button = el("trackerContextBtn");
    button.classList.toggle("is-active", state.tracker.contextVisible);
    button.setAttribute("aria-pressed", String(state.tracker.contextVisible));
  }

  /* -------------------------------------------------------------------------- */
  /* Tracker: live position against the marked polygons                          */
  /* -------------------------------------------------------------------------- */

  function toggleTrackerLocate() {
    if (state.tracker.watchId !== null) stopTrackerLocate();
    else startTrackerLocate();
  }

  function startTrackerLocate() {
    if (!("geolocation" in navigator)) {
      showToast("GPS tidak tersedia", "Browser ini tidak mendukung Location API.", "error");
      return;
    }

    state.tracker.locateError = null;
    state.tracker.watchId = navigator.geolocation.watchPosition(
      handleTrackerPosition,
      (error) => {
        state.tracker.locateError = error;
        updateTrackerLocateButton();
        updateTrackerMapStatus();
        showToast("Posisi belum terbaca", trackerLocateMessage(error), "error");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
    );

    updateTrackerLocateButton();
    showToast("Pelacakan posisi aktif", "Posisi GPS Anda dibandingkan langsung dengan polygon yang ditandai.", "success");
  }

  function stopTrackerLocate() {
    if (state.tracker.watchId === null) return;
    navigator.geolocation.clearWatch(state.tracker.watchId);
    state.tracker.watchId = null;
    updateTrackerLocateButton();
    updateTrackerProximity();
    updateTrackerMapStatus();
  }

  function trackerLocateMessage(error) {
    const messages = {
      1: "Izinkan akses lokasi pada pengaturan browser, lalu coba lagi.",
      2: "Posisi belum tersedia. Pindah ke area terbuka lalu coba lagi.",
      3: "GPS terlalu lama merespons. Coba sekali lagi."
    };
    return messages[error?.code] || error?.message || "Terjadi kesalahan geolocation.";
  }

  function handleTrackerPosition(position) {
    const hadFix = Boolean(state.tracker.myPosition);
    const coords = position.coords || {};
    const accuracy = Number.isFinite(coords.accuracy) ? Math.max(1, Math.round(coords.accuracy * 10) / 10) : null;
    state.tracker.myPosition = {
      lat: roundCoordinate(coords.latitude),
      lng: roundCoordinate(coords.longitude),
      accuracy,
      at: Date.now()
    };
    state.tracker.locateError = null;

    drawTrackerPosition();
    updateTrackerProximity();
    updateTrackerLocateButton();
    updateTrackerMapStatus();
    maybeRefreshTrackerRoute();

    if (!hadFix) {
      if (state.tracker.targets.some((target) => target.bounds)) fitTrackedPolygons(17);
      else state.tracker.map.setView([state.tracker.myPosition.lat, state.tracker.myPosition.lng], 17);
    }
  }

  function drawTrackerPosition() {
    const map = state.tracker.map;
    if (state.tracker.locateLayer) map.removeLayer(state.tracker.locateLayer);

    const { lat, lng, accuracy } = state.tracker.myPosition;
    const group = L.featureGroup([], { pane: "trackerTargetPane" });

    if (Number.isFinite(accuracy)) {
      L.circle([lat, lng], {
        radius: accuracy,
        pane: "trackerContextPane",
        color: "#38bdf8",
        weight: 1.5,
        opacity: 0.9,
        fillColor: "#7dd3fc",
        fillOpacity: 0.14,
        interactive: false
      }).addTo(group);
    }

    L.marker([lat, lng], {
      icon: L.divIcon({ className: "tracker-me-icon", html: "<i></i>", iconSize: [22, 22], iconAnchor: [11, 11] })
    })
      .bindPopup(`<div class="map-popup"><strong>Posisi Anda</strong><code>${lat.toFixed(6)}<br>${lng.toFixed(6)}</code><small>${Number.isFinite(accuracy) ? `akurasi ±${formatNumber(accuracy, 1)} m` : "akurasi tidak dilaporkan"}</small></div>`)
      .addTo(group);

    state.tracker.locateLayer = group.addTo(map);
  }

  function updateTrackerProximity() {
    /* Rewrites status spans in place; never replaces the list. */
    const point = state.tracker.myPosition ? [state.tracker.myPosition.lat, state.tracker.myPosition.lng] : null;

    state.tracker.targets.forEach((target) => {
      const polys = target.polygons.length ? target.polygons.flatMap((poly) => poly.polys) : [];
      if (!point || !polys.length) {
        target.proximity = null;
        return;
      }
      const inside = pointInPolys(point, polys);
      target.proximity = { inside, distance: distanceToPolys(point, polys) };
      if (target.layer) target.layer.setStyle(trackerTargetStyle(inside));
    });

    state.tracker.targets.forEach((target, index) => {
      const status = document.querySelector(`[data-status-for="${index}"]`);
      const row = document.querySelector(`.tracker-row[data-index="${index}"]`);
      if (!status) return;
      if (state.tracker.destination && state.tracker.destination.index === index) {
        const km = state.tracker.routeInfo ? `${trackerRouteKilometers(state.tracker.routeInfo)} km ke tujuan` : "rute sedang dihitung";
        status.textContent = `TUJUAN · ${km}`;
        status.className = "tracker-row-status is-route";
        if (row) row.classList.toggle("is-inside", Boolean(target.proximity && target.proximity.inside));
        return;
      }
      if (target.mode === "none") {
        status.textContent = "TIDAK DITEMUKAN";
        status.className = "tracker-row-status is-missing";
        if (row) row.classList.remove("is-inside");
        return;
      }
      if (!target.proximity) {
        status.textContent = target.polygons.length > 1 ? `${formatNumber(target.polygons.length, 0)} POLYGON DITANDAI` : "DITANDAI";
        status.className = "tracker-row-status";
        if (row) row.classList.remove("is-inside");
        return;
      }
      if (target.proximity.inside) {
        status.textContent = "POSISI ANDA DI DALAM POLYGON";
        status.className = "tracker-row-status is-inside";
        if (row) row.classList.add("is-inside");
      } else {
        status.textContent = `${formatTrackerDistance(target.proximity.distance)} dari tepi polygon`;
        status.className = "tracker-row-status is-outside";
        if (row) row.classList.remove("is-inside");
      }
    });
  }

  /* Field-friendly distance: metres below 1 km, kilometres above. */
  function formatTrackerDistance(meters) {
    if (!Number.isFinite(meters)) return "jarak belum tersedia";
    if (meters < 10) return `±${formatNumber(Math.round(meters * 10) / 10, 1)} m`;
    if (meters < 1000) return `±${formatNumber(Math.round(meters), 0)} m`;
    return `±${formatNumber(meters / 1000, 2)} km`;
  }

  function updateTrackerLocateButton() {
    const button = el("trackerLocateBtn");
    const label = button.querySelector(".tracker-locate-label");
    const watching = state.tracker.watchId !== null;
    const error = state.tracker.locateError;

    button.classList.toggle("is-active", watching && !error);
    button.classList.toggle("is-loading", watching && !state.tracker.myPosition && !error);
    button.setAttribute("aria-pressed", String(watching));
    label.textContent = watching
      ? (state.tracker.myPosition ? "Berhenti Lacak" : "Mencari…")
      : (state.tracker.myPosition ? "Lacak Lagi" : "Posisi Saya");
    button.title = watching
      ? "Hentikan pemantauan posisi GPS"
      : "Tampilkan posisi saya dan jaraknya ke polygon yang ditandai";
  }

  function updateTrackerMapStatus() {
    const badge = el("trackerMapStatus");
    const caption = el("trackerMapCaption");
    const targets = state.tracker.targets;
    const marked = targets.filter((target) => target.mode !== "none").length;
    const missing = targets.filter((target) => target.mode === "none").length;
    const insideCount = targets.filter((target) => target.proximity && target.proximity.inside).length;
    const watching = state.tracker.watchId !== null;
    const position = state.tracker.myPosition;

    let text;
    if (watching && !position) text = "MENCARI GPS…";
    else if (watching && state.tracker.locateError) text = "GPS GAGAL";
    else if (position) {
      const phrase = insideCount
        ? `${formatNumber(insideCount, 0)} POLYGON DI LOKASI ANDA`
        : (marked ? "DI LUAR POLYGON TARGET" : "POSISI TERKUNCI");
      text = watching ? phrase : `TERAKHIR · ${phrase}`;
    }
    else if (marked && missing) text = `${formatNumber(marked, 0)} DITANDAI · ${formatNumber(missing, 0)} TIDAK ADA`;
    else if (marked) text = `${formatNumber(marked, 0)} POLYGON DITANDAI`;
    else if (missing) text = "ID TIDAK DITEMUKAN";
    else text = "SIAP LACAK";

    badge.textContent = text;
    badge.classList.toggle("is-live", watching);
    badge.classList.toggle("is-warn", Boolean(missing) || Boolean(state.tracker.locateError && watching));

    const polygonCount = targets.reduce((sum, target) => sum + target.polygons.length, 0);
    const parts = [];
    if (state.tracker.data) parts.push(`${formatNumber(state.tracker.featureCount, 0)} polygon BSRE tersedia`);
    else parts.push(state.tracker.loading ? "memuat data BSRE…" : "data BSRE belum termuat");
    if (polygonCount) parts.push(`${formatNumber(polygonCount, 0)} ditandai`);
    if (position) {
      const quality = classifyGpsAccuracy(position.accuracy);
      parts.push(`posisi ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · ±${formatNumber(position.accuracy, 1)} m · ${quality.label}`);
    }
    if (state.tracker.routeInfo) {
      const route = state.tracker.routeInfo;
      parts.push(`tujuan ${state.tracker.destination?.token || "—"} · ${trackerRouteKilometers(route)} km · ${formatTrackerDuration(route.duration)}`);
    }
    caption.textContent = parts.join(" · ");
  }

  /* -------------------------------------------------------------------------- */
  /* Tracker: route to the selected polygon                                      */
  /* -------------------------------------------------------------------------- */

  function setTrackerDestination(index, options = {}) {
    const target = state.tracker.targets[index];
    if (!target || !target.bounds) {
      showToast("Polygon belum ditandai", "Pilih ID yang ada di data BSRE terlebih dahulu.", "warning");
      return;
    }

    state.tracker.destination = { index, token: target.token, point: null, inside: false };
    state.tracker.routeInfo = null;
    state.tracker.lastRouteAt = 0;
    state.tracker.lastRouteFrom = null;
    renderTrackerRouteLayers();
    updateTrackerDestinationControls();

    if (!state.tracker.myPosition) {
      state.tracker.routePending = true;
      setInlineMessage("trackerRouteMessage", "Menunggu posisi GPS. Jalur dihitung otomatis begitu fix tersedia.", "info");
      if (state.tracker.watchId === null) startTrackerLocate();
      return;
    }

    state.tracker.routePending = false;
    void requestTrackerRoute();
  }

  function clearTrackerDestination(options = {}) {
    state.tracker.routeRequest += 1;
    state.tracker.destination = null;
    state.tracker.routeInfo = null;
    state.tracker.routePending = false;
    state.tracker.routeLoading = false;
    state.tracker.lastRouteAt = 0;
    state.tracker.lastRouteFrom = null;
    renderTrackerRouteLayers();
    setInlineMessage("trackerRouteMessage", "", "info", true);
    updateTrackerDestinationControls();
    updateTrackerProximity();
    updateTrackerMapStatus();
    if (!options.silent && state.tracker.targets.length) {
      showToast("Tujuan dihapus", "Jalur biru dan estimasi jarak dibersihkan dari peta.", "warning");
    }
  }

  async function requestTrackerRoute() {
    if (!state.tracker.destination) return;

    const position = state.tracker.myPosition;
    if (!position) {
      state.tracker.routePending = true;
      return;
    }

    const target = state.tracker.targets[state.tracker.destination.index];
    if (!target || !target.polygons.length) {
      clearTrackerDestination({ silent: true });
      return;
    }

    const origin = [position.lat, position.lng];
    const polys = target.polygons.flatMap((poly) => poly.polys).filter((rings) => rings.length);
    const nearest = polys.length ? nearestPointOnPolys(origin, polys) : null;
    const insidePolygon = polys.length ? pointInPolys(origin, polys) : false;
    const fallbackCenter = target.polygons.find((poly) => poly.metrics) ?.metrics ?.center || null;
    const destinationPoint = insidePolygon ? (fallbackCenter || origin) : (nearest ? nearest.point : fallbackCenter);

    if (!destinationPoint) {
      setInlineMessage("trackerRouteMessage", "Polygon ini tidak punya koordinat yang valid untuk dijadikan tujuan.", "error");
      return;
    }

    state.tracker.destination.point = destinationPoint;
    // Being inside the plot is a point-in-polygon test, not a "close to the edge" test.
    state.tracker.destination.inside = insidePolygon;
    renderTrackerRouteLayers();

    if (state.tracker.destination.inside) {
      state.tracker.routeLoading = false;
      state.tracker.routeInfo = {
        distance: 0,
        duration: null,
        coordinates: [],
        steps: [],
        shape: "none",
        mode: "Anda sudah berada di dalam polygon ini",
        from: origin,
        at: Date.now()
      };
      setInlineMessage("trackerRouteMessage", "0 km — Anda sudah berada di dalam polygon target, jadi tidak ada jalur yang perlu dihitung.", "success");
      renderTrackerRouteLayers();
      updateTrackerDestinationControls();
      updateTrackerProximity();
      updateTrackerMapStatus();
      return;
    }

    const requestId = ++state.tracker.routeRequest;
    state.tracker.routeLoading = true;
    state.tracker.routeInfo = null;
    setInlineMessage("trackerRouteMessage", "Menghitung jalur tercepat…", "info");
    updateTrackerDestinationControls();

    let route = null;
    let notice = null;
    try {
      route = await fetchTrackerRoute(origin, destinationPoint);
    } catch (error) {
      if (requestId !== state.tracker.routeRequest) return;
      route = {
        distance: trackerMetersBetween(origin, destinationPoint),
        duration: null,
        coordinates: [origin, destinationPoint],
        steps: [],
        shape: "straight",
        mode: "Garis lurus · tanpa jaringan"
      };
      notice = `${error.message || "Rute jaringan tidak tersedia"}. Estimasi memakai jarak garis lurus dari GPS Anda ke tepi polygon.`;
    }

    if (requestId !== state.tracker.routeRequest) return;

    route.from = origin;
    route.at = Date.now();
    state.tracker.routeInfo = route;
    state.tracker.routeLoading = false;
    state.tracker.lastRouteAt = route.at;
    state.tracker.lastRouteFrom = origin;

    setInlineMessage("trackerRouteMessage", notice || `Jalur tercepat ${trackerRouteKilometers(route)} km · ${formatTrackerDuration(route.duration)} · ${route.steps.length} tahapan jalan.`, notice ? "warning" : "success");
    renderTrackerRouteLayers();
    updateTrackerDestinationControls();
    updateTrackerProximity();
    updateTrackerMapStatus();
    fitTrackerRoute(route, [origin, destinationPoint]);
  }

  async function fetchTrackerRoute(origin, destination) {
    const url = `${TRACKER_ROUTE_API}/${origin[1]},${origin[0]};${destination[1]},${destination[0]}`
      + "?overview=full&geometries=geojson&steps=true&alternatives=false";

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TRACKER_ROUTE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal, cache: "no-store", mode: "cors", credentials: "omit" });
    } catch (error) {
      throw new Error(error.name === "AbortError" ? "Layanan rute tidak merespons" : "Tidak dapat menghubungi layanan rute");
    } finally {
      window.clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`Layanan rute menolak permintaan (HTTP ${response.status})`);

    const data = await response.json().catch(() => null);
    if (!data || data.code !== "Ok" || !Array.isArray(data.routes) || !data.routes.length) {
      throw new Error("Tidak ada jalur beroda yang terhubung");
    }

    const route = data.routes[0];
    const coordinates = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => [lat, lng])
      : [];
    if (coordinates.length < 2) throw new Error("Geometri jalur tidak tersedia");

    return {
      distance: Number(route.distance),
      duration: Number.isFinite(route.duration) ? route.duration : null,
      coordinates,
      steps: trackerRouteSteps(route),
      shape: "road",
      mode: "Jalur tercepat · jalan raya"
    };
  }

  function trackerRouteSteps(route) {
    const steps = route.legs?.[0]?.steps;
    if (!Array.isArray(steps)) return [];
    return steps
      .filter((step) => step && step.maneuver && Number.isFinite(step.distance))
      .map((step) => ({
        text: trackerStepText(step),
        distance: step.distance,
        coordinates: Array.isArray(step.geometry?.coordinates)
          ? step.geometry.coordinates.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => [lat, lng])
          : []
      }));
  }

  function trackerStepText(step) {
    const maneuver = step.maneuver || {};
    const type = String(maneuver.type || "");
    const word = trackerDirectionWord(maneuver.modifier);
    const road = step.name ? ` di ${step.name}` : "";

    if (type === "depart") return "Berangkat dari posisi Anda";
    if (type === "arrive") return "Tiba di polygon tujuan";
    if (type === "turn") return `Belok ${word}${step.name ? ` ke ${step.name}` : ""}`;
    if (type === "new name") return `Lanjut${road}`;
    if (type === "continue") return `Terus${road}`;
    if (type === "merge") return `Gabung${road}`;
    if (type === "on ramp") return `Masuk jalur${step.name ? ` ke ${step.name}` : ""}`;
    if (type === "off ramp") return `Keluar${step.name ? ` ke ${step.name}` : ""}`;
    if (type === "fork") return `Ambil lajur ${word}${road}`;
    if (type === "roundabout" || type === "rotary") return `Ikuti bundaran${maneuver.exit ? ` lalu keluar ${maneuver.exit}` : ""}`;
    if (type === "end of road") return `Sampai ujung jalan, belok ${word}`;
    if (type === "notification" || type === "exit roundabout") return `Lanjut${road}`;
    return `${type ? type.replace(/^\w/, (c) => c.toUpperCase()) : "Lanjut"}${word && word !== "lurus" ? ` (${word})` : ""}${road}`;
  }

  function trackerDirectionWord(modifier) {
    const value = String(modifier || "straight");
    if (value.startsWith("slight")) return value.includes("left") ? "kiri tipis" : "kanan tipis";
    if (value.startsWith("sharp")) return value.includes("left") ? "kiri tajam" : "kanan tajam";
    if (value.includes("uturn")) return "balik arah";
    if (value === "straight") return "lurus";
    return value.includes("left") ? "kiri" : "kanan";
  }

  function renderTrackerRouteLayers() {
    const map = state.tracker.map;

    [state.tracker.routeLayer, state.tracker.routeMarker].forEach((layer) => {
      if (layer) map.removeLayer(layer);
    });
    state.tracker.routeLayer = null;
    state.tracker.routeMarker = null;

    const route = state.tracker.routeInfo;
    if (route && route.coordinates.length > 1) {
      const lines = [L.polyline(route.coordinates, { color: "#ffffff", weight: 9, opacity: 0.95, lineJoin: "round", lineCap: "round" })];
      if (route.steps.length) {
        // Thin white separators make the blue line read like a map direction layer.
        lines.unshift(L.polyline(route.coordinates, { color: "#e8f0fe", weight: 7, opacity: 1, lineJoin: "round", lineCap: "round" }));
      }
      lines.push(L.polyline(route.coordinates, {
        color: "#1a73e8",
        weight: 5,
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
        dashArray: route.shape === "straight" ? "9 7" : null
      }));
      state.tracker.routeLayer = L.layerGroup(lines, { pane: "trackerRoutePane", interactive: false }).addTo(map);
    }

    const destination = state.tracker.destination;
    if (destination && destination.point) {
      state.tracker.routeMarker = L.marker(destination.point, {
        pane: "trackerRoutePane",
        icon: L.divIcon({ className: "tracker-flag-icon", html: "<span>TUJUAN</span>", iconSize: [66, 24], iconAnchor: [12, 24] })
      }).addTo(map);
    }

    renderTrackerRoutePanel();
  }

  function renderTrackerRoutePanel() {
    const route = state.tracker.routeInfo;
    const stats = el("trackerRouteStats");
    const stepsList = el("trackerRouteSteps");
    if (!stats || !stepsList) return;

    if (!route) {
      setNodeText("trackerRouteDistance", "—");
      setNodeText("trackerRouteDuration", "—");
      setNodeText("trackerRouteMode", "—");
      stepsList.replaceChildren();
      stepsList.hidden = true;
      stats.hidden = true;
      setNodeHidden("trackerRouteActions", true);
      return;
    }

    setNodeText("trackerRouteDistance", `${trackerRouteKilometers(route)} km`);
    setNodeText("trackerRouteDuration", formatTrackerDuration(route.duration));
    setNodeText("trackerRouteMode", route.shape === "straight" ? "LURUS" : "JALAN RAYA");
    stats.hidden = false;
    setNodeHidden("trackerRouteActions", false);

    const list = stepsList;
    list.replaceChildren();
    if (route.steps.length) {
      const shown = route.steps.slice(0, 40);
      shown.forEach((step) => {
        const item = document.createElement("li");
        item.className = "tracker-step";
        const text = document.createElement("span");
        text.textContent = step.text;
        const distance = document.createElement("small");
        distance.textContent = formatTrackerStepDistance(step.distance);
        item.append(text, distance);
        list.append(item);
      });
      if (route.steps.length > shown.length) {
        const more = document.createElement("li");
        more.className = "tracker-step is-more";
        more.textContent = `+${route.steps.length - shown.length} langkah lainnya`;
        list.append(more);
      }
      list.hidden = false;
    } else {
      list.hidden = true;
    }

    const link = el("trackerRouteMapsLink");
    if (!link) return;
    const point = state.tracker.destination?.point;
    link.href = point
      ? `https://www.google.com/maps/dir/?api=1&destination=${point[0].toFixed(6)},${point[1].toFixed(6)}&travelmode=driving`
      : "#";
  }

  function trackerRouteKilometers(route) {
    const meters = Number(route.distance);
    return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format((Number.isFinite(meters) ? meters : 0) / 1000);
  }

  function formatTrackerDuration(seconds) {
    if (!Number.isFinite(seconds)) return "estimasi waktu tidak tersedia";
    const total = Math.max(1, Math.round(seconds / 60));
    if (total < 60) return `${formatNumber(total, 0)} menit`;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes ? `${formatNumber(hours, 0)} jam ${formatNumber(minutes, 0)} menit` : `${formatNumber(hours, 0)} jam`;
  }

  function fitTrackerRoute(route, anchors) {
    const bounds = L.latLngBounds([]);
    route.coordinates.forEach((point) => bounds.extend(point));
    anchors.forEach((point) => { if (point) bounds.extend(point); });
    if (!bounds.isValid()) return;
    state.tracker.map.fitBounds(bounds, { padding: [46, 46], maxZoom: 17 });
  }

  function maybeRefreshTrackerRoute() {
    if (!state.tracker.destination || state.tracker.routeLoading) return;
    const position = state.tracker.myPosition;
    if (!position) return;

    if (state.tracker.routePending) {
      state.tracker.routePending = false;
      void requestTrackerRoute();
      return;
    }

    const now = Date.now();
    if (state.tracker.lastRouteAt && now - state.tracker.lastRouteAt < TRACKER_ROUTE_MIN_REFRESH_MS) return;
    if (state.tracker.lastRouteFrom) {
      const moved = trackerMetersBetween([position.lat, position.lng], state.tracker.lastRouteFrom);
      if (moved < TRACKER_ROUTE_MOVE_THRESHOLD_M) return;
    }
    void requestTrackerRoute();
  }

  function trackerMetersBetween(from, to) {
    return haversineDistance({ lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] });
  }

  function formatTrackerStepDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${formatNumber(Math.round(meters), 0)} m`;
    return `${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(meters / 1000)} km`;
  }

  /* Closest point on the polygon boundary, used as the routing endpoint. */
  function nearestPointOnPolys(point, polys) {
    const [lat, lng] = point;
    const scaleY = 111320;
    const scaleX = 111320 * Math.cos(toRadians(lat));
    const px = lng * scaleX;
    const py = lat * scaleY;
    let best = null;
    let bestDistance = Infinity;

    polys.forEach((rings) => {
      rings.forEach((ring) => {
        for (let i = 0, len = ring.length; i < len; i += 1) {
          const [ay, ax] = ring[i];
          const [by, bx] = ring[(i + 1) % len];
          const axm = ax * scaleX;
          const aym = ay * scaleY;
          const dx = (bx - ax) * scaleX;
          const dy = (by - ay) * scaleY;
          const lengthSq = dx * dx + dy * dy;
          const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - axm) * dx + (py - aym) * dy) / lengthSq));
          const cx = axm + t * dx;
          const cy = aym + t * dy;
          const distance = Math.hypot(px - cx, py - cy);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = [ay + t * (by - ay), ax + t * (bx - ax)];
          }
        }
      });
    });

    return best ? { point: [roundCoordinate(best[0]), roundCoordinate(best[1])], distance: bestDistance } : null;
  }

  /* -------------------------------------------------------------------------- */
  /* Tracker: geometry helpers                                                   */
  /* -------------------------------------------------------------------------- */

  function eachGeoRing(geo, callback) {
    if (!geo || !Array.isArray(geo.coordinates)) return;
    if (geo.type === "Polygon") geo.coordinates.forEach((ring, ringIndex) => callback(ring, 0, ringIndex));
    else if (geo.type === "MultiPolygon") {
      geo.coordinates.forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) => callback(ring, polygonIndex, ringIndex)));
    }
  }

  function openRing(ring) {
    const clean = Array.isArray(ring) ? ring.slice() : [];
    if (clean.length > 1 && positionsEqual(clean[0], clean[clean.length - 1])) clean.pop();
    return clean;
  }

  /* [[lat,lng] rings per polygon], closing duplicates and bad numbers removed. */
  function geometryPolys(geo) {
    const polys = [];
    eachGeoRing(geo, (ring, polygonIndex) => {
      const clean = openRing(ring)
        .filter((position) => Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]))
        .map(([lng, lat]) => [lat, lng]);
      if (clean.length < 3) return;
      if (!polys[polygonIndex]) polys[polygonIndex] = [];
      polys[polygonIndex].push(clean);
    });
    return polys.filter(Boolean);
  }

  function trackerMetrics(feature) {
    const geo = feature?.geometry;
    if (!geo) return null;

    let vertices = 0;
    let bestRing = null;
    let bestArea = 0;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    eachGeoRing(geo, (rawRing) => {
      const ring = openRing(rawRing).filter((position) => Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]));
      vertices += ring.length;
      ring.forEach(([lng, lat]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
      const area = Math.abs(shoelaceArea(ring));
      if (area > bestArea) {
        bestArea = area;
        bestRing = ring;
      }
    });

    if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;

    return {
      vertices,
      bounds: L.latLngBounds([minLat, minLng], [maxLat, maxLng]),
      center: bestRing && bestRing.length > 2 ? ringCentroid(bestRing) : [(minLat + maxLat) / 2, (minLng + maxLng) / 2]
    };
  }

  /* ring positions are [lng, lat] */
  function shoelaceArea(ring) {
    let sum = 0;
    for (let i = 0, len = ring.length; i < len; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % len];
      sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
  }

  function ringCentroid(ring) {
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, len = ring.length; i < len; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % len];
      const cross = x1 * y2 - x2 * y1;
      area += cross;
      x += (x1 + x2) * cross;
      y += (y1 + y2) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 1e-14) {
      const sums = ring.reduce((acc, position) => [acc[0] + position[0], acc[1] + position[1]], [0, 0]);
      return [sums[1] / ring.length, sums[0] / ring.length];
    }
    return [y / (6 * area), x / (6 * area)];
  }

  /* Even-odd rule per polygon so ring holes cancel out; OR across sub-polygons. */
  function pointInPolys(point, polys) {
    return polys.some((rings) => rings.reduce((inside, ring) => inside !== pointInRing(point, ring), false));
  }

  function pointInRing([lat, lng], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i += 1) {
      const [latI, lngI] = ring[i];
      const [latJ, lngJ] = ring[j];
      if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) inside = !inside;
    }
    return inside;
  }

  function distanceToPolys(point, polys) {
    const [lat, lng] = point;
    const scaleY = 111320;
    const scaleX = 111320 * Math.cos(toRadians(lat));
    let best = Infinity;

    polys.forEach((rings) => {
      rings.forEach((ring) => {
        for (let i = 0, len = ring.length; i < len; i += 1) {
          const [ay, ax] = ring[i];
          const [by, bx] = ring[(i + 1) % len];
          const distance = distancePointSegmentMeters(lat, lng, ax, ay, bx, by, scaleX, scaleY);
          if (distance < best) best = distance;
        }
      });
    });

    return Number.isFinite(best) ? best : null;
  }

  function distancePointSegmentMeters(py, px, ax, ay, bx, by, scaleX, scaleY) {
    const pxm = px * scaleX;
    const pym = py * scaleY;
    const axm = ax * scaleX;
    const aym = ay * scaleY;
    const bxm = bx * scaleX;
    const bym = by * scaleY;
    const dx = bxm - axm;
    const dy = bym - aym;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((pxm - axm) * dx + (pym - aym) * dy) / lengthSq));
    return Math.hypot(pxm - (axm + t * dx), pym - (aym + t * dy));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* -------------------------------------------------------------------------- */
  /* File handling and validation                                                */
  /* -------------------------------------------------------------------------- */

  function setupDropZone(zoneId, inputId, handler) {
    const zone = el(zoneId);
    const input = el(inputId);
    const browseButton = zone.querySelector(".browse-button");

    browseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      input.click();
    });
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.add("is-dragging");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove("is-dragging");
      });
    });
    zone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) handler(file);
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) handler(file);
      input.value = "";
    });
  }

  async function readAndValidateGeoJSON(file) {
    if (!file) throw new Error("Tidak ada file yang dipilih.");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`File terlalu besar (${formatBytes(file.size)}). Batas aplikasi ini adalah ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    }
    if (!/\.(geojson|json)$/i.test(file.name)) {
      throw new Error("Ekstensi file harus .geojson atau .json.");
    }

    let text;
    try {
      text = await file.text();
    } catch (_error) {
      throw new Error("File tidak dapat dibaca oleh browser.");
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`JSON tidak valid: ${error.message}`);
    }

    const errors = validateGeoJSON(data);
    if (errors.length) {
      const shown = errors.slice(0, 6);
      const remainder = errors.length > shown.length ? `\n…dan ${errors.length - shown.length} masalah lain.` : "";
      throw new Error(`GeoJSON tidak valid:\n• ${shown.join("\n• ")}${remainder}`);
    }
    return data;
  }

  function validateGeoJSON(data) {
    const errors = [];
    const add = (message) => {
      if (errors.length < 30) errors.push(message);
    };

    if (!isPlainObject(data)) {
      add("Root harus berupa object JSON.");
      return errors;
    }

    if (data.type === "FeatureCollection") {
      if (!Array.isArray(data.features)) {
        add("FeatureCollection.features harus berupa array.");
      } else {
        data.features.forEach((feature, index) => validateFeature(feature, `features[${index}]`, add));
      }
    } else if (data.type === "Feature") {
      validateFeature(data, "feature", add);
    } else {
      add('Root type harus "FeatureCollection" atau "Feature".');
    }
    return errors;
  }

  function validateFeature(feature, path, add) {
    if (!isPlainObject(feature)) {
      add(`${path} harus berupa object.`);
      return;
    }
    if (feature.type !== "Feature") add(`${path}.type harus "Feature".`);
    if (!("geometry" in feature)) {
      add(`${path}.geometry tidak ditemukan.`);
    } else if (feature.geometry !== null) {
      validateGeometry(feature.geometry, `${path}.geometry`, add);
    }
    if (!("properties" in feature)) {
      add(`${path}.properties tidak ditemukan (gunakan object atau null).`);
    } else if (feature.properties !== null && !isPlainObject(feature.properties)) {
      add(`${path}.properties harus berupa object atau null.`);
    }
  }

  function validateGeometry(geometry, path, add) {
    if (!isPlainObject(geometry)) {
      add(`${path} harus berupa object atau null.`);
      return;
    }
    const type = geometry.type;
    const supported = ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"];
    if (!supported.includes(type)) {
      add(`${path}.type “${String(type)}” tidak didukung GeoJSON.`);
      return;
    }

    if (type === "GeometryCollection") {
      if (!Array.isArray(geometry.geometries)) {
        add(`${path}.geometries harus berupa array.`);
      } else {
        geometry.geometries.forEach((item, index) => validateGeometry(item, `${path}.geometries[${index}]`, add));
      }
      return;
    }

    if (!("coordinates" in geometry)) {
      add(`${path}.coordinates tidak ditemukan.`);
      return;
    }
    const coordinates = geometry.coordinates;

    if (type === "Point") {
      validatePosition(coordinates, `${path}.coordinates`, add);
    } else if (type === "MultiPoint") {
      validatePositionArray(coordinates, `${path}.coordinates`, add, 1);
    } else if (type === "LineString") {
      validateLine(coordinates, `${path}.coordinates`, add);
    } else if (type === "MultiLineString") {
      if (!Array.isArray(coordinates) || !coordinates.length) add(`${path}.coordinates harus berisi minimal satu LineString.`);
      else coordinates.forEach((line, index) => validateLine(line, `${path}.coordinates[${index}]`, add));
    } else if (type === "Polygon") {
      validatePolygonCoordinates(coordinates, `${path}.coordinates`, add);
    } else if (type === "MultiPolygon") {
      if (!Array.isArray(coordinates) || !coordinates.length) add(`${path}.coordinates harus berisi minimal satu Polygon.`);
      else coordinates.forEach((polygon, index) => validatePolygonCoordinates(polygon, `${path}.coordinates[${index}]`, add));
    }
  }

  function validatePosition(position, path, add) {
    if (!Array.isArray(position) || position.length < 2) {
      add(`${path} harus berupa posisi [longitude, latitude].`);
      return;
    }
    if (!position.every((number) => typeof number === "number" && Number.isFinite(number))) {
      add(`${path} hanya boleh berisi angka finite.`);
      return;
    }
    if (position[0] < -180 || position[0] > 180) add(`${path}: longitude harus antara -180 dan 180.`);
    if (position[1] < -90 || position[1] > 90) add(`${path}: latitude harus antara -90 dan 90.`);
  }

  function validatePositionArray(array, path, add, minimum) {
    if (!Array.isArray(array) || array.length < minimum) {
      add(`${path} harus berisi minimal ${minimum} posisi.`);
      return;
    }
    array.forEach((position, index) => validatePosition(position, `${path}[${index}]`, add));
  }

  function validateLine(line, path, add) {
    validatePositionArray(line, path, add, 2);
  }

  function validatePolygonCoordinates(polygon, path, add) {
    if (!Array.isArray(polygon) || !polygon.length) {
      add(`${path} harus berisi minimal satu linear ring.`);
      return;
    }
    polygon.forEach((ring, ringIndex) => {
      const ringPath = `${path}[${ringIndex}]`;
      validatePositionArray(ring, ringPath, add, 4);
      if (Array.isArray(ring) && ring.length >= 2 && !positionsEqual(ring[0], ring[ring.length - 1])) {
        add(`${ringPath} belum tertutup; posisi pertama dan terakhir harus sama.`);
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Shared helpers                                                              */
  /* -------------------------------------------------------------------------- */

  function getFeatures(data) {
    if (!data) return [];
    if (data.type === "FeatureCollection") return data.features;
    if (data.type === "Feature") return [data];
    return [];
  }

  function geometryTypeCounts(features) {
    const counts = new Map();
    features.forEach((feature) => {
      const type = getGeometryLabel(feature.geometry);
      counts.set(type, (counts.get(type) || 0) + 1);
    });
    return counts;
  }

  function getGeometryLabel(geometry) {
    return geometry?.type || "Null geometry";
  }

  function getFeatureName(feature, index) {
    const properties = feature?.properties;
    if (properties && typeof properties === "object") {
      for (const key of ["nama_lahan", "name", "title", "nama", "id"]) {
        const value = properties[key];
        if (["string", "number"].includes(typeof value) && String(value).trim()) return String(value);
      }
    }
    if (feature?.id !== undefined && feature.id !== null) return `Feature ${feature.id}`;
    return `Feature ${index + 1}`;
  }

  function detectValueType(value) {
    if (value === null) return "null";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "object") return "json";
    return "string";
  }

  function serializePropertyValue(value, type) {
    if (type === "null") return "";
    if (type === "json") return JSON.stringify(value, null, 2);
    return String(value ?? "");
  }

  function strictSlug(value) {
    const slug = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "");
    return slug || "nama_lahan";
  }

  function stripJsonExtension(filename) {
    return String(filename || "").replace(/\.(geojson|json)$/i, "");
  }

  function ensureGeoJSONExtension(filename) {
    const clean = stripJsonExtension(filename)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
      .replace(/\s+/g, "_")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 180) || "hasil_geojson";
    return `${clean}.geojson`;
  }

  function downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/geo+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setInlineMessage(id, message, type = "error", hide = false) {
    const box = el(id);
    box.hidden = hide || !message;
    box.className = `inline-alert${type ? ` ${type}` : ""}`;
    if (!message) {
      box.textContent = "";
      return;
    }

    const lines = String(message).split("\n").filter(Boolean);
    if (lines.length <= 1) {
      box.textContent = message;
      return;
    }
    box.replaceChildren(document.createTextNode(lines[0]));
    const list = document.createElement("ul");
    lines.slice(1).forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line.replace(/^•\s*/, "");
      list.append(item);
    });
    box.append(list);
  }

  function showToast(title, message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", "status");
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = message;
    copy.append(strong, detail);
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Tutup notifikasi");
    close.textContent = "×";
    close.addEventListener("click", () => toast.remove());
    toast.append(copy, close);
    el("toastRegion").append(toast);
    window.setTimeout(() => toast.remove(), 5200);
  }

  function firstLine(message) {
    return String(message || "Terjadi kesalahan.").split("\n")[0];
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${formatNumber(bytes / 1024 ** index, index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatNumber(number, maximumFractionDigits = 2) {
    return new Intl.NumberFormat("id-ID", {
      maximumFractionDigits,
      minimumFractionDigits: 0
    }).format(number);
  }

  function roundCoordinate(number) {
    return Math.round(number * 1e7) / 1e7;
  }

  function positionsEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
})();
