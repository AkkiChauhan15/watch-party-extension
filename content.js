const socket = io('https://my-watch-party-backend.onrender.com');
//const socket = io('http://localhost:3000');

let ROOM_ID  = "";
let USERNAME = "Guest";
let IS_HOST  = false;

// =====================================================
// AUTO-REJOIN AFTER QUEUE NAVIGATION
// =====================================================
(function restoreSessionIfNeeded() {
    const saved = sessionStorage.getItem('wp_session');
    if (!saved) return;
    try {
        const { room, username } = JSON.parse(saved);
        if (!room) return;
        const doRejoin = () => {
            ROOM_ID  = room;
            USERNAME = username || 'Guest';
            socket.emit('join_room', ROOM_ID);
            showNotification(`AUTO-SYNC: [${ROOM_ID}] // ID:[${USERNAME}]`);
            injectChatUI();
            socket.emit('chat_message', {
                roomId: ROOM_ID,
                text: "rejoined after navigation.",
                sender: USERNAME,
                isSystem: true
            });
        };
        if (socket.connected) doRejoin();
        else socket.once('connect', doRejoin);
    } catch (e) {
        console.error('WP: session restore error', e);
    }
})();

socket.on('connect', () => console.log(`🔗 Connected: ${socket.id}`));

// =====================================================
// AUTO-JOIN FROM MAGIC LINK  (?wp=roomname in the URL)
// Friend opens the copied link → extension reads the
// ?wp= param and silently joins the room. No popup needed.
// =====================================================
(function autoJoinFromUrl() {
    const params  = new URLSearchParams(window.location.search);
    const wpRoom  = params.get('wp');
    if (!wpRoom) return;

    // If restoreSessionIfNeeded already handled a session, don't double-join
    const saved = sessionStorage.getItem('wp_session');
    if (saved) {
        try {
            const { room } = JSON.parse(saved);
            if (room === wpRoom) return; // already in this room
        } catch {}
    }

    const doAutoJoin = (username) => {
        ROOM_ID  = wpRoom;
        USERNAME = username || 'Guest';
        sessionStorage.setItem('wp_session', JSON.stringify({ room: ROOM_ID, username: USERNAME }));
        socket.emit('join_room', ROOM_ID);
        showNotification(`AUTO-JOIN: [${ROOM_ID}] // ID:[${USERNAME}]`);
        injectChatUI();
        socket.emit('chat_message', {
            roomId:   ROOM_ID,
            text:     "joined via party link.",
            sender:   USERNAME,
            isSystem: true
        });
    };

    // Pull their previously saved username (set by popup.js on last manual join)
    // Wrapped in try/catch in case "storage" permission is missing from manifest.json
    const joinWithUsername = (username) => {
        if (socket.connected) doAutoJoin(username);
        else socket.once('connect', () => doAutoJoin(username));
    };
    try {
        chrome.storage.local.get('wp_username', (result) => {
            joinWithUsername((result && result.wp_username) ? result.wp_username : 'Guest');
        });
    } catch (e) {
        // "storage" permission missing from manifest.json — falling back to Guest
        // Fix: add "storage" to permissions array in manifest.json
        console.warn('WP: Add "storage" to manifest.json permissions to restore usernames.');
        joinWithUsername('Guest');
    }
})();

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "join_room") {
        ROOM_ID  = request.room;
        USERNAME = request.username;
        sessionStorage.setItem('wp_session', JSON.stringify({ room: ROOM_ID, username: USERNAME }));
        socket.emit('join_room', ROOM_ID);
        showNotification(`SYS.CONNECT: [${ROOM_ID}] // ID:[${USERNAME}]`);
        injectChatUI();
        socket.emit('chat_message', { roomId: ROOM_ID, text: "has jacked into the stream.", sender: USERNAME, isSystem: true });
    }
});

// =====================================================
// PLATFORM DETECTION
// =====================================================
const PLATFORMS = {
    youtube: {
        match: () => location.hostname.includes('youtube.com'),
        squishSelectors: ['ytd-app','ytd-masthead','body','html'],
        sidebarMode: 'squish',
        isAd: () => !!document.querySelector('.ad-showing,.ytp-ad-player-overlay,.ytp-ad-text'),
        // YouTube handles full href navigation fine
        navigate: (url) => { window.location.href = url; }
    },
    netflix: {
        match: () => location.hostname.includes('netflix.com'),
        squishSelectors: ['.watch-video','.NFPlayer','body','html'],
        sidebarMode: 'overlay',
        isAd: () => false,
        // Netflix M7375: NEVER use window.location.href on watch URLs.
        // Use history.pushState so Netflix's own SPA router picks it up
        // without triggering the DRM "programmatic navigation" block.
        navigate: (url) => {
            try {
                const u = new URL(url);
                // Only SPA-navigate watch pages; let other Netflix pages do a normal load
                if (u.pathname.startsWith('/watch')) {
                    history.pushState({}, '', url);
                    // Dispatch a popstate so Netflix's router reacts
                    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
                    // Also try clicking a matching link if Netflix rendered one
                    const link = document.querySelector(`a[href*="${u.pathname}"]`);
                    if (link) link.click();
                } else {
                    window.location.href = url;
                }
            } catch {
                window.location.href = url;
            }
        }
    },
    prime: {
        match: () => location.hostname.includes('amazon.com') || location.hostname.includes('primevideo.com'),
        squishSelectors: ['.webPlayerSDKContainer','.dv-player-fullscreen','body','html'],
        sidebarMode: 'overlay',
        isAd: () => !!document.querySelector('.atvwebplayersdk-ad-timer-remaining,[data-testid="ad-badge"]'),
        // Prime Video also uses a SPA router — pushState avoids their equivalent of M7375
        navigate: (url) => {
            try {
                history.pushState({}, '', url);
                window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
            } catch {
                window.location.href = url;
            }
        }
    },
    disney: {
        match: () => location.hostname.includes('disneyplus.com'),
        squishSelectors: ['.hudson-container','body','html'],
        sidebarMode: 'overlay',
        isAd: () => !!document.querySelector('.ad-overlay,[class*="AdContainer"]'),
        navigate: (url) => { window.location.href = url; }
    },
    hbo: {
        match: () => location.hostname.includes('max.com') || location.hostname.includes('hbomax.com'),
        squishSelectors: ['.watch-player','body','html'],
        sidebarMode: 'overlay',
        isAd: () => !!document.querySelector('[class*="ad-label"],[class*="AdContainer"]'),
        navigate: (url) => { window.location.href = url; }
    },
    hulu: {
        match: () => location.hostname.includes('hulu.com'),
        squishSelectors: ['.site-player','body','html'],
        sidebarMode: 'overlay',
        isAd: () => !!document.querySelector('.ad-countdown,[class*="AdContainer"]'),
        navigate: (url) => { window.location.href = url; }
    },
    // HiAnime: video lives inside a cross-origin iframe (MegaPlay/AniWatch player)
    // Direct <video> access is blocked by browser security (same-origin policy).
    // We use postMessage to control the player and listen for its events instead.
    hianime: {
        match: () => location.hostname.includes('hianime.biz.pl'),
        squishSelectors: ['body','html'],
        sidebarMode: 'overlay',
        isAd: () => false,
        navigate: (url) => { window.location.href = url; },
        getIframe: () => document.querySelector(
            'iframe[src*="megaplay.buzz"], iframe[src*="animeplay.cfd"], iframe[src*="hianimeapi"]'
        ),
        postCmd: (cmd) => {
            const iframe = PLATFORMS.hianime.getIframe();
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage(cmd, '*');
            }
        }
    },
    streamiloo: {
        match: () => location.hostname === 'streamiloo.to' || location.hostname.endsWith('.streamiloo.to'),
        squishSelectors: ['body','html'],
        sidebarMode: 'overlay',
        isAd: () => false,
        navigate: (url) => { window.location.href = url; },
        usesPlayerBridge: true,
        getIframe: () => document.querySelector(
            '#playerFrame, iframe[src*="vidsrc.mov"], iframe[src*="vsembed.ru"]'
        ),
        postCmd: (command, currentTime) => {
            const iframe = PLATFORMS.streamiloo.getIframe();
            if (!iframe?.contentWindow) return;
            iframe.contentWindow.postMessage({
                source: 'watch-party-player-bridge',
                kind: 'command',
                command,
                currentTime
            }, '*');
        }
    },
};

