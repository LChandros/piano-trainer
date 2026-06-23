// Piano Trainer server — serves the app, stores/serves uploaded MIDI files.
// Pure Node core modules, no dependencies — runs on a Raspberry Pi with `node server.js`.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SONGS_DIR = path.join(ROOT, "songs");
const PORT = process.env.PORT || 3022;
const MAX_UPLOAD = 8 * 1024 * 1024; // 8 MB
fs.mkdirSync(SONGS_DIR, { recursive: true });

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

  // --- delete an uploaded song ---
  if (p.indexOf("/api/songs/") === 0 && req.method === "DELETE") {
    const name = sanitize(decodeURIComponent(p.slice("/api/songs/".length)));
    try { fs.unlinkSync(path.join(SONGS_DIR, name)); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 404, { error: "not found" }); }
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
