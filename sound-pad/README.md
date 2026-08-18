# John & Joy – Sound Pad (Mobile App)

DJ-style sound pad app para sa **Sand & Gravel Remix** — pwede sa phone, tablet, at Android APK.

## Features

- 10 **Ambient** pads (loop ∞)
- 40 **Effect** pads (one-shot DJ drops)
- Pitch & Gain sliders
- Long-press to upload MP3/WAV
- **Installable sa phone** (PWA)
- **Android APK** via Capacitor

---

## Option 1: I-install sa Phone (Pinakamadali)

### Android (Chrome)

1. I-host ang app o buksan sa browser
2. Tap **Install** sa banner, o Menu → **Add to Home screen**
3. May icon na sa home screen — parang tunay na app

### iPhone (Safari)

1. Buksan sa Safari
2. Tap **Share** (box with arrow)
3. **Add to Home Screen**
4. Tap **Add**

---

## Option 2: Android APK (Play Store ready)

### Requirements

- Node.js 18+
- Android Studio (para mag-build ng APK)

### Steps

```bash
cd sound-pad
npm install
npm run build:web
npx cap add android
npx cap sync android
npx cap open android
```

Sa Android Studio:
1. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. APK nasa: `android/app/build/outputs/apk/debug/`

### Install APK sa phone

1. Copy ang APK sa phone
2. Enable **Install from unknown sources**
3. Tap ang APK file → Install

---

## Local testing

```bash
cd sound-pad
npm install
npm run build:web
python3 -m http.server 8080 --directory www
```

Buksan: http://localhost:8080

---

## Phone tips

| Action | Result |
|--------|--------|
| **Tap** pad | Play sound |
| **Long-press** (0.6s) | Upload MP3/WAV |
| **Tap** ambient | Start/stop loop |
| **Stop All** | Stop all loops |

Custom sounds are saved sa phone browser storage.

---

## Suggested custom uploads

| Pad | Upload |
|-----|--------|
| John & Joy! | Suno vocal drop |
| Gravel Hook | "Gravel gravel hey!" |
| Digidi Hey | DIGIDI-style chant |
| Load Dump | Truck SFX |