function detectPlatform() {
    for (const [name, cfg] of Object.entries(PLATFORMS)) if (cfg.match()) return { name, ...cfg };
    return {
        name: 'generic',
        squishSelectors: ['body','html'],
        sidebarMode: 'overlay',
        isAd: () => false,
        navigate: (url) => { window.location.href = url; }
    };
}
const PLATFORM = detectPlatform();

// =====================================================
// SMART VIDEO FINDER
// =====================================================
let video = null, isRemoteAction = false, videoListenersAttached = false;

function findBestVideo() {
    const all = Array.from(document.querySelectorAll('video'));
    if (!all.length) return null;
    return all.reduce((best, v) => {
        if (!best) return v;
        if (!v.paused && best.paused) return v;
        if (v.duration > (best.duration || 0)) return v;
        return best;
    }, null);
}
function tryAttachVideo() {
    // HiAnime: no direct <video> access — attach once the iframe is present instead
    if (PLATFORM.name === 'hianime') {
        if (!videoListenersAttached) {
            const iframe = PLATFORMS.hianime.getIframe();
            if (iframe) {
                videoListenersAttached = true;
                video = true; // sentinel so pollers stop
                attachVideoListeners();
            }
        }
        return;
    }
    if (PLATFORM.usesPlayerBridge) {
        if (!videoListenersAttached && PLATFORM.getIframe()) {
            videoListenersAttached = true;
            video = true; // sentinel: the real video belongs to a cross-origin frame
            attachVideoListeners();
        }
        return;
    }

    const found = findBestVideo();
    if (found && found !== video) {
        video = found;
        if (!videoListenersAttached) { videoListenersAttached = true; attachVideoListeners(); }
    }
}
const _vPoll = setInterval(() => { tryAttachVideo(); if (video) clearInterval(_vPoll); }, 800);
new MutationObserver(() => { if (!video) tryAttachVideo(); }).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (PLATFORM.usesPlayerBridge || PLATFORM.name === 'hianime') {
        if (!videoListenersAttached) tryAttachVideo();
        return;
    }
    const fresh = findBestVideo();
    if (fresh && fresh !== video) { video = fresh; videoListenersAttached = false; attachVideoListeners(); videoListenersAttached = true; }
});

// =====================================================
// VOICE CALL STATE
// =====================================================
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let localStream = null, peerConnections = {}, isMuted = false, isInCall = false;

// =====================================================
// NOTIFICATIONS
// =====================================================
function showNotification(msg) {
    const t = document.createElement('div');
    t.innerText = msg;
    t.style.cssText = `position:fixed;top:20px;right:20px;background:rgba(10,10,15,0.97);color:#ff003c;padding:15px 25px;z-index:2147483647;font-size:16px;font-weight:bold;font-family:'Share Tech Mono',monospace;border:2px solid #ff003c;box-shadow:0 0 10px #ff003c,inset 0 0 10px rgba(255,0,60,0.3);pointer-events:none;text-transform:uppercase;`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

function formatTime(s) {
    if (!isFinite(s) || s < 0) return '??:??';
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

// =====================================================
// AD WATCHER — MutationObserver
// =====================================================
let isInAd = false, isBuffering = false, _adObserver = null;

function startAdWatcher() {
    if (_adObserver) return;
    _adObserver = new MutationObserver(() => {
        if (!ROOM_ID) return;
        const adNow = PLATFORM.isAd();
        if (adNow && !isInAd)      { isInAd = true;  socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'ad_start' }); }
        else if (!adNow && isInAd) { isInAd = false; socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'ad_end'   }); }
    });
    _adObserver.observe(document.body, { childList: true, subtree: true });
}
function stopAdWatcher() {
    if (_adObserver) { _adObserver.disconnect(); _adObserver = null; }
    isInAd = false;
}

