import { useEffect, useState } from 'react'

export default function Music({ sona }) {
  const state = sona.musicState
  const [url, setUrl] = useState('')
  const [devices, setDevices] = useState([])
  const [ytDlp, setYtDlp] = useState(sona.settings?.music?.ytDlpPath ?? '')

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setYtDlp(sona.settings?.music?.ytDlpPath ?? '')
  }, [sona.settings?.music?.ytDlpPath])

  const current = state?.current

  return (
    <div className="stack">
      <section className="card card--lead">
        <div className="card-head">
          <h2>Sekarang diputar</h2>
          <span className="muted tiny">{state?.total ?? 0} track</span>
        </div>
        <p className="track-title">{current?.title ?? '— belum ada —'}</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => window.sona.music.previous()}>
            ⏮
          </button>
          <button type="button" className="primary" onClick={() => window.sona.music.pause()}>
            {state?.playing ? 'pause' : 'play'}
          </button>
          <button type="button" className="ghost" onClick={() => window.sona.music.next()}>
            ⏭
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={state?.volume ?? 75}
            onChange={(e) => window.sona.music.volume(Number(e.target.value))}
          />
          <span className="mixer-val">{state?.volume ?? 75}%</span>
        </div>
        <p className="muted tiny">
          Output dipilih per perangkat: kirim musik ke virtual cable, lalu tangkap di OBS lewat Application Audio Capture.
        </p>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Tambah musik</h2>
          </div>
          <div className="form">
            <button type="button" className="primary" onClick={() => window.sona.music.addFiles()}>
              pilih file audio
            </button>
            <label>
              <span>URL (butuh yt-dlp)</span>
              <div className="row">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    if (!url.trim()) return
                    const res = await window.sona.music.play(url.trim())
                    if (!res.ok) sona.notify(`Gagal: ${res.error}`, 'error')
                    else setUrl('')
                  }}
                >
                  putar
                </button>
              </div>
            </label>
            <label>
              <span>Path yt-dlp.exe</span>
              <div className="row">
                <input value={ytDlp} onChange={(e) => setYtDlp(e.target.value)} placeholder="C:\\tools\\yt-dlp.exe" />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => sona.saveSettings({ music: { ...sona.settings.music, ytDlpPath: ytDlp } })}
                >
                  simpan
                </button>
              </div>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Output & mode</h2>
          </div>
          <div className="form">
            <label>
              <span>Perangkat output</span>
              <select value={sona.settings?.music?.sinkId ?? ''} onChange={(e) => window.sona.music.sink(e.target.value)}>
                <option value="">default sistem</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `output ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Loop</span>
              <select value={state?.loop ?? 'off'} onChange={(e) => window.sona.music.loop(e.target.value)}>
                <option value="off">off</option>
                <option value="all">semua</option>
                <option value="one">satu track</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={Boolean(state?.shuffle)} onChange={(e) => window.sona.music.shuffle(e.target.checked)} />
              <span>acak</span>
            </label>
            <button type="button" className="ghost" onClick={() => window.sona.music.clear()} disabled={!state?.total}>
              kosongkan antrean
            </button>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Antrean</h2>
        </div>
        <ul className="element-list">
          {(state?.queue ?? []).map((item, index) => (
            <li key={item.id} className={index === state.index ? 'element-list--on' : ''}>
              <button type="button" className="element-pick" onClick={() => window.sona.music.jump(index)}>
                <span>{index + 1}. {item.title}</span>
                <span className="muted tiny">{item.source}</span>
              </button>
              <button type="button" className="ghost tiny-btn" onClick={() => window.sona.music.remove(item.id)}>
                ✕
              </button>
            </li>
          ))}
          {!state?.queue?.length && <li className="muted tiny">Antrean kosong. Tambahkan file audio di atas.</li>}
        </ul>
      </section>
    </div>
  )
}
