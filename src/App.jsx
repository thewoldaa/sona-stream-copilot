import { useEffect, useRef, useState } from 'react'
import { useSona } from './lib/useSona.js'
import { Mic } from './lib/mic.js'
import Dashboard from './views/Dashboard.jsx'
import Assistant from './views/Assistant.jsx'
import ObsPanel from './views/ObsPanel.jsx'
import Settings from './views/Settings.jsx'

const TABS = [
  { id: 'dashboard', label: 'Rundown', hint: 'Kontrol cepat' },
  { id: 'assistant', label: 'Asisten', hint: 'Perintah bahasa alami' },
  { id: 'obs', label: 'OBS', hint: 'Koneksi & scene' },
  { id: 'settings', label: 'Setelan', hint: 'Model, suara, hotkey' }
]

export default function App() {
  const sona = useSona()
  const [tab, setTab] = useState('dashboard')
  const [draft, setDraft] = useState('')
  const [, force] = useState(0)
  const micRef = useRef(null)

  useEffect(() => {
    if (!sona.settings) return
    if (sona.settings.obs?.autoConnect) sona.refresh()
  }, [sona.settings])

  useEffect(() => {
    const off = window.sona.on('voice:hotkey', () => {
      setTab('assistant')
      toggleMic()
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleMic() {
    if (!Mic.supported()) {
      sona.notify('Mikrofon tidak tersedia di mesin ini.', 'error')
      return
    }
    if (!sona.settings?.stt?.enabled) {
      sona.notify('Aktifkan STT di Setelan dulu.', 'error')
      return
    }
    if (!micRef.current) micRef.current = new Mic()

    if (micRef.current.recording) {
      force((n) => n + 1)
      const clip = await micRef.current.stop()
      force((n) => n + 1)
      if (!clip) return
      sona.notify('Mentranskripsi…')
      const res = await window.sona.stt.transcribe(clip.buffer, clip.mime)
      if (!res.ok) return sona.notify(`STT gagal: ${res.error}`, 'error')
      if (!res.text) return sona.notify('Tidak ada suara terdeteksi.', 'error')
      setDraft(res.text)
      sona.command(res.text)
      setTab('assistant')
    } else {
      await micRef.current.start()
      force((n) => n + 1)
      sona.notify('Merekam… tekan lagi untuk kirim.')
    }
  }

  const recording = micRef.current?.recording
  const s = sona.settings

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Sona</strong>
            <small>stream copilot</small>
          </div>
        </div>

        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav ${tab === t.id ? 'nav--on' : ''}`}
              onClick={() => setTab(t.id)}
              type="button"
            >
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <div className={`dot ${sona.connected ? 'dot--on' : 'dot--off'}`} />
          <span>{sona.connected ? 'OBS terhubung' : 'OBS offline'}</span>
        </div>
      </aside>

      <main className="stage">
        <header className="topline">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="muted">
              {sona.snapshot?.obsVersion ? `OBS ${sona.snapshot.obsVersion}` : 'belum ada data OBS'} ·{' '}
              {sona.snapshot?.currentScene ?? '—'} · {sona.audio.length} input audio
            </p>
          </div>
          <div className="topline-actions">
            <button className={`mic ${recording ? 'mic--on' : ''}`} onClick={toggleMic} type="button" title={s?.voice?.hotkey}>
              {recording ? '● rekam' : '🎙 suara'}
            </button>
            <button className="ghost" onClick={sona.refresh} type="button">
              refresh
            </button>
          </div>
        </header>

        <div className="scroll">
          {tab === 'dashboard' && <Dashboard sona={sona} onCommand={(text) => { setDraft(text); sona.command(text); setTab('assistant') }} />}
          {tab === 'assistant' && <Assistant sona={sona} draft={draft} setDraft={setDraft} onMic={toggleMic} recording={recording} />}
          {tab === 'obs' && <ObsPanel sona={sona} />}
          {tab === 'settings' && <Settings sona={sona} />}
        </div>
      </main>

      {sona.toast && <div className={`toast toast--${sona.toast.kind}`}>{sona.toast.text}</div>}
    </div>
  )
}
