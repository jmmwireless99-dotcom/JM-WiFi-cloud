# John & Joy – Sound Pad

DJ-style sound pad web app (like iSoundGrid) for the **Sand & Gravel Remix** jingle.

## Features

- **Ambients** (10 pads) — tap to loop background sounds (∞)
- **Effects** (40 pads) — one-shot DJ drops, vocals, and SFX
- **Pitch** slider — speed up or slow down sounds
- **Gain** slider — master volume
- **Stop All** — stops every looping ambient
- **Custom sounds** — long-press any pad to upload your own MP3/WAV

## How to run

Open `index.html` in a browser, or serve the folder locally:

```bash
cd sound-pad
python3 -m http.server 8080
```

Then visit: http://localhost:8080

## Tips

1. Tap once on **Effects** to trigger a sound.
2. Tap **Ambients** to start/stop a loop.
3. **Long-press** (600ms) any pad to replace it with your own audio file.
4. Upload your Suno jingle clips onto pads like "John & Joy!", "Gravel Hook", etc.
5. Works on phone/tablet — add to home screen for a full-screen DJ pad.

## Suggested custom uploads

| Pad | Upload this |
|-----|-------------|
| John & Joy! | Vocal drop from Suno |
| Gravel Hook | "Gravel gravel hey!" hook |
| Digidi Hey | DIGIDI-style chant |
| Load Dump | Truck dumping gravel SFX |
| Best Quality | "Best quality!" vocal |
