# Piano Trainer

A DIY falling-notes piano trainer (Synthesia-style) for learning piano. Runs as a
web app: song notes scroll down toward an on-screen keyboard, and you play along on
a real MIDI keyboard, the on-screen piano, or your computer keys.

Built to run on a Raspberry Pi (or any machine with Node) on the home network.

## Modes
- **Notes (wait)** — the song freezes at each note/chord until you play the correct
  key(s), then continues. Play in time and it flows like you're just playing the song.
- **Rhythm (preview)** — the song scrolls continuously. Timing/scoring not implemented
  yet (planned Phase 2).

## Inputs (any of these)
- **Live MIDI keyboard** via the Web MIDI API (requires a secure context — https or
  localhost — and a Chromium-based browser).
- **On-screen piano** — click/tap the drawn keys.
- **Computer keyboard** — `A S D F G H J K` (white keys), `W E T Y U` (black keys).

A small built-in oscillator synth makes sound for played notes, so it works on a plain
desktop with no keyboard attached.

## Features
- Tempo slider (rescales in place — keeps your position).
- Measure markers + `m. X / Y` readout, read from each song's time signature.
- Note-name labels toggle (draws note names on the falling blocks).
- Progress bar — click it to jump to that measure.
- Upload your own `.mid` files; multi-track files get a track picker (defaults to the
  likely melody). Tempo and time signature are read from the file.

## Running

```
node server.js          # serves the app + song storage on :3022 (PORT env to change)
```

Then open `http://<host>:3022/`. No dependencies — Node core modules only.

## Server endpoints
- `GET  /api/songs`           — list uploaded songs
- `POST /api/upload?name=x.mid` — upload (raw body, 8 MB cap, `.mid`/`.midi` only)
- `DELETE /api/songs/<name>`   — delete an uploaded song
- `GET  /songs/<name>`         — fetch a stored MIDI file

## Layout
- `index.html`, `css/`, `js/` — the web app
- `js/midi-parser.js` — self-contained Standard MIDI File parser (no deps)
- `js/songs.js` — bundled built-in songs (Twinkle, Ode to Joy)
- `server.js` — Node static + upload server
- `phase0-midi-test.html` — standalone diagnostic to confirm a host can read USB MIDI
- `songs/` — uploaded MIDI files (git-ignored)

## Known limitations
- The MIDI parser uses the file's first tempo and time signature (constant-tempo
  assumption) — fine for most practice MIDIs.
- Web MIDI requires https/localhost; on a plain-http LAN address the on-screen and
  computer-key inputs still work.
