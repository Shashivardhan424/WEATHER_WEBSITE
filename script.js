/**
 * SkyVue Weather Dashboard
 * OpenWeatherMap APIs (current, 5-day/3h forecast, air pollution).
 * Optional One Call 3.0 for alerts (requires eligible API plan).
 */

// -----------------------------------------------------------------------------
// Configuration — replace with your OpenWeather API key
// -----------------------------------------------------------------------------
const API_KEY = "37beb7757d8a14a6f07b132c68b404d2";

const API = {
  weather: "https://api.openweathermap.org/data/2.5/weather",
  forecast: "https://api.openweathermap.org/data/2.5/forecast",
  airPollution: "https://api.openweathermap.org/data/2.5/air_pollution",
  /** Alerts often require a paid One Call plan; failures are handled gracefully */
  oneCall: "https://api.openweathermap.org/data/3.0/onecall",
};

const STORAGE = {
  unit: "skyvue_unit",
  theme: "skyvue_theme",
  favorites: "skyvue_favorites",
  lastCity: "skyvue_last_city",
  cache: "skyvue_weather_cache",
};

/** @typedef {"metric" | "imperial"} UnitSystem */

let currentCoords = { lat: null, lon: null };
let currentCityQuery = "";
/** @type {UnitSystem} */
let unitSystem = "metric";

// -----------------------------------------------------------------------------
// DOM refs
// -----------------------------------------------------------------------------
const els = {
  bgLayer: document.getElementById("bgLayer"),
  cityInput: document.getElementById("cityInput"),
  searchForm: document.getElementById("searchForm"),
  loadingBar: document.getElementById("loadingBar"),
  errorToast: document.getElementById("errorToast"),
  offlineBadge: document.getElementById("offlineBadge"),
  themeToggle: document.getElementById("themeToggle"),
  unitToggle: document.getElementById("unitToggle"),
  unitLabel: document.getElementById("unitLabel"),
  voiceBtn: document.getElementById("voiceBtn"),
  voiceHint: document.getElementById("voiceHint"),
  cityName: document.getElementById("cityName"),
  countryLine: document.getElementById("countryLine"),
  weatherIcon: document.getElementById("weatherIcon"),
  tempBig: document.getElementById("tempBig"),
  conditionText: document.getElementById("conditionText"),
  feelsLike: document.getElementById("feelsLike"),
  humidity: document.getElementById("humidity"),
  windSpeed: document.getElementById("windSpeed"),
  pressure: document.getElementById("pressure"),
  visibility: document.getElementById("visibility"),
  sunrise: document.getElementById("sunrise"),
  sunset: document.getElementById("sunset"),
  aqiValue: document.getElementById("aqiValue"),
  aqiDesc: document.getElementById("aqiDesc"),
  aqiFill: document.getElementById("aqiFill"),
  alertList: document.getElementById("alertList"),
  hourlyScroll: document.getElementById("hourlyScroll"),
  dailyGrid: document.getElementById("dailyGrid"),
  favoritesChips: document.getElementById("favoritesChips"),
  saveFavoriteBtn: document.getElementById("saveFavoriteBtn"),
};

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function assertApiKey() {
  if (!API_KEY || API_KEY === "YOUR_OPENWEATHER_API_KEY") {
    showError("Add your OpenWeather API key in script.js (constant API_KEY).");
    return false;
  }
  return true;
}

/**
 * Convert OpenWeather UTC `dt` + city `timezone` shift to a Date representing city-local wall clock
 * when read with getUTC* methods.
 */
function cityWallClock(dtUtc, timezoneSeconds) {
  return new Date((dtUtc + timezoneSeconds) * 1000);
}

function formatLocalTimeFromWallClock(wallClock) {
  const h = wallClock.getUTCHours();
  const m = wallClock.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hr12 = h % 12 || 12;
  const mm = String(m).padStart(2, "0");
  return `${hr12}:${mm} ${ampm}`;
}

/**
 * @param {number} temp
 * @param {UnitSystem} unit
 */
function formatTemp(temp, unit) {
  const rounded = Math.round(temp * 10) / 10;
  const sym = unit === "metric" ? "°C" : "°F";
  return `${rounded}${sym}`;
}

function windLabel(speed, unit) {
  if (unit === "metric") return `${speed.toFixed(1)} m/s`;
  return `${speed.toFixed(1)} mph`;
}

/** OpenWeather AQI 1–5 */
const AQI_LABELS = {
  1: "Good",
  2: "Fair",
  3: "Moderate",
  4: "Poor",
  5: "Very Poor",
};

