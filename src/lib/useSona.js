import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const api = () => window.sona

/** Renderer running outside Electron (plain `vite dev`) has no bridge. */
const hasBridge = () => Boolean(window.sona)

/** Central app state: settings, OBS status/snapshot, and the assistant transcript. */
export function useSona() {
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState({ connected: false, error: null, url: null })
  const [snapshot, setSnapshot] = useState(null)
  const [messages, setMessages] = useState([])
  const [steps, setSteps] = useState([])
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  useEffect(() => {
    if (!hasBridge()) {
      setInfo({ version: 'dev', electron: '-', chrome: '-', node: '-', settingsPath: '(browser)' })
      return () => {}
    }
    let alive = true
    api()
      .settings.get()
      .then((s) => alive && setSettings(s))
      .catch(() => {})
    api()
      .app.info()
      .then((i) => alive && setInfo(i))
      .catch(() => {})

    const offStatus = api().on('obs:status', setStatus)
    const offSnap = api().on('obs:snapshot', setSnapshot)
    const offStep = api().on('ai:step', (step) => setSteps((prev) => [...prev.slice(-40), step]))

    return () => {
      alive = false
      offStatus()
      offSnap()
      offStep()
    }
  }, [])

  const saveSettings = useCallback(
    async (patch) => {
      const next = await api().settings.save(patch)
      setSettings(next)
      notify('Pengaturan tersimpan.')
      return next
    },
    [notify]
  )

  const connect = useCallback(
    async (cfg) => {
      const res = await api().obs.connect(cfg)
      if (!res.ok) notify(`Gagal konek OBS: ${res.error}`, 'error')
      else notify('OBS terhubung.')
      return res
    },
    [notify]
  )

  const disconnect = useCallback(async () => {
    await api().obs.disconnect()
    notify('OBS terputus.')
  }, [notify])

  const refresh = useCallback(async () => {
    const snap = await api().obs.snapshot().catch(() => null)
    if (snap) setSnapshot(snap)
    return snap
  }, [])

  const command = useCallback(
    async (text) => {
      const trimmed = String(text || '').trim()
      if (!trimmed || busy) return
      setBusy(true)
      setSteps([])
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      try {
        const res = await api().ai.command(trimmed, history)
        if (!res.ok) {
          setMessages((prev) => [...prev, { role: 'assistant', content: `⚠︎ ${res.error}`, error: true }])
          notify(res.error, 'error')
        } else {
          const answer = res.answer || '(tidak ada jawaban)'
          setMessages((prev) => [...prev, { role: 'assistant', content: answer, steps: res.steps }])
          speak(answer)
        }
        refresh()
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠︎ ${String(err)}`, error: true }])
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, notify, refresh]
  )

  const speak = useCallback(
    (text) => {
      const voice = settings?.voice
      if (!voice?.ttsEnabled || !text) return
      if (!('speechSynthesis' in window)) return
      try {
        window.speechSynthesis.cancel()
        const utter = new SpeechSynthesisUtterance(String(text).slice(0, 600))
        utter.rate = Number(voice.rate) || 1
        utter.pitch = Number(voice.pitch) || 1
        const voices = window.speechSynthesis.getVoices()
        const chosen = voices.find((v) => v.name === voice.voiceName)
        if (chosen) utter.voice = chosen
        window.speechSynthesis.speak(utter)
      } catch {
        /* speech is best-effort */
      }
    },
    [settings]
  )

  const speakTest = useCallback(() => {
    speak('Halo, saya Sona. Siap bantu stream kamu.')
  }, [speak])

  const scenes = snapshot?.scenes ?? []
  const audio = snapshot?.audio ?? []
  const connected = Boolean(status?.connected)

  return useMemo(
    () => ({
      settings,
      status,
      snapshot,
      scenes,
      audio,
      connected,
      messages,
      steps,
      busy,
      info,
      toast,
      notify,
      saveSettings,
      connect,
      disconnect,
      refresh,
      command,
      speak,
      speakTest
    }),
    [settings, status, snapshot, scenes, audio, connected, messages, steps, busy, info, toast, notify, saveSettings, connect, disconnect, refresh, command, speak, speakTest]
  )
}
