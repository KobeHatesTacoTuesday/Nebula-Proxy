"use strict";

const $ = (selector) => document.querySelector(selector);
const searchTemplate = "https://www.google.com/search?q=%s";
const maxTabs = matchMedia("(max-width: 700px)").matches ? 4 : 8;

const { ScramjetController } = $scramjetLoadController();
const controller = new ScramjetController({
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js",
  },
});
const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

const state = {
  tabs: [],
  activeId: null,
  ready: false,
  readyPromise: null,
  effects: localStorage.getItem("nebula:effects") !== "off" && !matchMedia("(max-width: 700px)").matches,
  clearOnClose: localStorage.getItem("nebula:clear") === "on",
};

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId);
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "New tab"; }
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function setStatus(status, message) {
  const statusButton = $("#statusButton");
  const dot = $("#connectionDot");
  statusButton.classList.remove("ready", "error");
  dot.classList.remove("ready", "error");
  if (status !== "starting") {
    statusButton.classList.add(status);
    dot.classList.add(status);
  }
  $("#statusText").textContent = status === "ready" ? "PROXY READY" : status === "error" ? "OFFLINE" : "STARTING";
  $("#panelStatus").textContent = message;
  $(".connection-card .connection-dot").className = `connection-dot ${status}`;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 1800);
}

function startProgress() {
  const bar = $("#progress");
  bar.style.opacity = "1";
  bar.style.width = "18%";
  requestAnimationFrame(() => { bar.style.width = "82%"; });
}

function stopProgress() {
  const bar = $("#progress");
  bar.style.width = "100%";
  setTimeout(() => {
    bar.style.opacity = "0";
    bar.style.width = "0";
  }, 180);
}

async function prepareProxy() {
  if (state.ready) return;
  if (state.readyPromise) return state.readyPromise;

  state.readyPromise = (async () => {
    setStatus("starting", "Starting proxy");
    await controller.init();
    await registerSW();
    const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
    if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
      await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    }
    state.ready = true;
    setStatus("ready", "Proxy connected");
  })().catch((error) => {
    state.readyPromise = null;
    setStatus("error", "Proxy connection failed");
    throw error;
  });

  return state.readyPromise;
}

function createFrame(tab) {
  if (tab.proxy) return tab.proxy;

  const proxy = controller.createFrame();
  proxy.frame.className = "proxy-frame";
  proxy.frame.title = "Proxied browser content";
  proxy.frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; picture-in-picture");
  $("#frameHost").appendChild(proxy.frame);

  proxy.addEventListener("navigate", (event) => {
    startProgress();
    if (event.url) tab.url = String(event.url);
  });

  proxy.addEventListener("urlchange", (event) => {
    if (event.url) {
      tab.url = String(event.url);
      tab.title = domain(tab.url);
      if (tab.id === state.activeId) $("#addressInput").value = tab.url;
      renderTabs();
    }
    stopProgress();
  });

  proxy.frame.addEventListener("load", () => {
    stopProgress();
    setTimeout(() => {
      try {
        const title = proxy.frame.contentDocument?.title?.trim();
        if (title) tab.title = title;
      } catch {}
      renderTabs();
    }, 120);
  });

  tab.proxy = proxy;
  return proxy;
}

function makeTab(select = true) {
  if (state.tabs.length >= maxTabs) {
    toast(`Maximum ${maxTabs} tabs`);
    return activeTab();
  }
  const tab = { id: id(), title: "New tab", url: "", proxy: null };
  state.tabs.push(tab);
  if (select) selectTab(tab.id);
  renderTabs();
  setTimeout(() => $("#startInput").focus(), 20);
  return tab;
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const [removed] = state.tabs.splice(index, 1);
  removed.proxy?.frame.remove();
  if (!state.tabs.length) return void makeTab();
  if (state.activeId === tabId) selectTab(state.tabs[Math.max(0, index - 1)].id);
  renderTabs();
}

function selectTab(tabId) {
  state.activeId = tabId;
  const tab = activeTab();
  document.querySelectorAll(".proxy-frame").forEach((frame) => frame.classList.remove("active"));
  if (tab?.proxy) tab.proxy.frame.classList.add("active");
  $("#startPage").classList.toggle("hidden", Boolean(tab?.url));
  $("#errorScreen").classList.add("hidden");
  $("#addressInput").value = tab?.url || "";
  document.body.classList.toggle("browsing", Boolean(tab?.url));
  document.title = tab?.title && tab.title !== "New tab" ? `${tab.title} — Nebula` : "Nebula";
  renderTabs();
}

function renderTabs() {
  $("#tabs").innerHTML = state.tabs.map((tab) => `
    <button class="tab ${tab.id === state.activeId ? "active" : ""}" data-tab="${tab.id}" role="tab" aria-selected="${tab.id === state.activeId}">
      <span class="tab-icon">${tab.url ? escapeHtml(domain(tab.url).slice(0, 1).toUpperCase()) : "N"}</span>
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <span class="tab-close" data-close-tab="${tab.id}" role="button" aria-label="Close tab">×</span>
    </button>`).join("");
}