function setLoading(on) {
  document.body.classList.toggle("is-loading", on);
  if (els.loadingBar) els.loadingBar.hidden = !on;
  const mainEl = document.querySelector("main");
  if (mainEl) mainEl.setAttribute("aria-busy", on ? "true" : "false");
}

let toastTimer;
function showError(message, duration = 4500) {
  els.errorToast.textContent = message;
  els.errorToast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.errorToast.hidden = true;
  }, duration);
}

function setOnlineBadge(offline) {
  els.offlineBadge.hidden = !offline;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE.theme, theme);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

function applyUnit(u) {
  unitSystem = u;
  localStorage.setItem(STORAGE.unit, u);
  els.unitLabel.textContent = u === "metric" ? "°C" : "°F";
}

function toggleUnit() {
  applyUnit(unitSystem === "metric" ? "imperial" : "metric");
  if (currentCoords.lat != null) {
    refreshWeather();
  } else if (currentCityQuery) {
    loadCityWeather(currentCityQuery);
  }
}

// -----------------------------------------------------------------------------
// Background + weather-driven UI class on body
// -----------------------------------------------------------------------------

function applyWeatherBackground(current) {
  const body = document.body;
  body.className = body.className.replace(/\bweather-bg-\S+/g, "").trim();

  const icon = current.weather?.[0]?.icon || "01d";
  const isNight = icon.endsWith("n");
  const main = (current.weather?.[0]?.main || "Clear").toLowerCase();

  let variant = "clear-day";
  if (main.includes("thunder")) variant = "thunder";
  else if (main.includes("rain") || main.includes("drizzle")) variant = "rain";
  else if (main.includes("snow")) variant = "snow";
  else if (main.includes("mist") || main.includes("fog") || main.includes("haze")) variant = "fog";
  else if (main.includes("cloud")) variant = "cloudy";
  else if (main.includes("clear")) variant = isNight ? "clear-night" : "clear-day";
  else variant = "cloudy";

  body.classList.add(`weather-bg-${variant}`);
}

// -----------------------------------------------------------------------------
// Favorites
// -----------------------------------------------------------------------------

function getFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE.favorites);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites(list) {
  localStorage.setItem(STORAGE.favorites, JSON.stringify(list));
}

function renderFavorites() {
  const list = getFavorites();
  els.favoritesChips.innerHTML = "";
  list.forEach((city) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.city = city;

    const label = document.createElement("span");
    label.textContent = city;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.setAttribute("aria-label", `Remove ${city}`);
    remove.textContent = "×";

    chip.append(label, remove);
    els.favoritesChips.appendChild(chip);

    chip.addEventListener("click", (e) => {
      if (e.target === remove) return;
      els.cityInput.value = city;
      loadCityWeather(city);
    });

    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = getFavorites().filter((c) => c !== city);
      saveFavorites(next);
      renderFavorites();
    });
  });
}

// -----------------------------------------------------------------------------
// Cache (offline / last good state)
// -----------------------------------------------------------------------------

function saveCache(payload) {
  try {
    localStorage.setItem(STORAGE.cache, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE.cache);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function renderFromCache(cache) {
  if (!cache?.current || !cache?.forecast) return false;
  currentCoords = { lat: cache.current.coord.lat, lon: cache.current.coord.lon };
  currentCityQuery = cache.query || "";
  renderCurrentWeather(cache.current);
  renderForecastSections(cache.forecast, cache.current.timezone);
  if (cache.air) renderAirQuality(cache.air);
  renderAlerts(cache.alerts || []);
  applyWeatherBackground(cache.current);
  setOnlineBadge(!navigator.onLine);
  return true;
}

// -----------------------------------------------------------------------------
// API calls
// -----------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || res.statusText || "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchAirPollution(lat, lon) {
  const q = `lat=${lat}&lon=${lon}&appid=${API_KEY}`;
  return fetchJson(`${API.airPollution}?${q}`);
}

/** Try One Call 3.0 for alerts; silently skip if plan does not include it */
async function fetchAlertsOptional(lat, lon) {
  const exclude = "minutely,hourly,daily";
  const url = `${API.oneCall}?lat=${lat}&lon=${lon}&exclude=${exclude}&appid=${API_KEY}`;
  try {
    const data = await fetchJson(url);
    return Array.isArray(data.alerts) ? data.alerts : [];
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) return [];
    return [];
  }
}

