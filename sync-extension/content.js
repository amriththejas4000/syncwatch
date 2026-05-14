// content.js - SIMPLE VERSION, just make sync work
if (window.top === window) injectSidebar();

let isSyncing = false;
let roomActive = false;
let isHost = false;
let controlMode = "everyone";
let sidebarOpen = false;
let isAdPlaying = false;
let currentUrl = location.href;

setInterval(() => {
  if (!roomActive) return;
  
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    if (controlMode === "everyone" || isHost) {
      console.log("[SW] url changed:", currentUrl);
      chrome.runtime.sendMessage({ type: "url-change", url: currentUrl });
    }
  }

  // YouTube ad selectors (these safely disappear from the DOM when not active)
  const adEl = document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay, .ytp-ad-module:not(:empty)');
  
  let isHotstarAd = false;
  if (location.hostname.includes('hotstar.com')) {
    const player = document.querySelector('[data-testid="player-space-container"]');
    if (player) {
      const adText = document.evaluate(".//*[text()='Go Ads free' or text()='Go Ads Free']", player, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (adText && adText.getBoundingClientRect().width > 0) {
        isHotstarAd = true;
      }
    }
  }

  const isAd = !!adEl || isHotstarAd;
  if (isAd !== isAdPlaying) {
    isAdPlaying = isAd;
    console.log("[SW] ad status changed:", isAdPlaying);
    chrome.runtime.sendMessage({ type: "ad-status", playing: isAdPlaying });
  }
}, 1000);

