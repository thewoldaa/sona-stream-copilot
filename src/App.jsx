import { useCallback, useEffect, useRef, useState } from 'react'
import { useSona } from './lib/useSona.js'
import { Mic } from './lib/mic.js'
import { WakeListener } from './lib/wake.js'
import Dashboard from './views/Dashboard.jsx'
import Assistant from './views/Assistant.jsx'
import ObsPanel from './views/ObsPanel.jsx'
import ChatPanel from './views/ChatPanel.jsx'
import Designer from './views/Designer.jsx'
import Music from './views/Music.jsx'
import Settings from './views/Settings.jsx'
import Onboarding from './views/Onboarding.jsx'
import { MusicDeck } from './lib/musicDeck.jsx'

const TABS = [
  { id: 'dashboard', label: 'Rundown', hint: 'Kontrol cepat' },
  { id: 'assistant', label: 'Asisten', hint: 'Perintah bahasa alami' },
  { id: 'obs', label: 'OBS', hint: 'Koneksi, scene, source' },
  { id: 'chat', label: 'Chat', hint: 'Moderasi & interaksi' },
  { id: 'overlay', label: 'Overlay', hint: 'Designer & browser source' },
  { id: 'music', label: 'Musik', hint: 'Antrean & output device' },
  { id: 'settings', label: 'Setelan', hint: 'Model, suara, hotkey' }
]

