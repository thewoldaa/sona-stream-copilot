# Sona — free, local-first stream copilot

Asisten AI untuk streamer yang mengendalikan **OBS Studio**, **chat Twitch**, **overlay**,
dan **musik** — semuanya dari satu tempat. Gratis, sumber terbuka (MIT), **tanpa backend
vendor**: model, suara, chat, dan data tinggal di mesin kamu.

```
"pindah ke scene Gameplay lalu mute mic"
"volume musik 30 persen"
"mulai poll: map mana yang dimainkan, opsi map 1, map 2, map 3"
"pasang filter noise suppression di mic"
"simpan restore point sebelum aku utak-atik layout"
```

Sona menerjemahkan itu jadi **tool call tervalidasi**, bukan jawaban karangan.

---

## Kenapa ada

Proyek ini lahir dari reverse-engineering aplikasi komersial **Dexter 1.0.12**
(lihat repo `dexter-rea`, file `analysis/FEATURE-MAP.md`). Pelajaran yang diambil:

- otak percakapan tidak boleh bergantung pada server vendor — kalau server mati,
  langganan habis, atau kredit model habis, aplikasi jadi bata;
- kontrol OBS harus **terkunci ketat**: tool tervalidasi, antrean tulis serial,
  undo untuk aksi yang bisa dibalik;
- overlay paling enak dibaca sebagai satu *rundown sheet* — hairline rules, satu warna
  aksen, bukan grid kartu.

Sona adalah implementasi ulang **dari nol**. Tidak ada satu byte pun dari aplikasi aslinya.

## Fitur

| Subsistem | Status |
|---|---|
| Kontrol OBS (68 tool) | ✅ scene/source/transform/filter/audio/output/config + escape hatch `obs_raw_request` |
| Antrean tulis serial + undo | ✅ 30 langkah terakhir, dibalik satu per satu |
| Restore point layout & audio | ✅ simpan/daftar/pulihkan |
| Asisten bahasa alami → tool call | ✅ 68 tool, maks 8 langkah, validasi nama scene/source |
| Model lokal | ✅ Ollama / LM Studio / llama.cpp / vLLM |
| Model cloud | ✅ OpenRouter, Groq, OpenAI, endpoint apa pun yang OpenAI-compatible |
| TTS | ✅ voice OS (`speechSynthesis`), offline |
| Read-aloud chat | ✅ filter link/bot/panjang minimum |
| Wake word | ✅ gate energi lokal + frasa pada transkrip (butuh STT) |
| Push-to-talk | ✅ hotkey global + tombol UI |
| STT | ✅ endpoint `/audio/transcriptions` (whisper.cpp, faster-whisper, OpenAI) |
| Chat Twitch | ✅ IRC-over-WS; baca anonim, kirim/hapus dengan token |
| Moderasi | ✅ blacklist, caps, link, emote spam, simbol + second opinion AI opsional |
| Command & counter | ✅ `!cmd`, `!nama+`, `!uptime`, cooldown per command |
| Poll & giveaway | ✅ vote `!1..!6`, `!join`, auto-pick, auto-close |
| Timer pengumuman | ✅ interval per menit |
| Overlay designer | ✅ server lokal + browser source, 8 tipe elemen, SSE live |
| Orb mengambang | ✅ jendela transparan always-on-top, geser, snap pojok, klik untuk bicara, bubble jawaban |
| Notch | ✅ bar di tepi atas layar yang mengembang jadi panel 9 tile (chat, OBS, overlay, automations, go live, musik, bitrate, penonton, model) |
| Panduan awal | ✅ overlay 5 langkah saat pertama dibuka (deteksi OBS, model, suara, orb) |
| Musik | ✅ antrean file lokal, yt-dlp opsional, output device via `setSinkId` |
| Rahasia terenkripsi | ✅ `safeStorage` (DPAPI) untuk password OBS, token, API key |
| Billing / akun / kredit | ❌ tidak ada — dan itu fiturnya |
| Telemetri / OTA updater | ❌ tidak ada |

## Mulai cepat

```powershell
npm install
npm run build
npm start
```

1. **OBS** → Tools → WebSocket Server Settings → aktifkan (port 4455). Sona bisa
   mendeteksi port/password dari config OBS lewat tombol *deteksi* di tab OBS.
2. Tab **Setelan** → Base URL model:
   - Ollama: `http://127.0.0.1:11434/v1`, model `llama3.1` (atau `qwen2.5`)
   - LM Studio: `http://127.0.0.1:1234/v1`
   - OpenRouter: `https://openrouter.ai/api/v1` + API key
3. Tes koneksi → simpan. Model **wajib** mendukung function calling.
4. Tab **Chat** → isi channel → sambungkan (tempel token OAuth kalau mau kirim/moderasi).
5. Tab **Overlay** → jalankan server → copy URL → tempel di OBS Browser Source 1920×1080.

### STT & wake word

```bash
whisper-server -m ggml-base.bin --host 127.0.0.1 --port 8000 --inference
```

Setelan → STT → Base URL `http://127.0.0.1:8000/v1` → aktifkan. Setelah itu tombol
**wake** di header akan mendengarkan kata bangun (default “sona”) sepenuhnya lokal:
gate energi mendeteksi awal/akhir ucapan, lalu transkrip dicek frasanya.

### Musik ke OBS

Pilih output device di tab Musik (mis. VB-Cable), lalu di OBS tambahkan
**Application Audio Capture → Sona**. Tidak perlu native audio dependency.

## Build installer

```powershell
npm run dist
```

Menghasilkan di `release/`:

- `Sona-<versi>-x64-setup.exe` — installer per-user (NSIS)
- `Sona-<versi>-portable.exe` — satu file, tanpa instalasi

## Arsitektur

```
electron/
  main.js      window induk + orb transparan, IPC, hotkey, protocol sona-media
  preload.js   contextBridge whitelist (tanpa ipcRenderer mentah)
  obs.js       wrapper obs-websocket: antrean serial, snapshot, undo, restore point
  tools.js     68 tool: OBS + chat + overlay + musik + escape hatch v5
  agent.js     loop function calling (maks 8 langkah) + text completion
  chat.js      Twitch IRC, moderasi lokal, command, poll, giveaway, timer
  overlay.js   HTTP + SSE server untuk browser source OBS
  notch.js     jendela bar tepi atas (?win=notch), expand/collapse, snapshot agregat
  music.js     antrean; playback di renderer lewat protocol sona-media
  settings.js  JSON di userData, deep-merge, tulis atomik
  secrets.js   blob terenkripsi safeStorage
src/
  App.jsx      shell, tab, mic, wake, onboarding, toast
  Orb.jsx      widget mengambang (?win=orb): drag, snap, state, popup
  Notch.jsx    bar tepi atas (?win=notch): panel 9 tile, aksi cepat  views/       Dashboard, Assistant, ObsPanel, ChatPanel, Designer, Music, Settings
  lib/         useSona, mic, wake (VAD), musicDeck
```

Batas kepercayaan: renderer tidak dipercaya. `obs:call` punya allowlist request type,
payload agent divalidasi di main process, semua penulisan OBS melewati satu antrean,
dan rahasia tidak pernah kembali ke renderer.

## Lisensi

MIT. Lihat `LICENSE`.
