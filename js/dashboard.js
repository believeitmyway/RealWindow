// Dashboard State
const DASH_STATE = {
    weather: {
        lat: 35.6895, // Default Tokyo
        lon: 139.6917,
        current: null,
        forecast: null,
        lastFetch: 0
    },
    calendar: {
        events: [],
        view: 'today', // today, 3day, week
        clientId: '',
        apiKey: '',
        tokenClient: null,
        accessToken: null,
        isAuthenticated: false
    },
    settings: {
        forecastDays: 1
    }
};

// Open-Meteo WMO Code Mapping (Simple Emoji/Icon mapping)
// 0: Clear, 1-3: Cloudy, 45,48: Fog, 51-55: Drizzle, 61-65: Rain, 71-77: Snow, 95-99: Thunderstorm
function getWeatherIcon(code) {
    if (code === 0) return '☀️'; // Clear
    if (code >= 1 && code <= 3) return '☁️'; // Clouds
    if (code >= 45 && code <= 48) return '🌫️'; // Fog
    if (code >= 51 && code <= 67) return '🌧️'; // Rain
    if (code >= 71 && code <= 77) return '❄️'; // Snow
    if (code >= 80 && code <= 82) return '🌦️'; // Showers
    if (code >= 95) return '⚡'; // Thunder
    return '❓';
}

// --- Initialization ---
function initDashboard() {
    console.log("Initializing Dashboard...");
    loadDashboardSettings();

    // UI Event Listeners
    document.getElementById('btn-dashboard-toggle').addEventListener('click', toggleDashboard);
    document.getElementById('dashboard-overlay').addEventListener('click', (e) => {
        // Close if clicking outside content
        if (e.target.id === 'dashboard-overlay') toggleDashboard();
    });

    // Settings
    document.getElementById('dashboard-settings-btn').addEventListener('click', openDashSettings);
    document.getElementById('btn-close-dash-settings').addEventListener('click', closeDashSettings);
    document.getElementById('btn-save-dash-settings').addEventListener('click', saveDashSettings);

    // Schedule Tabs
    document.querySelectorAll('.schedule-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchScheduleView(e.target.dataset.view);
        });
    });

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Initial Data Fetch
    fetchWeather();

    // Attempt to init GAPI and GIS if keys exist
    if (DASH_STATE.calendar.apiKey && DASH_STATE.calendar.clientId) {
        // We rely on scripts loading. If loaded, init.
        if (typeof gapi !== 'undefined') gapiLoaded();
        if (typeof google !== 'undefined') gisLoaded();
    }
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });

    document.querySelector('#card-time .time-display').textContent = timeStr;
    document.querySelector('#card-time .date-display').textContent = dateStr;
}

// --- Dashboard Toggle ---
function toggleDashboard() {
    const overlay = document.getElementById('dashboard-overlay');
    overlay.classList.toggle('visible');

    // Refresh data if opening
    if (overlay.classList.contains('visible')) {
        updateClock();
        fetchWeather(); // Will check cache
        if (DASH_STATE.calendar.isAuthenticated) {
            listUpcomingEvents();
        }
    }
}

