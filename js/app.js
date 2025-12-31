// State Management
const STATE = {
    currentVideoIndex: 0,
    playlist: [], // Array of video objects
    settings: {
        genre: 'all',
        region: 'all',
        favoritesOnly: false
    },
    isPlaying: false,
    favorites: [], // Array of IDs
    blocked: [] // Array of IDs
};

// DOM Elements
const videoElement = document.getElementById('main-video');
const audioElement = document.getElementById('background-audio');
const startOverlay = document.getElementById('start-overlay');
const settingsModal = document.getElementById('settings-modal');

// --- Initialization ---

function init() {
    loadData(); // Load blocked/favorites/settings

    // Initial playlist generation
    updatePlaylist();

    // Event Listeners
    startOverlay.addEventListener('click', startExperience);

    // Settings Listeners
    document.getElementById('btn-close-settings').addEventListener('click', () => {
        applySettings();
        toggleSettings();
    });

    // Double click support (for mouse users/testing)
    document.body.addEventListener('dblclick', (e) => {
        // Don't trigger if clicking controls
        if (e.target.closest('.control-btn') || e.target.closest('.modal-content')) return;
        toggleSettings();
    });

    // Clear Data Listener
    document.getElementById('btn-clear-data').addEventListener('click', () => {
        if(confirm("Reset all favorites and blocked videos?")) {
            localStorage.clear();
            location.reload();
        }
    });

    // Good/Bad Buttons
    document.getElementById('btn-good').addEventListener('click', toggleFavorite);
    document.getElementById('btn-bad').addEventListener('click', blockVideo);

    // For testing playback logic before full interaction
    videoElement.addEventListener('ended', playNextVideo);

    // Touch Interaction
    setupTouchInteractions();
}

// --- Interaction Logic ---
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let lastTap = 0;

function setupTouchInteractions() {
    const touchArea = document.body;

    touchArea.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: false });

    touchArea.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleGesture(e);
        handleDoubleTap(e);
    }, { passive: false });
}

function handleGesture(e) {
    if (settingsModal.classList.contains('hidden') === false) return; // Don't swipe if settings open
    if (!STATE.isPlaying) return;

    const xDiff = touchEndX - touchStartX;
    const yDiff = touchEndY - touchStartY;

    // Thresholds
    const minSwipeDistance = 50;

    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        // Horizontal Swipe
        if (Math.abs(xDiff) > minSwipeDistance) {
            if (xDiff > 0) {
                // Right Swipe: Previous (or random in playlist)
                // For "Random within genre", next/prev is effectively the same in a shuffled list
                playNextVideo();
            } else {
                // Left Swipe: Next
                playNextVideo();
            }
        }
    } else {
        // Vertical Swipe
        if (Math.abs(yDiff) > minSwipeDistance) {
             if (yDiff > 0) {
                // Down Swipe
                switchGenre();
            } else {
                // Up Swipe
                switchGenre();
            }
        }
    }
}

function handleDoubleTap(e) {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;

    // 300ms for double tap
    if (tapLength < 300 && tapLength > 0) {
        // Don't trigger if tapping on controls
        if (e.target.closest('.control-btn') || e.target.closest('.modal-content')) return;

        toggleSettings();
        e.preventDefault();
    }
    lastTap = currentTime;
}

function switchGenre() {
    // 1. Get list of available genres from config
    const genres = [...new Set(CONFIG.videos.map(v => v.genre))];

    // 2. Pick a random new genre different from current if possible
    let currentGenre = STATE.settings.genre;
    if (currentGenre === 'all') {
        // If currently 'all', pick a specific one
        const randomGenre = genres[Math.floor(Math.random() * genres.length)];
        STATE.settings.genre = randomGenre;
    } else {
        // Pick a different one
        const otherGenres = genres.filter(g => g !== currentGenre);
        if (otherGenres.length > 0) {
            STATE.settings.genre = otherGenres[Math.floor(Math.random() * otherGenres.length)];
        } else {
            STATE.settings.genre = 'all'; // Fallback
        }
    }

    console.log("Switched genre to:", STATE.settings.genre);

    // Update UI select to reflect change (UX)
    document.getElementById('genre-select').value = STATE.settings.genre;

    // Regenerate playlist and play
    updatePlaylist();
    STATE.currentVideoIndex = 0;
    playCurrentVideo();

    // Show a temporary toast or overlay? (Optional, skipping for minimal UI as requested)
}

// --- Playback Logic ---

function startExperience() {
    startOverlay.classList.add('hidden');
    STATE.isPlaying = true;

    // Unlock Audio Context (browser requirement)
    audioElement.play().then(() => {
        audioElement.pause();
    }).catch(e => console.log("Audio play failed (expected if no source yet)", e));

    playCurrentVideo();
}

function applySettings() {
    // Read values from DOM
    STATE.settings.genre = document.getElementById('genre-select').value;
    STATE.settings.region = document.getElementById('region-select').value;
    STATE.settings.favoritesOnly = document.getElementById('favorites-only').checked;

    saveData();
    updatePlaylist();

    // Reset index and play new list
    STATE.currentVideoIndex = 0;
    if (STATE.isPlaying) {
        playCurrentVideo();
    }
}