async function fetchWeatherByCoords(lat, lon) {
  const u = unitSystem;
  const q = `lat=${lat}&lon=${lon}&units=${u}&appid=${API_KEY}`;
  const current = await fetchJson(`${API.weather}?${q}`);
  const forecast = await fetchJson(`${API.forecast}?${q}`);
  const air = await fetchAirPollution(lat, lon).catch(() => null);
  const alerts = await fetchAlertsOptional(lat, lon);
  return { current, forecast, air, alerts, query: `${current.name}` };
}

async function fetchWeatherByCity(city) {
  const u = unitSystem;
  const qCity = encodeURIComponent(city.trim());
  const q = `q=${qCity}&units=${u}&appid=${API_KEY}`;
  const current = await fetchJson(`${API.weather}?${q}`);
  const { lat, lon } = current.coord;
  const forecast = await fetchJson(`${API.forecast}?lat=${lat}&lon=${lon}&units=${u}&appid=${API_KEY}`);
  const air = await fetchAirPollution(lat, lon).catch(() => null);
  const alerts = await fetchAlertsOptional(lat, lon);
  return { current, forecast, air, alerts, query: city.trim() };
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function renderCurrentWeather(data) {
  const w = data.weather?.[0];
  const iconCode = w?.icon || "01d";
  els.cityName.textContent = data.name || "—";
  els.countryLine.textContent = data.sys?.country ? `${data.sys.country}` : "";
  els.weatherIcon.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  els.weatherIcon.alt = w?.description || "Weather";

  els.tempBig.textContent = formatTemp(data.main.temp, unitSystem);
  els.conditionText.textContent = w?.description || "—";
  els.feelsLike.textContent = formatTemp(data.main.feels_like, unitSystem);

  els.humidity.textContent = `${data.main.humidity ?? "—"}%`;
  els.windSpeed.textContent = windLabel(data.wind?.speed ?? 0, unitSystem);
  els.pressure.textContent = data.main.pressure != null ? `${data.main.pressure} hPa` : "—";

  const vis = data.visibility;
  els.visibility.textContent =
    vis != null ? (unitSystem === "metric" ? `${(vis / 1000).toFixed(1)} km` : `${(vis / 1609).toFixed(1)} mi`) : "—";

  const tz = data.timezone ?? 0;
  const sr = cityWallClock(data.sys.sunrise, tz);
  const ss = cityWallClock(data.sys.sunset, tz);
  els.sunrise.textContent = formatLocalTimeFromWallClock(sr);
  els.sunset.textContent = formatLocalTimeFromWallClock(ss);
}

function renderAirQuality(airData) {
  if (!airData?.list?.[0]) {
    els.aqiValue.textContent = "—";
    els.aqiDesc.textContent = "Unavailable";
    els.aqiFill.style.width = "0%";
    return;
  }
  const aqi = airData.list[0].main.aqi;
  els.aqiValue.textContent = String(aqi);
  els.aqiDesc.textContent = AQI_LABELS[aqi] || "Unknown";
  const pct = ((aqi - 1) / 4) * 100;
  els.aqiFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function renderAlerts(alerts) {
  els.alertList.innerHTML = "";
  if (!alerts.length) {
    const p = document.createElement("p");
    p.className = "alert-empty";
    p.textContent =
      "No severe weather alerts in the feed for this location. (Full alert data may require an eligible OpenWeather plan.)";
    els.alertList.appendChild(p);
    return;
  }
  alerts.forEach((a) => {
    const li = document.createElement("li");
    const tag = document.createElement("div");
    tag.className = "alert-tag";
    tag.textContent = a.event || a.sender_name || "Alert";
    const body = document.createElement("div");
    body.textContent = a.description || a.tags?.join(", ") || JSON.stringify(a).slice(0, 200);
    li.append(tag, body);
    els.alertList.appendChild(li);
  });
}

/**
 * Build daily aggregates from 3-hour forecast list (max 5 days on free API).
 */
function aggregateDaily(forecastList, timezoneSeconds) {
  /** @type {Map<string, { min: number, max: number, icon: string, sample: object }>} */
  const byDay = new Map();

  for (const item of forecastList) {
    const wall = cityWallClock(item.dt, timezoneSeconds);
    const y = wall.getUTCFullYear();
    const mo = wall.getUTCMonth();
    const d = wall.getUTCDate();
    const key = `${y}-${mo}-${d}`;

    const temp = item.main.temp;
    const icon = item.weather?.[0]?.icon || "02d";
    if (!byDay.has(key)) {
      byDay.set(key, { min: temp, max: temp, icon, sample: item });
    } else {
      const entry = byDay.get(key);
      entry.min = Math.min(entry.min, temp);
      entry.max = Math.max(entry.max, temp);
      // Prefer daytime icon for display (icon ending with 'd')
      if (icon.endsWith("d")) entry.icon = icon;
    }
  }

  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v)
    .slice(0, 5);
}

function renderHourly(forecastList, timezoneSeconds) {
  els.hourlyScroll.innerHTML = "";
  const now = Date.now() / 1000;
  const horizon = now + 24 * 3600;
  const slice = forecastList.filter((x) => x.dt >= now && x.dt <= horizon);

  // If filter removes everything (clock skew), take first 8 items (~24h at 3h steps)
  const items = slice.length ? slice : forecastList.slice(0, 8);

  items.forEach((item) => {
    const wall = cityWallClock(item.dt, timezoneSeconds);
    const slot = document.createElement("div");
    slot.className = "hour-slot";
    const timeEl = document.createElement("time");
    const dayPart = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wall.getUTCDay()];
    timeEl.textContent = `${dayPart} ${formatLocalTimeFromWallClock(wall)}`;

    const img = document.createElement("img");
    const ic = item.weather?.[0]?.icon || "01d";
    img.src = `https://openweathermap.org/img/wn/${ic}.png`;
    img.alt = item.weather?.[0]?.description || "";

    const temp = document.createElement("div");
    temp.className = "hour-temp";
    temp.textContent = formatTemp(item.main.temp, unitSystem);

    slot.append(timeEl, img, temp);
    els.hourlyScroll.appendChild(slot);
  });
}