async function navigate(value) {
  const input = value.trim();
  if (!input) return;
  const tab = activeTab();
  tab.url = search(input, searchTemplate);
  tab.title = domain(tab.url);
  $("#addressInput").value = tab.url;
  $("#startPage").classList.add("hidden");
  $("#errorScreen").classList.add("hidden");
  document.body.classList.add("browsing");
  renderTabs();
  startProgress();

  try {
    await prepareProxy();
    const proxy = createFrame(tab);
    document.querySelectorAll(".proxy-frame").forEach((frame) => frame.classList.remove("active"));
    proxy.frame.classList.add("active");
    proxy.go(tab.url);
  } catch (error) {
    stopProgress();
    $("#errorScreen").classList.remove("hidden");
    $("#errorMessage").textContent = error?.message || "The proxy could not connect. This app requires HTTPS and a WebSocket-capable Node server.";
  }
}

function navigateActive(method) {
  const tab = activeTab();
  if (!tab?.proxy) return;
  startProgress();
  tab.proxy[method]();
}

const shortcutData = [
  ["Google", "https://google.com", "G"],
  ["YouTube", "https://youtube.com", "▶"],
  ["Reddit", "https://reddit.com", "R"],
  ["Discord", "https://discord.com/app", "D"],
  ["Wikipedia", "https://wikipedia.org", "W"],
  ["GitHub", "https://github.com", "GH"],
];

function renderShortcuts() {
  $("#shortcuts").innerHTML = shortcutData.map(([name, url, icon]) => `
    <button class="shortcut" data-url="${url}"><span class="shortcut-icon">${icon}</span><span class="shortcut-name">${name}</span></button>`).join("");
}

function setEffects(enabled) {
  state.effects = enabled;
  document.body.classList.toggle("no-effects", !enabled);
  $("#effectsToggle").checked = enabled;
  localStorage.setItem("nebula:effects", enabled ? "on" : "off");
}

function toggleMenu(force) {
  const menu = $("#menu");
  const open = typeof force === "boolean" ? force : !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", String(!open));
}

function wireEvents() {
  $("#addressForm").addEventListener("submit", (event) => { event.preventDefault(); navigate($("#addressInput").value); });
  $("#startForm").addEventListener("submit", (event) => { event.preventDefault(); navigate($("#startInput").value); });
  $("#shortcuts").addEventListener("click", (event) => { const button = event.target.closest("[data-url]"); if (button) navigate(button.dataset.url); });
  $("#tabs").addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-tab]");
    if (close) { event.stopPropagation(); closeTab(close.dataset.closeTab); return; }
    const tab = event.target.closest("[data-tab]");
    if (tab) selectTab(tab.dataset.tab);
  });
  $("#newTabButton").addEventListener("click", () => makeTab());
  $("#menuNewTab").addEventListener("click", () => { makeTab(); toggleMenu(false); });
  $("#homeButton").addEventListener("click", () => makeTab());
  $("#backButton").addEventListener("click", () => navigateActive("back"));
  $("#forwardButton").addEventListener("click", () => navigateActive("forward"));
  $("#reloadButton").addEventListener("click", () => navigateActive("reload"));
  $("#retryButton").addEventListener("click", () => navigate(activeTab()?.url || $("#addressInput").value));
  $("#menuButton").addEventListener("click", () => toggleMenu());
  $("#statusButton").addEventListener("click", () => toggleMenu());
  $("#closeMenu").addEventListener("click", () => toggleMenu(false));
  $("#effectsToggle").addEventListener("change", (event) => setEffects(event.target.checked));
  $("#clearToggle").checked = state.clearOnClose;
  $("#clearToggle").addEventListener("change", (event) => { state.clearOnClose = event.target.checked; localStorage.setItem("nebula:clear", state.clearOnClose ? "on" : "off"); });
  $("#fullscreenButton").addEventListener("click", () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); toggleMenu(false); });
  document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#menu") && !event.target.closest("#menuButton") && !event.target.closest("#statusButton")) toggleMenu(false); });
  document.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && ["l", "k"].includes(event.key.toLowerCase())) { event.preventDefault(); $("#addressInput").focus(); $("#addressInput").select(); }
    if (command && event.key.toLowerCase() === "t") { event.preventDefault(); makeTab(); }
    if (command && event.key.toLowerCase() === "w") { event.preventDefault(); closeTab(state.activeId); }
    if (command && event.key.toLowerCase() === "r") { event.preventDefault(); navigateActive("reload"); }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); navigateActive("back"); }
    if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); navigateActive("forward"); }
    if (event.key === "Escape") toggleMenu(false);
  });
  window.addEventListener("beforeunload", () => { if (state.clearOnClose) { localStorage.removeItem("nebula:effects"); localStorage.removeItem("nebula:clear"); } });
}

renderShortcuts();
setEffects(state.effects);
wireEvents();
makeTab();
prepareProxy().catch(() => {});