function injectSidebar() {
  if (document.getElementById("sw-frame")) return;

  const toggle = document.createElement("div");
  toggle.id = "sw-toggle";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>`;
  toggle.style.cssText = "position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:2147483647;width:24px;height:56px;background:linear-gradient(135deg,#7c6dfa,#fa6d9a);border-radius:0 10px 10px 0;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:2px 0 16px rgba(124,109,250,0.5);transition:left 0.35s ease, opacity 0.35s ease;";

  const frame = document.createElement("iframe");
  frame.id = "sw-frame";
  frame.src = chrome.runtime.getURL("sidebar.html");
  frame.allow = "clipboard-write";
  frame.style.cssText = "position:fixed;left:-345px;top:0;width:340px;height:100%;z-index:2147483646;border:none;box-shadow:4px 0 30px rgba(0,0,0,0.7);border-radius:0 16px 16px 0;transition:left 0.35s cubic-bezier(0.4,0,0.2,1);";

  document.documentElement.appendChild(frame);
  document.documentElement.appendChild(toggle);

  let toggleTimeout;
  let isHoveringArea = false;

  function hideToggle() {
    if (!sidebarOpen && !isHoveringArea) {
      toggle.style.opacity = "0";
      toggle.style.pointerEvents = "none";
    }
  }

  document.addEventListener("mousemove", (e) => {
    const threshold = sidebarOpen ? 390 : 60;
    const inArea = e.clientX <= threshold;
    
    if (inArea !== isHoveringArea) {
      isHoveringArea = inArea;
      if (inArea) {
        toggle.style.opacity = "1";
        toggle.style.pointerEvents = "auto";
        clearTimeout(toggleTimeout);
      } else {
        if (!sidebarOpen) {
          clearTimeout(toggleTimeout);
          toggleTimeout = setTimeout(hideToggle, 5000);
        }
      }
    }
  });

  // Initialize visible state
  toggle.style.opacity = "1";
  toggle.style.pointerEvents = "auto";
  toggleTimeout = setTimeout(hideToggle, 5000);

  function setOpen(open) {
    sidebarOpen = open;
    frame.style.left = open ? "0" : "-345px";
    toggle.style.left = open ? "340px" : "0";
    toggle.querySelector("svg").style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
  }

  toggle.addEventListener("click", () => setOpen(!sidebarOpen));

  // sidebar → background
  window.addEventListener("message", (e) => {
    if (e.data?.from !== "sw-sidebar") return;
    const msg = e.data.msg;
    if (["create-room", "join-room", "leave-room", "send-sync", "send-chat", "save-user", "typing-start", "typing-stop", "force-sync"].includes(msg.type)) {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return;
        if (msg.type === "create-room" && res) postToFrame({ type: "create-room-res", ...res, controlMode: msg.controlMode });
        if (msg.type === "join-room" && res) postToFrame({ type: "join-room-res", ...res });
      });
    }
  });

  // background → sidebar
  chrome.runtime.onMessage.addListener((msg) => {
    postToFrame(msg);
    if (msg.type === "room-joined") {
      roomActive = true; isHost = msg.isHost; controlMode = msg.controlMode;
      console.log("[SW] room joined, attaching media");
      attachMedia();
    }
    if (msg.type === "room-left") { roomActive = false; }
    if (msg.type === "sync-event") {
      console.log("[SW] got sync event", msg.data);
      applySyncEvent(msg.data);
    }
    if (msg.type === "toggle-sidebar") setOpen(!sidebarOpen);
  });

  function postToFrame(msg) {
    try { frame.contentWindow?.postMessage({ from: "sw-bg", msg }, "*"); } catch { }
  }
}

// on page load check if already in room
chrome.runtime.sendMessage({ type: "tab-sync-check", url: location.href }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res?.active) {
    roomActive = true; isHost = res.isHost; controlMode = res.controlMode;
    console.log("[SW] already in room, attaching media");
    attachMedia();
  }
});

function attachMedia() {
  const run = () => {
    const els = [...document.querySelectorAll("video,audio")];
    console.log("[SW] found media elements:", els.length);
    els.forEach(attachEl);
  };
  run();
  setTimeout(run, 1000);
  setTimeout(run, 3000);
  new MutationObserver(() => {
    [...document.querySelectorAll("video,audio")].forEach(el => { if (!el._sw) attachEl(el); });
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
}

let initialSyncDone = false;

function attachEl(el) {
  if (el._sw) return;
  el._sw = true;
  console.log("[SW] attached to media element", el);

  if (!initialSyncDone) {
    initialSyncDone = true;
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "silent-sync" });
    }, 400);
  }

  el.addEventListener("play", () => {
    console.log("[SW] play detected, isSyncing:", isSyncing);
    sendSync("play", el);
  });
  el.addEventListener("pause", () => {
    console.log("[SW] pause detected, isSyncing:", isSyncing);
    sendSync("pause", el);
  });
  el.addEventListener("seeked", () => {
    console.log("[SW] seek detected");
    sendSync("seek", el);
  });
}

function sendSync(type, el) {
  if (!roomActive) { console.log("[SW] not in room, skip"); return; }
  if (isSyncing) { console.log("[SW] isSyncing, skip"); return; }
  if (isAdPlaying) { console.log("[SW] ad is playing, don't send syncs"); return; }
  if (controlMode === "host-only" && !isHost) return;
  const data = { type, currentTime: el.currentTime, paused: el.paused };
  console.log("[SW] sending sync", data);
  chrome.runtime.sendMessage({ type: "send-sync", data });
}

function applySyncEvent(data) {
  if (data.type === "nav") {
    console.log("[SW] navigating to:", data.url);
    if (location.href !== data.url) location.href = data.url;
    return;
  }

  if (isAdPlaying) { console.log("[SW] ad is playing, ignoring incoming syncs"); return; }
  const el = document.querySelector("video,audio");
  if (!el) { console.log("[SW] no media element to apply sync"); return; }
  console.log("[SW] applying sync", data, "current:", el.currentTime);
  isSyncing = true;
  if (data.type === "seek" || Math.abs(el.currentTime - data.currentTime) > 1.5) {
    el.currentTime = data.currentTime;
  }
  if (data.paused === true || data.type === "pause") el.pause();
  else if (data.paused === false || data.type === "play") el.play().catch(() => { });
  setTimeout(() => { isSyncing = false; }, 500);
}