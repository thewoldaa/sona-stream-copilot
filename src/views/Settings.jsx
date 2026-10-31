import { useEffect, useState } from 'react'

export default function Settings({ sona }) {
  const [local, setLocal] = useState(sona.settings)
  const [models, setModels] = useState(null)
  const [testing, setTesting] = useState(false)
  const [secretsForm, setSecretsForm] = useState({ obsPassword: '', aiKey: '', sttKey: '', twitchToken: '' })

  useEffect(() => {
    if (sona.settings) setLocal(sona.settings)
  }, [sona.settings])

  if (!local) return <p className="muted">Memuat setelan…</p>

  const patch = (section, key, value) => setLocal((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  const patchMod = (key, value) => setLocal((prev) => ({ ...prev, chat: { ...prev.chat, moderation: { ...prev.chat.moderation, [key]: value } } }))

  async function save() {
    await sona.saveSettings(local)
    if (Object.values(secretsForm).some(Boolean)) {
      await sona.saveSecrets(secretsForm)
      setSecretsForm({ obsPassword: '', aiKey: '', sttKey: '', twitchToken: '' })
    }
  }

  async function testModel() {
    setTesting(true)
    const res = await window.sona.ai.test()
    setTesting(false)
    if (!res.ok) return sona.notify(`Model tidak terjangkau: ${res.error}`, 'error')
    setModels(res.models ?? [])
    sona.notify(`Terhubung. ${res.models?.length ?? 0} model terlihat.`)
  }

  const secretsStatus = sona.settings?.secrets ?? {}

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Model AI (OpenAI-compatible)</h2>
          <span className="muted tiny">lokal atau cloud, tanpa perantara</span>
        </div>
        <p className="muted tiny">
          Default ke Ollama lokal (<code>http://127.0.0.1:11434/v1</code>). Bisa juga LM Studio, llama.cpp, OpenRouter,
          Groq, OpenAI, atau endpoint apa pun yang bicara <code>/chat/completions</code> dengan function calling.
        </p>
        <div className="form">
          <label>
            <span>Base URL</span>
            <input value={local.ai.baseUrl} onChange={(e) => patch('ai', 'baseUrl', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              <span>Model</span>
              <input value={local.ai.model} onChange={(e) => patch('ai', 'model', e.target.value)} placeholder="llama3.1" />
            </label>
            <label>
              <span>Suhu</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1.5"
                value={local.ai.temperature ?? 0.4}
                onChange={(e) => patch('ai', 'temperature', Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            <span>System prompt</span>
            <textarea rows="4" value={local.ai.systemPrompt} onChange={(e) => patch('ai', 'systemPrompt', e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="ghost" onClick={testModel} disabled={testing}>
              {testing ? 'menguji…' : 'tes koneksi'}
            </button>
            {models && <span className="muted tiny">{models.slice(0, 6).join(' · ')}</span>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Rahasia (terenkripsi)</h2>
          <span className={`pill ${secretsStatus.available ? 'pill--ok' : 'pill--off'}`}>
            {secretsStatus.available ? 'OS keychain' : 'tidak tersedia'}
          </span>
        </div>
        <p className="muted tiny">
          Password OBS, token Twitch, dan API key disimpan lewat <code>safeStorage</code> (DPAPI di Windows) — bukan di
          <code> settings.json</code>.
        </p>
        <div className="form">
          <label>
            <span>Password OBS {secretsStatus.obsPassword ? '· tersimpan' : ''}</span>
            <input
              type="password"
              value={secretsForm.obsPassword}
              onChange={(e) => setSecretsForm({ ...secretsForm, obsPassword: e.target.value })}
              placeholder={secretsStatus.obsPassword ? '••••••••' : 'kosong bila auth mati'}
            />
          </label>
          <div className="form-row">
            <label>
              <span>API key model {secretsStatus.aiKey ? '· tersimpan' : ''}</span>
              <input
                type="password"
                value={secretsForm.aiKey}
                onChange={(e) => setSecretsForm({ ...secretsForm, aiKey: e.target.value })}
                placeholder="kosong untuk lokal"
              />
            </label>
            <label>
              <span>API key STT {secretsStatus.sttKey ? '· tersimpan' : ''}</span>
              <input
                type="password"
                value={secretsForm.sttKey}
                onChange={(e) => setSecretsForm({ ...secretsForm, sttKey: e.target.value })}
              />
            </label>
          </div>
          <label>
            <span>Token Twitch {secretsStatus.twitchToken ? '· tersimpan' : ''}</span>
            <input
              type="password"
              value={secretsForm.twitchToken}
              onChange={(e) => setSecretsForm({ ...secretsForm, twitchToken: e.target.value })}
              placeholder="oauth:…"
            />
          </label>
          <p className="muted tiny">Rahasia ikut tersimpan saat kamu menekan “simpan setelan”.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Suara & wake word</h2>
          <span className="muted tiny">TTS memakai voice OS — offline, gratis</span>
        </div>
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={Boolean(local.voice.ttsEnabled)} onChange={(e) => patch('voice', 'ttsEnabled', e.target.checked)} />
            <span>Bacakan jawaban Sona</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={Boolean(local.voice.readAloud)} onChange={(e) => patch('voice', 'readAloud', e.target.checked)} />
            <span>Bacakan chat masuk (read-aloud)</span>
          </label>
          <label>
            <span>Hotkey rekam</span>
            <input value={local.voice.hotkey} onChange={(e) => patch('voice', 'hotkey', e.target.value)} placeholder="Control+Alt+Space" />
          </label>
          <div className="form-row">
            <label>
              <span>Rate ({Number(local.voice.rate).toFixed(2)})</span>
              <input type="range" min="0.6" max="1.8" step="0.05" value={local.voice.rate} onChange={(e) => patch('voice', 'rate', Number(e.target.value))} />
            </label>
            <label>
              <span>Pitch ({Number(local.voice.pitch).toFixed(2)})</span>
              <input type="range" min="0.5" max="1.8" step="0.05" value={local.voice.pitch} onChange={(e) => patch('voice', 'pitch', Number(e.target.value))} />
            </label>
          </div>
          <div className="row">
            <button type="button" className="ghost" onClick={sona.speakTest}>
              tes suara
            </button>
          </div>

          <div className="divider" />

          <div className="form-row">
            <label>
              <span>Kata bangun</span>
              <input value={local.wake.phrase} onChange={(e) => patch('wake', 'phrase', e.target.value)} placeholder="sona" />
            </label>
            <label>
              <span>Ambang suara ({Number(local.wake.threshold).toFixed(3)})</span>
              <input
                type="range"
                min="0.01"
                max="0.2"
                step="0.005"
                value={local.wake.threshold}
                onChange={(e) => patch('wake', 'threshold', Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            <span>Diam sebelum kirim ({local.wake.silenceMs} ms)</span>
            <input
              type="range"
              min="300"
              max="2000"
              step="50"
              value={local.wake.silenceMs}
              onChange={(e) => patch('wake', 'silenceMs', Number(e.target.value))}
            />
          </label>
          <p className="muted tiny">
            Wake word memakai gate energi lokal + transkripsi dari server STT kamu. Tidak ada audio yang dikirim ke
            selain endpoint yang kamu isi sendiri.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Speech-to-text</h2>
          <span className="muted tiny">OpenAI-compatible /audio/transcriptions</span>
        </div>
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={Boolean(local.stt.enabled)} onChange={(e) => patch('stt', 'enabled', e.target.checked)} />
            <span>Aktifkan input suara & wake word</span>
          </label>
          <label>
            <span>Base URL</span>
            <input value={local.stt.baseUrl} onChange={(e) => patch('stt', 'baseUrl', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              <span>Model</span>
              <input value={local.stt.model} onChange={(e) => patch('stt', 'model', e.target.value)} />
            </label>
            <label>
              <span>Bahasa</span>
              <input value={local.stt.language} onChange={(e) => patch('stt', 'language', e.target.value)} placeholder="id" />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Moderasi chat</h2>
          <span className="muted tiny">aturan lokal, jalan tanpa server</span>
        </div>
        <div className="form">
          <label>
            <span>Blacklist (satu kata per baris)</span>
            <textarea
              rows="4"
              value={(local.chat.moderation.blacklist ?? []).join('\n')}
              onChange={(e) => patchMod('blacklist', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            />
          </label>
          <div className="form-row">
            <label>
              <span>Maks caps (%)</span>
              <input type="number" value={local.chat.moderation.maxCapsPercent} onChange={(e) => patchMod('maxCapsPercent', Number(e.target.value))} />
            </label>
            <label>
              <span>Maks emote</span>
              <input type="number" value={local.chat.moderation.maxEmotes} onChange={(e) => patchMod('maxEmotes', Number(e.target.value))} />
            </label>
            <label>
              <span>Aksi</span>
              <select value={local.chat.moderation.action} onChange={(e) => patchMod('action', e.target.value)}>
                <option value="none">tandai saja</option>
                <option value="delete">hapus</option>
                <option value="timeout">timeout</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Overlay</h2>
          <span className="muted tiny">server lokal, hanya 127.0.0.1</span>
        </div>
        <div className="form form-grid">
          <label>
            <span>Port</span>
            <input type="number" value={local.overlay.port} onChange={(e) => patch('overlay', 'port', Number(e.target.value))} />
          </label>
          <label>
            <span>Lebar</span>
            <input type="number" value={local.overlay.width} onChange={(e) => patch('overlay', 'width', Number(e.target.value))} />
          </label>
          <label>
            <span>Tinggi</span>
            <input type="number" value={local.overlay.height} onChange={(e) => patch('overlay', 'height', Number(e.target.value))} />
          </label>
        </div>
      </section>

      <div className="row row--end">
        <button type="button" className="primary" onClick={save}>
          simpan setelan
        </button>
      </div>

      {sona.info && (
        <section className="card">
          <div className="card-head">
            <h2>Tentang</h2>
          </div>
          <ul className="steplist">
            <li>
              <span className="muted tiny">versi</span> <code>{sona.info.version}</code>
            </li>
            <li>
              <span className="muted tiny">electron</span> <code>{sona.info.electron}</code> · <code>{sona.info.chrome}</code>
            </li>
            <li>
              <span className="muted tiny">setelan</span> <code>{sona.info.settingsPath}</code>
            </li>
            <li>
              <span className="muted tiny">overlay</span> <code>{sona.info.overlayUrl ?? '—'}</code>
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
