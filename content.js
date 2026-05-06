const socket = io('https://my-watch-party-backend.onrender.com');

//const socket = io('http://localhost:3000');
let ROOM_ID = "";
let USERNAME = "Guest";

socket.on('connect', () => {
    console.log(`🔗 Connected to server. ID: ${socket.id}`);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "join_room") {
        ROOM_ID = request.room;
        USERNAME = request.username;

        socket.emit('join_room', ROOM_ID);
        showNotification(`SYS.CONNECT: [${ROOM_ID}] // ID:[${USERNAME}]`);
        injectChatUI();

        socket.emit('chat_message', {
            roomId: ROOM_ID,
            text: "has jacked into the stream.",
            sender: USERNAME,
            isSystem: true
        });
    }
});

// =====================================================
// --- PLATFORM DETECTION ---
// Each streaming site has a different DOM structure.
// We detect the host and return the right squish targets
// and any special video-finding hints.
// =====================================================
const PLATFORMS = {
    youtube: {
        match: () => location.hostname.includes('youtube.com'),
        // Elements to shrink to make room for the sidebar
        squishSelectors: ['ytd-app', 'ytd-masthead', 'body', 'html'],
        // YouTube sometimes has a sidebar already — offset from right edge instead
        sidebarMode: 'squish',
    },
    netflix: {
        match: () => location.hostname.includes('netflix.com'),
        squishSelectors: ['.watch-video', '.NFPlayer', 'body', 'html'],
        sidebarMode: 'overlay', // Netflix player is full-screen; overlay is cleaner
    },
    prime: {
        match: () => location.hostname.includes('amazon.com') || location.hostname.includes('primevideo.com'),
        squishSelectors: ['.webPlayerSDKContainer', '.dv-player-fullscreen', 'body', 'html'],
        sidebarMode: 'overlay',
    },
    disney: {
        match: () => location.hostname.includes('disneyplus.com'),
        squishSelectors: ['.hudson-container', 'body', 'html'],
        sidebarMode: 'overlay',
    },
    hbo: {
        match: () => location.hostname.includes('max.com') || location.hostname.includes('hbomax.com'),
        squishSelectors: ['.watch-player', 'body', 'html'],
        sidebarMode: 'overlay',
    },
    hulu: {
        match: () => location.hostname.includes('hulu.com'),
        squishSelectors: ['.site-player', 'body', 'html'],
        sidebarMode: 'overlay',
    },
};

function detectPlatform() {
    for (const [name, config] of Object.entries(PLATFORMS)) {
        if (config.match()) return { name, ...config };
    }
    // Fallback — generic: just overlay the sidebar, don't squish anything
    return { name: 'generic', squishSelectors: ['body', 'html'], sidebarMode: 'overlay' };
}

const PLATFORM = detectPlatform();
console.log(`🎬 Watch Party: detected platform → ${PLATFORM.name}`);

// =====================================================
// --- SMART VIDEO FINDER ---
// Streaming sites load video elements asynchronously,
// sometimes inside shadow DOM or iframes. We use
// MutationObserver + polling to catch it reliably.
// =====================================================
let video = null;
let isRemoteAction = false;
let videoListenersAttached = false;

function findBestVideo() {
    // Prefer the video with the longest duration (the main feature, not an ad)
    const all = Array.from(document.querySelectorAll('video'));
    if (!all.length) return null;
    return all.reduce((best, v) => {
        if (!best) return v;
        // Prefer playing videos, then longest duration
        if (v.paused === false && best.paused === true) return v;
        if (v.duration > (best.duration || 0)) return v;
        return best;
    }, null);
}

function tryAttachVideo() {
    const found = findBestVideo();
    if (found && found !== video) {
        video = found;
        if (!videoListenersAttached) {
            videoListenersAttached = true;
            attachVideoListeners();
            console.log(`✅ Watch Party: video element locked on [${PLATFORM.name}]`);
        }
    }
}

// Poll every 800ms — catches lazy-loaded players (Netflix, Prime)
const videoPoller = setInterval(() => {
    tryAttachVideo();
    if (video) clearInterval(videoPoller);
}, 800);

// Also watch for DOM mutations — fires faster than polling on most sites
const videoObserver = new MutationObserver(() => {
    if (!video) tryAttachVideo();
});
videoObserver.observe(document.documentElement, { childList: true, subtree: true });

