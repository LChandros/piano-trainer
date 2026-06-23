// DIY Piano Trainer — Phase 1: engine + Mode 1 (wait mode).
// Inputs: on-screen piano, computer keyboard (QWERTY), and live Web MIDI.
// Built-in oscillator synth so played notes make sound on a plain desktop.
(function () {
  "use strict";

  // ---------- constants ----------
  var LOW = 60, HIGH = 83;               // C4 .. B5 (two octaves)
  var WHITE_SET = { 0:1, 2:1, 4:1, 5:1, 7:1, 9:1, 11:1 }; // semitone classes that are white keys
  var KEYBOARD_H = 150;                  // px reserved at bottom for the drawn keyboard
  var LEAD_SEC = 3.0;                    // how many seconds of song are visible above the hit line
  var NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  // QWERTY -> MIDI, home row = white keys from C4
  var QWERTY = {
    a:60, w:61, s:62, e:63, d:64, f:65, t:66, g:67, y:68, h:69, u:70, j:71,
    k:72, o:73, l:74, p:75, ";":76
  };

  function midiToFreq(p) { return 440 * Math.pow(2, (p - 69) / 12); }
  function noteLabel(p) { return NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1); }
  function isWhite(p) { return !!WHITE_SET[p % 12]; }

  // ---------- theme (user-customizable, persisted to localStorage) ----------
  var THEME_DEFAULTS = {
    whiteNote: "#3aa0ff", blackNote: "#9b6bff", hitNote: "#ffd54a",
    labelBg: "#ffe14a", labelText: "#10131a"
  };
  var theme = (function () {
    var t = {};
    for (var k in THEME_DEFAULTS) t[k] = THEME_DEFAULTS[k];
    try { var s = JSON.parse(localStorage.getItem("pt-theme")); if (s) for (var j in s) if (t.hasOwnProperty(j)) t[j] = s[j]; } catch (e) {}
    return t;
  })();
  function saveTheme() { try { localStorage.setItem("pt-theme", JSON.stringify(theme)); } catch (e) {} }

  // ---------- tiny synth ----------
  var Synth = {
    ctx: null, voices: {},
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },
    on: function (pitch) {
      var ctx = this.ensure(); if (!ctx) return;
      this.off(pitch, true);
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(pitch);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
      osc.connect(g); g.connect(ctx.destination);
      osc.start();
      this.voices[pitch] = { osc: osc, g: g };
    },
    off: function (pitch, immediate) {
      var v = this.voices[pitch]; if (!v) return;
      var ctx = this.ctx, t = ctx.currentTime;
      try {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(v.g.gain.value, t);
        v.g.gain.exponentialRampToValueAtTime(0.0001, t + (immediate ? 0.02 : 0.18));
        v.osc.stop(t + (immediate ? 0.03 : 0.2));
      } catch (e) {}
      delete this.voices[pitch];
    }
  };

  // ---------- input hub (unifies the three sources) ----------
  var Input = {
    down: {},                   // currently held pitches
    onNoteOn: function () {}, onNoteOff: function () {},
    press: function (pitch, vel) {
      if (this.down[pitch]) return;
      this.down[pitch] = true;
      Synth.on(pitch);
      this.onNoteOn(pitch, vel || 100);
    },
    release: function (pitch) {
      if (!this.down[pitch]) return;
      delete this.down[pitch];
      Synth.off(pitch);
      this.onNoteOff(pitch);
    },
    initQwerty: function () {
      var self = this;
      window.addEventListener("keydown", function (e) {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        var p = QWERTY[e.key.toLowerCase()];
        if (p != null) { e.preventDefault(); self.press(p, 100); }
      });
      window.addEventListener("keyup", function (e) {
        var p = QWERTY[e.key.toLowerCase()];
        if (p != null) self.release(p);
      });
    },
    initMIDI: function (statusEl) {
      var self = this;
      if (!navigator.requestMIDIAccess) {
        statusEl.textContent = "Live MIDI: unavailable here (needs https/localhost) — use the on-screen or computer keyboard";
        statusEl.className = "midi-status off";
        return;
      }
      navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
        function bind() {
          access.inputs.forEach(function (inp) { inp.onmidimessage = onMsg; });
          var names = [];
          access.inputs.forEach(function (inp) { names.push(inp.name); });
          if (names.length) {
            statusEl.textContent = "Live MIDI: " + names.join(", ");
            statusEl.className = "midi-status on";
          } else {
            statusEl.textContent = "Live MIDI: ready — no keyboard connected yet";
            statusEl.className = "midi-status";
          }
        }
        function onMsg(e) {
          var s = e.data[0] & 0xf0;
          if (s === 0x90 && e.data[2] > 0) self.press(e.data[1], e.data[2]);
          else if (s === 0x80 || (s === 0x90 && e.data[2] === 0)) self.release(e.data[1]);
        }
        bind();
        access.onstatechange = bind;
      }, function () {
        statusEl.textContent = "Live MIDI: access denied";
        statusEl.className = "midi-status off";
      });
    }
  };

  // ---------- engine ----------
  var Engine = {
    canvas: null, ctx: null, dpr: 1,
    song: null, secPerBeat: 0.6,
    notes: [], groups: [], gi: 0,
    now: 0, lastTs: 0, wallNow: 0, running: false, mode: "wait", finished: false,
    whiteRects: [], blackRects: [],
    flash: {},                  // pitch -> {until, ok}

    load: function (song, tempoScale) {
      this.song = song;
      this.secPerBeat = (60 / song.bpm) / (tempoScale || 1);
      var self = this;
      this.notes = song.notes.map(function (n) {
        return { pitch: n.pitch, start: n.start * self.secPerBeat, dur: n.dur * self.secPerBeat };
      });
      // group simultaneous notes (chords) by start time
      var byStart = {};
      this.notes.forEach(function (n) {
        var k = n.start.toFixed(3);
        (byStart[k] = byStart[k] || { start: n.start, required: {}, hit: {}, count: 0 });
        if (!byStart[k].required[n.pitch]) { byStart[k].required[n.pitch] = 1; byStart[k].count++; }
      });
      this.groups = Object.keys(byStart).map(function (k) { return byStart[k]; })
        .sort(function (a, b) { return a.start - b.start; });
      var last = this.notes[this.notes.length - 1];
      this.songEnd = last ? last.start + last.dur : 0;
      this.beatsPerMeasure = song.beatsPerMeasure || 4;
      this.totalBeats = this.secPerBeat ? this.songEnd / this.secPerBeat : 0;
      this.totalMeasures = Math.max(1, Math.ceil(this.totalBeats / this.beatsPerMeasure));
      this.reset();
    },

    measureInfo: function () {
      if (this.now < 0) return { current: 0, total: this.totalMeasures || 0 };
      var beat = this.now / this.secPerBeat;
      var cur = Math.min(this.totalMeasures, Math.floor(beat / this.beatsPerMeasure) + 1);
      return { current: cur, total: this.totalMeasures };
    },

    // Change tempo without resetting position: rescale times in place so the
    // current playhead, group index, and hit state are all preserved.
    setTempo: function (scale) {
      if (!this.song) return;
      var oldSPB = this.secPerBeat;
      this.secPerBeat = (60 / this.song.bpm) / (scale || 1);
      var ratio = this.secPerBeat / oldSPB;
      if (!isFinite(ratio) || ratio <= 0) return;
      this.notes.forEach(function (n) { n.start *= ratio; n.dur *= ratio; });
      this.groups.forEach(function (g) { g.start *= ratio; });
      this.now *= ratio;
      this.songEnd *= ratio;
    },

    progress: function () {
      if (!this.songEnd) return 0;
      return Math.max(0, Math.min(1, this.now / this.songEnd));
    },

    // Jump to the measure nearest a 0..1 fraction of the song (click-to-seek).
    seekToFraction: function (frac) {
      if (!this.song || !this.totalMeasures) return;
      frac = Math.max(0, Math.min(1, frac));
      var measure = Math.min(this.totalMeasures - 1, Math.floor(frac * this.totalMeasures));
      this.now = measure * this.beatsPerMeasure * this.secPerBeat;
      this.finished = false;
      // mark groups before the playhead as already done, clear the rest
      for (var i = 0; i < this.groups.length; i++) {
        var g = this.groups[i];
        g.hit = {};
        if (g.start < this.now - 1e-6) { for (var k in g.required) g.hit[k] = 1; g.satisfied = true; }
        else g.satisfied = false;
      }
      this.gi = this.groups.length;
      for (var j = 0; j < this.groups.length; j++) {
        if (this.groups[j].start >= this.now - 1e-6) { this.gi = j; break; }
      }
    },

    reset: function () {
      this.gi = 0; this.now = -LEAD_SEC; this.finished = false; this.flash = {};
      this.groups.forEach(function (g) { g.hit = {}; g.satisfied = false; });
    },

    start: function () { this.running = true; this.lastTs = 0; },
    pause: function () { this.running = false; },

    setMode: function (m) { this.mode = m; },

    // called by Input hub
    onPress: function (pitch) {
      // flashes expire on the WALL clock (not the song clock, which freezes when paused)
      this.flash[pitch] = { until: this.wallNow + 250, ok: false };
      if (this.finished) return;
      if (this.mode === "wait" && this.gi < this.groups.length) {
        var g = this.groups[this.gi];
        if (g.required[pitch] && !g.hit[pitch]) {
          g.hit[pitch] = 1;
          this.flash[pitch] = { until: this.wallNow + 250, ok: true };
          var hitCount = 0;
          for (var k in g.hit) if (g.hit[k]) hitCount++;
          if (hitCount >= g.count) g.satisfied = true;
        }
      }
    },

    update: function (dt) {
      if (!this.running || this.finished) return;
      if (this.gi >= this.groups.length) {
        // let the tail scroll past, then finish
        this.now += dt;
        if (this.now > this.notes[this.notes.length - 1].start + 1.5) this.finished = true;
        return;
      }
      if (this.mode === "wait") {
        var gate = this.groups[this.gi].start;
        if (this.now < gate) {
          this.now = Math.min(this.now + dt, gate);
        } else if (this.groups[this.gi].satisfied) {
          this.gi++;
        } // else: frozen at the gate, waiting for the player
      } else {
        // rhythm / free preview: clock never stops
        this.now += dt;
        while (this.gi < this.groups.length && this.groups[this.gi].start < this.now - 0.05) this.gi++;
      }
    },

    layout: function () {
      var c = this.canvas, parent = c.parentElement;
      this.dpr = window.devicePixelRatio || 1;
      var w = parent.clientWidth, h = parent.clientHeight;
      c.width = w * this.dpr; c.height = h * this.dpr;
      c.style.width = w + "px"; c.style.height = h + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.W = w; this.H = h;
      this.hitY = h - KEYBOARD_H;
      this.pps = this.hitY / LEAD_SEC;
      // build white-key x map
      var whites = [];
      for (var p = LOW; p <= HIGH; p++) if (isWhite(p)) whites.push(p);
      var ww = w / whites.length;
      this.whiteRects = []; this.blackRects = []; this.xByPitch = {};
      for (var i = 0; i < whites.length; i++) {
        var x = i * ww;
        this.whiteRects.push({ pitch: whites[i], x: x, w: ww });
        this.xByPitch[whites[i]] = { cx: x + ww / 2, w: ww * 0.82, white: true };
      }
      // black keys sit between certain whites
      for (var j = 0; j < whites.length; j++) {
        var wp = whites[j], bp = wp + 1;
        if (bp <= HIGH && !isWhite(bp)) {
          var bx = (j + 1) * ww - ww * 0.3;
          this.blackRects.push({ pitch: bp, x: bx, w: ww * 0.6 });
          this.xByPitch[bp] = { cx: bx + ww * 0.3, w: ww * 0.5, white: false };
        }
      }
    },

    draw: function () {
      var ctx = this.ctx, W = this.W, H = this.H, hitY = this.hitY;
      ctx.clearRect(0, 0, W, H);
      // background
      ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H);
      // lane separators (subtle)
      ctx.strokeStyle = "#141925"; ctx.lineWidth = 1;
      for (var i = 0; i < this.whiteRects.length; i++) {
        var r = this.whiteRects[i];
        ctx.beginPath(); ctx.moveTo(r.x, 0); ctx.lineTo(r.x, hitY); ctx.stroke();
      }
      // falling notes
      for (var n = 0; n < this.notes.length; n++) {
        var note = this.notes[n], pos = this.xByPitch[note.pitch];
        if (!pos) continue;
        var bottomY = hitY - (note.start - this.now) * this.pps;
        var topY = bottomY - note.dur * this.pps;
        if (bottomY < -10 || topY > hitY) continue;
        var clampedBottom = Math.min(bottomY, hitY);
        var w = pos.w, x = pos.cx - w / 2;
        var atLine = bottomY >= hitY - 4 && topY <= hitY + 4;
        if (clampedBottom <= topY) continue;
        ctx.fillStyle = atLine ? theme.hitNote : (pos.white ? theme.whiteNote : theme.blackNote);
        roundRect(ctx, x, topY, w, clampedBottom - topY, 5);
        ctx.fill();
        if (this.showLabels && (clampedBottom - topY) > 20) {
          var lbl = noteLabel(note.pitch);
          var midY = (topY + clampedBottom) / 2;
          ctx.font = "800 15px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          var tw = ctx.measureText(lbl).width, chipW = tw + 12, chipH = 20;
          ctx.fillStyle = theme.labelBg;
          roundRect(ctx, pos.cx - chipW / 2, midY - chipH / 2, chipW, chipH, 6); ctx.fill();
          ctx.fillStyle = theme.labelText;
          ctx.fillText(lbl, pos.cx, midY + 1);
          ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        }
      }
      // hit line
      ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(W, hitY); ctx.stroke();
      // keyboard
      this.drawKeyboard();
      // "next note" hint label
      if (this.mode === "wait" && this.gi < this.groups.length && !this.finished) {
        var g = this.groups[this.gi];
        var pitches = Object.keys(g.required).map(Number).map(noteLabel).join(" + ");
        var waiting = this.now >= g.start - 0.001 && !g.satisfied;
        ctx.fillStyle = waiting ? "#ffd54a" : "#6f7a8c";
        ctx.font = "600 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(waiting ? "Play: " + pitches : "Next: " + pitches, W / 2, 26);
        ctx.textAlign = "left";
      }
      if (this.finished) {
        ctx.fillStyle = "#56e08a"; ctx.font = "800 30px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("Song complete! 🎵", W / 2, hitY / 2);
        ctx.textAlign = "left";
      }
    },

    drawKeyboard: function () {
      var ctx = this.ctx, hitY = this.hitY, kbTop = hitY, kbH = KEYBOARD_H;
      // white keys
      for (var i = 0; i < this.whiteRects.length; i++) {
        var r = this.whiteRects[i], held = Input.down[r.pitch];
        var fl = this.flash[r.pitch];
        var active = fl && fl.until > this.wallNow;
        // held keys stay strongly lit for the whole press; flash is momentary feedback on top
        ctx.fillStyle = held ? (active && !fl.ok ? "#ff7a7a" : "#5aa9f0")
                             : (active ? (fl.ok ? "#56e08a" : "#ff7a7a") : "#f2f5f9");
        ctx.fillRect(r.x + 1, kbTop, r.w - 2, kbH);
        ctx.strokeStyle = "#0b0d12"; ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 1, kbTop, r.w - 2, kbH);
        if (r.pitch % 12 === 0) { // label C's
          ctx.fillStyle = "#8a93a3"; ctx.font = "11px system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.fillText(noteLabel(r.pitch), r.x + r.w / 2, kbTop + kbH - 8);
          ctx.textAlign = "left";
        }
      }
      // black keys on top
      for (var j = 0; j < this.blackRects.length; j++) {
        var b = this.blackRects[j], bheld = Input.down[b.pitch];
        var bfl = this.flash[b.pitch];
        var bactive = bfl && bfl.until > this.wallNow;
        ctx.fillStyle = bheld ? (bactive && !bfl.ok ? "#c14a4a" : "#3f86d6")
                              : (bactive ? (bfl.ok ? "#2e9e5b" : "#c14a4a") : "#1a1f2b");
        ctx.fillRect(b.x, kbTop, b.w, kbH * 0.62);
        ctx.strokeStyle = "#000"; ctx.strokeRect(b.x, kbTop, b.w, kbH * 0.62);
      }
    },

    keyAt: function (px, py) {
      if (py < this.hitY) return null;
      // black keys first (they're on top)
      for (var j = 0; j < this.blackRects.length; j++) {
        var b = this.blackRects[j];
        if (px >= b.x && px <= b.x + b.w && py <= this.hitY + KEYBOARD_H * 0.62) return b.pitch;
      }
      for (var i = 0; i < this.whiteRects.length; i++) {
        var r = this.whiteRects[i];
        if (px >= r.x && px <= r.x + r.w) return r.pitch;
      }
      return null;
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- wiring ----------
  function boot() {
    var canvas = document.getElementById("stage");
    Engine.canvas = canvas;
    Engine.ctx = canvas.getContext("2d");
    Engine.layout();
    window.addEventListener("resize", function () { Engine.layout(); });

    Input.onNoteOn = function (p) { Engine.onPress(p); };
    Input.onNoteOff = function () {};
    Input.initQwerty();
    Input.initMIDI(document.getElementById("midiStatus"));

    // on-screen piano via pointer
    var activePointer = {};
    canvas.addEventListener("pointerdown", function (e) {
      Synth.ensure();
      var rect = canvas.getBoundingClientRect();
      var p = Engine.keyAt(e.clientX - rect.left, e.clientY - rect.top);
      if (p != null) { activePointer[e.pointerId] = p; Input.press(p, 100); canvas.setPointerCapture(e.pointerId); }
    });
    function lift(e) {
      var p = activePointer[e.pointerId];
      if (p != null) { Input.release(p); delete activePointer[e.pointerId]; }
    }
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);

    // controls
    var songSel = document.getElementById("song");
    var trackSel = document.getElementById("track");
    var trackWrap = document.getElementById("trackWrap");
    var uploadBtn = document.getElementById("upload");
    var fileInput = document.getElementById("file");
    var modeSel = document.getElementById("mode");
    var tempo = document.getElementById("tempo");
    var tempoVal = document.getElementById("tempoVal");
    var startBtn = document.getElementById("start");
    var labelsChk = document.getElementById("labels");
    var ticksEl = document.getElementById("ticks");
    var measureEl = document.getElementById("measure");

    var currentSong = null;     // resolved {name, bpm, beatsPerMeasure, notes}
    var parsedMIDI = null;      // last parsed uploaded file (for track switching)

    function buildTicks() {
      ticksEl.innerHTML = "";
      for (var m = 1; m < Engine.totalMeasures; m++) {
        var t = document.createElement("div");
        t.className = "tick";
        t.style.left = (m / Engine.totalMeasures * 100) + "%";
        ticksEl.appendChild(t);
      }
    }

    function loadCurrent() {
      if (!currentSong) return;
      Engine.load(currentSong, parseFloat(tempo.value));
      Engine.setMode(modeSel.value);
      Engine.showLabels = labelsChk.checked;
      Engine.pause();
      startBtn.textContent = "Start";
      buildTicks();
    }

    function populateSongs(files, selectValue) {
      songSel.innerHTML = "";
      Object.keys(window.SONGS).forEach(function (k) {
        var o = document.createElement("option");
        o.value = "builtin:" + k; o.textContent = window.SONGS[k].name; songSel.appendChild(o);
      });
      (files || []).forEach(function (f) {
        var o = document.createElement("option");
        o.value = "file:" + f; o.textContent = "📄 " + f.replace(/\.midi?$/i, ""); songSel.appendChild(o);
      });
      if (selectValue) songSel.value = selectValue;
    }

    function refreshSongs(selectValue) {
      populateSongs([], selectValue);   // builtins immediately (also the offline fallback)
      fetch("/api/songs").then(function (r) { return r.json(); }).then(function (d) {
        populateSongs(d.songs || [], selectValue);
        selectSong();
      }).catch(function () { selectSong(); });
    }

    function buildSongFromTrack(fname) {
      var i = parseInt(trackSel.value, 10) || 0;
      var tr = parsedMIDI.tracks[i] || parsedMIDI.tracks[0];
      currentSong = { name: fname, bpm: parsedMIDI.bpm, beatsPerMeasure: parsedMIDI.beatsPerMeasure, notes: tr.notes };
    }

    function selectSong() {
      var v = songSel.value || "";
      if (v.indexOf("builtin:") === 0) {
        parsedMIDI = null; trackWrap.style.display = "none";
        currentSong = window.SONGS[v.slice(8)];
        loadCurrent();
      } else if (v.indexOf("file:") === 0) {
        var fname = v.slice(5);
        fetch("/songs/" + encodeURIComponent(fname)).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          parsedMIDI = window.parseMIDI(new Uint8Array(buf));
          trackSel.innerHTML = "";
          parsedMIDI.tracks.forEach(function (tr, i) {
            var o = document.createElement("option");
            o.value = i; o.textContent = (tr.name || ("Track " + (i + 1))) + " · " + tr.notes.length + " notes";
            trackSel.appendChild(o);
          });
          trackSel.value = parsedMIDI.defaultTrack;
          trackWrap.style.display = parsedMIDI.tracks.length > 1 ? "" : "none";
          buildSongFromTrack(fname);
          loadCurrent();
        }).catch(function (e) { alert("Could not read that MIDI file: " + (e && e.message || e)); });
      }
    }

    songSel.addEventListener("change", selectSong);
    trackSel.addEventListener("change", function () {
      if (parsedMIDI) { buildSongFromTrack(songSel.value.slice(5)); loadCurrent(); }
    });
    uploadBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files[0]; if (!f) return;
      f.arrayBuffer().then(function (buf) {
        return fetch("/api/upload?name=" + encodeURIComponent(f.name),
          { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) refreshSongs("file:" + d.name); else alert("Upload failed: " + (d.error || "unknown"));
      }).catch(function (e) { alert("Upload failed: " + (e && e.message || e)); });
      fileInput.value = "";
    });
    modeSel.addEventListener("change", function () { Engine.setMode(modeSel.value); });
    labelsChk.addEventListener("change", function () { Engine.showLabels = labelsChk.checked; });

    // click the progress bar to jump to that measure
    var progressBar = document.getElementById("progress");
    progressBar.addEventListener("click", function (e) {
      var rect = progressBar.getBoundingClientRect();
      if (rect.width > 0) Engine.seekToFraction((e.clientX - rect.left) / rect.width);
    });

    // settings panel (theme colors) — applied live, persisted to localStorage
    var settingsPanel = document.getElementById("settings");
    var colorInputs = settingsPanel.querySelectorAll("input[data-theme]");
    function syncColorInputs() {
      colorInputs.forEach(function (inp) { inp.value = theme[inp.getAttribute("data-theme")]; });
    }
    syncColorInputs();
    colorInputs.forEach(function (inp) {
      inp.addEventListener("input", function () {
        theme[inp.getAttribute("data-theme")] = inp.value; saveTheme();
      });
    });
    document.getElementById("settingsBtn").addEventListener("click", function () {
      settingsPanel.hidden = !settingsPanel.hidden;
    });
    document.getElementById("resetTheme").addEventListener("click", function () {
      for (var k in THEME_DEFAULTS) theme[k] = THEME_DEFAULTS[k];
      saveTheme(); syncColorInputs();
    });
    tempo.addEventListener("input", function () {
      tempoVal.textContent = Math.round(parseFloat(tempo.value) * 100) + "%";
      Engine.setTempo(parseFloat(tempo.value)); // rescale in place — keeps position, no reset
    });
    startBtn.addEventListener("click", function () {
      Synth.ensure();
      if (Engine.running) { Engine.pause(); startBtn.textContent = "Resume"; }
      else {
        if (Engine.finished || Engine.gi >= Engine.groups.length) Engine.reset();
        Engine.start(); startBtn.textContent = "Pause";
      }
    });
    document.getElementById("restart").addEventListener("click", function () {
      Engine.reset(); Engine.pause(); startBtn.textContent = "Start";
    });

    refreshSongs();

    // main loop — wrapped so a single bad frame can never kill the animation
    var progressFill = document.getElementById("progressFill");
    function frame(ts) {
      try {
        Engine.wallNow = ts;   // always-advancing wall clock for flash expiry
        if (!Engine.lastTs) Engine.lastTs = ts;
        var dt = Math.min((ts - Engine.lastTs) / 1000, 0.05);
        Engine.lastTs = ts;
        Engine.update(dt);
        Engine.draw();
        if (progressFill) progressFill.style.width = (Engine.progress() * 100).toFixed(1) + "%";
        var mi = Engine.measureInfo();
        if (measureEl) measureEl.textContent = "m. " + mi.current + " / " + mi.total;
        if (Engine.finished && Engine.running) { Engine.pause(); startBtn.textContent = "Restart"; }
      } catch (err) {
        if (window.console) console.error("frame error (recovered):", err);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
