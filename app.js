(() => {
  "use strict";

  const DEFAULT_CENTER = [3.5952, 98.6722];
  const DEFAULT_ZOOM = 13;
  const EARTH_RADIUS = 6371008.8;
  const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

  let deferredInstallPrompt = null;

  const state = {
    activeTab: "maker",
    maker: {
      points: [],
      map: null,
      layerGroup: null,
      bsreLayer: null,
      bsreLoading: false,
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
      bsreVisible: false
    },
    renamer: {
      data: null,
      file: null
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
    if (["maker", "reader", "renamer"].includes(requestedTab)) {
      switchTab(requestedTab, false);
    }
  }

  function switchTab(tabName, updateHistory = true) {
    if (!["maker", "reader", "renamer"].includes(tabName)) return;
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
  }

  /* -------------------------------------------------------------------------- */
  /* Maps                                                                        */
  /* -------------------------------------------------------------------------- */

  function initMaps() {
    state.maker.map = createMap("makerMap");
    const bsrePane = state.maker.map.createPane("bsrePane");
    bsrePane.style.zIndex = "350";
    bsrePane.style.pointerEvents = "none";
    state.maker.layerGroup = L.featureGroup().addTo(state.maker.map);
    state.reader.map = createMap("readerMap");
    const readerBsrePane = state.reader.map.createPane("readerBsrePane");
    readerBsrePane.style.zIndex = "390";
    readerBsrePane.style.pointerEvents = "none";
  }

  function createMap(elementId) {
    const map = L.map(elementId, {
      zoomControl: true,
      preferCanvas: true
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    map.attributionControl.setPrefix(false);
    L.control.scale({ imperial: false, maxWidth: 120, position: "bottomleft" }).addTo(map);
    return map;
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
    el("takePointBtn").addEventListener("click", takeGpsPoint);
    el("loadBsreBtn").addEventListener("click", loadBsreLayer);
    el("resetMakerBtn").addEventListener("click", resetMaker);
    el("downloadMakerBtn").addEventListener("click", downloadMakerGeoJSON);

    el("pointTableBody").addEventListener("click", (event) => {
      const button = event.target.closest(".delete-point");
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;
      state.maker.points.splice(index, 1);
      renderMaker(true);
      showToast("Titik dihapus", `Titik ${index + 1} telah dikeluarkan dari polygon.`, "warning");
    });

    updateMakerAvailability();
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

  function takeGpsPoint() {
    if (state.maker.isLocating) return;

    if (!("geolocation" in navigator)) {
      setGpsStatus("error", "Geolocation tidak tersedia", "Browser ini tidak mendukung Location API.");
      showToast("GPS tidak tersedia", "Gunakan browser modern dengan dukungan geolocation.", "error");
      return;
    }

    state.maker.isLocating = true;
    el("takePointBtn").disabled = true;
    setGpsStatus("loading", "Mencari posisi akurat…", "Tetap diam beberapa detik di titik pengukuran.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
          accuracy: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy * 10) / 10
            : null,
          capturedAt: new Date().toISOString()
        };

        state.maker.points.push(point);
        state.maker.isLocating = false;
        setGpsStatus(
          "success",
          `Titik ${state.maker.points.length} berhasil direkam`,
          point.accuracy !== null
            ? `Akurasi perangkat ±${formatNumber(point.accuracy, 1)} m.`
            : "Akurasi perangkat tidak tersedia."
        );
        renderMaker(true);
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
        row.innerHTML = `
          <td><span class="point-number">${index + 1}</span></td>
          <td>${point.lat.toFixed(7)}</td>
          <td>${point.lng.toFixed(7)}</td>
          <td>${point.accuracy === null ? "—" : `±${formatNumber(point.accuracy, 1)} m`}</td>
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
    const filename = `${strictSlug(name || "nama_lahan")}.geojson`;
    const bsreSuffix = state.maker.bsreLayer ? " · BSRE aktif" : "";

    el("makerFileHint").textContent = filename;
    el("pointCount").textContent = String(pointCount);
    el("pointCountBadge").textContent = String(pointCount);
    el("areaM2").textContent = polygonReady ? formatNumber(area, area < 100 ? 2 : 0) : "—";
    el("areaHa").textContent = polygonReady ? formatNumber(area / 10000, 4) : "—";
    el("perimeter").textContent = polygonReady ? formatNumber(perimeter, 1) : "—";
    el("resetMakerBtn").disabled = pointCount === 0 || state.maker.isLocating;
    el("takePointBtn").disabled = state.maker.isLocating;
    el("downloadMakerBtn").disabled = !polygonReady || !name || !owner || state.maker.isLocating;

    const message = el("makerMessage");
    message.className = "inline-alert inline-alert-info";
    if (pointCount === 0) {
      message.textContent = "Minimal 3 titik diperlukan untuk membentuk polygon.";
    } else if (pointCount < 3) {
      message.textContent = `${3 - pointCount} titik lagi diperlukan. Garis saat ini masih berupa preview terbuka.`;
    } else if (!name || !owner) {
      message.textContent = `Polygon siap — lengkapi ${!name && !owner ? "Nama Lahan dan Nama Pemilik" : !name ? "Nama Lahan" : "Nama Pemilik"} untuk mengaktifkan download.`;
    } else {
      message.className = "inline-alert success";
      message.textContent = `Polygon siap — ${pointCount} titik, luas ${formatNumber(area, 2)} m² (${formatNumber(area / 10000, 4)} ha).`;
    }

    el("makerMapCaption").textContent = polygonReady
      ? `Polygon tertutup otomatis · ${pointCount} titik · ${formatNumber(area / 10000, 4)} ha${bsreSuffix}`
      : pointCount
        ? `Preview garis aktif · ${pointCount} dari minimal 3 titik${bsreSuffix}`
        : state.maker.bsreLayer
          ? "Polygon BSRE aktif · warna sky blue"
          : "Ambil titik pertama untuk mulai menggambar batas.";
  }

  function resetMaker() {
    if (state.maker.points.length && !window.confirm("Hapus seluruh titik yang sudah direkam?")) return;
    state.maker.points = [];
    setGpsStatus("", "Siap mengambil lokasi", "Aktifkan izin lokasi pada browser Anda.");
    renderMaker(false);
    if (state.maker.bsreLayer) {
      fitLeafletLayer(state.maker.map, state.maker.bsreLayer, 17);
    } else {
      state.maker.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
    showToast(
      "Maker direset",
      state.maker.bsreLayer
        ? "Seluruh titik GPS telah dihapus; layer BSRE tetap ditampilkan."
        : "Seluruh titik GPS telah dihapus.",
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
            luas_m2: Number(area.toFixed(2)),
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
      if (state.reader.dirty && !window.confirm("Perubahan properties belum disimpan. Tetap ganti file?")) return;
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

    if (state.reader.dirty && !window.confirm("Perubahan pada feature ini belum disimpan. Buang perubahan dan pindah feature?")) {
      return;
    }

    state.reader.selectedIndex = index;
    state.reader.dirty = false;
    renderFeatureList();
    renderReaderSelection(true);
    renderPropertyEditor();
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

  function downloadReaderGeoJSON() {
    if (!state.reader.data) return;
    if (state.reader.dirty) {
      setInlineMessage("readerEditorMessage", "Simpan perubahan properties sebelum mengunduh file.", "error", false);
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
