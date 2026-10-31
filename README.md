# Sona — free, local-first stream copilot

Asisten AI untuk streamer yang mengendalikan **OBS Studio** lewat suara atau teks.
Gratis, sumber terbuka (MIT), dan **tanpa backend vendor**: model, suara, dan data
semuanya di mesin kamu.

```
"pindah ke scene Gameplay lalu mute mic"
"volume musik 30 persen"
"mulai rekam, dan kalau ada yang salah bilang"
```

Sona menerjemahkan itu jadi **tool call OBS**, bukan jawaban karangan.

---

## Kenapa ada

Proyek ini lahir dari reverse-engineering terhadap aplikasi komersial **Dexter 1.0.12**
(lihat repo `dexter-rea`). Pelajaran yang diambil:

- otak percakapan sebaiknya tidak bergantung pada server vendor — kalau server mati,
  langganan habis, atau kredit model habis, aplikasi jadi bata;
- kontrol OBS harus **terkunci ketat** (tool call tervalidasi, antrean tulis serial),
  karena model bahasa tidak boleh menebak nama scene;
- UI kontrol stream paling enak dibaca sebagai satu *rundown sheet* — hairline rules,
  satu warna aksen, bukan grid kartu.

Sona adalah implementasi ulang **dari nol** dengan arsitektur yang sama sehatnya,
tetapi 100% bisa dijalankan offline tanpa akun.

> Bukan salinan kode, bukan repack, bukan crack. Tidak ada satu byte pun dari aplikasi
> aslinya. Nama, merek, dan aset milik pemiliknya masing-masing.

## Fitur

| Fitur | Status |
|---|---|
| Kontrol OBS via `obs-websocket` (v5) | ✅ scene, transition, audio, stream/record, virtual cam |
| Asisten bahasa alami → tool call (function calling) | ✅ OpenAI-compatible, maks 6 langkah per perintah |
| Dukungan model lokal | ✅ Ollama / LM Studio / llama.cpp / vLLM |
| Dukungan cloud | ✅ OpenRouter, Groq, OpenAI, endpoint apa pun |
| TTS | ✅ voice OS (`speechSynthesis`), offline & gratis |
| Push-to-talk + STT | ✅ hotkey global + endpoint `/audio/transcriptions` (whisper.cpp, faster-whisper, OpenAI) |
| Mixer & quick scene | ✅ dari UI, tanpa lewat model |
| Sandbox renderer | ✅ `contextIsolation`, `sandbox`, preload whitelist |
| Backend/akun/telemetri | ❌ tidak ada — dan itu fiturnya |

## Mulai cepat

```powershell
npm install
npm run build
npm start          # atau: npm run run
```

Lalu:

1. **OBS** → Tools → WebSocket Server Settings → aktifkan (port 4455).
2. Tab **OBS** → sambungkan.
3. Tab **Setelan** → isi Base URL model:
   - Ollama lokal: `http://127.0.0.1:11434/v1`, model `llama3.1` (atau `qwen2.5`)
   - LM Studio: `http://127.0.0.1:1234/v1`
   - OpenRouter: `https://openrouter.ai/api/v1` + API key
4. Tes koneksi → simpan.

Model **wajib mendukung function calling**. Kalau tidak, Sona akan menjawab teks tapi
tidak menyentuh OBS.

### STT (opsional)

Jalankan server transkripsi apa pun yang kompatibel OpenAI, misalnya whisper.cpp:

```bash
whisper-server -m ggml-base.bin --host 127.0.0.1 --port 8000 --inference
```

lalu Setelan → STT → Base URL `http://127.0.0.1:8000/v1`, aktifkan, simpan.
Tanpa STT, tombol 🎙 otomatis memperingatkan dan kamu tetap bisa mengetik.

## Build installer

```powershell
npm run dist
```

Menghasilkan di `release/`:

- `Sona-1.0.0-x64-nsis.exe` — installer per-user, bisa pilih folder
- `Sona-1.0.0-portable.exe` — satu file, tanpa instalasi

## Arsitektur

```
electron/
  main.js      window, IPC, hotkey, permission handler (media saja)
  preload.js   contextBridge whitelist (tanpa ipcRenderer mentah)
  obs.js       wrapper obs-websocket: antrean serial, snapshot, event→refresh
  agent.js     loop function calling + 11 tool OBS
  settings.js  JSON di userData, deep-merge, tulis atomik
src/
  App.jsx      shell, tab, mic state, toast
  views/       Dashboard, Assistant, ObsPanel, Settings
  lib/         useSona (state pusat), mic (MediaRecorder)
```

Batas kepercayaan: renderer tidak dipercaya. `obs:call` punya allowlist request type,
payload agent divalidasi di main process, dan semua penulisan OBS melewati satu antrean
supaya perintah beruntun dari model tidak saling tabrak.

## Lisensi

MIT. Lihat `LICENSE`.
