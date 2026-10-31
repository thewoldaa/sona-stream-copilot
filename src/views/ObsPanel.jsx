import { useEffect, useState } from 'react'

export default function ObsPanel({ sona }) {
  const obsCfg = sona.settings?.obs ?? { url: 'ws://127.0.0.1:4455', password: '', autoConnect: true }
  const [form, setForm] = useState(obsCfg)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm((prev) => ({ ...prev, ...obsCfg }))
  }, [sona.settings])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    await sona.connect(form)
    setBusy(false)
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Koneksi OBS WebSocket</h2>
          <span className={`pill ${sona.connected ? 'pill--ok' : 'pill--off'}`}>
            {sona.connected ? 'connected' : 'offline'}
          </span>
        </div>

        <p className="muted tiny">
          Di OBS: <strong>Tools → WebSocket Server Settings</strong>, aktifkan server (default port 4455).
          Sona hanya bicara ke OBS lewat WebSocket lokal dan tidak pernah menyentuh kredensial OBS di disk.
        </p>

        <form className="form" onSubmit={submit}>
          <label>
            <span>URL</span>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="ws://127.0.0.1:4455" />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="kosongkan bila auth dimatikan"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(form.autoConnect)}
              onChange={(e) => setForm({ ...form, autoConnect: e.target.checked })}
            />
            <span>Sambungkan otomatis saat aplikasi dibuka</span>
          </label>

          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'menyambung…' : 'sambungkan'}
            </button>
            <button type="button" className="ghost" onClick={sona.disconnect} disabled={!sona.connected}>
              putuskan
            </button>
            <button type="button" className="ghost" onClick={sona.refresh}>
              muat ulang state
            </button>
          </div>

          {sona.status?.error && <p className="bad tiny">Error: {sona.status.error}</p>}
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Scene collection</h2>
          <span className="muted tiny">{sona.scenes.length} scene</span>
        </div>
        <div className="chips">
          {sona.scenes.map((scene) => (
            <span key={scene} className={`chip ${scene === sona.snapshot?.currentScene ? 'chip--on' : ''}`}>
              {scene}
            </span>
          ))}
          {!sona.scenes.length && <p className="muted tiny">Tidak ada scene terbaca.</p>}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Input audio</h2>
          <span className="muted tiny">{sona.audio.length} input</span>
        </div>
        <ul className="steplist">
          {sona.audio.map((input) => (
            <li key={input.name}>
              <code>{input.name}</code>
              <span className="muted tiny"> {input.volumePct}%</span>
              <span className={input.muted ? 'bad' : 'ok'}>{input.muted ? ' muted' : ' live'}</span>
            </li>
          ))}
          {!sona.audio.length && <li className="muted tiny">Tidak ada input audio.</li>}
        </ul>
      </section>
    </div>
  )
}
