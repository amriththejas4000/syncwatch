// sidebar.js — runs inside the iframe

const adjectives = ["Cozy", "Blue", "Red", "Swift", "Lazy", "Happy", "Mystic", "Wild", "Calm", "Brave", "Chill", "Dark", "Neon", "Pixel", "Fuzzy", "Jolly", "Sly", "Zany", "Bold", "Epic"];
const animals = ["Panda", "Fox", "Wolf", "Bear", "Tiger", "Hawk", "Otter", "Lynx", "Raven", "Koala", "Drake", "Viper", "Moose", "Gecko", "Sloth", "Crane", "Bison", "Dingo", "Quail", "Stoat"];
const colors = ["#7c6dfa", "#fa6d9a", "#4dfa9a", "#faa04d", "#4db8fa", "#fa4d4d", "#c44dfa", "#4dfae0", "#fa8c4d", "#4dfac4"];

const $ = id => document.getElementById(id);
let myUser = null;
let memberCount = 1;
let editingName = false;

// ── Communicate with parent (content script) ──────────────
function sendToParent(msg) {
  window.parent.postMessage({ from: "sw-sidebar", msg }, "*");
}

// background sends messages via content script → postMessage to iframe
window.addEventListener("message", (e) => {
  if (e.data?.from !== "sw-bg") return;
  handleBgMsg(e.data.msg);
});

function handleBgMsg(msg) {
  if (msg.type === "typing-start") {
    typingUsers.set(msg.data.name, msg.data.color);
    renderTyping();
  }
  if (msg.type === "typing-stop") {
    typingUsers.delete(msg.data.name);
    renderTyping();
  }
  if (msg.type === "chat-message") {
    // clear typing for that sender when message arrives
    if (!msg.data.system && msg.data.sender?.name) {
      typingUsers.delete(msg.data.sender.name);
      renderTyping();
    }
    addMsg(msg.data);
  }
  if (msg.type === "member-joined") { memberCount = msg.data.memberCount; $("mcnt").textContent = memberCount; }
  if (msg.type === "member-left") { memberCount = msg.data.memberCount; $("mcnt").textContent = memberCount; }
  if (msg.type === "promoted-to-host") {
    $("rbadge").textContent = "host"; $("rbadge").className = "bdg bh";
    addMsg({ system: true, text: "You are now the host 👑" });
  }
  if (msg.type === "room-left") {
    $("btnForceSync").style.display = "none";
    chrome.storage.local.remove(["swRoomId", "swIsHost", "swControlMode", "swSyncUrl", "chatMessages"]);
    $("dot").classList.remove("on");
    $("clist").innerHTML = "";
    show("sHome");
  }
}

// ── Boot ──────────────────────────────────────────────────
chrome.storage.local.get(["swUser", "swRoomId", "swIsHost", "swControlMode", "swSyncUrl", "chatMessages"], (s) => {
  // set or generate persistent user
  if (s.swUser) {
    myUser = JSON.parse(s.swUser);
  } else {
    myUser = generateUser();
    chrome.storage.local.set({ swUser: JSON.stringify(myUser) });
  }
  renderIdentity();

  // restore room if active
  if (s.swRoomId) {
    enterRoom(s.swRoomId, s.swIsHost, s.swControlMode, s.swSyncUrl);
    $("dot").classList.add("on");
    // restore chat history
    if (s.chatMessages?.length) {
      s.chatMessages.forEach(addMsg);
    }
  }
});

function generateUser() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const ani = animals[Math.floor(Math.random() * animals.length)];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return { name: adj + ani, color, initials: adj[0] + ani[0] };
}

function renderIdentity() {
  if (!myUser) return;
  $("bigAv").textContent = myUser.initials;
  $("bigAv").style.background = myUser.color;
  $("uname").textContent = myUser.name;
}

// ── Edit name ─────────────────────────────────────────────
$("editAvBtn").addEventListener("click", () => {
  editingName = !editingName;
  $("nameEditRow").style.display = editingName ? "flex" : "none";
  if (editingName) { $("nameEditInp").value = myUser.name; $("nameEditInp").focus(); }
});

$("nameSaveBtn").addEventListener("click", saveName);
$("nameEditInp").addEventListener("keydown", e => { if (e.key === "Enter") saveName(); });

function saveName() {
  const n = $("nameEditInp").value.trim();
  if (!n || n.length < 2) return;
  // keep color and initials based on new name
  myUser.name = n;
  myUser.initials = n.substring(0, 2).toUpperCase();
  chrome.storage.local.set({ swUser: JSON.stringify(myUser) });
  sendToParent({ type: "save-user", user: myUser });
  renderIdentity();
  editingName = false;
  $("nameEditRow").style.display = "none";
}

// ── Screen nav ────────────────────────────────────────────
function show(id) {
  document.querySelectorAll(".scr").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
}

$("btnCreate2").addEventListener("click", () => show("sCreate"));
$("btnJoin2").addEventListener("click", () => show("sJoin"));
$("bkCreate").addEventListener("click", () => { $("cerr").textContent = ""; show("sHome"); });
$("bkJoin").addEventListener("click", () => { $("jerr").textContent = ""; show("sJoin"); show("sHome"); });

// ── Create ────────────────────────────────────────────────
$("btnDoCreate").addEventListener("click", () => {
  $("btnDoCreate").disabled = true; $("btnDoCreate").textContent = "Creating...";
  const controlMode = $("hostTog").checked ? "host-only" : "everyone";
  sendToParent({ type: "create-room", controlMode, user: myUser });
});