// If the user navigates within a SPA (Netflix episode change, YouTube next video)
// the old video element gets replaced — re-attach
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        const fresh = findBestVideo();
        if (fresh && fresh !== video) {
            video = fresh;
            videoListenersAttached = false;
            attachVideoListeners();
            videoListenersAttached = true;
            console.log('🔄 Watch Party: re-attached to new video element');
        }
    }
});

// =====================================================
// --- VOICE CALL STATE ---
// =====================================================
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let localStream     = null;
let peerConnections = {};
let isMuted         = false;
let isInCall        = false;

// =====================================================
// --- NOTIFICATIONS ---
// =====================================================
function showNotification(message) {
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: rgba(10, 10, 15, 0.95); color: #ff003c;
        padding: 15px 25px; z-index: 2147483647;
        font-size: 16px; font-weight: bold; font-family: 'Share Tech Mono', monospace;
        border: 2px solid #ff003c; box-shadow: 0 0 10px #ff003c, inset 0 0 10px #ff003c;
        pointer-events: none; text-transform: uppercase;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// =====================================================
// --- VIDEO SYNC ---
// =====================================================
function attachVideoListeners() {
    if (!video) return;

    // Netflix / Prime auto-pause on blur — suppress it during remote seeks
    video.addEventListener('play', () => {
        if (isRemoteAction) return;
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'play', time: video.currentTime });
    });

    video.addEventListener('pause', () => {
        if (isRemoteAction) return;
        // Ignore very-short pauses that are part of a seek
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'pause', time: video.currentTime });
    });

    video.addEventListener('seeked', () => {
        if (isRemoteAction) return;
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'seeked', time: video.currentTime });
    });

    // ---- Incoming sync from server ----
    socket.on('sync_state', (data) => {
        if (!video) return;
        isRemoteAction = true;

        const drift = Math.abs(video.currentTime - data.time);
        if (drift > 0.5) video.currentTime = data.time;

        if (data.action === 'play') {
            // Some DRM players (Netflix) block .play() unless it follows a user gesture.
            // We silently try and catch the NotAllowedError.
            video.play().catch(() => {});
        }
        if (data.action === 'pause') video.pause();

        // Extend the lock a bit longer for slow DRM players
        setTimeout(() => { isRemoteAction = false; }, 800);
    });

    socket.on('latecomer_arrived', (data) => {
        video.pause();
        socket.emit('sync_state', {
            roomId: ROOM_ID, action: 'pause', time: video.currentTime,
            message: `GUEST_${data.newUserId} DETECTED. SYNCING...`
        });
    });

    socket.on('sync_state', (data) => {
        if (data.message) showNotification(data.message);
    });
}

