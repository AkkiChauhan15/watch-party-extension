const socket = io('https://my-watch-party-backend.onrender.com');
let ROOM_ID = ""; // Starts empty!
let USERNAME = "Guest";

socket.on('connect', () => {
    console.log(`🔗 Connected to server. ID: ${socket.id}`);
});

// --- Listen for the popup to send the Room ID ---
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

// --- Visual UI Notification ---
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
        if (Math.abs(video.currentTime - data.time) > 0.5) {
            video.currentTime = data.time;
        }
        if (data.action === 'play') video.play();
        if (data.action === 'pause') video.pause();
        setTimeout(() => isRemoteAction = false, 500);
    });

    socket.on('latecomer_arrived', (data) => {
        console.log(`👋 New user (${data.newUserId}) joined. Pausing to sync.`);
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

// ==========================================
// --- FEATURE 1: EMOJI VIDEO OVERLAY ---
// ==========================================

// Injects the overlay layer on top of the YouTube player (created once)
function ensureOverlayLayer() {
    if (document.getElementById('wp-emoji-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'wp-emoji-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: calc(100% - 350px);
        height: 100%;
        pointer-events: none;
        z-index: 99998;
        overflow: hidden;
    `;
    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.textContent = `
        @keyframes wp-float-up {
            0%   { transform: translateY(0)   scale(1);   opacity: 1; }
            60%  { transform: translateY(-55vh) scale(1.15); opacity: 0.9; }
            100% { transform: translateY(-80vh) scale(0.8); opacity: 0; }
        }
        .wp-floating-emoji {
            position: absolute;
            bottom: 15%;
            font-size: 36px;
            animation: wp-float-up 2.6s ease-out forwards;
            pointer-events: none;
            user-select: none;
            filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
        }
    `;
    document.head.appendChild(style);
}

// Fires one emoji bubble at a slightly randomised horizontal position
function floatEmojiOnVideo(emoji) {
    ensureOverlayLayer();
    const overlay = document.getElementById('wp-emoji-overlay');
    if (!overlay) return;

    const el = document.createElement('span');
    el.className = 'wp-floating-emoji';
    el.textContent = emoji;

    // Spread across the middle third of the player so they don't all stack
    const leftPct = 30 + Math.random() * 40;
    el.style.left = `${leftPct}%`;

    // Tiny random delay so rapid-fire clicks stagger nicely
    el.style.animationDelay = `${Math.random() * 0.15}s`;

    overlay.appendChild(el);
    // Remove DOM node after animation completes (2.6s + 0.15s buffer)
    setTimeout(() => el.remove(), 2800);
}

// Incoming reaction from another user — float it AND add it to chat
socket.on('reaction', (data) => {
    floatEmojiOnVideo(data.emoji);
    appendMessage(data.sender, data.emoji, 'receiver');
});

// ==========================================
// --- FEATURE 2: TYPING INDICATOR ---
// ==========================================

let typingTimeout = null;

// Show/hide the "... is typing" bubble
function setTypingIndicator(senderName, visible) {
    let indicator = document.getElementById('wp-typing-indicator');

    if (!visible) {
        if (indicator) indicator.remove();
        return;
    }

    // Build it fresh each time so the name is always current
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'wp-typing-indicator';
        indicator.style.cssText = `
            display: flex; align-items: center; gap: 8px;
            padding: 4px 16px 8px; animation: fadeIn 0.2s ease;
        `;
    }

    indicator.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
            <div style="
                background:#1e293b; border-radius:12px;
                padding:8px 12px; display:flex; align-items:center; gap:6px;
            ">
                <span style="font-size:11px;color:#94a3b8;">${senderName} is typing</span>
                <div style="display:flex;gap:3px;align-items:center;">
                    <span class="wp-dot" style="animation-delay:0s"></span>
                    <span class="wp-dot" style="animation-delay:0.2s"></span>
                    <span class="wp-dot" style="animation-delay:0.4s"></span>
                </div>
            </div>
        </div>
    `;

    const box = document.getElementById('wp-chat-box');
    if (box) {
        box.appendChild(indicator);
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }
}

// Listen for typing events from other room members
socket.on('user_typing',  (data) => { setTypingIndicator(data.sender, true);  });
socket.on('user_stopped', (data) => { setTypingIndicator(data.sender, false); });

// ==========================================
// --- CHAT UI & LOGIC ---
// ==========================================

socket.on('chat_message', (data) => {
    // Hide typing indicator the moment the message lands
    setTypingIndicator(data.sender, false);

    if (data.isSystem) {
        appendMessage(data.sender, data.text, 'system');
    } else {
        appendMessage(data.sender, data.text, 'receiver'); 
    }
});

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
            transform: translateX(0); 
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
        #wp-chat-header {
            background: #1e293b; padding: 16px; font-weight: 600; font-size: 14px;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #334155;
        }
        #wp-chat-box {
            flex-grow: 1; overflow-y: auto; padding: 16px; display: flex; 
            flex-direction: column; gap: 12px; scroll-behavior: smooth;
        }
        #wp-chat-box::-webkit-scrollbar { width: 6px; }
        #wp-chat-box::-webkit-scrollbar-track { background: transparent; }
        #wp-chat-box::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .wp-msg-wrapper { display: flex; flex-direction: column; max-width: 85%; animation: fadeIn 0.3s ease; }
        .wp-msg-wrapper.sender { align-self: flex-end; align-items: flex-end; }
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
        .wp-msg-wrapper.sender .wp-msg-bubble { background: #3b82f6; color: white; border-bottom-right-radius: 4px; }
        .wp-msg-wrapper.receiver .wp-msg-bubble { background: #1e293b; color: #e2e8f0; border-bottom-left-radius: 4px; }
        .wp-timestamp { font-size: 9px; color: #64748b; margin-top: 4px; }
        #wp-reaction-bar { display: flex; gap: 10px; padding: 8px 16px; background: #0f172a; border-top: 1px solid #1e293b; }
        .wp-reaction-btn { background: #1e293b; border: none; border-radius: 12px; cursor: pointer; padding: 6px 10px; font-size: 16px; transition: transform 0.1s, background 0.2s; }
        .wp-reaction-btn:hover { background: #334155; transform: scale(1.1); }
        #wp-input-area { display: flex; padding: 16px; background: #0f172a; gap: 8px; align-items: center; }
        #wp-chat-input {
            flex-grow: 1; background: #1e293b; border: 1px solid #334155; color: white;
            padding: 12px 16px; border-radius: 20px; outline: none; font-size: 14px;
        }
        #wp-chat-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); }
        .wp-action-btn {
            background: #3b82f6; color: white; border: none; width: 40px; height: 40px;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 18px; transition: background 0.2s;
        }
        .wp-action-btn:hover { background: #2563eb; }
        .wp-icon-btn { background: transparent; color: #94a3b8; width: 36px; height: 36px; font-size: 20px; }
        .wp-icon-btn:hover { color: #f8fafc; background: #1e293b; }

        /* --- Typing indicator dots --- */
        @keyframes wp-dot-bounce {
            0%, 80%, 100% { transform: translateY(0);   opacity: 0.4; }
            40%            { transform: translateY(-4px); opacity: 1;   }
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
        <div id="wp-chat-header"><span>🎬 Room: ${ROOM_ID}</span></div>
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

    function setSquish(isDocked) {
        const newWidth = isDocked ? 'calc(100% - 350px)' : '100%';
        document.documentElement.style.width = newWidth;
        document.body.style.width = newWidth;
        const ytApp = document.querySelector('ytd-app');
        if (ytApp) ytApp.style.width = newWidth;
        const ytHeader = document.querySelector('ytd-masthead');
        if (ytHeader) ytHeader.style.width = newWidth;

        // Keep emoji overlay width in sync with the player area
        const overlay = document.getElementById('wp-emoji-overlay');
        if (overlay) overlay.style.width = newWidth;
    }

    let isDocked = true;
    setSquish(true); 

    const toggleTab = document.getElementById('wp-toggle-tab');
    toggleTab.addEventListener('click', () => {
        isDocked = !isDocked;
        if (isDocked) {
            chatContainer.classList.remove('hidden');
            toggleTab.innerText = '▶';
            setSquish(true); 
        } else {
            chatContainer.classList.add('hidden');
            toggleTab.innerText = '◀';
            setSquish(false); 
        }
    });

    const input = document.getElementById('wp-chat-input');
    const sendBtn = document.getElementById('wp-send-btn');

    function sendChat() {
        const text = input.value.trim();
        if (!text || !ROOM_ID) return;
        
        // Stop the typing indicator for everyone when message is sent
        socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME });

        appendMessage('You', text, 'sender'); 
        socket.emit('chat_message', { roomId: ROOM_ID, text: text, sender: USERNAME });
        input.value = '';
    }

    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    // --- Typing indicator: emit while typing, debounce stop ---
    input.addEventListener('input', () => {
        if (!ROOM_ID) return;
        socket.emit('typing', { roomId: ROOM_ID, sender: USERNAME });

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stopped_typing', { roomId: ROOM_ID, sender: USERNAME });
        }, 2000); // 2s of silence = stopped typing
    });

    // --- Reaction bar: float on video AND broadcast to room ---
    document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!ROOM_ID) return;
            const emoji = e.currentTarget.dataset.emoji;

            // Float it locally right away (no round-trip wait)
            floatEmojiOnVideo(emoji);

            // Show it in your own chat as a sender bubble
            appendMessage('You', emoji, 'sender');

            // Broadcast to room (others receive via 'reaction' socket event)
            socket.emit('reaction', { roomId: ROOM_ID, emoji: emoji, sender: USERNAME });
        });
    });
}

