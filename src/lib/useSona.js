import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const api = () => window.sona

/** Renderer running outside Electron (plain `vite dev`) has no bridge. */
const hasBridge = () => Boolean(window.sona)

/** Central app state: settings, OBS, chat, overlay, music, and the transcript. */
export function useSona() {
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState({ connected: false, error: null, url: null, undoDepth: 0 })
  const [snapshot, setSnapshot] = useState(null)
  const [messages, setMessages] = useState([])
  const [steps, setSteps] = useState([])
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [toast, setToast] = useState(null)

  const [chatState, setChatState] = useState({ connected: false, channel: '', anonymous: true, recent: [] })
  const [chatMessages, setChatMessages] = useState([])
  const [chatFlags, setChatFlags] = useState([])
  const [poll, setPoll] = useState(null)
  const [giveaway, setGiveaway] = useState(null)

  const [overlayState, setOverlayState] = useState({ running: false, url: null, port: null, elements: [] })
  const [musicState, setMusicState] = useState(null)

  const toastTimer = useRef(null)
  const settingsRef = useRef(null)
  settingsRef.current = settings

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const speak = useCallback(
    (text, { prefix = '' } = {}) => {
      const voice = settingsRef.current?.voice
      if (!voice?.ttsEnabled || !text) return
      if (!('speechSynthesis' in window)) return
      try {
        const utter = new SpeechSynthesisUtterance((prefix + String(text)).slice(0, 600))
        utter.rate = Number(voice.rate) || 1
        utter.pitch = Number(voice.pitch) || 1
        const chosen = window.speechSynthesis.getVoices().find((v) => v.name === voice.voiceName)
        if (chosen) utter.voice = chosen
        utter.onstart = () => window.sona?.orb?.setState('speaking')
        utter.onend = () => window.sona?.orb?.setState('idle')
        window.speechSynthesis.speak(utter)
      } catch {
        /* speech is best-effort */
      }
    },
    []
  )

  useEffect(() => {
    if (!hasBridge()) {
      setInfo({ version: 'dev', electron: '-', chrome: '-', node: '-', settingsPath: '(browser)' })
      return () => {}
    }
    let alive = true

    api().settings.get().then((s) => alive && setSettings(s)).catch(() => {})
    api().app.info().then((i) => alive && setInfo(i)).catch(() => {})
    api().overlay.state().then((o) => alive && setOverlayState(o)).catch(() => {})
    api().music.state().then((m) => alive && setMusicState(m)).catch(() => {})
    api().chat.state().then((c) => alive && c && setChatState(c)).catch(() => {})

    const offs = [
      api().on('obs:status', setStatus),
      api().on('obs:snapshot', setSnapshot),
      api().on('ai:step', (step) => setSteps((prev) => [...prev.slice(-40), step])),
      api().on('chat:state', (state) => setChatState((prev) => ({ ...prev, ...state }))),
      api().on('chat:message', (message) => setChatMessages((prev) => [...prev.slice(-200), message])),
      api().on('chat:flag', (flag) => setChatFlags((prev) => [...prev.slice(-40), flag])),
      api().on('chat:poll', setPoll),
      api().on('chat:giveaway', setGiveaway),
      api().on('music:state', setMusicState),
      api().on('chat:read', ({ user, text }) => speak(text, { prefix: `${user} bilang: ` }))
    ]

    return () => {
      alive = false
      for (const off of offs) off()
    }
  }, [speak])

  const saveSettings = useCallback(
    async (patch) => {
      const next = await api().settings.save(patch)
      setSettings(next)
      notify('Pengaturan tersimpan.')
      return next
    },
    [notify]
  )

  const saveSecrets = useCallback(
    async (patch) => {
      const res = await api().secrets.save(patch)
      const fresh = await api().settings.get()
      setSettings(fresh)
      notify(res.ok ? 'Rahasia tersimpan terenkripsi.' : 'Penyimpanan aman tidak tersedia.', res.ok ? 'info' : 'error')
      return res
    },
    [notify]
  )

  /* ---------------------------------- obs --------------------------------- */

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

  const undo = useCallback(async () => {
    const res = await api().obs.undo()
    if (!res.ok) notify(res.error === 'nothing_to_undo' ? 'Tidak ada yang bisa dibatalkan.' : res.error, 'error')
    else notify(`Dibatalkan: ${res.undone}`)
    refresh()
    return res
  }, [notify, refresh])

  const detectObs = useCallback(async () => {
    const found = await api().obs.detect()
    if (!found.found) notify('Config obs-websocket tidak ditemukan.', 'error')
    return found
  }, [notify])

  /* ----------------------------------- ai --------------------------------- */

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
          window.sona?.orb?.popup({ text: answer.slice(0, 180), ms: 7000 })
        }
        refresh()
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠︎ ${String(err)}`, error: true }])
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, notify, refresh, speak]
  )

  const speakTest = useCallback(() => speak('Halo, saya Sona. Siap bantu stream kamu.'), [speak])

  /* ---------------------------------- chat -------------------------------- */

  const chatConnect = useCallback(
    async (cfg) => {
      const res = await api().chat.connect(cfg)
      if (!res.ok) notify(`Gagal konek chat: ${res.error}`, 'error')
      else notify(`Chat tersambung ke #${res.channel}${res.anonymous ? ' (mode baca)' : ''}.`)
      const state = await api().chat.state().catch(() => null)
      if (state) setChatState(state)
      return res
    },
    [notify]
  )

  const chatDisconnect = useCallback(async () => {
    await api().chat.disconnect()
    notify('Chat terputus.')
  }, [notify])

  const chatSend = useCallback(
    async (text) => {
      const res = await api().chat.send(text)
      if (!res.ok) notify(`Chat: ${res.error}`, 'error')
      return res
    },
    [notify]
  )

  /* -------------------------------- overlay -------------------------------- */

  const overlayStart = useCallback(async () => {
    const res = await api().overlay.start()
    const state = await api().overlay.state()
    setOverlayState(state)
    if (!res.ok) notify(`Overlay gagal: ${res.error}`, 'error')
    return res
  }, [notify])

  const overlayStop = useCallback(async () => {
    await api().overlay.stop()
    setOverlayState(await api().overlay.state())
  }, [])

  const overlayUpdate = useCallback(async (elements) => {
    await api().overlay.update(elements)
    setOverlayState(await api().overlay.state())
  }, [])

  const overlayPickImage = useCallback(async () => {
    const res = await api().overlay.pickImage()
    if (!res.ok && res.error !== 'canceled') notify(res.error, 'error')
    return res
  }, [notify])

  /* --------------------------------- music --------------------------------- */

  const music = useMemo(
    () => ({
      play: (query) => api().music.play(query),
      pause: () => api().music.pause(),
      next: () => api().music.next(),
      previous: () => api().music.previous(),
      jump: (index) => api().music.jump(index),
      volume: (percent) => api().music.volume(percent),
      loop: (mode) => api().music.loop(mode),
      shuffle: (on) => api().music.shuffle(on),
      sink: (sinkId) => api().music.sink(sinkId),
      addFiles: () => api().music.addFiles(),
      remove: (id) => api().music.remove(id),
      clear: () => api().music.clear()
    }),
    []
  )

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
      saveSecrets,
      connect,
      disconnect,
      refresh,
      undo,
      detectObs,
      command,
      speak,
      speakTest,
      chatState,
      chatMessages,
      chatFlags,
      poll,
      giveaway,
      chatConnect,
      chatDisconnect,
      chatSend,
      overlayState,
      overlayStart,
      overlayStop,
      overlayUpdate,
      overlayPickImage,
      musicState,
      music
    }),
    [
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
      saveSecrets,
      connect,
      disconnect,
      refresh,
      undo,
      detectObs,
      command,
      speak,
      speakTest,
      chatState,
      chatMessages,
      chatFlags,
      poll,
      giveaway,
      chatConnect,
      chatDisconnect,
      chatSend,
      overlayState,
      overlayStart,
      overlayStop,
      overlayUpdate,
      overlayPickImage,
      musicState,
      music
    ]
  )
}