// =====================================================
// VIDEO LISTENERS
// =====================================================
function attachVideoListeners() {
    // ── HiAnime: video is inside a cross-origin iframe ──────────────
    // We can't access video directly. Use postMessage to control the
    // MegaPlay iframe player and listen for its events via window.message.
    if (PLATFORM.name === 'hianime') {
        attachHiAnimeListeners();
        return;
    }
    if (PLATFORM.usesPlayerBridge) {
        attachPlayerBridgeListeners();
        return;
    }

    if (!video) return;
    startAdWatcher();
    video.addEventListener('play',    () => { if (isRemoteAction || isInAd) return; socket.emit('sync_state',  { roomId: ROOM_ID, action: 'play',   time: video.currentTime }); socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'play',  timestamp: formatTime(video.currentTime) }); });
    video.addEventListener('pause',   () => { if (isRemoteAction || isInAd) return; socket.emit('sync_state',  { roomId: ROOM_ID, action: 'pause',  time: video.currentTime }); socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'pause', timestamp: formatTime(video.currentTime) }); });
    video.addEventListener('seeked',  () => { if (isRemoteAction) return;            socket.emit('sync_state',  { roomId: ROOM_ID, action: 'seeked', time: video.currentTime }); socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'seek',  timestamp: formatTime(video.currentTime) }); });
    video.addEventListener('waiting', () => { if (isInAd || isBuffering) return; isBuffering = true;  socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_start' }); });
    video.addEventListener('canplay', () => { if (!isBuffering) return;           isBuffering = false; socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_end'   }); });

    socket.off('sync_state');
    socket.on('sync_state', (data) => {
        if (!video) return;
        isRemoteAction = true;
        if (Math.abs(video.currentTime - data.time) > 0.5) video.currentTime = data.time;
        if (data.action === 'play')  video.play().catch(() => {});
        if (data.action === 'pause') video.pause();
        if (data.message) showNotification(data.message);
        setTimeout(() => { isRemoteAction = false; }, 800);
    });
    socket.on('latecomer_arrived', (data) => {
        video.pause();
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'pause', time: video.currentTime, message: `GUEST_${data.newUserId} DETECTED. SYNCING...` });
    });
}

// =====================================================
// STREAMILOO — cross-origin nested iframe sync
// =====================================================
let _bridgeCurrentTime = 0;

function attachPlayerBridgeListeners() {
    startAdWatcher();

    window.addEventListener('message', (event) => {
        const iframe = PLATFORM.getIframe();
        if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;

        const msg = event.data;
        if (!msg || msg.source !== 'watch-party-player-bridge' || msg.kind !== 'event') return;
        if (Number.isFinite(Number(msg.currentTime))) _bridgeCurrentTime = Number(msg.currentTime);
        if (isRemoteAction) return;

        if (msg.event === 'play' || msg.event === 'pause' || msg.event === 'seeked') {
            socket.emit('sync_state', {
                roomId: ROOM_ID,
                action: msg.event,
                time: _bridgeCurrentTime
            });
            socket.emit('user_status', {
                roomId: ROOM_ID,
                sender: USERNAME,
                type: msg.event === 'seeked' ? 'seek' : msg.event,
                timestamp: formatTime(_bridgeCurrentTime)
            });
        }
        if (msg.event === 'buffering' && !isBuffering) {
            isBuffering = true;
            socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_start' });
        }
        if (msg.event === 'canplay' && isBuffering) {
            isBuffering = false;
            socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_end' });
        }
    });

    socket.off('sync_state');
    socket.on('sync_state', (data) => {
        isRemoteAction = true;
        _bridgeCurrentTime = Number(data.time) || 0;
        PLATFORM.postCmd(data.action === 'seeked' ? 'seek' : data.action, _bridgeCurrentTime);
        if (data.message) showNotification(data.message);
        setTimeout(() => { isRemoteAction = false; }, 900);
    });

    socket.on('latecomer_arrived', (data) => {
        PLATFORM.postCmd('pause', _bridgeCurrentTime);
        socket.emit('sync_state', {
            roomId: ROOM_ID,
            action: 'pause',
            time: _bridgeCurrentTime,
            message: `GUEST_${data.newUserId} DETECTED. SYNCING...`
        });
    });

    showNotification('STREAMILOO SYNC ACTIVE');
}

// =====================================================
// HIANIME — postMessage iframe sync
// MegaPlay player sends events via window.postMessage
// and accepts commands the same way.
// =====================================================
let _hiAnimeCurrentTime = 0; // track time since we can't read it directly

function attachHiAnimeListeners() {
    startAdWatcher();

    // Listen for events FROM the MegaPlay iframe player
    window.addEventListener('message', (event) => {
        // Only process messages from known player origins
        if (!event.origin.includes('megaplay') &&
            !event.origin.includes('animeplay') &&
            !event.origin.includes('hianimeapi')) return;

        const msg = event.data;
        if (!msg || !msg.type) return;

        // MegaPlay emits: { type: 'timeupdate', currentTime: N }
        // { type: 'play' } { type: 'pause' } { type: 'seeked', currentTime: N }
        if (msg.type === 'timeupdate' && msg.currentTime !== undefined) {
            _hiAnimeCurrentTime = msg.currentTime;
        }

        if (isRemoteAction) return;

        if (msg.type === 'play') {
            socket.emit('sync_state',  { roomId: ROOM_ID, action: 'play',   time: _hiAnimeCurrentTime });
            socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'play',  timestamp: formatTime(_hiAnimeCurrentTime) });
        }
        if (msg.type === 'pause') {
            socket.emit('sync_state',  { roomId: ROOM_ID, action: 'pause',  time: _hiAnimeCurrentTime });
            socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'pause', timestamp: formatTime(_hiAnimeCurrentTime) });
        }
        if (msg.type === 'seeked') {
            _hiAnimeCurrentTime = msg.currentTime || _hiAnimeCurrentTime;
            socket.emit('sync_state',  { roomId: ROOM_ID, action: 'seeked', time: _hiAnimeCurrentTime });
            socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'seek',  timestamp: formatTime(_hiAnimeCurrentTime) });
        }
        if (msg.type === 'buffering') {
            if (!isBuffering) { isBuffering = true;  socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_start' }); }
        }
        if (msg.type === 'buffered' || msg.type === 'canplay') {
            if (isBuffering)  { isBuffering = false; socket.emit('user_status', { roomId: ROOM_ID, sender: USERNAME, type: 'buffer_end'   }); }
        }
    });

    // Helper: send a command to the iframe player
    function sendToPlayer(cmd) {
        const iframe = PLATFORMS.hianime.getIframe();
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(cmd, '*');
        }
    }

    // Receive sync commands from other party members
    socket.off('sync_state');
    socket.on('sync_state', (data) => {
        isRemoteAction = true;

        if (data.action === 'play') {
            // Seek to correct time first, then play
            sendToPlayer({ type: 'seek',  currentTime: data.time });
            sendToPlayer({ type: 'play'  });
        }
        if (data.action === 'pause') {
            sendToPlayer({ type: 'seek',  currentTime: data.time });
            sendToPlayer({ type: 'pause' });
        }
        if (data.action === 'seeked') {
            sendToPlayer({ type: 'seek',  currentTime: data.time });
        }
        if (data.message) showNotification(data.message);
        setTimeout(() => { isRemoteAction = false; }, 800);
    });

    socket.on('latecomer_arrived', (data) => {
        sendToPlayer({ type: 'pause' });
        socket.emit('sync_state', {
            roomId:  ROOM_ID,
            action:  'pause',
            time:    _hiAnimeCurrentTime,
            message: `GUEST_${data.newUserId} DETECTED. SYNCING...`
        });
    });

    console.log('✅ Watch Party: HiAnime postMessage sync active');
    showNotification('HIANIME SYNC ACTIVE');
}

// =====================================================
// NAVIGATE TO URL — platform-aware, no DRM triggers
// =====================================================
socket.on('navigate_to', (data) => {
    const { url } = data;
    if (!url) return;

    // Already on this URL — don't navigate, just sync video time
    if (window.location.href === url) {
        showNotification(`▶ ALREADY HERE: syncing...`);
        return;
    }

    // Save session BEFORE any navigation attempt
    if (ROOM_ID) {
        sessionStorage.setItem('wp_session', JSON.stringify({ room: ROOM_ID, username: USERNAME }));
    }

    showNotification(`▶ LOADING: ${data.title || url}`);

    // For SPA platforms (Netflix, Prime) — don't tear down the observer/video
    // because pushState keeps the page alive. For href-based platforms, clean up.
    const isSPA = ['netflix', 'prime'].includes(PLATFORM.name);

    if (!isSPA) {
        video = null;
        videoListenersAttached = false;
        stopAdWatcher();
    }

    // Delay slightly so the notification is visible, then use platform navigate
    setTimeout(() => {
        PLATFORM.navigate(url);

        // For SPA platforms: after pushState the video element is replaced —
        // re-run the video finder after a short wait for the player to mount
        if (isSPA) {
            video = null;
            videoListenersAttached = false;
            setTimeout(() => { tryAttachVideo(); }, 2000);
        }
    }, 800);
});

socket.on('queue_empty', () => {
    appendStatusMessage('📭 Queue is empty — add something to watch!', 'buffer');
    renderQueue([], IS_HOST);
});

// =====================================================
// USER STATUS → CHAT
// =====================================================
socket.on('user_status', (data) => {
    const { sender, type, timestamp } = data;
    const msgs = { play: `▶ ${sender} played at ${timestamp}`, pause: `⏸ ${sender} paused at ${timestamp}`, seek: `⏩ ${sender} skipped to ${timestamp}`, ad_start: `📺 ${sender} is watching an ad — room paused`, ad_end: `✅ ${sender}'s ad finished — resuming`, buffer_start: `⏳ ${sender} is buffering...`, buffer_end: `✅ ${sender} finished buffering` };
    if (msgs[type]) appendStatusMessage(msgs[type], type);
    if (type === 'ad_start' && video && !isInAd) {
        isRemoteAction = true;
        if (PLATFORM.usesPlayerBridge) PLATFORM.postCmd('pause', _bridgeCurrentTime);
        else video.pause();
        setTimeout(() => { isRemoteAction = false; }, 800);
    }
    if (type === 'ad_end' && video) {
        isRemoteAction = true;
        if (PLATFORM.usesPlayerBridge) PLATFORM.postCmd('play', _bridgeCurrentTime);
        else video.play().catch(() => {});
        setTimeout(() => { isRemoteAction = false; }, 800);
    }
});