// --- Helper: draw Modern Bubbles & System Alerts ---
function appendMessage(sender, text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;

    // Remove the typing indicator before adding a new message so order stays clean
    const existingIndicator = document.getElementById('wp-typing-indicator');
    if (existingIndicator) existingIndicator.remove();
    
    const msgDiv = document.createElement('div');
    
    if (type === 'system') {
        msgDiv.style.cssText = "text-align: center; color: #64748b; font-size: 12px; margin: 8px 0; font-style: italic; animation: fadeIn 0.3s ease;";
        msgDiv.innerText = `${sender} ${text}`;
        box.appendChild(msgDiv);
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
    }

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const initial = sender.charAt(0).toUpperCase();

    msgDiv.className = `wp-msg-wrapper ${type}`;
    
    const headerHtml = type === 'receiver' 
        ? `<div class="wp-avatar-row">
             <div class="wp-avatar">${initial}</div>
             <span class="wp-sender-name">${sender}</span>
           </div>` 
        : '';

    msgDiv.innerHTML = `
        ${headerHtml}
        <div class="wp-msg-bubble"></div>
        <div class="wp-timestamp">${timeString}</div>
    `;
    
    msgDiv.querySelector('.wp-msg-bubble').textContent = text;
    box.appendChild(msgDiv);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}