// --- Weather Logic ---
async function fetchWeather() {
    const now = Date.now();
    // Cache for 10 minutes
    if (now - DASH_STATE.weather.lastFetch < 600000 && DASH_STATE.weather.current) {
        renderWeather();
        return;
    }

    const { lat, lon } = DASH_STATE.weather;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode&timezone=auto&forecast_days=1`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        DASH_STATE.weather.current = data.current_weather;
        DASH_STATE.weather.forecast = data.hourly;
        DASH_STATE.weather.lastFetch = now;

        renderWeather();
    } catch (e) {
        console.error("Weather fetch failed", e);
    }
}

function renderWeather() {
    if (!DASH_STATE.weather.current) return;

    // Current
    const cur = DASH_STATE.weather.current;
    document.querySelector('#card-weather .weather-icon').textContent = getWeatherIcon(cur.weathercode);
    document.querySelector('#card-weather .temp-main').textContent = `${Math.round(cur.temperature)}°`;

    // Min/Max (Estimate from forecast or just show current)
    if (DASH_STATE.weather.forecast) {
        const temps = DASH_STATE.weather.forecast.temperature_2m.slice(0, 24);
        const min = Math.min(...temps);
        const max = Math.max(...temps);
        document.querySelector('#card-weather .temp-range').textContent = `${Math.round(max)}° / ${Math.round(min)}°`;
    }

    // Hourly Forecast (Next 12 hours)
    const forecastContainer = document.querySelector('.forecast-container');
    forecastContainer.innerHTML = '';

    const hourly = DASH_STATE.weather.forecast;
    const currentHour = new Date().getHours();

    let startIndex = currentHour;
    // Show next 6-8 hours with 2h steps
    for (let i = startIndex; i < startIndex + 12; i += 2) {
        if (i >= hourly.time.length) break;

        const time = hourly.time[i]; // "2023-01-01T14:00"
        const temp = hourly.temperature_2m[i];
        const code = hourly.weathercode[i];
        const dateObj = new Date(time);
        const hourStr = dateObj.getHours() + ":00";

        const item = document.createElement('div');
        item.className = 'forecast-item';
        item.innerHTML = `
            <span class="f-time">${hourStr}</span>
            <span class="f-icon">${getWeatherIcon(code)}</span>
            <span class="f-temp">${Math.round(temp)}°</span>
        `;
        forecastContainer.appendChild(item);
    }
}

// --- Google Calendar Logic (Migration to GIS + GAPI) ---

function gapiLoaded() {
    gapi.load('client', initGapiClient);
}

function gisLoaded() {
    const { clientId } = DASH_STATE.calendar;
    if (!clientId) return;

    DASH_STATE.calendar.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                DASH_STATE.calendar.accessToken = tokenResponse.access_token;
                DASH_STATE.calendar.isAuthenticated = true;
                updateAuthUI(true);
            }
        },
    });
}

async function initGapiClient() {
    const { apiKey } = DASH_STATE.calendar;
    if (!apiKey) return;

    try {
        await gapi.client.init({
            apiKey: apiKey,
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
        });
        // Note: No clientId or scope passed here. Auth is handled by GIS.
    } catch (e) {
        console.error("Error initializing GAPI Client", e);
    }
}

function updateAuthUI(isSignedIn) {
    const btn = document.getElementById('btn-gcal-auth');
    if (isSignedIn) {
        btn.textContent = "Sign Out (Refresh Token)";
        // If we have token, try listing events
        listUpcomingEvents();
    } else {
        btn.textContent = "Sign In with Google";
        renderEmptySchedule("Please sign in to see events.");
    }
}

function handleAuthClick() {
    if (!DASH_STATE.calendar.tokenClient) {
        // Try re-init if client wasn't ready (e.g. keys just saved)
        if (typeof google !== 'undefined') gisLoaded();

        if (!DASH_STATE.calendar.tokenClient) {
            alert("Google Auth not initialized. Check Client ID.");
            return;
        }
    }

    if (DASH_STATE.calendar.isAuthenticated) {
        // "Sign Out" in GIS token model basically means discarding the token
        // There is no global sign out for the browser session in the same way.
        // Or we can request a new token.
        // For simplicity, we just reset local state.
        DASH_STATE.calendar.accessToken = null;
        DASH_STATE.calendar.isAuthenticated = false;
        updateAuthUI(false);
    } else {
        // Request token
        // Prompt the user to select an account if desired, or just authorize
        DASH_STATE.calendar.tokenClient.requestAccessToken({prompt: 'consent'});
    }
}

function switchScheduleView(view) {
    DASH_STATE.calendar.view = view;

    // Update tabs
    document.querySelectorAll('.schedule-tab').forEach(t => {
        if (t.dataset.view === view) t.classList.add('active');
        else t.classList.remove('active');
    });

    listUpcomingEvents();
}

async function listUpcomingEvents() {
    if (!DASH_STATE.calendar.isAuthenticated || !DASH_STATE.calendar.accessToken) return;

    let timeMin = (new Date()).toISOString();
    let timeMax;
    const now = new Date();

    // View Logic
    if (DASH_STATE.calendar.view === 'today') {
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59);
        timeMax = endOfDay.toISOString();
    } else if (DASH_STATE.calendar.view === '3day') {
        const future = new Date(now);
        future.setDate(future.getDate() + 3);
        timeMax = future.toISOString();
    } else { // week
        const future = new Date(now);
        future.setDate(future.getDate() + 7);
        timeMax = future.toISOString();
    }

    try {
        // Use the token
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
            'timeMin': timeMin,
            'timeMax': timeMax,
            'showDeleted': false,
            'singleEvents': true,
            'maxResults': 20,
            'orderBy': 'startTime'
        });

        const events = response.result.items;
        renderEvents(events);
    } catch (e) {
        console.error("Error fetching events", e);
        renderEmptySchedule("Error fetching events. Token might be expired.");
        // Optional: Auto-refresh token if 401
    }
}

function renderEvents(events) {
    const list = document.querySelector('.schedule-list');
    list.innerHTML = '';

    if (events.length === 0) {
        renderEmptySchedule("No upcoming events found.");
        return;
    }

    events.forEach(event => {
        const when = event.start.dateTime || event.start.date;
        if (!when) return;

        const date = new Date(when);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });

        // Check for all-day events (no time)
        const isAllDay = !event.start.dateTime;

        const isToday = new Date().toDateString() === date.toDateString();
        let displayTime = isToday ? timeStr : `${dateStr} ${timeStr}`;
        if (isAllDay) displayTime = isToday ? "All Day" : dateStr;

        const li = document.createElement('li');
        li.className = 'schedule-item';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'event-time';
        timeSpan.textContent = displayTime;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'event-title';
        titleSpan.textContent = event.summary;

        li.appendChild(timeSpan);
        li.appendChild(titleSpan);
        list.appendChild(li);
    });
}

function renderEmptySchedule(msg) {
    const list = document.querySelector('.schedule-list');
    list.innerHTML = `<li style="padding:10px; color:#999; text-align:center;">${msg}</li>`;
}

// --- Settings Logic ---
function openDashSettings() {
    const modal = document.getElementById('dash-settings-modal');
    modal.classList.remove('hidden');

    // Load values into inputs
    document.getElementById('inp-gcal-client-id').value = DASH_STATE.calendar.clientId || '';
    document.getElementById('inp-gcal-api-key').value = DASH_STATE.calendar.apiKey || '';
    document.getElementById('inp-weather-lat').value = DASH_STATE.weather.lat;
    document.getElementById('inp-weather-lon').value = DASH_STATE.weather.lon;
}

function closeDashSettings() {
    document.getElementById('dash-settings-modal').classList.add('hidden');
}

function saveDashSettings() {
    const cid = document.getElementById('inp-gcal-client-id').value;
    const key = document.getElementById('inp-gcal-api-key').value;
    const lat = document.getElementById('inp-weather-lat').value;
    const lon = document.getElementById('inp-weather-lon').value;

    DASH_STATE.calendar.clientId = cid;
    DASH_STATE.calendar.apiKey = key;
    DASH_STATE.weather.lat = lat;
    DASH_STATE.weather.lon = lon;

    localStorage.setItem('dash_config', JSON.stringify({
        calendar: { clientId: cid, apiKey: key },
        weather: { lat, lon }
    }));

    closeDashSettings();

    // Re-init if changed
    if (cid && key) {
        initGapiClient();
        gisLoaded();
    }

    // Refresh weather
    fetchWeather();
}

function loadDashboardSettings() {
    try {
        const stored = localStorage.getItem('dash_config');
        if (stored) {
            const data = JSON.parse(stored);
            if (data.calendar) {
                DASH_STATE.calendar.clientId = data.calendar.clientId;
                DASH_STATE.calendar.apiKey = data.calendar.apiKey;
            }
            if (data.weather) {
                DASH_STATE.weather.lat = data.weather.lat || 35.6895;
                DASH_STATE.weather.lon = data.weather.lon || 139.6917;
            }
        }
    } catch(e) {
        console.error("Failed to load dash settings", e);
    }
}
