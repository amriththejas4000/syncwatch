importScripts("socket.io.js");
const SERVER_URL = "https://syncwatch-server-production-2664.up.railway.app";
let socket = null;
let roomInfo = null;

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "toggle-sidebar" }).catch(() => { });
});

function connectSocket(user) {
  if (socket?.connected) return;
  socket = io(SERVER_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    console.log("[BG] socket connected:", socket.id);
    if (user) socket.emit("set-identity", user);
  });

  socket.on("disconnect", () => console.log("[BG] socket disconnected"));

  socket.on("sync-event", (data) => {
    console.log("[BG] got sync-event from server, broadcasting to all tabs:", data);
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "sync-event", data }).catch(() => { });
      });
    });
  });

  socket.on("chat-message", (data) => {
    chrome.storage.local.get("chatMessages", (s) => {
      const msgs = s.chatMessages || [];
      msgs.push(data);
      if (msgs.length > 300) msgs.splice(0, msgs.length - 300);
      chrome.storage.local.set({ chatMessages: msgs });
    });
    broadcastAll({ type: "chat-message", data });
  });

  socket.on("member-joined", (d) => broadcastAll({ type: "member-joined", data: d }));
  socket.on("member-left", (d) => broadcastAll({ type: "member-left", data: d }));
  socket.on("typing-start", (d) => broadcastAll({ type: "typing-start", data: d }));
  socket.on("typing-stop", (d) => broadcastAll({ type: "typing-stop", data: d }));
  socket.on("promoted-to-host", () => {
    if (roomInfo) { roomInfo.isHost = true; chrome.storage.local.set({ swIsHost: true }); }
    broadcastAll({ type: "promoted-to-host" });
  });
}

function broadcastAll(msg) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, msg).catch(() => { }));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "create-room") {
    chrome.storage.local.get("swUser", (s) => {
      const user = s.swUser ? JSON.parse(s.swUser) : msg.user;
      connectSocket(user);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const syncUrl = tabs[0]?.url || "";
        socket.emit("create-room", { controlMode: msg.controlMode, syncUrl, user }, (res) => {
          if (res.error) return sendResponse({ error: res.error });
          roomInfo = { roomId: res.roomId, isHost: true, controlMode: msg.controlMode, syncUrl, tabId: sender.tab.id };
          chrome.storage.local.set({ swRoomId: res.roomId, swIsHost: true, swControlMode: msg.controlMode, swSyncUrl: syncUrl, chatMessages: [] });
          console.log("[BG] room created:", res.roomId);
          notifyAllTabs();
          sendResponse({ ...res, syncUrl });
        });
      });
    });
    return true;
  }

  if (msg.type === "join-room") {
    chrome.storage.local.get("swUser", (s) => {
      const user = s.swUser ? JSON.parse(s.swUser) : msg.user;
      connectSocket(user);
      socket.emit("join-room", { roomId: msg.roomId, user }, (res) => {
        if (res.error) return sendResponse({ error: res.error });
        roomInfo = { roomId: res.roomId, isHost: false, controlMode: res.controlMode, syncUrl: res.syncUrl, tabId: sender.tab.id };
        chrome.storage.local.set({ swRoomId: res.roomId, swIsHost: false, swControlMode: res.controlMode, swSyncUrl: res.syncUrl, chatMessages: res.history || [] });
        console.log("[BG] joined room:", res.roomId);
        notifyAllTabs();
        sendResponse(res);
      });
    });
    return true;
  }

  if (msg.type === "send-sync") {
    console.log("[BG] sending sync to server:", msg.data);
    if (socket?.connected && roomInfo) {
      socket.emit("sync-event", msg.data);
    } else {
      console.log("[BG] cant send - socket connected:", socket?.connected, "roomInfo:", !!roomInfo);
    }
    return;
  }

  if (msg.type === "typing-start") { if (socket?.connected) socket.emit("typing-start"); }
  if (msg.type === "typing-stop") { if (socket?.connected) socket.emit("typing-stop"); }
  if (msg.type === "send-chat") { if (socket?.connected) socket.emit("chat-message", { text: msg.text }); }

  if (msg.type === "save-user") {
    chrome.storage.local.set({ swUser: JSON.stringify(msg.user) });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "leave-room") {
    socket?.disconnect(); socket = null; roomInfo = null;
    chrome.storage.local.remove(["swRoomId", "swIsHost", "swControlMode", "swSyncUrl", "chatMessages"]);
    broadcastAll({ type: "room-left" });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "force-sync") {
    if (socket?.connected && roomInfo) {
      roomInfo.tabId = sender.tab.id;
      socket.emit("force-sync-notify");
      socket.emit("request-sync", null, (res) => {
        if (res) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "sync-event",
            data: { type: "seek", currentTime: res.currentTime, paused: res.paused }
          }).catch(() => { });
        }
      });
    }
    return;
  }

  if (msg.type === "silent-sync") {
    if (socket?.connected && roomInfo) {
      socket.emit("request-sync", null, (res) => {
        if (res) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "sync-event",
            data: { type: "seek", currentTime: res.currentTime, paused: res.paused }
          }).catch(() => { });
        }
      });
    }
    return;
  }

  if (msg.type === "ad-status") {
    if (socket?.connected && roomInfo) {
      socket.emit("ad-status", { playing: msg.playing });
    }
    return;
  }

  if (msg.type === "url-change") {
    if (socket?.connected && roomInfo && roomInfo.tabId === sender.tab.id) {
      roomInfo.syncUrl = msg.url;
      chrome.storage.local.set({ swSyncUrl: msg.url });
      socket.emit("url-change", { url: msg.url });
    }
    return;
  }

  if (msg.type === "tab-sync-check") {
    if (roomInfo) sendResponse({ active: true, ...roomInfo });
    else sendResponse({ active: false });
    return true;
  }
});

function notifyAllTabs() {
  if (!roomInfo) return;
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { type: "room-joined", ...roomInfo }).catch(() => { });
    });
  });
}