export default function App() {
  const sona = useSona()
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'dashboard')
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(false)
  const [wakeOn, setWakeOn] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const micRef = useRef(null)
  const wakeRef = useRef(null)

  useEffect(() => {
    if (!sona.settings) return
    if (sona.settings.onboarding?.done !== true) setShowOnboarding(true)
  }, [sona.settings?.onboarding?.done]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = recording ? 'listening' : sona.busy ? 'thinking' : 'idle'
    window.sona?.orb?.setState(next)
  }, [recording, sona.busy])

  useEffect(() => {
    if (!sona.settings) return
    if (sona.settings.obs?.autoConnect) sona.refresh()
  }, [sona.settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitVoice = useCallback(
    async (blob) => {
      const res = await window.sona.stt.transcribe(await blob.arrayBuffer(), blob.type || 'audio/webm')
      if (!res.ok) return sona.notify(`STT gagal: ${res.error}`, 'error')
      const text = String(res.text ?? '').trim()
      if (!text) return
      const phrase = (sona.settings?.wake?.phrase || 'sona').toLowerCase()
      const lower = text.toLowerCase()
      const at = lower.indexOf(phrase)
      const command = (at >= 0 ? text.slice(at + phrase.length) : text).replace(/^[,.\s]+/, '').trim()
      if (at >= 0 && !command) {
        sona.notify('Ya, saya dengar. Lanjutkan perintahnya.')
        return
      }
      if (at < 0 && sona.settings?.wake?.enabled) return // ignore chatter without the wake phrase
      setDraft(command)
      setTab('assistant')
      sona.command(command)
    },
    [sona]
  )

  const startWake = useCallback(async () => {
    if (!WakeListener.supported()) return sona.notify('Mikrofon tidak tersedia.', 'error')
    if (!sona.settings?.stt?.enabled) return sona.notify('Wake word butuh STT aktif (Setelan → STT).', 'error')
    if (!wakeRef.current) {
      wakeRef.current = new WakeListener({
        phrase: sona.settings.wake.phrase,
        threshold: Number(sona.settings.wake.threshold) || 0.055,
        silenceMs: Number(sona.settings.wake.silenceMs) || 850,
        onUtterance: submitVoice
      })
    }
    await wakeRef.current.start()
    setWakeOn(true)
    sona.notify(`Mendengarkan kata "${sona.settings.wake.phrase}".`)
  }, [sona, submitVoice])

  const stopWake = useCallback(() => {
    wakeRef.current?.stop()
    setWakeOn(false)
  }, [])

  useEffect(() => {
    const off = window.sona.on('app:nav', (next) => setTab(next))
    return off
  }, [])

  useEffect(() => {
    const off = window.sona.on('voice:hotkey', () => {
      setTab('assistant')
      toggleMic()
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleMic() {
    if (!Mic.supported()) return sona.notify('Mikrofon tidak tersedia di mesin ini.', 'error')
    if (!sona.settings?.stt?.enabled) return sona.notify('Aktifkan STT di Setelan dulu.', 'error')
    if (!micRef.current) micRef.current = new Mic()

    if (micRef.current.recording) {
      setRecording(false)
      const clip = await micRef.current.stop()
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
      setRecording(true)
      sona.notify('Merekam… tekan lagi untuk kirim.')
    }
  }

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
            <button key={t.id} className={`nav ${tab === t.id ? 'nav--on' : ''}`} onClick={() => setTab(t.id)} type="button">
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </button>
          ))}
        </nav>

        <div className="rail-status">
          <div className="rail-line">
            <span className={`dot ${sona.connected ? 'dot--on' : 'dot--off'}`} />
            <span>{sona.connected ? 'OBS' : 'OBS offline'}</span>
          </div>
          <div className="rail-line">
            <span className={`dot ${sona.chatState?.connected ? 'dot--on' : 'dot--off'}`} />
            <span>{sona.chatState?.connected ? `#${sona.chatState.channel}` : 'chat offline'}</span>
          </div>
          <div className="rail-line">
            <span className={`dot ${sona.overlayState?.running ? 'dot--on' : 'dot--off'}`} />
            <span>{sona.overlayState?.running ? `overlay :${sona.overlayState.port}` : 'overlay mati'}</span>
          </div>
        </div>
      </aside>

      <main className="stage">
        <header className="topline">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="muted">
              {sona.snapshot?.obsVersion ? `OBS ${sona.snapshot.obsVersion}` : 'belum ada data OBS'} ·{' '}
              {sona.snapshot?.currentScene ?? '—'} · {sona.audio.length} input audio
              {sona.snapshot?.streaming ? ' · LIVE' : ''}
            </p>
          </div>
          <div className="topline-actions">
            <button
              className={`mic ${wakeOn ? 'mic--on' : ''}`}
              onClick={() => (wakeOn ? stopWake() : startWake())}
              type="button"
              title={`Wake word: ${s?.wake?.phrase ?? 'sona'}`}
            >
              {wakeOn ? '👂 dengar' : '👂 wake'}
            </button>
            <button className={`mic ${recording ? 'mic--on' : ''}`} onClick={toggleMic} type="button" title={s?.voice?.hotkey}>
              {recording ? '● rekam' : '🎙 suara'}
            </button>
            <button className="ghost" onClick={sona.refresh} type="button">
              refresh
            </button>
            <button
              className="ghost"
              type="button"
              title="Tampilkan / sembunyikan notch"
              onClick={async () => {
                const state = await window.sona.notch.state()
                const res = await window.sona.notch.toggle(!state.enabled)
                sona.notify(res.enabled ? 'Notch ditampilkan.' : 'Notch disembunyikan.')
              }}
            >
              notch
            </button>
            <button
              className="ghost"
              type="button"
              title="Tampilkan / sembunyikan orb"
              onClick={async () => {
                const state = await window.sona.orb.state()
                const res = await window.sona.orb.toggle(!state.enabled)
                sona.notify(res.enabled ? 'Orb ditampilkan.' : 'Orb disembunyikan.')
              }}
            >
              orb
            </button>
          </div>
        </header>

        <div className="scroll">
          {tab === 'dashboard' && (
            <Dashboard
              sona={sona}
              onCommand={(text) => {
                setDraft(text)
                sona.command(text)
                setTab('assistant')
              }}
            />
          )}
          {tab === 'assistant' && <Assistant sona={sona} draft={draft} setDraft={setDraft} onMic={toggleMic} recording={recording} />}
          {tab === 'obs' && <ObsPanel sona={sona} />}
          {tab === 'chat' && <ChatPanel sona={sona} />}
          {tab === 'overlay' && <Designer sona={sona} />}
          {tab === 'music' && <Music sona={sona} />}
          {tab === 'settings' && <Settings sona={sona} />}
        </div>
      </main>

      {sona.toast && <div className={`toast toast--${sona.toast.kind}`}>{sona.toast.text}</div>}
      {showOnboarding && <Onboarding sona={sona} onDone={() => setShowOnboarding(false)} />}
      <MusicDeck />
    </div>
  )
}
