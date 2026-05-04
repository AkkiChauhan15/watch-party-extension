const socket = io('https://my-watch-party-backend.onrender.com');
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
        showNotification(`SYSTEM CONNECTED: [${ROOM_ID}] AS [${USERNAME}]`);
        injectChatUI();

        socket.emit('chat_message', {
            roomId: ROOM_ID,
            text: "has joined the party!",
            sender: USERNAME,
            isSystem: true
        });
    }
});

let video = null;
const findVideoInterval = setInterval(() => {
    video = document.querySelector('video');
    if (video) {
        clearInterval(findVideoInterval);
        attachVideoListeners();
    }
}, 1000);

let isRemoteAction = false;

// =====================================================
// --- VOICE CALL STATE ---
// =====================================================
// Google's free public STUN servers — no setup needed, no cost, no account
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let localStream      = null;  // Our microphone audio stream
let peerConnections  = {};    // Map of socketId → RTCPeerConnection (one per remote peer)
let isMuted          = false;
let isInCall         = false;

// =====================================================
// --- NOTIFICATIONS ---
// =====================================================
function showNotification(message) {
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: rgba(229, 9, 20, 0.9); color: white;
        padding: 15px 25px; border-radius: 8px; z-index: 999999;
        font-size: 18px; font-weight: bold; font-family: sans-serif;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3); pointer-events: none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// =====================================================
// --- VIDEO SYNC ---
// =====================================================
function attachVideoListeners() {
    video.addEventListener('play', () => {
        if (isRemoteAction) return;
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'play', time: video.currentTime });
    });
    video.addEventListener('pause', () => {
        if (isRemoteAction) return;
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'pause', time: video.currentTime });
    });
    video.addEventListener('seeked', () => {
        if (isRemoteAction) return;
        socket.emit('sync_state', { roomId: ROOM_ID, action: 'seeked', time: video.currentTime });
    });

    socket.on('sync_state', (data) => {
        isRemoteAction = true;
        if (Math.abs(video.currentTime - data.time) > 0.5) video.currentTime = data.time;
        if (data.action === 'play')  video.play();
        if (data.action === 'pause') video.pause();
        setTimeout(() => isRemoteAction = false, 500);
    });

    socket.on('latecomer_arrived', (data) => {
        video.pause();
        socket.emit('sync_state', {
            roomId: ROOM_ID, action: 'pause', time: video.currentTime,
            message: `User ${data.newUserId} has joined!`
        });
    });

    socket.on('sync_state', (data) => {
        if (data.message) showNotification(data.message);
    });
}

