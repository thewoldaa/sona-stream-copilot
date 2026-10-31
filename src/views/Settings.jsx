import { useEffect, useState } from 'react'

export default function Settings({ sona }) {
  const [local, setLocal] = useState(sona.settings)
  const [models, setModels] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (sona.settings) setLocal(sona.settings)
  }, [sona.settings])

  if (!local) return <p className="muted">Memuat setelan…</p>

  const patch = (section, key, value) =>
    setLocal((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }))

  async function save() {
    await sona.saveSettings(local)
  }

  async function testModel() {
    setTesting(true)
    const res = await window.sona.ai.test()
    setTesting(false)
    if (!res.ok) return sona.notify(`Model tidak terjangkau: ${res.error}`, 'error')
    setModels(res.models ?? [])
    sona.notify(`Terhubung. ${res.models?.length ?? 0} model terlihat.`)
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Model AI (OpenAI-compatible)</h2>
          <span className="muted tiny">lokal atau cloud, tanpa perantara</span>
        </div>
        <p className="muted tiny">
          Default ke Ollama lokal (<code>http://127.0.0.1:11434/v1</code>). Bisa juga LM Studio, llama.cpp server,
          OpenRouter, Groq, OpenAI, atau endpoint apa pun yang bicara format <code>/chat/completions</code> dengan
          function calling.
        </p>
        <div className="form">
          <label>
            <span>Base URL</span>
            <input value={local.ai.baseUrl} onChange={(e) => patch('ai', 'baseUrl', e.target.value)} />
          </label>
          <label>
            <span>Model</span>
            <input value={local.ai.model} onChange={(e) => patch('ai', 'model', e.target.value)} placeholder="llama3.1" />
          </label>
          <label>
            <span>API key (opsional)</span>
            <input
              type="password"
              value={local.ai.apiKey}
              onChange={(e) => patch('ai', 'apiKey', e.target.value)}
              placeholder="kosong untuk server lokal"
            />
          </label>
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
          <h2>Suara (TTS)</h2>
          <span className="muted tiny">memakai voice OS — gratis, offline</span>
        </div>
        <div className="form">
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(local.voice.ttsEnabled)}
              onChange={(e) => patch('voice', 'ttsEnabled', e.target.checked)}
            />
            <span>Bacakan jawaban Sona</span>
          </label>
          <label>
            <span>Hotkey rekam</span>
            <input value={local.voice.hotkey} onChange={(e) => patch('voice', 'hotkey', e.target.value)} placeholder="Control+Alt+Space" />
          </label>
          <label>
            <span>Rate ({Number(local.voice.rate).toFixed(2)})</span>
            <input
              type="range"
              min="0.6"
              max="1.8"
              step="0.05"
              value={local.voice.rate}
              onChange={(e) => patch('voice', 'rate', Number(e.target.value))}
            />
          </label>
          <label>
            <span>Pitch ({Number(local.voice.pitch).toFixed(2)})</span>
            <input
              type="range"
              min="0.5"
              max="1.8"
              step="0.05"
              value={local.voice.pitch}
              onChange={(e) => patch('voice', 'pitch', Number(e.target.value))}
            />
          </label>
          <div className="row">
            <button type="button" className="ghost" onClick={sona.speakTest}>
              tes suara
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Speech-to-text (opsional)</h2>
          <span className="muted tiny">OpenAI-compatible /audio/transcriptions</span>
        </div>
        <p className="muted tiny">
          Cocokkan dengan server whisper.cpp (<code>--inference</code> mode), faster-whisper, atau API apa pun yang
          menerima multipart audio. Kalau dimatikan, kamu tetap bisa mengetik perintah.
        </p>
        <div className="form">
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(local.stt.enabled)}
              onChange={(e) => patch('stt', 'enabled', e.target.checked)}
            />
            <span>Aktifkan input suara</span>
          </label>
          <label>
            <span>Base URL</span>
            <input value={local.stt.baseUrl} onChange={(e) => patch('stt', 'baseUrl', e.target.value)} />
          </label>
          <label>
            <span>Model</span>
            <input value={local.stt.model} onChange={(e) => patch('stt', 'model', e.target.value)} />
          </label>
          <label>
            <span>Bahasa</span>
            <input value={local.stt.language} onChange={(e) => patch('stt', 'language', e.target.value)} placeholder="id" />
          </label>
          <label>
            <span>API key (opsional)</span>
            <input type="password" value={local.stt.apiKey} onChange={(e) => patch('stt', 'apiKey', e.target.value)} />
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
          </ul>
        </section>
      )}
    </div>
  )
}