// =====================================================
// VIEWER COUNT
// =====================================================
socket.on('room_count', (data) => {
    const el = document.getElementById('wp-viewer-count');
    if (el) el.textContent = `👁 ${data.count} WATCHING`;
});

// =====================================================
// EMOJI OVERLAY
// =====================================================
function ensureOverlayLayer() {
    if (document.getElementById('wp-emoji-overlay')) return;
    const o = document.createElement('div');
    o.id = 'wp-emoji-overlay';
    o.style.cssText = `position:fixed;top:0;left:0;width:calc(100% - 350px);height:100%;pointer-events:none;z-index:2147483640;overflow:hidden;`;
    document.body.appendChild(o);
    const s = document.createElement('style');
    s.textContent = `@keyframes wp-float-up{0%{transform:translateY(0) scale(1);opacity:1}60%{transform:translateY(-55vh) scale(1.15);opacity:.9}100%{transform:translateY(-80vh) scale(.8);opacity:0}}.wp-floating-emoji{position:absolute;bottom:15%;font-size:36px;animation:wp-float-up 2.6s ease-out forwards;pointer-events:none;user-select:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}`;
    document.head.appendChild(s);
}
function floatEmojiOnVideo(emoji) {
    ensureOverlayLayer();
    const o = document.getElementById('wp-emoji-overlay');
    if (!o) return;
    const el = document.createElement('span');
    el.className = 'wp-floating-emoji';
    el.textContent = emoji;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.animationDelay = `${Math.random() * 0.15}s`;
    o.appendChild(el);
    setTimeout(() => el.remove(), 2800);
}
socket.on('reaction', (data) => { floatEmojiOnVideo(data.emoji); appendMessage(data.sender, data.emoji, 'receiver'); });