function renderForecastSections(forecast, timezoneSeconds) {
  const list = forecast.list || [];
  const daily = aggregateDaily(list, timezoneSeconds);
  renderDailyForecast(daily, timezoneSeconds);
  renderHourly(list, timezoneSeconds);
}

function renderDailyForecast(daily, timezoneSeconds) {
  els.dailyGrid.innerHTML = "";
  daily.forEach((day, i) => {
    const wall = cityWallClock(day.sample.dt, timezoneSeconds);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wall.getUTCDay()];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[wall.getUTCMonth()];

    const card = document.createElement("div");
    card.className = "day-card";
    card.style.animationDelay = `${i * 0.05}s`;

    const name = document.createElement("div");
    name.className = "day-name";
    name.textContent = i === 0 ? "Today" : weekday;

    const dateStr = document.createElement("div");
    dateStr.className = "day-date";
    dateStr.textContent = `${month} ${wall.getUTCDate()}`;

    const img = document.createElement("img");
    img.src = `https://openweathermap.org/img/wn/${day.icon}@2x.png`;
    img.alt = "";

    const temps = document.createElement("div");
    temps.className = "day-temps";
    temps.innerHTML = `<span class="hi">${formatTemp(day.max, unitSystem)}</span> / <span class="lo">${formatTemp(
      day.min,
      unitSystem
    )}</span>`;

    card.append(name, dateStr, img, temps);
    els.dailyGrid.appendChild(card);
  });
}

function handleSuccessfulPayload(payload) {
  const { current, forecast, air, alerts, query } = payload;
  currentCoords = { lat: current.coord.lat, lon: current.coord.lon };
  currentCityQuery = query;
  localStorage.setItem(STORAGE.lastCity, query);

  renderCurrentWeather(current);
  renderForecastSections(forecast, current.timezone);
  renderAirQuality(air);
  renderAlerts(alerts);
  applyWeatherBackground(current);

  saveCache({
    query,
    current,
    forecast,
    air,
    alerts,
    savedAt: Date.now(),
  });

  els.cityInput.value = query;
  setOnlineBadge(false);
}

async function refreshWeather() {
  if (currentCoords.lat == null) return;
  if (!assertApiKey()) return;
  setLoading(true);
  try {
    const payload = await fetchWeatherByCoords(currentCoords.lat, currentCoords.lon);
    handleSuccessfulPayload(payload);
  } catch (e) {
    handleFetchError(e);
  } finally {
    setLoading(false);
  }
}

async function loadCityWeather(city) {
  if (!city?.trim()) {
    showError("Please enter a city name.");
    return;
  }
  if (!assertApiKey()) return;
  setLoading(true);
  try {
    const payload = await fetchWeatherByCity(city);
    handleSuccessfulPayload(payload);
  } catch (e) {
    handleFetchError(e);
  } finally {
    setLoading(false);
  }
}

