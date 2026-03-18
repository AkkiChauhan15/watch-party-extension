const socket = io('https://my-watch-party-backend.onrender.com');
let ROOM_ID = ""; // Starts empty!
let USERNAME = "Guest";

socket.on('connect', () => {
    console.log(`🔗 Connected to server. ID: ${socket.id}`);
});

// --- NEW: Listen for the popup to send the Room ID ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "join_room") {
        ROOM_ID = request.room;
        USERNAME = request.username; 
        
        socket.emit('join_room', ROOM_ID);
        showNotification(`SYSTEM CONNECTED: [${ROOM_ID}] AS [${USERNAME}]`);
        injectChatUI();

        // --- NEW: Announce to everyone else that you arrived ---
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

// --- NEW: Visual UI Notification ---
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
// --- UPGRADED: MODERN CHAT UI & LOGIC ---
// ==========================================

// 1. Listen for incoming chat messages from friends
// 1. Listen for incoming chat messages from friends
socket.on('chat_message', (data) => {
    if (data.isSystem) {
        appendMessage(data.sender, data.text, 'system');
    } else {
        appendMessage(data.sender, data.text, 'receiver'); 
    }
});

// 2. Build and inject the Modern Chat UI
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
            <button class="wp-reaction-btn">🔥</button>
            <button class="wp-reaction-btn">😂</button>
            <button class="wp-reaction-btn">😍</button>
            <button class="wp-reaction-btn">👍</button>
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
        
        appendMessage('You', text, 'sender'); 
        socket.emit('chat_message', { roomId: ROOM_ID, text: text, sender: USERNAME });
        input.value = '';
    }

    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat() });

    document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!ROOM_ID) return; 
            const emoji = e.target.innerText;
            appendMessage('You', emoji, 'sender');
          socket.emit('chat_message', { roomId: ROOM_ID, text: emoji, sender: USERNAME });
        });
    });
}

// 3. Helper function to draw Modern Bubbles & System Alerts
function appendMessage(sender, text, type) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    
    const msgDiv = document.createElement('div');
    
    // --- NEW: Handle System Alerts Differently ---
    if (type === 'system') {
        msgDiv.style.cssText = "text-align: center; color: #64748b; font-size: 12px; margin: 8px 0; font-style: italic; animation: fadeIn 0.3s ease;";
        msgDiv.innerText = `${sender} ${text}`;
        box.appendChild(msgDiv);
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return; // Stop here so it doesn't draw a normal bubble
    }

    // --- Normal Chat Bubbles ---
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