// ── Join ──────────────────────────────────────────────────
$("btnDoJoin").addEventListener("click", () => {
  const code = $("joinInp").value.trim().toUpperCase();
  if (code.length < 6) { $("jerr").textContent = "Enter full 6-char code"; return; }
  $("btnDoJoin").disabled = true; $("btnDoJoin").textContent = "Joining...";
  sendToParent({ type: "join-room", roomId: code, user: myUser });
});

// ── Responses from background (via content → postMessage) ─
window.addEventListener("message", (e) => {
  if (e.data?.from !== "sw-bg") return;
  const msg = e.data.msg;

  if (msg.type === "create-room-res") {
    $("btnDoCreate").disabled = false; $("btnDoCreate").textContent = "Create room";
    if (msg.error) { $("cerr").textContent = msg.error; return; }
    enterRoom(msg.roomId, true, msg.controlMode || "everyone", msg.syncUrl);
    $("dot").classList.add("on");
  }
  if (msg.type === "join-room-res") {
    $("btnDoJoin").disabled = false; $("btnDoJoin").textContent = "Join room";
    if (msg.error) { $("jerr").textContent = msg.error === "Room not found" ? "Room not found — check the code" : msg.error; return; }
    enterRoom(msg.roomId, false, msg.controlMode, msg.syncUrl);
    if (msg.history) msg.history.forEach(addMsg);
    $("dot").classList.add("on");
  }
});

// ── Room screen ───────────────────────────────────────────
function enterRoom(roomId, isHost, controlMode, syncUrl) {
  $("btnForceSync").style.display = "flex";
  $("rcode").textContent = roomId;
  $("rbadge").textContent = isHost ? "host" : "viewer";
  $("rbadge").className = "bdg " + (isHost ? "bh" : "bv");
  $("mbadge").textContent = controlMode === "host-only" ? "host ctrl" : "everyone";
  try { $("stxt").textContent = "Synced · " + new URL(syncUrl).hostname; } catch { $("stxt").textContent = "Synced"; }
  show("sRoom");
}

$("rcode").addEventListener("click", () => {
  navigator.clipboard.writeText($("rcode").textContent).then(() => {
    $("rcode").style.color = "var(--gr)";
    setTimeout(() => { $("rcode").style.color = ""; }, 1500);
  });
});

$("btnForceSync").addEventListener("click", () => {
  $("btnForceSync").disabled = true;
  $("btnForceSync").style.transform = "rotate(360deg)";
  $("btnForceSync").style.opacity = "0.4";
  sendToParent({ type: "force-sync" });
  setTimeout(() => {
    $("btnForceSync").style.transform = "rotate(0deg)";
    $("btnForceSync").disabled = false;
    $("btnForceSync").style.opacity = "1";
  }, 1000);
});

$("btnLeave").addEventListener("click", () => {
  $("btnForceSync").style.display = "none";
  sendToParent({ type: "leave-room" });
  chrome.storage.local.remove(["swRoomId", "swIsHost", "swControlMode", "swSyncUrl", "chatMessages"]);
  $("dot").classList.remove("on");
  $("clist").innerHTML = "";
  memberCount = 1; $("mcnt").textContent = "1";
  show("sHome");
});

// ── Typing indicator ──────────────────────────────────────
let typingTimeout = null;
let isTyping = false;
const typingUsers = new Map(); // name → color

$("cinp").addEventListener("input", () => {
  if (!isTyping) {
    isTyping = true;
    sendToParent({ type: "typing-start" });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isTyping = false;
    sendToParent({ type: "typing-stop" });
  }, 2000);
});

function renderTyping() {
  const bar = $("typingBar");
  if (typingUsers.size === 0) { bar.innerHTML = ""; return; }
  const names = [...typingUsers.entries()].map(([name, color]) =>
    `<span style="color:${color};font-weight:600">${esc(name)}</span>`
  ).join(", ");
  const label = typingUsers.size === 1 ? "is typing" : "are typing";
  bar.innerHTML = `${names} ${label} <span class="typing-dot"><span></span><span></span><span></span></span>`;
}

// ── Chat ──────────────────────────────────────────────────
function sendChat() {
  const text = $("cinp").value.trim();
  if (!text) return;
  sendToParent({ type: "send-chat", text });
  // stop typing indicator
  clearTimeout(typingTimeout);
  isTyping = false;
  sendToParent({ type: "typing-stop" });
  $("cinp").value = "";
  // DON'T add locally — server will echo back
}
$("sbtn").addEventListener("click", sendChat);
$("cinp").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

function addMsg(data) {
  // deduplicate by id
  if (data.id && document.querySelector(`[data-msgid="${data.id}"]`)) return;

  const list = $("clist");
  const el = document.createElement("div");
  if (data.id) el.dataset.msgid = data.id;

  if (data.isLink) {
    el.className = "slink";
    let shortUrl = data.url;
    try { const u = new URL(data.url); shortUrl = u.hostname + u.pathname; } catch { }
    if (shortUrl.length > 45) shortUrl = shortUrl.substring(0, 45) + "…";
    el.innerHTML = `<div class="sl-label">📌 Syncing this page</div><a href="${esc(data.url)}" target="_blank">${esc(shortUrl)}</a>`;
  } else if (data.system) {
    el.className = "smsg";
    el.innerHTML = `<span>${esc(data.text)}</span>`;
  } else {
    const isSelf = myUser && data.sender?.name === myUser.name;
    const sender = data.sender || {};
    el.className = "mrow " + (isSelf ? "me" : "other");
    const av = `<div class="mav" style="background:${esc(sender.color || '#7c6dfa')}">${esc(sender.initials || '?')}</div>`;
    const cont = `<div class="mcont"><div class="mname">${esc(sender.name || '')}</div><div class="mbub">${esc(data.text)}</div></div>`;
    el.innerHTML = isSelf ? cont + av : av + cont;
  }

  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

$("joinInp").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  $("jerr").textContent = "";
});