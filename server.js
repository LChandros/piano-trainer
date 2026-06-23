// Piano Trainer server — serves the app, stores/serves uploaded MIDI files.
// Pure Node core modules, no dependencies — runs on a Raspberry Pi with `node server.js`.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SONGS_DIR = path.join(ROOT, "songs");
const DATA_DIR = path.join(ROOT, "data");
const HANDS_FILE = path.join(DATA_DIR, "hand-configs.json");
const META_FILE = path.join(DATA_DIR, "song-meta.json");
const PORT = process.env.PORT || 3022;
const MAX_UPLOAD = 8 * 1024 * 1024; // 8 MB
fs.mkdirSync(SONGS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function readHands() { try { return JSON.parse(fs.readFileSync(HANDS_FILE, "utf8")); } catch (e) { return {}; } }
function writeHands(m) { try { fs.writeFileSync(HANDS_FILE, JSON.stringify(m, null, 2)); return true; } catch (e) { return false; } }
function readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")); } catch (e) { return {}; } }
function writeMeta(m) { try { fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2)); return true; } catch (e) { return false; } }

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".mid": "audio/midi", ".midi": "audio/midi", ".ico": "image/x-icon"
};

function sanitize(name) { return path.basename(name || "").replace(/[^\w.\- ]+/g, "_"); }
function isMidi(name) { return /\.midi?$/i.test(name); }
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }

const server = http.createServer(function (req, res) {
  let url;
  try { url = new URL(req.url, "http://local"); } catch (e) { res.writeHead(400); return res.end("bad url"); }
  const p = url.pathname;

  // --- list uploaded songs ---
  if (p === "/api/songs" && req.method === "GET") {
    let files = [];
    try { files = fs.readdirSync(SONGS_DIR).filter(isMidi); } catch (e) {}
    return json(res, 200, { songs: files });
  }

  // --- upload a MIDI file (raw body, filename in ?name=) ---
  if (p === "/api/upload" && req.method === "POST") {
    const name = sanitize(url.searchParams.get("name") || "upload.mid");
    if (!isMidi(name)) return json(res, 400, { error: "not a .mid/.midi file" });
    const chunks = []; let size = 0, aborted = false;
    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_UPLOAD) { aborted = true; json(res, 413, { error: "file too large" }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (aborted) return;
      try { fs.writeFileSync(path.join(SONGS_DIR, name), Buffer.concat(chunks)); json(res, 200, { ok: true, name: name }); }
      catch (e) { json(res, 500, { error: "write failed" }); }
    });
    return;
  }

  // --- get a song's saved hand config ---
  if (p === "/api/hands" && req.method === "GET") {
    const all = readHands();
    return json(res, 200, { config: all[url.searchParams.get("name") || ""] || null });
  }

  // --- save a song's hand config ---
  if (p === "/api/hands" && req.method === "POST") {
    const name = url.searchParams.get("name") || "";
    if (!name) return json(res, 400, { error: "missing name" });
    const chunks = []; let size = 0, aborted = false;
    req.on("data", function (c) {
      size += c.length;
      if (size > 1024 * 1024) { aborted = true; json(res, 413, { error: "config too large" }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (aborted) return;
      let cfg;
      try { cfg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return json(res, 400, { error: "bad json" }); }
      const all = readHands(); all[name] = cfg;
      if (writeHands(all)) json(res, 200, { ok: true }); else json(res, 500, { error: "write failed" });
    });
    return;
  }

  // --- get all song metadata (favorites, last-played, best score, title) ---
  if (p === "/api/meta" && req.method === "GET") {
    return json(res, 200, { meta: readMeta() });
  }

  // --- merge partial metadata for one song ---
  if (p === "/api/meta" && req.method === "POST") {
    const name = url.searchParams.get("name") || "";
    if (!name) return json(res, 400, { error: "missing name" });
    const chunks = []; let size = 0, aborted = false;
    req.on("data", function (c) {
      size += c.length;
      if (size > 256 * 1024) { aborted = true; json(res, 413, { error: "too large" }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (aborted) return;
      let patch;
      try { patch = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return json(res, 400, { error: "bad json" }); }
      const all = readMeta(); const cur = all[name] || {};
      for (const k in patch) cur[k] = patch[k];
      all[name] = cur;
      if (writeMeta(all)) json(res, 200, { ok: true, meta: cur }); else json(res, 500, { error: "write failed" });
    });
    return;
  }

  // --- delete an uploaded song (also purge its hand config + metadata) ---
  if (p.indexOf("/api/songs/") === 0 && req.method === "DELETE") {
    const name = sanitize(decodeURIComponent(p.slice("/api/songs/".length)));
    try {
      fs.unlinkSync(path.join(SONGS_DIR, name));
      const key = "file:" + name;
      const h = readHands(); if (h[key]) { delete h[key]; writeHands(h); }
      const m = readMeta(); if (m[key]) { delete m[key]; writeMeta(m); }
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 404, { error: "not found" }); }
  }

  // --- serve a stored MIDI file ---
  if (p.indexOf("/songs/") === 0 && req.method === "GET") {
    const name = sanitize(decodeURIComponent(p.slice("/songs/".length)));
    return fs.readFile(path.join(SONGS_DIR, name), function (e, data) {
      if (e) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": "audio/midi" }); res.end(data);
    });
  }

  // --- static files ---
  if (req.method !== "GET") { res.writeHead(405); return res.end("method not allowed"); }
  let rel = decodeURIComponent(p === "/" ? "/index.html" : p);
  const fp = path.normalize(path.join(ROOT, rel));
  if (fp.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, function (e, data) {
    if (e) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", function () { console.log("piano-trainer listening on :" + PORT); });
