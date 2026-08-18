# John & Joy – Sound Pad

DJ-style sound pad app para sa **Sand & Gravel Remix** — pwede sa **phone**, **laptop**, at **desktop**.

## Features

- 10 **Ambient** pads (loop ∞)
- 40 **Effect** pads (one-shot DJ drops)
- Pitch & Gain sliders
- Upload MP3/WAV sa bawat pad
- **Phone app** (PWA + Android APK)
- **Laptop/Desktop app** (Electron — Windows, Mac, Linux)

---

## Laptop / Desktop App (Electron)

### Run sa laptop (development)

```bash
cd sound-pad
npm install
npm run desktop
```

Bubukas ang app na parang tunay na desktop program — may menu bar, fullscreen, at keyboard shortcuts.

### Build installer (.exe / .dmg / .AppImage)

```bash
cd sound-pad
npm install
npm run desktop:build        # Lahat ng platform
npm run desktop:build:win    # Windows .exe installer
npm run desktop:build:mac    # Mac .dmg
npm run desktop:build:linux  # Linux AppImage
```

Output nasa: `dist-desktop/`

### Laptop keyboard shortcuts

| Key | Action |
|-----|--------|
| **Space** | Stop All |
| **Right-click** pad | Upload MP3/WAV |
| **1–0** | Effects 1–10 |
| **Q–P** | Effects 11–20 |
| **A–L** | Effects 21–30 |
| **Z–/** | Effects 31–40 |
| **Ctrl+Shift+S** | Stop All (menu) |

### Browser sa laptop

Buksan lang sa Chrome/Edge — automatic na 10-column grid at keyboard shortcuts kapag malaki ang screen.

---

## Phone App

### I-install sa Phone (PWA)

**Android:** Chrome → Install / Add to Home screen  
**iPhone:** Safari → Share → Add to Home Screen

### Android APK

```bash
cd sound-pad
npm install
npm run build:web
npx cap add android
npx cap open android
```

Build APK sa Android Studio.

---

## Local testing (browser)

```bash
cd sound-pad
npm install
npm run build:web
python3 -m http.server 8080 --directory www
```

Buksan: http://localhost:8080

---

## Controls

| Platform | Play | Upload |
|----------|------|--------|
| **Phone** | Tap | Long-press |
| **Laptop** | Click | Right-click |
| **Desktop app** | Click | Right-click |

Custom sounds saved sa local storage ng device.

---

## Suggested custom uploads

| Pad | Upload |
|-----|--------|
| John & Joy! | Suno vocal drop |
| Gravel Hook | "Gravel gravel hey!" |
| Digidi Hey | DIGIDI-style chant |
| Load Dump | Truck SFX |