// =====================================================
// --- EMOJI VIDEO OVERLAY ---
// =====================================================
function ensureOverlayLayer() {
    if (document.getElementById('wp-emoji-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'wp-emoji-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: calc(100% - 350px); height: 100%;
        pointer-events: none; z-index: 2147483640; overflow: hidden;
    `;
    document.body.appendChild(overlay);

    const s = document.createElement('style');
    s.textContent = `
        @keyframes wp-float-up {
            0%   { transform:translateY(0)     scale(1);    opacity:1;   }
            60%  { transform:translateY(-55vh) scale(1.15); opacity:0.9; }
            100% { transform:translateY(-80vh) scale(0.8);  opacity:0;   }
        }
        .wp-floating-emoji {
            position:absolute; bottom:15%; font-size:36px;
            animation:wp-float-up 2.6s ease-out forwards;
            pointer-events:none; user-select:none;
            filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));
        }
    `;
    document.head.appendChild(s);
}

function floatEmojiOnVideo(emoji) {
    ensureOverlayLayer();
    const overlay = document.getElementById('wp-emoji-overlay');
    if (!overlay) return;
    const el = document.createElement('span');
    el.className = 'wp-floating-emoji';
    el.textContent = emoji;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.animationDelay = `${Math.random() * 0.15}s`;
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 2800);
}

socket.on('reaction', (data) => {
    floatEmojiOnVideo(data.emoji);
    appendMessage(data.sender, data.emoji, 'receiver');
});

// =====================================================
// --- TYPING INDICATOR ---
// =====================================================
let typingTimeout = null;

function setTypingIndicator(senderName, visible) {
    let indicator = document.getElementById('wp-typing-indicator');
    if (!visible) { if (indicator) indicator.remove(); return; }
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'wp-typing-indicator';
        indicator.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 16px 8px;font-family:'Share Tech Mono',monospace;`;
    }
    indicator.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
            <div style="background:rgba(0,0,0,0.7);border:1px solid #0ff;padding:4px 8px;display:flex;align-items:center;gap:6px;box-shadow:inset 0 0 5px #0ff;">
                <span style="font-size:10px;color:#0ff;text-transform:uppercase;">${senderName} IS UPLOADING</span>
                <div style="display:flex;gap:3px;align-items:center;">
                    <span class="wp-dot" style="animation-delay:0s"></span>
                    <span class="wp-dot" style="animation-delay:0.2s"></span>
                    <span class="wp-dot" style="animation-delay:0.4s"></span>
                </div>
            </div>
        </div>`;
    const box = document.getElementById('wp-chat-box');
    if (box) { box.appendChild(indicator); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); }
}

socket.on('user_typing',  (data) => setTypingIndicator(data.sender, true));
socket.on('user_stopped', (data) => setTypingIndicator(data.sender, false));

// =====================================================
// --- VOICE CALL ---
// =====================================================
function createPeerConnection(remoteSocketId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice_candidate', { to: remoteSocketId, candidate: e.candidate });
    };
    pc.ontrack = (e) => playRemoteAudio(remoteSocketId, e.streams[0]);
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    peerConnections[remoteSocketId] = pc;
    return pc;
}

function playRemoteAudio(remoteSocketId, stream) {
    document.getElementById(`wp-audio-${remoteSocketId}`)?.remove();
    const audio = document.createElement('audio');
    audio.id = `wp-audio-${remoteSocketId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
}

function closePeerConnection(id) {
    peerConnections[id]?.close();
    delete peerConnections[id];
    document.getElementById(`wp-audio-${id}`)?.remove();
}

function endCall() {
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    Object.keys(peerConnections).forEach(closePeerConnection);
    isInCall = false; isMuted = false;
    updateCallUI(false);
    socket.emit('voice_call_ended', { roomId: ROOM_ID, sender: USERNAME });
    appendSystemVoiceMessage('COMMS LINK SEVERED.');
}

function updateCallUI(inCall) {
    const s = document.getElementById('wp-call-start');
    const e = document.getElementById('wp-call-end');
    const m = document.getElementById('wp-call-mute');
    const st = document.getElementById('wp-call-status');
    if (!s) return;
    s.style.display  = inCall ? 'none'  : 'flex';
    e.style.display  = inCall ? 'flex'  : 'none';
    m.style.display  = inCall ? 'flex'  : 'none';
    if (st) { st.style.display = inCall ? 'flex' : 'none'; st.innerText = 'AUDIO: LIVE'; }
}

function appendSystemVoiceMessage(text) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    const el = document.createElement('div');
    el.style.cssText = "text-align:center;color:#f0ea00;font-size:11px;margin:8px 0;text-transform:uppercase;font-family:'Share Tech Mono',monospace;text-shadow:0 0 3px #f0ea00;border-top:1px dashed #f0ea00;border-bottom:1px dashed #f0ea00;padding:4px 0;position:relative;z-index:2;";
    el.innerText = text;
    box.appendChild(el);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}

socket.on('voice_call_incoming', async (data) => {
    appendSystemVoiceMessage(`OVERRIDE: ${data.sender} INITIATED COMMS...`);
    showNotification(`INCOMING TRANSMISSION: ${data.sender}`);
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isInCall = true; updateCallUI(true);
        const pc = createPeerConnection(data.from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_offer', { to: data.from, offer });
    } catch { appendSystemVoiceMessage('ERR: MIC ACCESS DENIED.'); }
});

socket.on('voice_offer', async (data) => {
    if (!localStream) return;
    const pc = createPeerConnection(data.from);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice_answer', { to: data.from, answer });
});

