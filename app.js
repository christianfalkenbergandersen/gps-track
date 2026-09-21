let db;
let watchId = null;
let tracking = false;
let currentTrack = [];
let currentDistance = 0;
let startTime = null;
let lastPointTime = null;
let timerId = null;
let positionMarker = null;
let trackLine = null;

const $ = id => document.getElementById(id);

const map = L.map("map", { zoomControl: false }).setView([56, -106], 4);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

trackLine = L.polyline([], { color: "#1976d2", weight: 5 }).addTo(map);

const dbRequest = indexedDB.open("GPSTrackerDB", 2);

dbRequest.onupgradeneeded = event => {
  const database = event.target.result;
  if (!database.objectStoreNames.contains("tracks")) {
    database.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
  }
  if (!database.objectStoreNames.contains("active")) {
    database.createObjectStore("active", { keyPath: "id" });
  }
};

dbRequest.onsuccess = event => {
  db = event.target.result;
  loadTracks();
  recoverActiveTrack();
};

dbRequest.onerror = () => setStatus("Database error", false);

function setStatus(text, recording = false) {
  $("statusText").textContent = text.toUpperCase();
  $("statusPill").className = "status-pill " + (recording ? "recording" : "stopped");
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v, i) => i === 0 ? String(v).padStart(2, "0") : String(v).padStart(2, "0")).join(":");
}

function haversine(a, b) {
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function saveActive() {
  if (!db) return;
  const tx = db.transaction("active", "readwrite");
  tx.objectStore("active").put({
    id: "current",
    startedAt: startTime,
    distance: currentDistance,
    points: currentTrack
  });
}

function clearActive() {
  if (!db) return;
  db.transaction("active", "readwrite").objectStore("active").delete("current");
}

function recoverActiveTrack() {
  if (!db) return;
  const tx = db.transaction("active", "readonly");
  tx.objectStore("active").get("current").onsuccess = e => {
    const saved = e.target.result;
    if (!saved || !saved.points || saved.points.length < 2) return;

    const resume = confirm(
      `An unfinished track was found (${formatDistance(saved.distance)}). Resume it?`
    );

    if (resume) {
      currentTrack = saved.points;
      currentDistance = saved.distance;
      startTime = saved.startedAt;
      lastPointTime = currentTrack.at(-1).time;
      drawCurrentTrack();
      updateStats(currentTrack.at(-1));
      setStatus("Recovered — press START to continue", false);
    } else {
      clearActive();
    }
  };
}

function drawCurrentTrack() {
  const coords = currentTrack.map(p => [p.lat, p.lon]);
  trackLine.setLatLngs(coords);
  if (coords.length) map.fitBounds(trackLine.getBounds(), { padding: [25, 25] });
}

function updateStats(point) {
  $("distance").textContent = formatDistance(currentDistance);
  $("points").textContent = currentTrack.length;
  $("accuracy").textContent = point?.accuracy != null ? `±${Math.round(point.accuracy)} m` : "—";
  $("speed").textContent =
    point?.speed != null && point.speed >= 0
      ? `${(point.speed * 3.6).toFixed(1)} km/h`
      : "—";
}

function updateTimer() {
  if (startTime != null) $("elapsed").textContent = formatElapsed(Date.now() - startTime);
}

$("startButton").addEventListener("click", startTracking);
$("stopButton").addEventListener("click", stopTracking);

function startTracking() {
  if (!navigator.geolocation) {
    alert("GPS is not available in this browser.");
    return;
  }

  // If a recovered track exists, continue it; otherwise start fresh.
  if (currentTrack.length === 0) {
    currentDistance = 0;
    startTime = Date.now();
    lastPointTime = null;
    trackLine.setLatLngs([]);
    if (positionMarker) {
      map.removeLayer(positionMarker);
      positionMarker = null;
    }
  } else if (startTime == null) {
    startTime = Date.now();
  }

  tracking = true;
  $("startButton").disabled = true;
  $("stopButton").disabled = false;
  setStatus("Tracking", true);

  clearInterval(timerId);
  timerId = setInterval(updateTimer, 1000);
  updateTimer();

  watchId = navigator.geolocation.watchPosition(
    receivePosition,
    gpsError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

function receivePosition(position) {
  if (!tracking) return;

  const p = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    speed: position.coords.speed,
    time: position.timestamp
  };

  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
  if (p.accuracy > 75) {
    updateStats(p);
    return;
  }

  if (currentTrack.length) {
    const previous = currentTrack.at(-1);
    const d = haversine(previous, p);
    const dt = Math.max(0.001, (p.time - previous.time) / 1000);

    // Reject obvious GPS jumps. A fast real-world move is still allowed.
    if (d > 1000 && dt < 20) return;

    // Suppress very small GPS jitter while stopped.
    if (d >= 3 || dt >= 10) currentDistance += d;
  }

  currentTrack.push(p);
  lastPointTime = p.time;

  if (!positionMarker) {
    positionMarker = L.circleMarker([p.lat, p.lon], {
      radius: 8, weight: 3, color: "#fff", fillColor: "#1976d2", fillOpacity: 1
    }).addTo(map);
  } else {
    positionMarker.setLatLng([p.lat, p.lon]);
  }

  trackLine.addLatLng([p.lat, p.lon]);
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15), { animate: false });

  updateStats(p);
  saveActive();
}