function updatePlaylist() {
    // Filter based on STATE.settings
    STATE.playlist = CONFIG.videos.filter(video => {
        // 1. Blocked check
        if (STATE.blocked.includes(video.id)) return false;

        // 2. Genre check
        if (STATE.settings.genre !== 'all' && video.genre !== STATE.settings.genre) return false;

        // 3. Region check
        if (STATE.settings.region !== 'all' && video.region !== STATE.settings.region) return false;

        // 4. Favorites only check
        if (STATE.settings.favoritesOnly && !STATE.favorites.includes(video.id)) return false;

        return true;
    });

    console.log("Playlist updated, count:", STATE.playlist.length);

    // If playlist is empty (e.g. strict filters), fallback or alert?
    // For now, if empty, we might want to relax one constraint or just show nothing?
    // Let's fallback to 'all' if it was empty due to filters, or just keep it empty and handle in play logic.
    if (STATE.playlist.length === 0) {
        // Option: Show alert?
        // alert("No videos match your criteria.");
        // But for "Atmosphere", maybe just fallback to all genres but keep region?
        // Or strictly show nothing (black screen)?
        // Let's try to be helpful: if favorites only yielded nothing, disable it temporarily?
        // No, user might want to know it's empty.
        // We will handle empty playlist in playCurrentVideo (do nothing).
    }

    // Shuffle
    shufflePlaylist();
}

function shufflePlaylist() {
    for (let i = STATE.playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [STATE.playlist[i], STATE.playlist[j]] = [STATE.playlist[j], STATE.playlist[i]];
    }
}

function playCurrentVideo() {
    if (STATE.playlist.length === 0) return;

    // Wrap index
    if (STATE.currentVideoIndex >= STATE.playlist.length) {
        STATE.currentVideoIndex = 0;
    }

    const video = STATE.playlist[STATE.currentVideoIndex];
    console.log("Playing:", video.id, video.genre);

    // Update Favorite Icon State
    updateFavoriteIcon(video.id);

    // Fade out
    videoElement.classList.remove('visible');

    setTimeout(() => {
        videoElement.src = video.url;
        videoElement.play().then(() => {
            videoElement.classList.add('visible');
            updateAudio(video.soundProfile);
        }).catch(e => console.error("Video play error:", e));
    }, 500); // Wait for fade out
}

function updateFavoriteIcon(videoId) {
    const btn = document.getElementById('btn-good');
    if (STATE.favorites.includes(videoId)) {
        btn.classList.add('active-good');
    } else {
        btn.classList.remove('active-good');
    }
}

function toggleFavorite() {
    if (STATE.playlist.length === 0) return;
    const video = STATE.playlist[STATE.currentVideoIndex];

    if (STATE.favorites.includes(video.id)) {
        // Remove
        STATE.favorites = STATE.favorites.filter(id => id !== video.id);
    } else {
        // Add
        STATE.favorites.push(video.id);
    }

    saveData();
    updateFavoriteIcon(video.id);
}

function blockVideo() {
    if (STATE.playlist.length === 0) return;
    const video = STATE.playlist[STATE.currentVideoIndex];

    if (!confirm("Don't show this landscape again?")) return;

    // Add to blocked
    if (!STATE.blocked.includes(video.id)) {
        STATE.blocked.push(video.id);
    }

    // If we are in "favorites only" mode and we block a favorite, we should also probably remove it from favorites?
    // Let's just block it.

    saveData();

    // Update playlist to remove this video immediately
    updatePlaylist();

    // Play next (updatePlaylist resets index if needed, but we might want to stay near current index)
    // For simplicity, updatePlaylist shuffles and resets.
    // Let's just playNextVideo() logic but we need to ensure the current video isn't picked again.
    // updatePlaylist() re-filters STATE.playlist, so the blocked video is gone.
    STATE.currentVideoIndex = 0; // Reset to start of new shuffled list
    playCurrentVideo();
}

function playNextVideo() {
    STATE.currentVideoIndex++;
    playCurrentVideo();
}

function updateAudio(soundProfile) {
    if (!soundProfile || !CONFIG.sounds[soundProfile]) {
        // Fallback or mute if no sound profile
        audioElement.pause();
        return;
    }

    const newSrc = CONFIG.sounds[soundProfile];
    // Avoid reloading if it's the same track
    const currentSrc = audioElement.getAttribute('src'); // using getAttribute to avoid full url matching issues if needed

    // Check if effective src is different (handling absolute/relative)
    if (audioElement.src !== newSrc) {
        // Fade out (optional refinement: simple switch for now)
        audioElement.src = newSrc;
        audioElement.play().catch(e => console.error("Audio play error", e));
    } else {
        // Ensure it's playing if it was paused
        if (audioElement.paused) {
            audioElement.play().catch(e => console.error("Audio play error", e));
        }
    }
}

// --- Persistence ---
function loadData() {
    try {
        const storedFavorites = localStorage.getItem('atmosphere_favorites');
        if (storedFavorites) STATE.favorites = JSON.parse(storedFavorites);

        const storedBlocked = localStorage.getItem('atmosphere_blocked');
        if (storedBlocked) STATE.blocked = JSON.parse(storedBlocked);

        const storedSettings = localStorage.getItem('atmosphere_settings');
        if (storedSettings) STATE.settings = JSON.parse(storedSettings);

        // Restore UI settings
        document.getElementById('genre-select').value = STATE.settings.genre;
        document.getElementById('region-select').value = STATE.settings.region;
        document.getElementById('favorites-only').checked = STATE.settings.favoritesOnly;

    } catch (e) {
        console.error("Error loading data", e);
    }
}

function saveData() {
    try {
        localStorage.setItem('atmosphere_favorites', JSON.stringify(STATE.favorites));
        localStorage.setItem('atmosphere_blocked', JSON.stringify(STATE.blocked));
        localStorage.setItem('atmosphere_settings', JSON.stringify(STATE.settings));
    } catch (e) {
        console.error("Error saving data", e);
    }
}

// --- UI Helpers ---
function toggleSettings() {
    settingsModal.classList.toggle('hidden');
}

// Initialize
document.addEventListener('DOMContentLoaded', init);