// =====================================================
// --- FEATURE: EMOJI VIDEO OVERLAY ---
// =====================================================
function ensureOverlayLayer() {
    if (document.getElementById('wp-emoji-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'wp-emoji-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: calc(100% - 350px); height: 100%;
        pointer-events: none; z-index: 99998; overflow: hidden;
    `;
    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.textContent = `
        @keyframes wp-float-up {
            0%   { transform: translateY(0)     scale(1);    opacity: 1;   }
            60%  { transform: translateY(-55vh) scale(1.15); opacity: 0.9; }
            100% { transform: translateY(-80vh) scale(0.8);  opacity: 0;   }
        }
        .wp-floating-emoji {
            position: absolute; bottom: 15%; font-size: 36px;
            animation: wp-float-up 2.6s ease-out forwards;
            pointer-events: none; user-select: none;
            filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
        }
    `;
    document.head.appendChild(style);
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
// --- FEATURE: TYPING INDICATOR ---
// =====================================================
let typingTimeout = null;

function setTypingIndicator(senderName, visible) {
    let indicator = document.getElementById('wp-typing-indicator');
    if (!visible) { if (indicator) indicator.remove(); return; }
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'wp-typing-indicator';
        indicator.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 16px 8px;animation:fadeIn 0.2s ease;`;
    }
    indicator.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
            <div style="background:#1e293b;border-radius:12px;padding:8px 12px;display:flex;align-items:center;gap:6px;">
                <span style="font-size:11px;color:#94a3b8;">${senderName} is typing</span>
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
// --- FEATURE: VOICE CALL ---
// =====================================================

// --- Create a peer connection to one specific remote user ---
function createPeerConnection(remoteSocketId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // When we discover a network path, send it to the remote peer via Socket.io
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };

    // When we receive the remote peer's audio track, play it
    pc.ontrack = (event) => {
        playRemoteAudio(remoteSocketId, event.streams[0]);
    };

    // Add our local microphone audio to this connection
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    peerConnections[remoteSocketId] = pc;
    return pc;
}

// --- Play a remote peer's audio by creating a hidden <audio> element ---
function playRemoteAudio(remoteSocketId, stream) {
    const existingAudio = document.getElementById(`wp-audio-${remoteSocketId}`);
    if (existingAudio) existingAudio.remove();

    const audio = document.createElement('audio');
    audio.id = `wp-audio-${remoteSocketId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.style.display = 'none'; // Hidden — just needs to exist in DOM to play
    document.body.appendChild(audio);
}

// --- Close one peer connection and remove its audio element ---
function closePeerConnection(remoteSocketId) {
    if (peerConnections[remoteSocketId]) {
        peerConnections[remoteSocketId].close();
        delete peerConnections[remoteSocketId];
    }
    const audio = document.getElementById(`wp-audio-${remoteSocketId}`);
    if (audio) audio.remove();
}

// --- Full teardown: stop mic, close all peers, reset UI ---
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    Object.keys(peerConnections).forEach(closePeerConnection);
    isInCall = false;
    isMuted  = false;
    updateCallUI(false);
    socket.emit('voice_call_ended', { roomId: ROOM_ID, sender: USERNAME });
    appendSystemVoiceMessage('📵 Voice call ended.');
}

// --- Update the call button strip in the chat header ---
function updateCallUI(inCall) {
    const startBtn = document.getElementById('wp-call-start');
    const endBtn   = document.getElementById('wp-call-end');
    const muteBtn  = document.getElementById('wp-call-mute');
    const callStatus = document.getElementById('wp-call-status');

    if (!startBtn) return;

    if (inCall) {
        startBtn.style.display  = 'none';
        endBtn.style.display    = 'flex';
        muteBtn.style.display   = 'flex';
        if (callStatus) { callStatus.style.display = 'flex'; callStatus.innerText = '🎙️ In call'; }
    } else {
        startBtn.style.display  = 'flex';
        endBtn.style.display    = 'none';
        muteBtn.style.display   = 'none';
        if (callStatus) callStatus.style.display = 'none';
    }
}

function appendSystemVoiceMessage(text) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    const el = document.createElement('div');
    el.style.cssText = "text-align:center;color:#64748b;font-size:12px;margin:8px 0;font-style:italic;animation:fadeIn 0.3s ease;";
    el.innerText = text;
    box.appendChild(el);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}

// =====================================================
// WebRTC Signaling socket events
// =====================================================

// Someone in our room just started a call — show an incoming call bar
socket.on('voice_call_incoming', async (data) => {
    appendSystemVoiceMessage(`📞 ${data.sender} started a voice call — joining...`);
    showNotification(`🎙️ ${data.sender} started a voice call!`);

    // Auto-join: get mic then send an offer back to the caller
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isInCall = true;
        updateCallUI(true);

        const pc = createPeerConnection(data.from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_offer', { to: data.from, offer });
    } catch (err) {
        appendSystemVoiceMessage('❌ Microphone access denied. Could not join call.');
        console.error('Voice call join error:', err);
    }
});

// We received an offer from someone who joined after us — answer it
socket.on('voice_offer', async (data) => {
    if (!localStream) return; // Only handle if we're already in a call
    const pc = createPeerConnection(data.from);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice_answer', { to: data.from, answer });
});

// Our offer was answered — finalise the connection
socket.on('voice_answer', async (data) => {
    const pc = peerConnections[data.from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

// Add a network path as it's discovered
socket.on('ice_candidate', async (data) => {
    const pc = peerConnections[data.from];
    if (pc && data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
        catch (e) { console.error('ICE candidate error:', e); }
    }
});

// Someone ended the call
socket.on('voice_call_ended', (data) => {
    appendSystemVoiceMessage(`📵 ${data.sender} ended the call.`);
    Object.keys(peerConnections).forEach(closePeerConnection);
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    isInCall = false;
    updateCallUI(false);
});

// A peer disconnected mid-call
socket.on('voice_peer_disconnected', (data) => {
    closePeerConnection(data.socketId);
});

// =====================================================
// --- CHAT MESSAGES ---
// =====================================================
socket.on('chat_message', (data) => {
    setTypingIndicator(data.sender, false);
    if (data.isSystem) {
        appendMessage(data.sender, data.text, 'system');
    } else {
        appendMessage(data.sender, data.text, 'receiver');
    }
});

// =====================================================
// --- INJECT CHAT UI ---
// =====================================================
function injectChatUI() {
    if (document.getElementById('wp-chat-container')) return;

    const style = document.createElement('style');
    style.textContent = `
        #wp-chat-container {
            position: fixed; top: 0; right: 0; width: 350px; height: 100vh;
            background: #0f172a; color: #f8fafc; z-index: 999999;
            display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif;
            box-shadow: -4px 0 20px rgba(0,0,0,0.5); border-left: 1px solid #1e293b;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #wp-chat-container.hidden { transform: translateX(100%); }
        #wp-toggle-tab {
            position: absolute; left: -40px; top: 50vh; transform: translateY(-50%);
            width: 40px; height: 48px; background: #1e293b; color: #f8fafc;
            border: none; border-radius: 8px 0 0 8px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; box-shadow: -4px 0 10px rgba(0,0,0,0.2);
            border-left: 1px solid #334155; border-top: 1px solid #334155; border-bottom: 1px solid #334155;
            transition: background 0.2s, color 0.2s;
        }
        #wp-toggle-tab:hover { background: #3b82f6; color: white; }
        ytd-app, ytd-masthead, body, html { transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important; }

        /* --- Header & call bar --- */
        #wp-chat-header {
            background: #1e293b; padding: 12px 16px; font-weight: 600; font-size: 14px;
            display: flex; flex-direction: column; gap: 8px;
            border-bottom: 1px solid #334155;
        }
        #wp-header-top { display: flex; justify-content: space-between; align-items: center; }
        #wp-call-bar {
            display: flex; align-items: center; gap: 8px;
        }
        #wp-call-status {
            font-size: 11px; color: #22c55e; font-weight: 500;
            display: none; align-items: center; gap: 4px; flex: 1;
        }
        #wp-call-status::before {
            content: ''; display: inline-block; width: 6px; height: 6px;
            border-radius: 50%; background: #22c55e;
            animation: wp-pulse 1.5s ease-in-out infinite;
        }
        @keyframes wp-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        .wp-call-btn {
            border: none; border-radius: 20px; cursor: pointer;
            padding: 6px 12px; font-size: 13px; font-weight: 500;
            display: flex; align-items: center; gap: 5px; transition: background 0.2s, transform 0.1s;
        }
        .wp-call-btn:active { transform: scale(0.96); }
        #wp-call-start { background: #22c55e; color: white; }
        #wp-call-start:hover { background: #16a34a; }
        #wp-call-end { background: #ef4444; color: white; display: none; }
        #wp-call-end:hover { background: #dc2626; }
        #wp-call-mute { background: #334155; color: #f8fafc; display: none; }
        #wp-call-mute:hover { background: #475569; }
        #wp-call-mute.muted { background: #f59e0b; color: white; }

        /* --- Chat box --- */
        #wp-chat-box {
            flex-grow: 1; overflow-y: auto; padding: 16px; display: flex;
            flex-direction: column; gap: 12px; scroll-behavior: smooth;
        }
        #wp-chat-box::-webkit-scrollbar { width: 6px; }
        #wp-chat-box::-webkit-scrollbar-track { background: transparent; }
        #wp-chat-box::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .wp-msg-wrapper { display: flex; flex-direction: column; max-width: 85%; animation: fadeIn 0.3s ease; }
        .wp-msg-wrapper.sender   { align-self: flex-end;   align-items: flex-end;   }
        .wp-msg-wrapper.receiver { align-self: flex-start; align-items: flex-start; }
        .wp-avatar-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .wp-avatar {
            width: 24px; height: 24px; border-radius: 50%; background: #3b82f6;
            display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;
        }
        .wp-sender-name { font-size: 11px; color: #94a3b8; }
        .wp-msg-bubble {
            padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.4;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1); word-wrap: break-word;
        }
        .wp-msg-wrapper.sender   .wp-msg-bubble { background: #3b82f6; color: white; border-bottom-right-radius: 4px; }
        .wp-msg-wrapper.receiver .wp-msg-bubble { background: #1e293b; color: #e2e8f0; border-bottom-left-radius: 4px; }
        .wp-timestamp { font-size: 9px; color: #64748b; margin-top: 4px; }

        /* --- Reaction bar & input --- */
        #wp-reaction-bar { display: flex; gap: 10px; padding: 8px 16px; background: #0f172a; border-top: 1px solid #1e293b; }
        .wp-reaction-btn { background: #1e293b; border: none; border-radius: 12px; cursor: pointer; padding: 6px 10px; font-size: 16px; transition: transform 0.1s, background 0.2s; }
        .wp-reaction-btn:hover { background: #334155; transform: scale(1.1); }
        #wp-input-area { display: flex; padding: 16px; background: #0f172a; gap: 8px; align-items: center; }
        #wp-chat-input {
            flex-grow: 1; background: #1e293b; border: 1px solid #334155; color: white;
            padding: 12px 16px; border-radius: 20px; outline: none; font-size: 14px;
        }
        #wp-chat-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.3); }
        .wp-action-btn {
            background: #3b82f6; color: white; border: none; width: 40px; height: 40px;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 18px; transition: background 0.2s;
        }
        .wp-action-btn:hover { background: #2563eb; }
        .wp-icon-btn { background: transparent; color: #94a3b8; width: 36px; height: 36px; font-size: 20px; }
        .wp-icon-btn:hover { color: #f8fafc; background: #1e293b; }

        /* --- Typing dots --- */
        @keyframes wp-dot-bounce {
            0%,80%,100% { transform: translateY(0);   opacity: 0.4; }
            40%          { transform: translateY(-4px); opacity: 1;   }
        }
        .wp-dot {
            display: inline-block; width: 5px; height: 5px;
            border-radius: 50%; background: #94a3b8;
            animation: wp-dot-bounce 1.2s ease-in-out infinite;
        }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);

    const chatContainer = document.createElement('div');
    chatContainer.id = 'wp-chat-container';
    chatContainer.innerHTML = `
        <button id="wp-toggle-tab" title="Toggle Chat">▶</button>
        <div id="wp-chat-header">
            <div id="wp-header-top">
                <span>🎬 Room: ${ROOM_ID}</span>
            </div>
            <div id="wp-call-bar">
                <button class="wp-call-btn" id="wp-call-start">🎙️ Start Voice Call</button>
                <div id="wp-call-status"></div>
                <button class="wp-call-btn" id="wp-call-mute">🎙️ Mute</button>
                <button class="wp-call-btn" id="wp-call-end">📵 End</button>
            </div>
        </div>
        <div id="wp-chat-box"></div>
        <div id="wp-reaction-bar">
            <button class="wp-reaction-btn" data-emoji="🔥">🔥</button>
            <button class="wp-reaction-btn" data-emoji="😂">😂</button>
            <button class="wp-reaction-btn" data-emoji="😍">😍</button>
            <button class="wp-reaction-btn" data-emoji="👍">👍</button>
        </div>
        <div id="wp-input-area">
            <button class="wp-action-btn wp-icon-btn" title="Emojis">😊</button>
            <input type="text" id="wp-chat-input" placeholder="Type a message...">
            <button class="wp-action-btn" id="wp-send-btn">➤</button>
        </div>
    `;
    document.body.appendChild(chatContainer);

    // --- Squish YouTube layout ---
    function setSquish(isDocked) {
        const newWidth = isDocked ? 'calc(100% - 350px)' : '100%';
        document.documentElement.style.width = newWidth;
        document.body.style.width = newWidth;
        const ytApp    = document.querySelector('ytd-app');
        const ytHeader = document.querySelector('ytd-masthead');
        if (ytApp)    ytApp.style.width    = newWidth;
        if (ytHeader) ytHeader.style.width = newWidth;
        const overlay = document.getElementById('wp-emoji-overlay');
        if (overlay)  overlay.style.width  = newWidth;
    }

    let isDocked = true;
    setSquish(true);

    document.getElementById('wp-toggle-tab').addEventListener('click', () => {
        isDocked = !isDocked;
        chatContainer.classList.toggle('hidden', !isDocked);
        document.getElementById('wp-toggle-tab').innerText = isDocked ? '▶' : '◀';
        setSquish(isDocked);
    });

    // --- Send chat ---
    const input   = document.getElementById('wp-chat-input');
    const sendBtn = document.getElementById('wp-send-btn');

    function sendChat() {
        const text = input.value.trim();
        if (!text || !ROOM_ID) return;
        socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME });
        appendMessage('You', text, 'sender');
        socket.emit('chat_message', { roomId: ROOM_ID, text, sender: USERNAME });
        input.value = '';
    }

    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    input.addEventListener('input', () => {
        if (!ROOM_ID) return;
        socket.emit('typing', { roomId: ROOM_ID, sender: USERNAME });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME });
        }, 2000);
    });

    // --- Reaction buttons ---
    document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!ROOM_ID) return;
            const emoji = e.currentTarget.dataset.emoji;
            floatEmojiOnVideo(emoji);
            appendMessage('You', emoji, 'sender');
            socket.emit('reaction', { roomId: ROOM_ID, emoji, sender: USERNAME });
        });
    });

    // --- Voice call buttons ---
    document.getElementById('wp-call-start').addEventListener('click', async () => {
        if (isInCall) return;
        try {
            // Ask for microphone permission
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            isInCall = true;
            updateCallUI(true);
            appendSystemVoiceMessage('🎙️ You started a voice call. Waiting for others to join...');

            // Tell everyone else in the room a call has started
            socket.emit('voice_call_started', { roomId: ROOM_ID, sender: USERNAME });
        } catch (err) {
            appendSystemVoiceMessage('❌ Microphone access denied.');
            console.error('Mic error:', err);
        }
    });

    document.getElementById('wp-call-end').addEventListener('click', () => {
        if (!isInCall) return;
        endCall();
    });

    document.getElementById('wp-call-mute').addEventListener('click', () => {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
        const muteBtn = document.getElementById('wp-call-mute');
        muteBtn.classList.toggle('muted', isMuted);
        muteBtn.innerText = isMuted ? '🔇 Unmute' : '🎙️ Mute';
    });
}

// =====================================================
// --- APPEND MESSAGE HELPER ---
// =====================================================
function appendMessage(sender, text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;

    const existingIndicator = document.getElementById('wp-typing-indicator');
    if (existingIndicator) existingIndicator.remove();

    const msgDiv = document.createElement('div');

    if (type === 'system') {
        msgDiv.style.cssText = "text-align:center;color:#64748b;font-size:12px;margin:8px 0;font-style:italic;animation:fadeIn 0.3s ease;";
        msgDiv.innerText = `${sender} ${text}`;
        box.appendChild(msgDiv);
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
    }

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const initial    = sender.charAt(0).toUpperCase();

    msgDiv.className = `wp-msg-wrapper ${type}`;
    const headerHtml = type === 'receiver'
        ? `<div class="wp-avatar-row"><div class="wp-avatar">${initial}</div><span class="wp-sender-name">${sender}</span></div>`
        : '';

    msgDiv.innerHTML = `${headerHtml}<div class="wp-msg-bubble"></div><div class="wp-timestamp">${timeString}</div>`;
    msgDiv.querySelector('.wp-msg-bubble').textContent = text;
    box.appendChild(msgDiv);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}