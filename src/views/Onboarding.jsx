import { useEffect, useState } from 'react'

const STEPS = ['selamat datang', 'OBS', 'model AI', 'suara & orb', 'selesai']

export default function Onboarding({ sona, onDone }) {
  const [step, setStep] = useState(0)
  const [obsForm, setObsForm] = useState({ url: sona.settings?.obs?.url ?? 'ws://127.0.0.1:4455', password: '' })
  const [aiForm, setAiForm] = useState({
    baseUrl: sona.settings?.ai?.baseUrl ?? 'http://127.0.0.1:11434/v1',
    model: sona.settings?.ai?.model ?? 'llama3.1'
  })
  const [voice, setVoice] = useState({
    ttsEnabled: sona.settings?.voice?.ttsEnabled ?? true,
    hotkey: sona.settings?.voice?.hotkey ?? 'Control+Alt+Space',
    phrase: sona.settings?.wake?.phrase ?? 'sona'
  })
  const [orb, setOrb] = useState(sona.settings?.orb?.enabled ?? true)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState(null)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function detect() {
    const found = await sona.detectObs()
    if (found?.found) {
      setObsForm((prev) => ({
        ...prev,
        url: `ws://127.0.0.1:${found.port || 4455}`,
        password: found.password || ''
      }))
      sona.notify(found.enabled ? 'OBS WebSocket terdeteksi dan aktif.' : 'Config ditemukan, tapi server WebSocket OBS masih mati.')
    }
  }

  async function testModel() {
    setTesting(true)
    await sona.saveSettings({ ai: { ...sona.settings.ai, ...aiForm } })
    const res = await window.sona.ai.test()
    setTesting(false)
    if (!res.ok) return sona.notify(`Model tidak terjangkau: ${res.error}`, 'error')
    setModels(res.models ?? [])
    sona.notify(`Model terhubung. ${res.models?.length ?? 0} tersedia.`)
  }

  async function finish() {
    await sona.saveSettings({
      ai: { ...sona.settings.ai, ...aiForm },
      voice: { ...sona.settings.voice, ttsEnabled: voice.ttsEnabled, hotkey: voice.hotkey },
      wake: { ...sona.settings.wake, phrase: voice.phrase },
      orb: { ...sona.settings.orb, enabled: orb },
      onboarding: { done: true, step: STEPS.length - 1 }
    })
    if (await window.sona.orb.state().then((s) => s.enabled !== orb)) {
      await window.sona.orb.toggle(orb)
    }
    onDone()
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <header className="onboarding-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <strong>Sona</strong>
              <small>stream copilot</small>
            </div>
          </div>
          <div className="onboarding-dots">
            {STEPS.map((label, index) => (
              <span key={label} className={index <= step ? 'on' : ''} title={label} />
            ))}
          </div>
        </header>

        <div className="onboarding-body">
          {step === 0 && (
            <>
              <h2>Semua di mesin kamu.</h2>
              <p className="muted">
                Sona mengendalikan OBS, membaca chat, menjalankan overlay, dan memutar musik. Model AI, suara, dan
                datanya tinggal di komputermu — tidak ada akun, tidak ada langganan, tidak ada server kami.
              </p>
              <ul className="onboarding-list">
                <li>Kontrol OBS lewat WebSocket lokal (68 tool)</li>
                <li>Chat Twitch + moderasi lokal</li>
                <li>Overlay browser source dengan designer</li>
                <li>Model bebas: Ollama, LM Studio, atau cloud pilihanmu</li>
              </ul>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Sambungkan OBS</h2>
              <p className="muted">
                Di OBS: <strong>Tools → WebSocket Server Settings</strong> → aktifkan server. Sona bisa membaca
                konfigurasinya otomatis dan mengisi port + password.
              </p>
              <div className="row">
                <button type="button" className="ghost" onClick={detect}>
                  deteksi otomatis
                </button>
                <button type="button" className="primary" onClick={() => sona.connect({ ...obsForm, autoConnect: true, autoDetect: true })}>
                  sambungkan
                </button>
                <span className={`pill ${sona.connected ? 'pill--ok' : 'pill--off'}`}>{sona.connected ? 'terhubung' : 'offline'}</span>
              </div>
              <div className="form">
                <label>
                  <span>URL</span>
                  <input value={obsForm.url} onChange={(e) => setObsForm({ ...obsForm, url: e.target.value })} />
                </label>
                <label>
                  <span>Password</span>
                  <input type="password" value={obsForm.password} onChange={(e) => setObsForm({ ...obsForm, password: e.target.value })} />
                </label>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Pilih otak</h2>
              <p className="muted">
                Sona butuh model yang mendukung <em>function calling</em>. Ollama lokal adalah jalur termudah dan
                sepenuhnya gratis.
              </p>
              <div className="form">
                <label>
                  <span>Base URL</span>
                  <input value={aiForm.baseUrl} onChange={(e) => setAiForm({ ...aiForm, baseUrl: e.target.value })} />
                </label>
                <label>
                  <span>Model</span>
                  <input value={aiForm.model} onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })} />
                </label>
              </div>
              <div className="row">
                <button type="button" className="ghost" onClick={testModel} disabled={testing}>
                  {testing ? 'menguji…' : 'tes koneksi'}
                </button>
                {models && <span className="muted tiny">{models.slice(0, 4).join(' · ')}</span>}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Suara & widget</h2>
              <p className="muted">TTS memakai voice Windows — offline dan gratis. Widget orb bisa dipakai bicara kapan saja.</p>
              <div className="form">
                <label className="check">
                  <input type="checkbox" checked={voice.ttsEnabled} onChange={(e) => setVoice({ ...voice, ttsEnabled: e.target.checked })} />
                  <span>Bacakan jawaban Sona</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={orb} onChange={(e) => setOrb(e.target.checked)} />
                  <span>Tampilkan orb mengambang</span>
                </label>
                <label>
                  <span>Hotkey rekam</span>
                  <input value={voice.hotkey} onChange={(e) => setVoice({ ...voice, hotkey: e.target.value })} />
                </label>
                <label>
                  <span>Kata bangun (wake word)</span>
                  <input value={voice.phrase} onChange={(e) => setVoice({ ...voice, phrase: e.target.value })} />
                </label>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2>Siap live.</h2>
              <p className="muted">Ringkasnya:</p>
              <ul className="onboarding-list">
                <li>OBS: {sona.connected ? 'tersambung' : 'belum tersambung — bisa diatur nanti'}</li>
                <li>Model: {aiForm.model} @ {aiForm.baseUrl}</li>
                <li>TTS: {voice.ttsEnabled ? 'aktif' : 'mati'} · horkey {voice.hotkey}</li>
                <li>Orb: {orb ? 'tampil' : 'dimatikan'}</li>
              </ul>
              <p className="muted tiny">
                Tab Asisten untuk perintah, Chat untuk Twitch, Overlay untuk browser source, Musik untuk antrean.
              </p>
            </>
          )}
        </div>

        <footer className="onboarding-foot">
          <button type="button" className="ghost tiny-btn" onClick={finish}>
            lewati
          </button>
          <div className="row">
            {step > 0 && (
              <button type="button" className="ghost" onClick={() => setStep((s) => s - 1)}>
                kembali
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="primary" onClick={() => setStep((s) => s + 1)}>
                lanjut
              </button>
            ) : (
              <button type="button" className="primary" onClick={finish}>
                buka sona
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