function gpsError(error) {
  const messages = {
    1: "Location permission denied",
    2: "Location unavailable",
    3: "GPS timeout"
  };
  setStatus(messages[error.code] || "GPS error", false);
}

function stopTracking() {
  if (!tracking) return;

  tracking = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(timerId);
  timerId = null;

  $("startButton").disabled = false;
  $("stopButton").disabled = true;
  setStatus("Stopped", false);

  if (currentTrack.length > 1) {
    const finished = {
      date: new Date().toISOString(),
      startedAt: startTime,
      endedAt: Date.now(),
      distance: currentDistance,
      points: currentTrack
    };

    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").add(finished);
    tx.oncomplete = () => {
      clearActive();
      loadTracks();
    };
  } else {
    clearActive();
  }
}

function loadTracks() {
  if (!db) return;

  const tx = db.transaction("tracks", "readonly");
  tx.objectStore("tracks").getAll().onsuccess = e => {
    const tracks = e.target.result.sort((a, b) => b.date.localeCompare(a.date));
    const list = $("trackList");
    list.innerHTML = "";

    if (!tracks.length) {
      list.textContent = "No saved tracks";
      return;
    }

    for (const track of tracks) {
      const card = document.createElement("div");
      card.className = "track-card";

      const date = new Date(track.date).toLocaleString();
      card.innerHTML = `
        <div class="date">${date}</div>
        <div class="meta">${formatDistance(track.distance)} · ${track.points.length} GPS points</div>
        <div class="track-actions">
          <button data-view>VIEW</button>
          <button data-delete>DELETE</button>
        </div>
      `;

      card.querySelector("[data-view]").onclick = () => showTrack(track);
      card.querySelector("[data-delete]").onclick = () => deleteTrack(track.id);
      list.appendChild(card);
    }
  };
}

function showTrack(track) {
  tracking = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(timerId);
  timerId = null;

  $("startButton").disabled = false;
  $("stopButton").disabled = true;
  setStatus("Viewing saved track", false);

  currentTrack = track.points;
  currentDistance = track.distance;
  startTime = track.startedAt;

  trackLine.setLatLngs(currentTrack.map(p => [p.lat, p.lon]));
  if (positionMarker) {
    map.removeLayer(positionMarker);
    positionMarker = null;
  }

  if (currentTrack.length) {
    const last = currentTrack.at(-1);
    positionMarker = L.circleMarker([last.lat, last.lon], {
      radius: 8, weight: 3, color: "#fff", fillColor: "#1976d2", fillOpacity: 1
    }).addTo(map);
    map.fitBounds(trackLine.getBounds(), { padding: [25, 25] });
    updateStats(last);
  }

  $("elapsed").textContent = formatElapsed((track.endedAt || Date.now()) - track.startedAt);
}

function deleteTrack(id) {
  if (!confirm("Delete this track?")) return;
  db.transaction("tracks", "readwrite").objectStore("tracks").delete(id).onsuccess = loadTracks;
}

$("clearAllButton").onclick = () => {
  if (!confirm("Delete all saved tracks?")) return;
  db.transaction("tracks", "readwrite").objectStore("tracks").clear().onsuccess = loadTracks;
};

function updateOnlineState() {
  $("offlineNotice").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);
updateOnlineState();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}