socket.on('voice_answer', async (data) => {
    const pc = peerConnections[data.from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice_candidate', async (data) => {
    const pc = peerConnections[data.from];
    if (pc && data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
    }
});

socket.on('voice_call_ended', (data) => {
    appendSystemVoiceMessage(`COMMS TERMINATED BY ${data.sender}.`);
    Object.keys(peerConnections).forEach(closePeerConnection);
    localStream?.getTracks().forEach(t => t.stop()); localStream = null;
    isInCall = false; updateCallUI(false);
});

socket.on('voice_peer_disconnected', (data) => closePeerConnection(data.socketId));

// =====================================================
// --- CHAT MESSAGES ---
// =====================================================
socket.on('chat_message', (data) => {
    setTypingIndicator(data.sender, false);
    appendMessage(data.sender, data.text, data.isSystem ? 'system' : 'receiver');
});

// =====================================================
// --- MATRIX GRID BACKGROUND ENGINE ---
// =====================================================
function initMatrixGrid(containerEl) {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>/?;:"[]{}\\|!@#$%^&*()_+-=';
    const TILE_SIZE = 28;
    const gridEl = containerEl.querySelector('#wp-matrix-grid');

    const buildGrid = () => {
        gridEl.innerHTML = '';
        const cols = Math.floor(containerEl.offsetWidth  / TILE_SIZE);
        const rows = Math.floor(containerEl.offsetHeight / TILE_SIZE);
        gridEl.style.setProperty('--wp-mcols', cols);
        gridEl.style.setProperty('--wp-mrows', rows);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < cols * rows; i++) {
            const tile = document.createElement('span');
            tile.className = 'wp-mtile';
            tile.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
            tile.addEventListener('click', () => {
                tile.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
                tile.classList.add('wp-mtile-glitch');
                setTimeout(() => tile.classList.remove('wp-mtile-glitch'), 220);
            });
            frag.appendChild(tile);
        }
        gridEl.appendChild(frag);
    };

    const onMouseMove = (e) => {
        const rect = containerEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const radius = rect.width * 1.2;
        for (const tile of gridEl.children) {
            const tr = tile.getBoundingClientRect();
            const tx = tr.left - rect.left + tr.width  / 2;
            const ty = tr.top  - rect.top  + tr.height / 2;
            const dist = Math.sqrt((mx - tx) ** 2 + (my - ty) ** 2);
            tile.style.setProperty('--wp-mi', Math.max(0, 1 - dist / radius));
        }
    };

    const idleInterval = setInterval(() => {
        const tiles = gridEl.children;
        if (!tiles.length) return;
        const count = Math.max(1, Math.floor(tiles.length * 0.015));
        for (let i = 0; i < count; i++) {
            tiles[Math.floor(Math.random() * tiles.length)].textContent =
                CHARS[Math.floor(Math.random() * CHARS.length)];
        }
    }, 120);

    new ResizeObserver(buildGrid).observe(containerEl);
    containerEl.addEventListener('mousemove', onMouseMove);
    containerEl.addEventListener('mouseleave', () => {
        for (const tile of gridEl.children) tile.style.setProperty('--wp-mi', 0);
    });
    buildGrid();
}

// =====================================================
// --- LAYOUT SQUISH — per-platform ---
// =====================================================
function setSquish(isDocked) {
    // FIX: use margin-right instead of width reduction for overlay-mode platforms.
    // Width-based squish breaks full-screen players (Netflix, Prime).
    const SIDEBAR_W = 350;

    if (PLATFORM.sidebarMode === 'squish') {
        // YouTube-style: shrink the app container
        const newWidth = isDocked ? `calc(100% - ${SIDEBAR_W}px)` : '100%';
        document.documentElement.style.width = newWidth;
        document.body.style.width = newWidth;
        for (const sel of PLATFORM.squishSelectors) {
            const el = document.querySelector(sel);
            if (el) el.style.width = newWidth;
        }
    } else {
        // Overlay-mode: keep player full width, just pad the right edge of body
        // so content isn't hidden under the sidebar
        document.body.style.paddingRight = isDocked ? `${SIDEBAR_W}px` : '0px';
        document.documentElement.style.paddingRight = isDocked ? `${SIDEBAR_W}px` : '0px';
        // Also shrink any platform-specific wrappers if they exist
        for (const sel of PLATFORM.squishSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.style.boxSizing = 'border-box';
                el.style.paddingRight = isDocked ? `${SIDEBAR_W}px` : '0px';
            }
        }
    }

    // Keep emoji overlay width in sync
    const overlay = document.getElementById('wp-emoji-overlay');
    if (overlay) overlay.style.width = isDocked ? `calc(100% - ${SIDEBAR_W}px)` : '100%';
}

