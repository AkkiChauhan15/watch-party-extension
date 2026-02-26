document.getElementById("syncBtn").addEventListener("click", async () => {
  const roomInput = document.getElementById("roomInput");
  const roomId = roomInput.value.trim();

  // --- THE FIX: No more alert() ---
  if (!roomId) {
    // 1. Flash the border pink
    roomInput.style.borderColor = "var(--neon-pink)";
    roomInput.style.boxShadow = "0 0 10px var(--neon-pink)";
    
    // 2. Change the placeholder text
    roomInput.value = "";
    roomInput.placeholder = "SYS ERR: ENTER ID";
    
    // 3. Reset it back to normal cyan after 2 seconds
    setTimeout(() => {
        roomInput.style.borderColor = "var(--neon-cyan)";
        roomInput.style.boxShadow = "inset 0 0 5px rgba(0, 255, 255, 0.2)";
        roomInput.placeholder = "ENTER ROOM ID";
    }, 2000);
    
    return; // Stop the function here
  }

  // Find the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send the Room ID to content.js
  chrome.tabs.sendMessage(tab.id, { 
    action: "join_room", 
    room: roomId 
  });
});