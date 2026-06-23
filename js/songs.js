// Bundled practice songs for the piano trainer.
// Note format after build: { pitch (MIDI), start (beats), dur (beats) }.
// seq() builds a monophonic melody from [pitch, durationInBeats] pairs.
(function () {
  "use strict";

  function seq(items) {
    var t = 0, notes = [];
    for (var i = 0; i < items.length; i++) {
      notes.push({ pitch: items[i][0], start: t, dur: items[i][1] });
      t += items[i][1];
    }
    return notes;
  }

  // MIDI: C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71 C5=72
  // Right hand: the melody (all >= C4)
  var TWINKLE_RH = seq([
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2]
  ]);
  // Left hand: simple I-IV-V bass, half notes (all below C4). C3=48 G2=43 F3=53
  var TWINKLE_LH = seq([
    [48,2],[48,2],[53,2],[48,2],
    [53,2],[48,2],[43,2],[48,2],
    [48,2],[53,2],[48,2],[43,2],
    [48,2],[53,2],[48,2],[43,2],
    [48,2],[48,2],[53,2],[48,2],
    [53,2],[48,2],[43,2],[48,2]
  ]);

  var ODE = seq([
    [64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],
    [60,1],[60,1],[62,1],[64,1],[64,1.5],[62,0.5],[62,2],
    [64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],
    [60,1],[60,1],[62,1],[64,1],[62,1.5],[60,0.5],[60,2]
  ]);

  window.SONGS = {
    twinkle: { name: "Twinkle Twinkle", bpm: 100, beatsPerMeasure: 4,
               tracks: [{ name: "Right hand", notes: TWINKLE_RH }, { name: "Left hand", notes: TWINKLE_LH }] },
    ode:     { name: "Ode to Joy",      bpm: 112, beatsPerMeasure: 4, notes: ODE }
  };
})();
