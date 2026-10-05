import { MapRenderer } from "./renderer.js";
import { GENERATOR_VERSION, WorldGenerator } from "./world.js";

const canvas = document.querySelector("#map");
const seedInput = document.querySelector("#seed");
const applyButton = document.querySelector("#apply");
const randomButton = document.querySelector("#random");
const homeButton = document.querySelector("#home");
const exportButton = document.querySelector("#export");
const stats = document.querySelector("#stats");
const debugRoutes = document.querySelector("#debugRoutes");
const debugLots = document.querySelector("#debugLots");
const debugIds = document.querySelector("#debugIds");

const params = new URLSearchParams(location.search);
const initialSeed = params.get("seed") || "71-days-after-arrival";

const camera = {
  x: Number(params.get("x")) || 550,
  y: Number(params.get("y")) || 550,
  scale: Math.max(0.07, Math.min(2.4, Number(params.get("s")) || 0.34)),
};

seedInput.value = initialSeed;

const generator = new WorldGenerator(initialSeed);
const renderer = new MapRenderer(canvas);

let framePending = false;
let lastData = null;
let dragging = false;
let pointerX = 0;
let pointerY = 0;
let urlTimer = null;

function updateUrlSoon() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const next = new URL(location.href);
    next.searchParams.set("seed", generator.seedText);
    next.searchParams.set("x", camera.x.toFixed(2));
    next.searchParams.set("y", camera.y.toFixed(2));
    next.searchParams.set("s", camera.scale.toFixed(4));
    history.replaceState(null, "", next);
  }, 180);
}

function renderNow() {
  framePending = false;
  const bounds = renderer.getBounds(camera);
  const started = performance.now();
  const data = generator.query(bounds);
  const elapsed = performance.now() - started;
  lastData = data;
  renderer.render(data, camera);
  stats.textContent =
    `v${GENERATOR_VERSION} · ${data.stats.rooms} rooms · ${data.stats.lots} lots · ` +
    `${data.stats.edges} macro edges · ${data.stats.candidatesConsidered} candidates · ` +
    `${elapsed.toFixed(1)} ms · sig ${data.signature}`;
  updateUrlSoon();
}

function scheduleRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(renderNow);
}

function applySeed() {
  const seed = seedInput.value.trim() || "71-days-after-arrival";
  seedInput.value = seed;
  generator.setSeed(seed);
  scheduleRender();
}

applyButton.addEventListener("click", applySeed);
seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applySeed();
});

randomButton.addEventListener("click", () => {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  seedInput.value = bytes[0].toString(36) + "-" + bytes[1].toString(36);
  applySeed();
});

homeButton.addEventListener("click", () => {
  camera.x = 550;
  camera.y = 550;
  camera.scale = 0.34;
  scheduleRender();
});

exportButton.addEventListener("click", () => {
  if (!lastData) scheduleRender();
  renderer.exportPng(`map-${generator.seedText.replace(/[^a-z0-9_-]+/gi, "-")}.png`);
});

debugRoutes.addEventListener("change", () => {
  renderer.debug.routes = debugRoutes.checked;
  scheduleRender();
});
debugLots.addEventListener("change", () => {
  renderer.debug.lots = debugLots.checked;
  scheduleRender();
});
debugIds.addEventListener("change", () => {
  renderer.debug.ids = debugIds.checked;
  scheduleRender();
});

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - pointerX;
  const dy = event.clientY - pointerY;
  pointerX = event.clientX;
  pointerY = event.clientY;
  camera.x -= dx / camera.scale;
  camera.y -= dy / camera.scale;
  scheduleRender();
});

function stopDrag(event) {
  dragging = false;
  canvas.classList.remove("dragging");
  if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", stopDrag);
canvas.addEventListener("pointercancel", stopDrag);

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const beforeX = camera.x + (px - rect.width / 2) / camera.scale;
  const beforeY = camera.y + (py - rect.height / 2) / camera.scale;

  const factor = Math.exp(-event.deltaY * 0.0012);
  camera.scale = Math.max(0.07, Math.min(2.4, camera.scale * factor));

  const afterX = camera.x + (px - rect.width / 2) / camera.scale;
  const afterY = camera.y + (py - rect.height / 2) / camera.scale;
  camera.x += beforeX - afterX;
  camera.y += beforeY - afterY;
  scheduleRender();
}, { passive: false });

window.addEventListener("resize", scheduleRender);
scheduleRender();