// =====================================================
// --- INJECT CHAT UI ---
// =====================================================
function injectChatUI() {
    if (document.getElementById('wp-chat-container')) return;

    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    const style = document.createElement('style');
    style.textContent = `
        :root {
            --cy-bg: #050508;
            --cy-neon-cyan: #0ff;
            --cy-neon-pink: #ff003c;
            --cy-neon-yellow: #f0ea00;
            --cy-dark-border: #1a1a24;
        }

        /* ===== MATRIX GRID ===== */
        #wp-matrix-grid {
            display: grid;
            grid-template-columns: repeat(var(--wp-mcols, 10), 1fr);
            grid-template-rows: repeat(var(--wp-mrows, 20), 1fr);
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 0; overflow: hidden;
        }
        .wp-mtile {
            pointer-events: all;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Courier New', Courier, monospace; font-size: 0.72rem;
            cursor: default; user-select: none;
            opacity:     calc(0.04 + var(--wp-mi, 0) * 0.82);
            color:       hsl(120, 100%, calc(38% + var(--wp-mi, 0) * 42%));
            text-shadow: 0 0 calc(var(--wp-mi, 0) * 12px) hsl(120, 100%, 55%);
            transform:   scale(calc(1 + var(--wp-mi, 0) * 0.18));
            transition:  color 0.18s ease, text-shadow 0.18s ease, opacity 0.18s ease, transform 0.18s ease;
        }
        .wp-mtile-glitch { animation: wp-tile-glitch 0.22s ease !important; }
        @keyframes wp-tile-glitch {
            0%   { transform: scale(1);   color: #0f0; }
            50%  { transform: scale(1.3); color: #fff; text-shadow: 0 0 10px #fff; }
            100% { transform: scale(1);   color: #0f0; }
        }

        /* ===== MAIN CONTAINER ===== */
        #wp-chat-container {
            position: fixed; top: 0; right: 0; width: 350px; height: 100vh;
            background: var(--cy-bg); color: var(--cy-neon-cyan);
            /* Max z-index so it floats above Netflix/Prime overlays */
            z-index: 2147483646;
            display: flex; flex-direction: column; font-family: 'Share Tech Mono', monospace;
            border-left: 2px solid var(--cy-neon-pink);
            box-shadow: -5px 0 20px rgba(255,0,60,0.4), inset 0 0 30px rgba(0,255,255,0.08);
            transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
            overflow: visible;
        }
        #wp-chat-container.hidden { transform: translateX(100%); }

        /* CRT scanlines */
        #wp-chat-container::after {
            content:""; position:absolute; inset:0;
            background:
                linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.18) 50%),
                linear-gradient(90deg, rgba(255,0,0,0.04), rgba(0,255,0,0.015), rgba(0,0,255,0.04));
            background-size: 100% 3px, 3px 100%;
            pointer-events:none; z-index:9998; overflow:hidden;
        }

        /* Toggle tab */
        #wp-toggle-tab {
            position:absolute; left:-42px; top:50vh; transform:translateY(-50%);
            width:40px; height:60px; background:var(--cy-bg); color:var(--cy-neon-pink);
            border:2px solid var(--cy-neon-pink); border-right:none; cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            font-size:20px; box-shadow:-4px 0 10px rgba(255,0,60,0.4);
            transition:background 0.1s, color 0.1s, box-shadow 0.1s;
            text-shadow:0 0 5px var(--cy-neon-pink); z-index:10000;
            font-family:'Share Tech Mono', monospace;
        }
        #wp-toggle-tab:hover { background:var(--cy-neon-pink); color:var(--cy-bg); box-shadow:-4px 0 20px var(--cy-neon-pink); }
        #wp-toggle-tab:active { opacity:0.7; }

        /* ===== HEADER ===== */
        #wp-chat-header {
            background: rgba(5,5,8,0.88); backdrop-filter:blur(2px);
            padding:12px 16px; font-weight:bold; font-size:14px;
            display:flex; flex-direction:column; gap:8px;
            border-bottom:2px solid var(--cy-neon-cyan);
            text-transform:uppercase; letter-spacing:1px;
            box-shadow:0 4px 10px rgba(0,255,255,0.15);
            position:relative; z-index:10;
        }
        #wp-header-top { display:flex; justify-content:space-between; align-items:center; text-shadow:0 0 5px var(--cy-neon-cyan); }

        /* Platform badge */
        #wp-platform-badge {
            font-size:9px; color:#555; text-transform:uppercase; letter-spacing:1px;
            border:1px solid #222; padding:2px 6px;
        }

        #wp-call-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        #wp-call-status {
            font-size:11px; color:var(--cy-neon-yellow); font-weight:bold;
            display:none; align-items:center; gap:4px; flex:1; text-shadow:0 0 4px var(--cy-neon-yellow);
        }
        #wp-call-status::before { content:'>'; animation:wp-blink 1s infinite; }
        @keyframes wp-blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .wp-call-btn {
            border:1px solid; border-radius:0; cursor:pointer;
            padding:5px 8px; font-size:10px; font-family:'Share Tech Mono',monospace; font-weight:bold;
            display:flex; align-items:center; gap:4px; transition:all 0.2s;
            text-transform:uppercase; background:transparent;
        }
        .wp-call-btn:active { transform:translate(2px,2px); }
        #wp-call-start { border-color:var(--cy-neon-cyan); color:var(--cy-neon-cyan); box-shadow:inset 0 0 5px var(--cy-neon-cyan); }
        #wp-call-start:hover { background:var(--cy-neon-cyan); color:var(--cy-bg); }
        #wp-call-end { border-color:var(--cy-neon-pink); color:var(--cy-neon-pink); display:none; box-shadow:inset 0 0 5px var(--cy-neon-pink); }
        #wp-call-end:hover { background:var(--cy-neon-pink); color:var(--cy-bg); }
        #wp-call-mute { border-color:#888; color:#888; display:none; }
        #wp-call-mute:hover { border-color:#fff; color:#fff; }
        #wp-call-mute.muted { border-color:var(--cy-neon-yellow); color:var(--cy-neon-yellow); box-shadow:inset 0 0 5px var(--cy-neon-yellow); }

        /* ===== CHAT BOX ===== */
        #wp-chat-box {
            flex-grow:1; overflow-y:auto; padding:16px; display:flex;
            flex-direction:column; gap:14px; scroll-behavior:smooth;
            position:relative; z-index:10;
        }
        #wp-chat-box::-webkit-scrollbar { width:4px; }
        #wp-chat-box::-webkit-scrollbar-track { background:transparent; }
        #wp-chat-box::-webkit-scrollbar-thumb { background:var(--cy-neon-cyan); }

        .wp-msg-wrapper { display:flex; flex-direction:column; max-width:90%; animation:wp-glitch-anim 0.3s ease; }
        .wp-msg-wrapper.sender   { align-self:flex-end;   align-items:flex-end;   }
        .wp-msg-wrapper.receiver { align-self:flex-start; align-items:flex-start; }
        .wp-avatar-row { display:flex; align-items:center; gap:8px; margin-bottom:2px; }
        .wp-avatar {
            width:20px; height:20px; background:rgba(0,0,0,0.8); border:1px solid var(--cy-neon-pink);
            display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold;
            color:var(--cy-neon-pink); box-shadow:inset 0 0 5px var(--cy-neon-pink);
        }
        .wp-sender-name { font-size:10px; color:#888; text-transform:uppercase; }
        .wp-msg-bubble {
            padding:8px 12px; font-size:13px; line-height:1.4;
            word-wrap:break-word; border:1px solid; position:relative;
            background:rgba(0,0,0,0.78); backdrop-filter:blur(4px);
        }
        .wp-msg-wrapper.sender .wp-msg-bubble {
            border-color:var(--cy-neon-cyan); color:#fff;
            box-shadow:-2px 2px 0 var(--cy-neon-cyan), inset 0 0 8px rgba(0,255,255,0.06);
            border-right:4px solid var(--cy-neon-cyan);
        }
        .wp-msg-wrapper.receiver .wp-msg-bubble {
            border-color:var(--cy-neon-pink); color:#fff;
            box-shadow:2px 2px 0 var(--cy-neon-pink), inset 0 0 8px rgba(255,0,60,0.06);
            border-left:4px solid var(--cy-neon-pink);
        }
        .wp-msg-bubble:hover { animation:wp-glitch-hover 0.2s infinite linear alternate-reverse; }
        .wp-timestamp { font-size:9px; color:#555; margin-top:4px; }

        /* ===== REACTION BAR ===== */
        #wp-reaction-bar {
            display:flex; gap:8px; padding:8px 12px;
            background:rgba(5,5,8,0.75); backdrop-filter:blur(3px);
            border-top:1px dashed rgba(255,255,255,0.08);
            position:relative; z-index:10; flex-wrap:wrap;
        }
        .wp-reaction-btn {
            background:rgba(0,0,0,0.5); border:1px solid #444; color:#fff; cursor:pointer;
            padding:3px 7px; font-size:15px; transition:all 0.1s;
        }
        .wp-reaction-btn:hover { border-color:var(--cy-neon-yellow); box-shadow:0 0 8px var(--cy-neon-yellow); transform:scale(1.1); }

        /* ===== INPUT AREA ===== */
        #wp-input-area {
            display:flex; padding:12px; background:rgba(0,0,0,0.95); gap:8px; align-items:center;
            border-top:2px solid var(--cy-neon-cyan); position:relative; z-index:10;
        }
        #wp-chat-input {
            flex-grow:1; background:rgba(5,5,8,0.98); border:1px solid #333; color:var(--cy-neon-cyan);
            padding:9px; outline:none; font-size:13px; font-family:'Share Tech Mono',monospace;
            box-shadow:inset 0 0 5px rgba(0,255,255,0.2);
        }
        #wp-chat-input:focus { border-color:var(--cy-neon-cyan); box-shadow:inset 0 0 10px rgba(0,255,255,0.5); }
        #wp-chat-input::placeholder { color:#333; text-transform:uppercase; }
        .wp-action-btn {
            background:transparent; color:var(--cy-neon-cyan); border:1px solid var(--cy-neon-cyan);
            width:38px; height:38px; display:flex; align-items:center; justify-content:center;
            cursor:pointer; font-size:15px; transition:all 0.1s; box-shadow:0 0 5px rgba(0,255,255,0.3);
        }
        .wp-action-btn:hover { background:var(--cy-neon-cyan); color:#000; }
        .wp-action-btn:active { transform:translate(2px,2px); box-shadow:none; }
        .wp-icon-btn { border-color:#555; color:#555; box-shadow:none; }
        .wp-icon-btn:hover { border-color:var(--cy-neon-pink); color:var(--cy-neon-pink); background:transparent; box-shadow:0 0 8px var(--cy-neon-pink); }

        /* ===== GLITCH ANIMATIONS ===== */
        @keyframes wp-glitch-anim {
            0%{transform:translate(0)} 20%{transform:translate(-2px,1px)}
            40%{transform:translate(-1px,-1px)} 60%{transform:translate(2px,1px)}
            80%{transform:translate(1px,-1px)} 100%{transform:translate(0)}
        }
        @keyframes wp-glitch-hover {
            0%{transform:skew(0deg)} 20%{transform:skew(-5deg);filter:hue-rotate(90deg)}
            40%{transform:skew(5deg)} 60%{transform:translate(1px,1px)}
            80%{transform:translate(-1px,-1px)} 100%{transform:skew(0deg)}
        }
        .wp-dot {
            display:inline-block; width:6px; height:6px;
            background:var(--cy-neon-cyan); box-shadow:0 0 4px var(--cy-neon-cyan);
            animation:wp-dot-blink 1s infinite; border-radius:0;
        }
        @keyframes wp-dot-blink { 0%,100%{opacity:0.2} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    `;
    document.head.appendChild(style);

    const chatContainer = document.createElement('div');
    chatContainer.id = 'wp-chat-container';
    chatContainer.innerHTML = `
        <div id="wp-matrix-grid"></div>
        <button id="wp-toggle-tab" title="Toggle Terminal">[ ]</button>
        <div id="wp-chat-header">
            <div id="wp-header-top">
                <span>NET://ROOM_${ROOM_ID}</span>
                <span id="wp-platform-badge">${PLATFORM.name.toUpperCase()}</span>
            </div>
            <div id="wp-call-bar">
                <button class="wp-call-btn" id="wp-call-start">INIT AUDIO</button>
                <div id="wp-call-status"></div>
                <button class="wp-call-btn" id="wp-call-mute">MUTE</button>
                <button class="wp-call-btn" id="wp-call-end">CUT LINE</button>
            </div>
        </div>
        <div id="wp-chat-box"></div>
        <div id="wp-reaction-bar">
            <button class="wp-reaction-btn" data-emoji="🔥">🔥</button>
            <button class="wp-reaction-btn" data-emoji="🤣">🤣</button>
            <button class="wp-reaction-btn" data-emoji="💀">💀</button>
            <button class="wp-reaction-btn" data-emoji="🥰">🥰</button>
            <button class="wp-reaction-btn" data-emoji="😭">😭</button>
            <button class="wp-reaction-btn" data-emoji="😡">😡</button>
        </div>
        <div id="wp-input-area">
            <button class="wp-action-btn wp-icon-btn" title="Emotes">☺</button>
            <input type="text" id="wp-chat-input" placeholder="Execute command...">
            <button class="wp-action-btn" id="wp-send-btn">_></button>
        </div>
    `;
    document.body.appendChild(chatContainer);
    initMatrixGrid(chatContainer);

    let isDocked = true;
    setSquish(true);

    document.getElementById('wp-toggle-tab').addEventListener('click', () => {
        isDocked = !isDocked;
        chatContainer.classList.toggle('hidden', !isDocked);
        document.getElementById('wp-toggle-tab').innerText = isDocked ? '[ ]' : '[x]';
        setSquish(isDocked);
    });

    const input   = document.getElementById('wp-chat-input');
    const sendBtn = document.getElementById('wp-send-btn');

    function sendChat() {
        const text = input.value.trim();
        if (!text || !ROOM_ID) return;
        socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME });
        appendMessage('ROOT', text, 'sender');
        socket.emit('chat_message', { roomId: ROOM_ID, text, sender: USERNAME });
        input.value = '';
    }

    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });
    input.addEventListener('input', () => {
        if (!ROOM_ID) return;
        socket.emit('typing', { roomId: ROOM_ID, sender: USERNAME });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME }), 2000);
    });

    document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!ROOM_ID) return;
            const emoji = e.currentTarget.dataset.emoji;
            floatEmojiOnVideo(emoji);
            appendMessage('ROOT', emoji, 'sender');
            socket.emit('reaction', { roomId: ROOM_ID, emoji, sender: USERNAME });
        });
    });

    document.getElementById('wp-call-start').addEventListener('click', async () => {
        if (isInCall) return;
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            isInCall = true; updateCallUI(true);
            appendSystemVoiceMessage('LOCAL MIC LIVE. BROADCASTING...');
            socket.emit('voice_call_started', { roomId: ROOM_ID, sender: USERNAME });
        } catch { appendSystemVoiceMessage('ERR: MIC HARDWARE NOT FOUND.'); }
    });

    document.getElementById('wp-call-end').addEventListener('click', () => { if (isInCall) endCall(); });

    document.getElementById('wp-call-mute').addEventListener('click', () => {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
        const btn = document.getElementById('wp-call-mute');
        btn.classList.toggle('muted', isMuted);
        btn.innerText = isMuted ? 'UNMUTE' : 'MUTE';
    });
}