function handleFetchError(err) {
  const offline = !navigator.onLine;
  if (offline) {
    const cache = loadCache();
    if (cache && renderFromCache(cache)) {
      showError("You are offline. Showing the last successful update.", 5000);
      return;
    }
    showError("No internet connection and no cached weather to display.");
    return;
  }

  const raw = (err && err.message) || "Could not load weather.";
  let friendly = raw;
  if (/not found|404|city/i.test(raw)) {
    friendly = "City not found. Check spelling or try another name.";
  } else if (err.status === 401) {
    friendly = "Invalid API key. Update API_KEY in script.js.";
  }

  const cache = loadCache();
  if (cache && renderFromCache(cache)) {
    showError(`${friendly} Showing cached data.`, 6500);
  } else {
    showError(friendly);
  }
}

// -----------------------------------------------------------------------------
// Voice search (Web Speech API)
// -----------------------------------------------------------------------------

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.voiceBtn.disabled = true;
    els.voiceBtn.title = "Voice search not supported in this browser";
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  els.voiceBtn.addEventListener("click", () => {
    try {
      els.voiceHint.hidden = false;
      rec.start();
    } catch {
      els.voiceHint.hidden = true;
      showError("Could not start voice recognition.");
    }
  });

  rec.addEventListener("end", () => {
    els.voiceHint.hidden = true;
  });

  rec.addEventListener("result", (ev) => {
    const text = ev.results[0][0].transcript.trim();
    if (text) {
      els.cityInput.value = text;
      loadCityWeather(text);
    }
  });

  rec.addEventListener("error", () => {
    els.voiceHint.hidden = true;
    showError("Voice recognition failed. Try again or type the city.");
  });
}

// -----------------------------------------------------------------------------
// Geolocation bootstrap
// -----------------------------------------------------------------------------

function tryGeolocation() {
  if (!navigator.geolocation) {
    const last = localStorage.getItem(STORAGE.lastCity);
    if (last) loadCityWeather(last);
    else showError("Geolocation unavailable. Search for a city above.");
    return;
  }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      currentCoords = { lat: latitude, lon: longitude };
      if (!assertApiKey()) {
        setLoading(false);
        return;
      }
      try {
        const payload = await fetchWeatherByCoords(latitude, longitude);
        handleSuccessfulPayload(payload);
      } catch (e) {
        handleFetchError(e);
        const last = localStorage.getItem(STORAGE.lastCity);
        if (last) await loadCityWeather(last);
      } finally {
        setLoading(false);
      }
    },
    async () => {
      const last = localStorage.getItem(STORAGE.lastCity);
      if (last) {
        try {
          await loadCityWeather(last);
        } catch {
          showError("Location denied. Search for a city or enable location access.");
        }
      } else {
        showError("Location access denied. Search for a city to see weather.");
      }
      setLoading(false);
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
  );
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

function initStorageThemeUnit() {
  const savedTheme = localStorage.getItem(STORAGE.theme);
  applyTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light");

  const savedUnit = localStorage.getItem(STORAGE.unit);
  applyUnit(savedUnit === "imperial" ? "imperial" : "metric");
}

function bindEvents() {
  els.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loadCityWeather(els.cityInput.value);
  });

  els.themeToggle.addEventListener("click", toggleTheme);
  els.unitToggle.addEventListener("click", toggleUnit);

  els.saveFavoriteBtn.addEventListener("click", () => {
    const name = (currentCityQuery || els.cityInput.value || "").trim();
    if (!name) {
      showError("No city to save. Search for a location first.");
      return;
    }
    const list = getFavorites();
    if (list.includes(name)) {
      showError(`${name} is already in favorites.`);
      return;
    }
    list.push(name);
    saveFavorites(list);
    renderFavorites();
  });

  window.addEventListener("online", () => setOnlineBadge(false));
  window.addEventListener("offline", () => {
    setOnlineBadge(true);
    showError("You are offline. Cached data may be shown when you request weather.");
  });
}

function init() {
  initStorageThemeUnit();
  bindEvents();
  setupVoice();
  renderFavorites();

  if (!assertApiKey()) {
    const cache = loadCache();
    if (cache) renderFromCache(cache);
    return;
  }

  // Offline-first paint
  if (!navigator.onLine) {
    const cache = loadCache();
    if (cache && renderFromCache(cache)) {
      setOnlineBadge(true);
      return;
    }
  }

  tryGeolocation();
}

init();
