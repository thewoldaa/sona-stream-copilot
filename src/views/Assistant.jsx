import { useEffect, useRef } from 'react'

export default function Assistant({ sona, draft, setDraft, onMic, recording }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [sona.messages, sona.steps])

  return (
    <div className="stack">
      <section className="card card--grow">
        <div className="card-head">
          <h2>Percakapan</h2>
          <button className="ghost tiny-btn" type="button" onClick={() => window.location.reload()}>
            reset
          </button>
        </div>

        <div className="log">
          {!sona.messages.length && (
            <div className="empty">
              <p>Belum ada percakapan.</p>
              <p className="muted tiny">
                Coba: <em>"pindah ke scene Gameplay"</em>, <em>"volume musik 30 persen"</em>, <em>"mute mic"</em>,
                <em> "mulai rekam"</em>.
              </p>
            </div>
          )}

          {sona.messages.map((message, index) => (
            <div key={index} className={`bubble bubble--${message.role} ${message.error ? 'bubble--err' : ''}`}>
              <span className="bubble-role">{message.role === 'user' ? 'kamu' : 'sona'}</span>
              <p>{message.content}</p>
              {message.steps?.length > 0 && (
                <details className="steps">
                  <summary>{message.steps.length} tool call</summary>
                  <ul>
                    {message.steps.map((step, i) => (
                      <li key={i}>
                        <code>{step.tool}</code>
                        <span className="muted tiny"> {JSON.stringify(step.args)}</span>
                        <span className={step.result?.ok ? 'ok' : 'bad'}> {step.result?.ok ? '✓' : '✗'}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </section>

      <form
        className="command command--sticky"
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft.trim()
          if (!text) return
          setDraft('')
          sona.command(text)
        }}
      >
        <button type="button" className={`mic ${recording ? 'mic--on' : ''}`} onClick={onMic} title="rekam suara">
          {recording ? '●' : '🎙'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={sona.connected ? 'Tanya atau perintah…' : 'OBS belum terhubung'}
          autoComplete="off"
        />
        <button type="submit" disabled={sona.busy || !draft.trim()}>
          {sona.busy ? '…' : 'kirim'}
        </button>
      </form>

      {sona.steps.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Tool call terakhir</h2>
          </div>
          <ul className="steplist">
            {sona.steps.slice(-8).map((step, i) => (
              <li key={i}>
                <code>{step.tool}</code>
                <span className={step.result?.ok ? 'ok' : 'bad'}>{step.result?.ok ? ' ok' : ' gagal'}</span>
                {!step.result?.ok && <span className="muted tiny"> {step.result?.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
