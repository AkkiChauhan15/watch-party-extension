const socket = io('http://localhost:3000');
let ROOM_ID = ""; // Starts empty!

socket.on('connect', () => {
    console.log(`🔗 Connected to server. ID: ${socket.id}`);
    // Notice we removed the auto-join logic here
});

// --- NEW: Listen for the popup to send the Room ID ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "join_room") {
        ROOM_ID = request.room;
        
        // Now we tell the server to join this specific room
        socket.emit('join_room', ROOM_ID);
        
        // Use your awesome UI notification to confirm!
        showNotification(`SYSTEM CONNECTED: ROOM [${ROOM_ID}]`);
        injectChatUI();
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
    // We use CSS to make a nice floating Netflix-style alert
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: rgba(229, 9, 20, 0.9); color: white; 
        padding: 15px 25px; border-radius: 8px; z-index: 999999;
        font-size: 18px; font-weight: bold; font-family: sans-serif;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3); pointer-events: none;
    `;
    document.body.appendChild(toast);
    
    // Automatically remove the alert after 4 seconds
    setTimeout(() => toast.remove(), 4000);
}

function attachVideoListeners() {
    
    // --- 1. SENDING COMMANDS (Anyone can do this) ---
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

    // --- 2. RECEIVING NORMAL COMMANDS ---
    socket.on('sync_state', (data) => {
        isRemoteAction = true; 
        
        if (Math.abs(video.currentTime - data.time) > 0.5) {
            video.currentTime = data.time;
        }
        if (data.action === 'play') video.play();
        if (data.action === 'pause') video.pause();

        setTimeout(() => isRemoteAction = false, 500);
    });

    // --- 3. NEW: THE HOST RECEIVES A LATECOMER ALERT ---
    socket.on('latecomer_arrived', (data) => {
        console.log(`👋 New user (${data.newUserId}) joined. Pausing to sync.`);
        
        // Host forces a pause
        video.pause(); 
        
        // Host announces the new user to everyone via standard sync
        socket.emit('sync_state', { 
            roomId: ROOM_ID, 
            action: 'pause', 
            time: video.currentTime,
            message: `User ${data.newUserId} has joined!` // Piggyback the message
        });
    });

    // --- 4. NEW: DISPLAYING THE NOTIFICATION ---
    // If the sync command includes a message, show it on screen
    socket.on('sync_state', (data) => {
        if (data.message) {
            showNotification(data.message);
        }
    });
}

// ==========================================
// --- NEW: CHAT UI & LOGIC ---
// ==========================================

// 1. Listen for incoming chat messages from friends
socket.on('chat_message', (data) => {
    appendMessage(data.sender, data.text, '#f0f'); // Neon Pink for friends
});

// 2. Build and inject the Chat Box into the webpage
function injectChatUI() {
    // Prevent injecting it twice
    if (document.getElementById('wp-chat-container')) return;

    // The Main Chat Container
    const chatContainer = document.createElement('div');
    chatContainer.id = 'wp-chat-container';
    chatContainer.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; width: 300px; height: 400px;
        background: rgba(9, 10, 15, 0.9); border: 1px solid #0ff; z-index: 999999;
        display: flex; flex-direction: column; border-radius: 4px; font-family: 'Orbitron', sans-serif, Arial;
        box-shadow: 0 0 15px rgba(0, 255, 255, 0.2); backdrop-filter: blur(5px);
    `;

    // The Header
    const header = document.createElement('div');
    header.innerText = `ROOM: ${ROOM_ID}`;
    header.style.cssText = `
        background: #000; color: #fcee0a; padding: 10px; text-align: center; 
        font-weight: bold; border-bottom: 1px solid #0ff; font-size: 14px; letter-spacing: 1px;
    `;

    // The Message Area
    const chatBox = document.createElement('div');
    chatBox.id = 'wp-chat-box';
    chatBox.style.cssText = `
        flex-grow: 1; overflow-y: auto; padding: 10px; display: flex; 
        flex-direction: column; gap: 8px; font-size: 14px;
    `;

    // The Input Area
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = `display: flex; padding: 10px; border-top: 1px solid #0ff; background: #000;`;

    const input = document.createElement('input');
    input.id = 'wp-chat-input';
    input.type = 'text';
    input.placeholder = 'TRANSMIT MESSAGE...';
    input.style.cssText = `
        flex-grow: 1; background: transparent; border: none; color: #0ff; 
        outline: none; font-family: inherit; font-size: 12px;
    `;

    const sendBtn = document.createElement('button');
    sendBtn.innerText = 'SEND';
    sendBtn.style.cssText = `
        background: transparent; color: #0ff; border: 1px solid #0ff; cursor: pointer; 
        padding: 5px 10px; font-weight: bold; margin-left: 5px; font-family: inherit;
    `;
    sendBtn.onmouseover = () => { sendBtn.style.background = '#0ff'; sendBtn.style.color = '#000'; };
    sendBtn.onmouseout = () => { sendBtn.style.background = 'transparent'; sendBtn.style.color = '#0ff'; };

    // Assemble the pieces
    inputContainer.appendChild(input);
    inputContainer.appendChild(sendBtn);
    chatContainer.appendChild(header);
    chatContainer.appendChild(chatBox);
    chatContainer.appendChild(inputContainer);
    document.body.appendChild(chatContainer);

    // 3. Send Message Logic
    function sendChat() {
        const text = input.value.trim();
        if (!text || !ROOM_ID) return;
        
        // Show your own message immediately
        appendMessage('You', text, '#0ff'); // Neon Cyan for you
        
        // Broadcast to server
        const shortId = socket.id.substring(0, 4);
        socket.emit('chat_message', { roomId: ROOM_ID, text: text, sender: shortId });
        
        input.value = ''; // Clear input
    }

    sendBtn.addEventListener('click', sendChat);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat() });
}

// Helper function to draw messages on screen
function appendMessage(sender, text, color) {
    const box = document.getElementById('wp-chat-box');
    if (!box) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<strong style="color: ${color}">${sender}:</strong> <span style="color: white;">${text}</span>`;
    msgDiv.style.cssText = `
        background: rgba(255,255,255,0.05); padding: 6px 10px; 
        border-radius: 4px; word-wrap: break-word; border-left: 3px solid ${color};
    `;
    
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight; // Auto-scroll to bottom
}