// =====================================================
// TYPING INDICATOR
// =====================================================
let typingTimeout = null;
function setTypingIndicator(name, visible) {
    let el = document.getElementById('wp-typing-indicator');
    if (!visible) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'wp-typing-indicator'; el.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 16px 8px;font-family:'Share Tech Mono',monospace;`; }
    el.innerHTML = `<div style="display:flex;align-items:center;gap:6px;"><div style="background:rgba(0,0,0,0.88);border:1px solid #0ff;padding:5px 10px;display:flex;align-items:center;gap:6px;box-shadow:inset 0 0 6px #0ff;"><span style="font-size:11px;color:#0ff;text-transform:uppercase;font-weight:bold;">${name} IS UPLOADING</span><div style="display:flex;gap:3px;align-items:center;"><span class="wp-dot" style="animation-delay:0s"></span><span class="wp-dot" style="animation-delay:.2s"></span><span class="wp-dot" style="animation-delay:.4s"></span></div></div></div>`;
    const box = document.getElementById('wp-chat-box');
    if (box) { box.appendChild(el); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); }
}
socket.on('user_typing',  (d) => setTypingIndicator(d.sender, true));
socket.on('user_stopped', (d) => setTypingIndicator(d.sender, false));

// =====================================================
// VOICE CALL
// =====================================================
function createPeerConnection(id) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice_candidate', { to: id, candidate: e.candidate }); };
    pc.ontrack = (e) => playRemoteAudio(id, e.streams[0]);
    localStream?.getTracks().forEach(t => pc.addTrack(t, localStream));
    peerConnections[id] = pc;
    return pc;
}
function playRemoteAudio(id, stream) {
    document.getElementById(`wp-audio-${id}`)?.remove();
    const a = document.createElement('audio');
    a.id = `wp-audio-${id}`; a.srcObject = stream; a.autoplay = true; a.style.display = 'none';
    document.body.appendChild(a);
}
function closePeerConnection(id) { peerConnections[id]?.close(); delete peerConnections[id]; document.getElementById(`wp-audio-${id}`)?.remove(); }
function endCall() {
    localStream?.getTracks().forEach(t => t.stop()); localStream = null;
    Object.keys(peerConnections).forEach(closePeerConnection);
    isInCall = false; isMuted = false; updateCallUI(false);
    socket.emit('voice_call_ended', { roomId: ROOM_ID, sender: USERNAME });
    appendSystemVoiceMessage('COMMS LINK SEVERED.');
}
function updateCallUI(inCall) {
    const s = document.getElementById('wp-call-start'), e = document.getElementById('wp-call-end'), m = document.getElementById('wp-call-mute'), st = document.getElementById('wp-call-status');
    if (!s) return;
    s.style.display = inCall ? 'none' : 'flex'; e.style.display = inCall ? 'flex' : 'none'; m.style.display = inCall ? 'flex' : 'none';
    if (st) { st.style.display = inCall ? 'flex' : 'none'; st.innerText = 'AUDIO: LIVE'; }
}
function appendSystemVoiceMessage(text) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    const el = document.createElement('div');
    el.style.cssText = "text-align:center;color:#f0ea00;font-size:12px;font-weight:bold;margin:8px 0;text-transform:uppercase;font-family:'Share Tech Mono',monospace;text-shadow:0 0 5px #f0ea00;border-top:1px dashed #f0ea00;border-bottom:1px dashed #f0ea00;padding:5px 0;position:relative;z-index:2;background:rgba(0,0,0,0.7);";
    el.innerText = text; box.appendChild(el); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}
socket.on('voice_call_incoming', async (data) => {
    appendSystemVoiceMessage(`OVERRIDE: ${data.sender} INITIATED COMMS...`);
    showNotification(`INCOMING TRANSMISSION: ${data.sender}`);
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isInCall = true; updateCallUI(true);
        const pc = createPeerConnection(data.from);
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        socket.emit('voice_offer', { to: data.from, offer });
    } catch { appendSystemVoiceMessage('ERR: MIC ACCESS DENIED.'); }
});
socket.on('voice_offer',  async (data) => { if (!localStream) return; const pc = createPeerConnection(data.from); await pc.setRemoteDescription(new RTCSessionDescription(data.offer)); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); socket.emit('voice_answer', { to: data.from, answer: ans }); });
socket.on('voice_answer', async (data) => { const pc = peerConnections[data.from]; if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); });
socket.on('ice_candidate', async (data) => { const pc = peerConnections[data.from]; if (pc && data.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {} } });
socket.on('voice_call_ended', (data) => { appendSystemVoiceMessage(`COMMS TERMINATED BY ${data.sender}.`); Object.keys(peerConnections).forEach(closePeerConnection); localStream?.getTracks().forEach(t => t.stop()); localStream = null; isInCall = false; updateCallUI(false); });
socket.on('voice_peer_disconnected', (data) => closePeerConnection(data.socketId));

// =====================================================
// CHAT MESSAGES
// =====================================================
socket.on('chat_message', (data) => {
    setTypingIndicator(data.sender, false);
    appendMessage(data.sender, data.text, data.isSystem ? 'system' : 'receiver');
});

// =====================================================
// QUEUE STATE & RENDER
// =====================================================
let currentQueue = [];

socket.on('queue_update', (data) => {
    currentQueue = data.queue || [];
    IS_HOST = (data.host === socket.id);
    renderQueue(currentQueue, IS_HOST);
    const badge = document.getElementById('wp-host-badge');
    if (badge) badge.style.display = IS_HOST ? 'inline-block' : 'none';
});

function renderQueue(queue, isHost) {
    const container = document.getElementById('wp-queue-list');
    if (!container) return;
    container.innerHTML = '';
    if (!queue.length) {
        container.innerHTML = `<div class="wp-queue-empty"><div class="wp-queue-empty-icon">📭</div><div class="wp-queue-empty-text">QUEUE IS EMPTY</div><div class="wp-queue-empty-sub">Add a URL above to start the party</div></div>`;
        return;
    }
    queue.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'wp-queue-item';
        el.innerHTML = `
            <div class="wp-queue-item-num">${String(idx + 1).padStart(2,'0')}</div>
            <div class="wp-queue-item-info">
                <div class="wp-queue-item-title">${escapeHtml(item.title)}</div>
                <div class="wp-queue-item-meta">BY ${escapeHtml(item.addedBy).toUpperCase()}</div>
            </div>
            <div class="wp-queue-item-actions">
                ${isHost ? `<button class="wp-q-btn wp-q-play" data-id="${item.id}" title="Play now">▶</button>` : ''}
                ${isHost ? `<button class="wp-q-btn wp-q-del"  data-id="${item.id}" title="Remove">✕</button>` : ''}
            </div>`;
        container.appendChild(el);
    });
    if (isHost) {
        container.querySelectorAll('.wp-q-play').forEach(btn => { btn.addEventListener('click', () => socket.emit('queue_play_item', { roomId: ROOM_ID, itemId: Number(btn.dataset.id) })); });
        container.querySelectorAll('.wp-q-del').forEach(btn  => { btn.addEventListener('click', () => socket.emit('queue_remove',    { roomId: ROOM_ID, itemId: Number(btn.dataset.id) })); });
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =====================================================
// MATRIX GRID
// =====================================================
function initMatrixGrid(containerEl) {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>/?;:"[]{}\\|!@#$%^&*()_+-=';
    const gridEl = containerEl.querySelector('#wp-matrix-grid');
    const buildGrid = () => {
        gridEl.innerHTML = '';
        const cols = Math.floor(containerEl.offsetWidth / 28), rows = Math.floor(containerEl.offsetHeight / 28);
        gridEl.style.setProperty('--wp-mcols', cols); gridEl.style.setProperty('--wp-mrows', rows);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < cols * rows; i++) {
            const tile = document.createElement('span');
            tile.className = 'wp-mtile';
            tile.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
            tile.addEventListener('click', () => { tile.textContent = CHARS[Math.floor(Math.random() * CHARS.length)]; tile.classList.add('wp-mtile-glitch'); setTimeout(() => tile.classList.remove('wp-mtile-glitch'), 220); });
            frag.appendChild(tile);
        }
        gridEl.appendChild(frag);
    };
    const onMove = (e) => {
        const rect = containerEl.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top, r = rect.width * 1.2;
        for (const tile of gridEl.children) { const tr = tile.getBoundingClientRect(); tile.style.setProperty('--wp-mi', Math.max(0, 1 - Math.sqrt((mx-(tr.left-rect.left+tr.width/2))**2+(my-(tr.top-rect.top+tr.height/2))**2)/r)); }
    };
    setInterval(() => { const t = gridEl.children; if (!t.length) return; for (let i=0;i<Math.max(1,Math.floor(t.length*.015));i++) t[Math.floor(Math.random()*t.length)].textContent=CHARS[Math.floor(Math.random()*CHARS.length)]; }, 120);
    new ResizeObserver(buildGrid).observe(containerEl);
    containerEl.addEventListener('mousemove', onMove);
    containerEl.addEventListener('mouseleave', () => { for (const t of gridEl.children) t.style.setProperty('--wp-mi',0); });
    buildGrid();
}

// =====================================================
// SQUISH
// =====================================================
function setSquish(isDocked) {
    const W = 350;
    if (PLATFORM.sidebarMode === 'squish') {
        const w = isDocked ? `calc(100% - ${W}px)` : '100%';
        document.documentElement.style.width = w; document.body.style.width = w;
        PLATFORM.squishSelectors.forEach(sel => { const el = document.querySelector(sel); if (el) el.style.width = w; });
    } else {
        const p = isDocked ? `${W}px` : '0px';
        document.body.style.paddingRight = p; document.documentElement.style.paddingRight = p;
        PLATFORM.squishSelectors.forEach(sel => { const el = document.querySelector(sel); if (el) { el.style.boxSizing='border-box'; el.style.paddingRight=p; } });
    }
    const ov = document.getElementById('wp-emoji-overlay');
    if (ov) ov.style.width = isDocked ? `calc(100% - ${W}px)` : '100%';
}

// =====================================================
// COPY PARTY LINK
// =====================================================
function copyPartyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('wp', ROOM_ID);
    navigator.clipboard.writeText(url.toString()).then(() => {
        showNotification('🔗 PARTY LINK COPIED!');
        const btn = document.getElementById('wp-copy-link-btn');
        if (btn) { btn.innerText = 'COPIED!'; setTimeout(() => { btn.innerText = '🔗 LINK'; }, 2000); }
    }).catch(() => showNotification('ERR: CLIPBOARD ACCESS DENIED'));
}

// =====================================================
// INJECT CHAT UI
// =====================================================
function injectChatUI() {
    if (document.getElementById('wp-chat-container')) return;

    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    const style = document.createElement('style');
    style.textContent = `
        :root { --cy-bg:#07070c; --cy-cyan:#0ff; --cy-pink:#ff003c; --cy-yellow:#f0ea00; --cy-green:#00ff88; }

        #wp-matrix-grid { display:grid;grid-template-columns:repeat(var(--wp-mcols,10),1fr);grid-template-rows:repeat(var(--wp-mrows,20),1fr);position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:hidden; }
        .wp-mtile { pointer-events:all;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-size:.72rem;cursor:default;user-select:none;opacity:calc(.06 + var(--wp-mi,0)*.85);color:hsl(120,100%,calc(40% + var(--wp-mi,0)*42%));text-shadow:0 0 calc(var(--wp-mi,0)*12px) hsl(120,100%,55%);transform:scale(calc(1+var(--wp-mi,0)*.18));transition:color .18s,text-shadow .18s,opacity .18s,transform .18s; }
        .wp-mtile-glitch { animation:wp-tile-glitch .22s ease !important; }
        @keyframes wp-tile-glitch { 0%{transform:scale(1);color:#0f0} 50%{transform:scale(1.3);color:#fff;text-shadow:0 0 10px #fff} 100%{transform:scale(1);color:#0f0} }

        #wp-chat-container { position:fixed;top:0;right:0;width:350px;height:100vh;background:rgba(7,7,12,.97);color:var(--cy-cyan);z-index:2147483646;display:flex;flex-direction:column;font-family:'Share Tech Mono',monospace;border-left:2px solid var(--cy-pink);box-shadow:-5px 0 25px rgba(255,0,60,.5),inset 0 0 40px rgba(0,255,255,.04);transition:transform .3s cubic-bezier(.4,0,.2,1);overflow:visible; }
        #wp-chat-container.hidden { transform:translateX(100%); }
        #wp-chat-container::after { content:"";position:absolute;inset:0;background:linear-gradient(rgba(18,16,16,0) 50%,rgba(0,0,0,.1) 50%),linear-gradient(90deg,rgba(255,0,0,.03),rgba(0,255,0,.01),rgba(0,0,255,.03));background-size:100% 3px,3px 100%;pointer-events:none;z-index:9998;overflow:hidden; }

        #wp-toggle-tab { position:absolute;left:-42px;top:50vh;transform:translateY(-50%);width:40px;height:60px;background:rgba(7,7,12,.98);color:var(--cy-pink);border:2px solid var(--cy-pink);border-right:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:-4px 0 12px rgba(255,0,60,.5);transition:background .1s,color .1s;text-shadow:0 0 6px var(--cy-pink);z-index:10000;font-family:'Share Tech Mono',monospace; }
        #wp-toggle-tab:hover { background:var(--cy-pink);color:#000;box-shadow:-4px 0 20px var(--cy-pink); }

        #wp-chat-header { background:rgba(7,7,12,.99);padding:10px 14px;font-weight:bold;font-size:13px;display:flex;flex-direction:column;gap:7px;border-bottom:2px solid var(--cy-cyan);text-transform:uppercase;letter-spacing:1px;box-shadow:0 4px 12px rgba(0,255,255,.2);position:relative;z-index:10; }
        #wp-header-top { display:flex;justify-content:space-between;align-items:center;gap:6px;text-shadow:0 0 6px var(--cy-cyan); }
        #wp-header-top span:first-child { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        #wp-host-badge { display:none;font-size:9px;color:var(--cy-yellow);border:1px solid var(--cy-yellow);padding:2px 6px;text-shadow:0 0 4px var(--cy-yellow);white-space:nowrap;flex-shrink:0; }
        #wp-platform-badge { font-size:9px;color:#555;border:1px solid #333;padding:2px 6px;white-space:nowrap;flex-shrink:0; }
        #wp-header-meta { display:flex;align-items:center;justify-content:space-between;gap:8px; }
        #wp-viewer-count { font-size:10px;color:#666;letter-spacing:1px; }
        #wp-copy-link-btn { background:transparent;border:1px solid #444;color:#888;padding:3px 8px;font-size:10px;font-family:'Share Tech Mono',monospace;font-weight:bold;cursor:pointer;text-transform:uppercase;transition:all .2s;letter-spacing:1px;white-space:nowrap; }
        #wp-copy-link-btn:hover { border-color:var(--cy-cyan);color:var(--cy-cyan);box-shadow:0 0 6px rgba(0,255,255,.4); }
        #wp-copy-link-btn:active { transform:translate(1px,1px); }

        #wp-call-bar { display:flex;align-items:center;gap:7px;flex-wrap:wrap; }
        #wp-call-status { font-size:11px;color:var(--cy-yellow);font-weight:bold;display:none;align-items:center;gap:4px;flex:1;text-shadow:0 0 5px var(--cy-yellow); }
        #wp-call-status::before { content:'>';animation:wp-blink 1s infinite; }
        @keyframes wp-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .wp-call-btn { border:1px solid;border-radius:0;cursor:pointer;padding:5px 8px;font-size:10px;font-family:'Share Tech Mono',monospace;font-weight:bold;display:flex;align-items:center;gap:4px;transition:all .2s;text-transform:uppercase;background:transparent; }
        .wp-call-btn:active { transform:translate(2px,2px); }
        #wp-call-start { border-color:var(--cy-cyan);color:var(--cy-cyan);box-shadow:inset 0 0 5px var(--cy-cyan); }
        #wp-call-start:hover { background:var(--cy-cyan);color:#000; }
        #wp-call-end { border-color:var(--cy-pink);color:var(--cy-pink);display:none;box-shadow:inset 0 0 5px var(--cy-pink); }
        #wp-call-end:hover { background:var(--cy-pink);color:#000; }
        #wp-call-mute { border-color:#888;color:#888;display:none; }
        #wp-call-mute:hover { border-color:#fff;color:#fff; }
        #wp-call-mute.muted { border-color:var(--cy-yellow);color:var(--cy-yellow); }

        #wp-tab-nav { display:flex;background:rgba(0,0,0,.6);border-bottom:1px solid rgba(0,255,255,.15);position:relative;z-index:10; }
        .wp-tab-btn { flex:1;padding:8px 0;font-size:11px;font-family:'Share Tech Mono',monospace;font-weight:bold;text-transform:uppercase;letter-spacing:1px;border:none;background:transparent;color:#555;cursor:pointer;transition:all .2s;border-bottom:2px solid transparent; }
        .wp-tab-btn:hover { color:#aaa; }
        .wp-tab-btn.active { color:var(--cy-cyan);border-bottom:2px solid var(--cy-cyan);text-shadow:0 0 6px var(--cy-cyan); }

        #wp-chat-box { flex-grow:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;position:relative;z-index:10; }
        #wp-chat-box::-webkit-scrollbar { width:4px; }
        #wp-chat-box::-webkit-scrollbar-thumb { background:var(--cy-cyan); }
        .wp-tab-panel { display:none;flex:1;flex-direction:column;overflow:hidden; }
        .wp-tab-panel.active { display:flex; }

        .wp-status-msg { text-align:center;font-size:11px;font-weight:bold;font-family:'Share Tech Mono',monospace;text-transform:uppercase;padding:5px 10px;margin:2px 0;position:relative;z-index:2;animation:fadeIn .3s ease; }
        .wp-status-play   { color:#00ff88;background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.25);text-shadow:0 0 5px #00ff88; }
        .wp-status-pause  { color:#ffaa00;background:rgba(255,170,0,.1); border:1px solid rgba(255,170,0,.25);text-shadow:0 0 5px #ffaa00; }
        .wp-status-seek   { color:#00aaff;background:rgba(0,170,255,.1); border:1px solid rgba(0,170,255,.25);text-shadow:0 0 5px #00aaff; }
        .wp-status-ad     { color:#ff003c;background:rgba(255,0,60,.12); border:1px solid rgba(255,0,60,.35);text-shadow:0 0 5px #ff003c; }
        .wp-status-buffer { color:#888;   background:rgba(80,80,80,.1);  border:1px solid rgba(80,80,80,.25); }

        .wp-msg-wrapper { display:flex;flex-direction:column;max-width:90%;animation:wp-glitch-anim .3s ease; }
        .wp-msg-wrapper.sender   { align-self:flex-end;  align-items:flex-end; }
        .wp-msg-wrapper.receiver { align-self:flex-start;align-items:flex-start; }
        .wp-avatar-row { display:flex;align-items:center;gap:8px;margin-bottom:3px; }
        .wp-avatar { width:22px;height:22px;background:rgba(0,0,0,.9);border:1px solid var(--cy-pink);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:var(--cy-pink);box-shadow:0 0 6px rgba(255,0,60,.4); }
        .wp-sender-name { font-size:11px;color:#aaa;text-transform:uppercase;font-weight:bold; }
        .wp-msg-bubble { padding:9px 13px;font-size:13px;line-height:1.5;word-wrap:break-word;border:1px solid;position:relative;background:rgba(0,0,0,.93); }
        .wp-msg-wrapper.sender   .wp-msg-bubble { border-color:var(--cy-cyan);color:#fff;box-shadow:-2px 2px 0 var(--cy-cyan),0 0 12px rgba(0,255,255,.12);border-right:4px solid var(--cy-cyan); }
        .wp-msg-wrapper.receiver .wp-msg-bubble { border-color:var(--cy-pink);color:#fff;box-shadow:2px 2px 0 var(--cy-pink),0 0 12px rgba(255,0,60,.12);border-left:4px solid var(--cy-pink); }
        .wp-msg-bubble:hover { animation:wp-glitch-hover .2s infinite linear alternate-reverse; }
        .wp-timestamp { font-size:10px;color:#555;margin-top:4px;font-weight:bold; }

        #wp-queue-panel { display:none;flex-direction:column;flex:1;overflow:hidden;position:relative;z-index:10; }
        #wp-queue-panel.active { display:flex; }
        #wp-queue-add-area { padding:12px 14px;background:rgba(0,0,0,.7);border-bottom:1px solid rgba(0,255,255,.15);position:relative;z-index:10;display:flex;flex-direction:column;gap:8px; }
        #wp-queue-add-area label { font-size:10px;color:var(--cy-cyan);text-transform:uppercase;letter-spacing:1px;font-weight:bold; }
        .wp-queue-input-row { display:flex;gap:6px; }
        #wp-queue-url-input { flex-grow:1;background:rgba(7,7,12,.98);border:1px solid #444;color:var(--cy-cyan);padding:9px 10px;outline:none;font-size:12px;font-family:'Share Tech Mono',monospace;box-shadow:inset 0 0 6px rgba(0,255,255,.12); }
        #wp-queue-url-input:focus { border-color:var(--cy-cyan);box-shadow:inset 0 0 10px rgba(0,255,255,.3); }
        #wp-queue-url-input::placeholder { color:#333;text-transform:uppercase; }
        #wp-queue-title-input { flex-grow:1;background:rgba(7,7,12,.98);border:1px solid #333;color:#aaa;padding:7px 10px;outline:none;font-size:11px;font-family:'Share Tech Mono',monospace; }
        #wp-queue-title-input::placeholder { color:#2a2a2a; }
        #wp-queue-add-btn { background:transparent;border:1px solid var(--cy-green);color:var(--cy-green);padding:9px 12px;font-size:12px;font-family:'Share Tech Mono',monospace;font-weight:bold;cursor:pointer;text-transform:uppercase;box-shadow:inset 0 0 5px rgba(0,255,136,.2);transition:all .2s;white-space:nowrap; }
        #wp-queue-add-btn:hover { background:var(--cy-green);color:#000;box-shadow:0 0 12px var(--cy-green); }
        #wp-queue-add-btn:active { transform:translate(2px,2px); }
        #wp-queue-host-bar { display:none;padding:8px 14px;background:rgba(0,0,0,.6);border-bottom:1px solid rgba(240,234,0,.15);align-items:center;gap:8px; }
        #wp-queue-host-bar.visible { display:flex; }
        #wp-queue-skip-btn { background:transparent;border:1px solid var(--cy-yellow);color:var(--cy-yellow);padding:5px 10px;font-size:10px;font-family:'Share Tech Mono',monospace;font-weight:bold;cursor:pointer;text-transform:uppercase;transition:all .2s; }
        #wp-queue-skip-btn:hover { background:var(--cy-yellow);color:#000; }
        .wp-host-label { font-size:10px;color:var(--cy-yellow);text-shadow:0 0 4px var(--cy-yellow);margin-left:auto; }
        #wp-queue-list { flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px; }
        #wp-queue-list::-webkit-scrollbar { width:4px; }
        #wp-queue-list::-webkit-scrollbar-thumb { background:var(--cy-cyan); }
        .wp-queue-empty { display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;opacity:.5; }
        .wp-queue-empty-icon { font-size:40px; }
        .wp-queue-empty-text { font-size:14px;color:var(--cy-cyan);font-weight:bold;text-transform:uppercase;letter-spacing:2px; }
        .wp-queue-empty-sub { font-size:11px;color:#555;text-transform:uppercase;text-align:center; }
        .wp-queue-item { display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(0,0,0,.7);border:1px solid rgba(0,255,255,.1);transition:border-color .2s,background .2s;animation:fadeIn .25s ease; }
        .wp-queue-item:hover { border-color:rgba(0,255,255,.35);background:rgba(0,255,255,.04); }
        .wp-queue-item-num { font-size:11px;color:#444;font-weight:bold;min-width:20px;text-align:center; }
        .wp-queue-item-info { flex:1;overflow:hidden; }
        .wp-queue-item-title { font-size:12px;color:#fff;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px; }
        .wp-queue-item-meta { font-size:10px;color:#555;text-transform:uppercase; }
        .wp-queue-item-actions { display:flex;gap:5px;flex-shrink:0; }
        .wp-q-btn { background:transparent;border:1px solid;cursor:pointer;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:'Share Tech Mono',monospace;transition:all .15s;font-weight:bold; }
        .wp-q-play { border-color:var(--cy-green);color:var(--cy-green); }
        .wp-q-play:hover { background:var(--cy-green);color:#000; }
        .wp-q-del  { border-color:var(--cy-pink);color:var(--cy-pink); }
        .wp-q-del:hover  { background:var(--cy-pink);color:#000; }

        #wp-reaction-bar { display:flex;gap:8px;padding:9px 13px;background:rgba(7,7,12,.97);border-top:1px solid rgba(0,255,255,.12);position:relative;z-index:10;flex-wrap:wrap; }
        .wp-reaction-btn { background:rgba(0,0,0,.8);border:1px solid #555;color:#fff;cursor:pointer;padding:4px 8px;font-size:16px;transition:all .1s; }
        .wp-reaction-btn:hover { border-color:var(--cy-yellow);box-shadow:0 0 10px var(--cy-yellow);transform:scale(1.15); }

        #wp-input-area { display:flex;padding:12px;background:rgba(0,0,0,.98);gap:8px;align-items:center;border-top:2px solid var(--cy-cyan);position:relative;z-index:10; }
        #wp-chat-input { flex-grow:1;background:rgba(7,7,12,1);border:1px solid #444;color:var(--cy-cyan);padding:10px 12px;outline:none;font-size:13px;font-family:'Share Tech Mono',monospace;box-shadow:inset 0 0 6px rgba(0,255,255,.12); }
        #wp-chat-input:focus { border-color:var(--cy-cyan);box-shadow:inset 0 0 12px rgba(0,255,255,.35); }
        #wp-chat-input::placeholder { color:#333;text-transform:uppercase; }
        .wp-action-btn { background:rgba(0,0,0,.85);color:var(--cy-cyan);border:1px solid var(--cy-cyan);width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;transition:all .1s;box-shadow:0 0 5px rgba(0,255,255,.2); }
        .wp-action-btn:hover { background:var(--cy-cyan);color:#000;box-shadow:0 0 12px var(--cy-cyan); }
        .wp-action-btn:active { transform:translate(2px,2px); }
        .wp-icon-btn { border-color:#555;color:#666;box-shadow:none;background:rgba(0,0,0,.6); }
        .wp-icon-btn:hover { border-color:var(--cy-pink);color:var(--cy-pink);background:rgba(0,0,0,.8); }

        @keyframes wp-glitch-anim { 0%{transform:translate(0)} 20%{transform:translate(-2px,1px)} 40%{transform:translate(-1px,-1px)} 60%{transform:translate(2px,1px)} 80%{transform:translate(1px,-1px)} 100%{transform:translate(0)} }
        @keyframes wp-glitch-hover { 0%{transform:skew(0deg)} 20%{transform:skew(-5deg);filter:hue-rotate(90deg)} 40%{transform:skew(5deg)} 60%{transform:translate(1px,1px)} 80%{transform:translate(-1px,-1px)} 100%{transform:skew(0deg)} }
        .wp-dot { display:inline-block;width:6px;height:6px;background:var(--cy-cyan);box-shadow:0 0 5px var(--cy-cyan);animation:wp-dot-blink 1s infinite;border-radius:0; }
        @keyframes wp-dot-blink { 0%,100%{opacity:.2} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    `;
    document.head.appendChild(style);

    const chatContainer = document.createElement('div');
    chatContainer.id = 'wp-chat-container';
    chatContainer.innerHTML = `
        <div id="wp-matrix-grid"></div>
        <button id="wp-toggle-tab" title="Toggle">[ ]</button>
        <div id="wp-chat-header">
            <div id="wp-header-top">
                <span>NET://ROOM_${ROOM_ID}</span>
                <span id="wp-host-badge">👑 HOST</span>
                <span id="wp-platform-badge">${PLATFORM.name.toUpperCase()}</span>
            </div>
            <div id="wp-header-meta">
                <span id="wp-viewer-count">👁 1 WATCHING</span>
                <button id="wp-copy-link-btn">🔗 LINK</button>
            </div>
            <div id="wp-call-bar">
                <button class="wp-call-btn" id="wp-call-start">INIT AUDIO</button>
                <div id="wp-call-status"></div>
                <button class="wp-call-btn" id="wp-call-mute">MUTE</button>
                <button class="wp-call-btn" id="wp-call-end">CUT LINE</button>
            </div>
        </div>
        <div id="wp-tab-nav">
            <button class="wp-tab-btn active" data-tab="chat">💬 CHAT</button>
            <button class="wp-tab-btn" data-tab="queue">📋 QUEUE</button>
        </div>
        <div id="wp-chat-panel" class="wp-tab-panel active" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
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
        </div>
        <div id="wp-queue-panel" class="wp-tab-panel">
            <div id="wp-queue-add-area">
                <label>ADD TO QUEUE</label>
                <div class="wp-queue-input-row">
                    <input type="text" id="wp-queue-url-input" placeholder="Paste video URL...">
                    <button id="wp-queue-add-btn">+ ADD</button>
                </div>
                <input type="text" id="wp-queue-title-input" placeholder="Optional title...">
            </div>
            <div id="wp-queue-host-bar">
                <button id="wp-queue-skip-btn">⏭ SKIP</button>
                <span class="wp-host-label">👑 HOST CONTROLS</span>
            </div>
            <div id="wp-queue-list"></div>
        </div>
    `;
    document.body.appendChild(chatContainer);
    initMatrixGrid(chatContainer);

    let isDocked = true;
    setSquish(true);
    renderQueue([], false);

    document.getElementById('wp-toggle-tab').addEventListener('click', () => {
        isDocked = !isDocked;
        chatContainer.classList.toggle('hidden', !isDocked);
        document.getElementById('wp-toggle-tab').innerText = isDocked ? '[ ]' : '[x]';
        setSquish(isDocked);
    });

    document.querySelectorAll('.wp-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.wp-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('wp-chat-panel').style.display  = tab === 'chat'  ? 'flex' : 'none';
            document.getElementById('wp-queue-panel').style.display = tab === 'queue' ? 'flex' : 'none';
        });
    });

    document.getElementById('wp-copy-link-btn').addEventListener('click', copyPartyLink);

    const input = document.getElementById('wp-chat-input');
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

    function submitQueueItem() {
        const urlInput   = document.getElementById('wp-queue-url-input');
        const titleInput = document.getElementById('wp-queue-title-input');
        const url   = urlInput.value.trim();
        const title = titleInput.value.trim() || extractTitle(url);
        if (!url || !ROOM_ID) return;
        socket.emit('queue_add', { roomId: ROOM_ID, url, title, sender: USERNAME });
        urlInput.value = ''; titleInput.value = '';
    }
    document.getElementById('wp-queue-add-btn').addEventListener('click', submitQueueItem);
    document.getElementById('wp-queue-url-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') submitQueueItem(); });
    document.getElementById('wp-queue-skip-btn').addEventListener('click', () => {
        if (!IS_HOST) return;
        socket.emit('queue_play_next', { roomId: ROOM_ID });
    });

    updateHostBar(false);
}

function updateHostBar(isHost) {
    const bar = document.getElementById('wp-queue-host-bar');
    if (bar) bar.classList.toggle('visible', isHost);
}

const _origRenderQueue = renderQueue;
window.renderQueue = function(queue, isHost) { updateHostBar(isHost); _origRenderQueue(queue, isHost); };
socket.off('queue_update');
socket.on('queue_update', (data) => {
    currentQueue = data.queue || [];
    IS_HOST = (data.host === socket.id);
    window.renderQueue(currentQueue, IS_HOST);
    const badge = document.getElementById('wp-host-badge');
    if (badge) badge.style.display = IS_HOST ? 'inline-block' : 'none';
});

function extractTitle(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com')) { const v = u.searchParams.get('v'); return v ? `YouTube: ${v}` : 'YouTube Video'; }
        if (u.hostname.includes('netflix.com'))  return 'Netflix Title';
        if (u.hostname.includes('amazon.com') || u.hostname.includes('primevideo.com')) return 'Prime Video';
        if (u.hostname.includes('disneyplus.com')) return 'Disney+ Title';
        return u.hostname.replace('www.','');
    } catch { return String(url).substring(0, 36) + '…'; }
}

function appendStatusMessage(text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    document.getElementById('wp-typing-indicator')?.remove();
    const typeClass = { play:'wp-status-play', pause:'wp-status-pause', seek:'wp-status-seek', ad_start:'wp-status-ad', ad_end:'wp-status-play', buffer_start:'wp-status-buffer', buffer_end:'wp-status-play' }[type] || 'wp-status-buffer';
    const el = document.createElement('div');
    el.className = `wp-status-msg ${typeClass}`;
    el.innerText = text;
    box.appendChild(el);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}

function appendMessage(sender, text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    document.getElementById('wp-typing-indicator')?.remove();
    const msgDiv = document.createElement('div');
    if (type === 'system') {
        msgDiv.style.cssText = "text-align:center;color:#0ff;font-size:12px;font-weight:bold;margin:6px 0;font-family:'Share Tech Mono',monospace;text-shadow:0 0 6px #0ff;text-transform:uppercase;position:relative;z-index:2;background:rgba(0,0,0,.9);padding:5px 8px;border:1px solid rgba(0,255,255,.2);";
        msgDiv.innerText = `>> ${sender} ${text}`;
        box.appendChild(msgDiv); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); return;
    }
    const timeString = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
    const initial = sender.substring(0,2).toUpperCase();
    msgDiv.className = `wp-msg-wrapper ${type}`;
    const headerHtml = type === 'receiver' ? `<div class="wp-avatar-row"><div class="wp-avatar">${initial}</div><span class="wp-sender-name">USR_${sender}</span></div>` : '';
    msgDiv.innerHTML = `${headerHtml}<div class="wp-msg-bubble"></div><div class="wp-timestamp">[${timeString}]</div>`;
    msgDiv.querySelector('.wp-msg-bubble').textContent = text;
    box.appendChild(msgDiv); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}
