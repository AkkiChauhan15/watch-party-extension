document.getElementById("syncBtn").addEventListener("click", async () => {
  const roomInput = document.getElementById("roomInput");
  const usernameInput = document.getElementById("usernameInput");
  
  const roomId = roomInput.value.trim();
  // Grab the username, default to 'Guest' if they left it blank
  const username = usernameInput.value.trim() || "Guest";

  if (!roomId) {
    roomInput.style.borderColor = "var(--neon-pink)";
    roomInput.style.boxShadow = "0 0 10px var(--neon-pink)";
    roomInput.value = "";
    roomInput.placeholder = "SYS ERR: ENTER ID";
    
    setTimeout(() => {
        roomInput.style.borderColor = "var(--neon-cyan)";
        roomInput.style.boxShadow = "inset 0 0 5px rgba(0, 255, 255, 0.2)";
        roomInput.placeholder = "ENTER ROOM ID";
    }, 2000);
    return; 
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
      // Send BOTH the Room ID and the Username to content.js
      await chrome.tabs.sendMessage(tab.id, { 
        action: "join_room", 
        room: roomId,
        username: username
      });
  } catch (error) {
      roomInput.style.borderColor = "var(--neon-pink)";
      roomInput.value = "";
      roomInput.placeholder = "ERR: MUST BE ON YOUTUBE";
      setTimeout(() => {
          roomInput.style.borderColor = "var(--neon-cyan)";
          roomInput.placeholder = "ENTER ROOM ID";
      }, 3000);
  }
});