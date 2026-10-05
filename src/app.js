import { MapRenderer } from "./renderer.js";
import { GENERATOR_VERSION, WorldGenerator } from "./world.js";

const canvas = document.querySelector("#map");
const seedInput = document.querySelector("#seed");
const applyButton = document.querySelector("#apply");
const randomButton = document.querySelector("#random");
const homeButton = document.querySelector("#home");
const exportButton = document.querySelector("#export");
const stats = document.querySelector("#stats");
const debugPortals = document.querySelector("#debugPortals");
const debugDistricts = document.querySelector("#debugDistricts");
const debugIds = document.querySelector("#debugIds");

const params = new URLSearchParams(location.search);
const initialSeed = params.get("seed") || "71-days-after-arrival";
const camera = {
  x: Number(params.get("x")) || 520,
  y: Number(params.get("y")) || 520,
  scale: Math.max(0.13, Math.min(2.5, Number(params.get("s")) || 0.30)),
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
    `v${GENERATOR_VERSION} · ${data.stats.rooms} rooms · ${data.stats.cells} owned cells · ` +
    `${data.stats.districts} districts · ${data.stats.doors} doors · ` +
    `${(data.stats.averageDensity * 100).toFixed(0)}% mean fill · ${elapsed.toFixed(1)} ms · sig ${data.signature}`;
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
seedInput.addEventListener("keydown", (event) => { if (event.key === "Enter") applySeed(); });

randomButton.addEventListener("click", () => {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  seedInput.value = bytes[0].toString(36) + "-" + bytes[1].toString(36);
  applySeed();
});

homeButton.addEventListener("click", () => {
  camera.x = 520;
  camera.y = 520;
  camera.scale = 0.30;
  scheduleRender();
});

exportButton.addEventListener("click", () => {
  if (!lastData) scheduleRender();
  renderer.exportPng(`map-${generator.seedText.replace(/[^a-z0-9_-]+/gi, "-")}.png`);
});

debugPortals.addEventListener("change", () => { renderer.debug.portals = debugPortals.checked; scheduleRender(); });
debugDistricts.addEventListener("change", () => { renderer.debug.districts = debugDistricts.checked; scheduleRender(); });
debugIds.addEventListener("change", () => { renderer.debug.ids = debugIds.checked; scheduleRender(); });

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
  if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
  camera.scale = Math.max(0.13, Math.min(2.5, camera.scale * Math.exp(-event.deltaY * 0.0012)));
  const afterX = camera.x + (px - rect.width / 2) / camera.scale;
  const afterY = camera.y + (py - rect.height / 2) / camera.scale;
  camera.x += beforeX - afterX;
  camera.y += beforeY - afterY;
  scheduleRender();
}, { passive: false });

window.addEventListener("resize", scheduleRender);
scheduleRender();
