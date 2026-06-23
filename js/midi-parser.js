// Self-contained Standard MIDI File (SMF) parser — no dependencies.
// parseMIDI(arrayBuffer) -> { bpm, beatsPerMeasure, ppq, tracks:[{name, notes:[{pitch,start,dur}]}], defaultTrack }
// start/dur are in BEATS (quarter notes), matching the engine's song format.
(function (root) {
  "use strict";

  function parseMIDI(buffer) {
    var dv = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength);
    var pos = 0;

    function u8()  { return dv.getUint8(pos++); }
    function u16() { var v = dv.getUint16(pos); pos += 2; return v; }
    function u32() { var v = dv.getUint32(pos); pos += 4; return v; }
    function str(n) { var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(pos++)); return s; }
    function vlq() { var v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }

    if (str(4) !== "MThd") throw new Error("not a MIDI file");
    var headLen = u32();
    u16();                       // format (unused)
    var ntracks = u16();
    var division = u16();
    var ppq = (division & 0x8000) ? 480 : division;   // assume ticks-per-quarter; fall back for SMPTE
    if (ppq <= 0) ppq = 480;
    if (headLen > 6) pos += headLen - 6;

    var microsPerQuarter = 500000;   // default 120 BPM
    var timeSigNum = 4;
    var gotTempo = false, gotTS = false;
    var tracks = [];

    function closeNote(active, notes, pitch, tick) {
      var a = active[pitch];
      if (a !== undefined) {
        notes.push({ pitch: pitch, startTick: a, durTick: Math.max(1, tick - a) });
        delete active[pitch];
      }
    }

    for (var t = 0; t < ntracks; t++) {
      var chunk = str(4);
      var len = u32();
      if (chunk !== "MTrk") { pos += len; continue; }   // skip unknown chunks cleanly
      var end = pos + len;
      var tick = 0, running = 0, name = "";
      var active = {}, notes = [];

      while (pos < end) {
        tick += vlq();
        var status = dv.getUint8(pos);
        if (status & 0x80) { pos++; running = status; } else { status = running; }
        var type = status & 0xf0;

        if (status === 0xff) {                 // meta event
          var metaType = u8();
          var l = vlq();
          if (metaType === 0x51 && l === 3) {
            var m = (u8() << 16) | (u8() << 8) | u8();
            if (!gotTempo) { microsPerQuarter = m; gotTempo = true; }
          } else if (metaType === 0x58 && l >= 2) {
            var num = u8(); u8(); u8(); u8();
            if (!gotTS) { timeSigNum = num || 4; gotTS = true; }
          } else if (metaType === 0x03) {
            name = str(l);
          } else {
            pos += l;
          }
        } else if (status === 0xf0 || status === 0xf7) {   // sysex
          pos += vlq();
        } else if (type === 0x90) {            // note on
          var p1 = u8(), v1 = u8();
          if (v1 > 0) active[p1] = tick; else closeNote(active, notes, p1, tick);
        } else if (type === 0x80) {            // note off
          var p2 = u8(); u8(); closeNote(active, notes, p2, tick);
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          pos += 2;                            // 2 data bytes
        } else if (type === 0xc0 || type === 0xd0) {
          pos += 1;                            // 1 data byte
        } else {
          pos++;                               // unknown — skip and hope to resync
        }
      }
      pos = end;                               // resync to track boundary regardless

      // convert ticks -> beats, sort
      var beatNotes = notes.map(function (n) {
        return { pitch: n.pitch, start: n.startTick / ppq, dur: n.durTick / ppq };
      }).sort(function (a, b) { return a.start - b.start; });
      if (beatNotes.length) tracks.push({ name: name, notes: beatNotes });
    }

    if (!tracks.length) throw new Error("no playable notes found");

    // pick a default track: highest average pitch (usually the melody / right hand)
    var di = 0, bestAvg = -1;
    for (var i = 0; i < tracks.length; i++) {
      var sum = 0, ns = tracks[i].notes;
      for (var k = 0; k < ns.length; k++) sum += ns[k].pitch;
      var avg = sum / ns.length;
      if (avg > bestAvg) { bestAvg = avg; di = i; }
    }

    return {
      bpm: Math.round(60000000 / microsPerQuarter),
      beatsPerMeasure: timeSigNum,
      ppq: ppq,
      tracks: tracks,
      defaultTrack: di
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = parseMIDI;
  if (root) root.parseMIDI = parseMIDI;
})(typeof window !== "undefined" ? window : null);
