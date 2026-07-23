// =====================================================
// PERSISTENT USERNAME — pre-fill from last session
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        chrome.storage.local.get('wp_username', (result) => {
            if (result && result.wp_username) {
                document.getElementById('usernameInput').value = result.wp_username;
            }
        });
    } catch (e) {
        console.warn('WP: Add "storage" to manifest.json permissions.');
    }
});

// YouTube auto-injects via content_scripts (safe, no DRM)
const AUTO_INJECT_HOSTS = ['youtube.com'];

// These sites inject on-demand only (DRM or iframe-player based)
const MANUAL_INJECT_HOSTS = [
    'netflix.com',
    'amazon.com',
    'primevideo.com',
    'disneyplus.com',
    'max.com',
    'hbomax.com',
    'hulu.com',
    'hianime.biz.pl',
    'streamiloo.to'  // nested cross-origin player
];

const ALL_SUPPORTED = [...AUTO_INJECT_HOSTS, ...MANUAL_INJECT_HOSTS];

document.getElementById("syncBtn").addEventListener("click", async () => {
    const roomInput     = document.getElementById("roomInput");
    const usernameInput = document.getElementById("usernameInput");

    const roomId   = roomInput.value.trim();
    const username = usernameInput.value.trim() || "Guest";

    if (!roomId) {
        showInputError(roomInput, "SYS ERR: ENTER ID", "ENTER ROOM ID");
        return;
    }

    try { chrome.storage.local.set({ wp_username: username }); } catch (e) {}

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab.url || '';

    if (!tabUrl.startsWith('http') || !ALL_SUPPORTED.some(h => tabUrl.includes(h))) {
        showInputError(roomInput, "ERR: GO TO A STREAM SITE", "ENTER ROOM ID");
        return;
    }

    const isManualInjectSite = MANUAL_INJECT_HOSTS.some(h => tabUrl.includes(h));

    if (isManualInjectSite) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['socket.io.min.js']
            });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            await new Promise(r => setTimeout(r, 600));
        } catch (injectErr) {
            console.log('WP: Script already injected or inject failed, continuing...', injectErr);
        }
    }

    try {
        await chrome.tabs.sendMessage(tab.id, {
            action:   "join_room",
            room:     roomId,
            username: username
        });
    } catch (error) {
        showInputError(roomInput, "ERR: RELOAD PAGE & RETRY", "ENTER ROOM ID");
    }
});

function showInputError(input, errorText, resetText, duration = 3000) {
    input.style.borderColor = "var(--neon-pink)";
    input.style.boxShadow   = "0 0 10px var(--neon-pink)";
    input.value             = "";
    input.placeholder       = errorText;
    setTimeout(() => {
        input.style.borderColor = "var(--neon-cyan)";
        input.style.boxShadow   = "inset 0 0 5px rgba(0, 255, 255, 0.2)";
        input.placeholder       = resetText;
    }, duration);
}
