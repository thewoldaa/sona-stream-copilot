import { useEffect, useRef, useState } from 'react'

const fmtUptime = (seconds) => {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The notch window (?win=notch): a bar pinned to the top edge that expands into
 * the control panel. Collapsed it shows state; expanded it shows the tile grid.
 */
export default function Notch() {
  const [state, setState] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const collapseTimer = useRef(null)

  useEffect(() => {
    let alive = true
    window.sona.notch.state().then((s) => {
      if (!alive || !s) return
      setState(s)
      setExpanded(Boolean(s.expanded))
    })
    const off = window.sona.on('notch:state', (next) => {
      if (!alive) return
      setState(next)
      setExpanded(Boolean(next.expanded))
    })
    const tick = setInterval(() => setClock(new Date()), 20_000)
    return () => {
      alive = false
      off()
      clearInterval(tick)
    }
  }, [])

  useEffect(() => {
    // Collapse on its own so the bar does not cover the screen all session.
    clearTimeout(collapseTimer.current)
    if (expanded) {
      collapseTimer.current = setTimeout(() => window.sona.notch.expand(false), 15000)
    }
    return () => clearTimeout(collapseTimer.current)
  }, [expanded])

  const act = (type) => window.sona.notch.action(type)
  const obs = state?.obs ?? {}
  const chat = state?.chat ?? {}
  const overlay = state?.overlay ?? {}
  const music = state?.music ?? {}
  const automations = state?.automations ?? {}

  const live = Boolean(obs.streaming)

  return (
    <div className={`notch ${expanded ? 'notch--open' : ''}`}>
      <div className="notch-bar">
        <button type="button" className="notch-mark" onClick={() => window.sona.notch.expand(!expanded)} title="Sona">
          <span className="notch-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>

        <div className="notch-meta">
          <span className={`notch-chip ${live ? 'notch-chip--live' : ''}`}>
            {live ? 'LIVE' : obs.connected ? 'siap' : 'OBS offline'}
          </span>
          <span className="notch-scene">{obs.scene ?? '—'}</span>
          {chat.connected && <span className="notch-dim">#{chat.channel}</span>}
        </div>

        <div className="notch-actions">
          <button type="button" onClick={() => act('voice')} title="Rekam suara">
            🎙
          </button>
          <button type="button" onClick={() => act('microphone')} title="Mute mic">
            🔇
          </button>
          <button type="button" onClick={() => act('alert')} title="Tes alert overlay">
            ◈
          </button>
          <button type="button" onClick={() => act('overlay')} title="Overlay">
            ▤
          </button>
          <button type="button" onClick={() => act('settings')} title="Setelan">
            ✎
          </button>
          <button type="button" onClick={() => window.sona.notch.expand(!expanded)} title={expanded ? 'Tutup' : 'Buka panel'}>
            {expanded ? '⌃' : '⌄'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="notch-panel">
          <div className="notch-grid">
            <button type="button" className="notch-tile" onClick={() => act('chat')}>
              <span className="tile-label">Obrolan</span>
              <span className="tile-value">{chat.connected ? `${chat.perMinute}/mnt` : '—'}</span>
              <span className={`tile-dot ${chat.connected ? 'on' : ''}`} />
            </button>

            <button type="button" className="notch-tile" onClick={() => act('main')}>
              <span className="tile-label">OBS</span>
              <span className="tile-value">{obs.connected ? `${obs.scenes} scene` : 'off'}</span>
              <span className={`tile-dot ${obs.connected ? 'on' : ''}`} />
            </button>

            <button type="button" className="notch-tile" onClick={() => act('overlay')}>
              <span className="tile-label">Overlay</span>
              <span className="tile-value">{overlay.running ? `:${overlay.port}` : 'mati'}</span>
              <span className={`tile-dot ${overlay.running ? 'on' : ''}`} />
            </button>

            <button type="button" className="notch-tile" onClick={() => act('chat')}>
              <span className="tile-label">Automations</span>
              <span className="tile-value">{automations.timers ?? 0} timer</span>
              <span className="tile-sub">{automations.commands ?? 0} command · {automations.counters ?? 0} counter</span>
            </button>

            <button type="button" className="notch-tile" onClick={() => act('stream')}>
              <span className="tile-label">Go Live</span>
              <span className={`tile-value ${live ? 'bad' : 'ok'}`}>{live ? 'Stop' : 'Mulai'}</span>
              <span className="tile-sub">{fmtUptime(obs.streamSeconds)}</span>
            </button>

            <button type="button" className="notch-tile" onClick={() => act('music')}>
              <span className="tile-label">Musik</span>
              <span className="tile-value">{music.playing ? 'play' : 'pause'}</span>
              <span className="tile-sub">{music.title ?? '—'}</span>
            </button>

            <div className="notch-tile notch-tile--static">
              <span className="tile-label">Bitrate</span>
              <span className="tile-value">{state?.bitrate != null ? `${state.bitrate} kbps` : '—'}</span>
            </div>

            <div className="notch-tile notch-tile--static">
              <span className="tile-label">Penonton</span>
              <span className="tile-value">—</span>
              <span className="tile-sub">butuh API Twitch</span>
            </div>

            <button type="button" className="notch-tile" onClick={() => act('assistant')}>
              <span className="tile-label">Model</span>
              <span className="tile-value">{state?.ai?.model || '—'}</span>
              <span className={`tile-dot ${state?.ai?.configured ? 'on' : ''}`} />
            </button>
          </div>

          <div className="notch-foot">
            <span className="notch-dim">{clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="notch-dim">
              {obs.audio?.length ? `${obs.audio.filter((a) => !a.muted).length}/${obs.audio.length} audio live` : 'tanpa audio'}
            </span>
            <div className="row">
              <button type="button" className="ghost tiny-btn" onClick={() => act('hide')}>
                sembunyikan
              </button>
              <button type="button" className="ghost tiny-btn" onClick={() => act('main')}>
                buka Sona
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