// =====================================================
// --- APPEND MESSAGE HELPER ---
// =====================================================
function appendMessage(sender, text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    document.getElementById('wp-typing-indicator')?.remove();

    const msgDiv = document.createElement('div');

    if (type === 'system') {
        msgDiv.style.cssText = "text-align:center;color:#0ff;font-size:11px;margin:8px 0;font-family:'Share Tech Mono',monospace;text-shadow:0 0 4px #0ff;text-transform:uppercase;position:relative;z-index:2;background:rgba(0,0,0,0.55);padding:3px 6px;backdrop-filter:blur(3px);";
        msgDiv.innerText = `>> ${sender} ${text}`;
        box.appendChild(msgDiv);
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
    }

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const initial    = sender.substring(0, 2).toUpperCase();
    msgDiv.className = `wp-msg-wrapper ${type}`;
    const headerHtml = type === 'receiver'
        ? `<div class="wp-avatar-row"><div class="wp-avatar">${initial}</div><span class="wp-sender-name">USR_${sender}</span></div>`
        : '';
    msgDiv.innerHTML = `${headerHtml}<div class="wp-msg-bubble"></div><div class="wp-timestamp">[${timeString}]</div>`;
    msgDiv.querySelector('.wp-msg-bubble').textContent = text;
    box.appendChild(msgDiv);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}