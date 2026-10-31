import { useEffect, useRef, useState } from 'react'

const LABELS = {
  idle: 'siap',
  listening: 'mendengar',
  thinking: 'berpikir',
  speaking: 'bicara',
  offline: 'offline'
}

/** The floating widget window (?win=orb). Tight window: drag the ring, click the core. */
export default function Orb() {
  const [state, setState] = useState('idle')
  const [popup, setPopup] = useState(null)
  const [hover, setHover] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const offs = [
      window.sona.on('orb:state', (next) => {
        setState(typeof next === 'string' ? next : next?.state ?? 'idle')
      }),
      window.sona.on('orb:popup', (payload) => {
        setPopup({ text: payload?.text ?? '', at: Date.now() })
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setPopup(null), Number(payload?.ms) || 6000)
      })
    ]
    return () => {
      clearTimeout(timer.current)
      offs.forEach((off) => off())
    }
  }, [])

  return (
    <div className={`orb-wrap orb--${state}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="orb-ring">
        <div className="orb-core" role="button" tabIndex={0} onClick={() => window.sona.orb.voiceToggle()} title="Bicara ke Sona">
          <span className="orb-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>

      <div className={`orb-actions ${hover ? '' : 'orb-actions--ghost'}`}>
        <button type="button" onClick={() => window.sona.orb.snap('br')} title="Pojok kanan bawah">
          ⌟
        </button>
        <button type="button" onClick={() => window.sona.orb.snap('tl')} title="Pojok kiri atas">
          ⌜
        </button>
        <button type="button" onClick={() => window.sona.orb.hide()} title="Sembunyikan">
          ✕
        </button>
      </div>

      <div className={`orb-label ${popup ? 'orb-label--popup' : ''}`}>
        {popup ? <span>{popup.text}</span> : <span>{LABELS[state] ?? 'siap'}</span>}
      </div>
    </div>
  )
}
