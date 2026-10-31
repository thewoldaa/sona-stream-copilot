import { useEffect, useMemo, useState } from 'react'

const TYPES = [
  { id: 'text', label: 'teks' },
  { id: 'chat', label: 'chat feed' },
  { id: 'alert', label: 'alert' },
  { id: 'poll', label: 'poll' },
  { id: 'nowplaying', label: 'now playing' },
  { id: 'clock', label: 'jam' },
  { id: 'scene', label: 'nama scene' }
]

const DEFAULTS = {
  text: { text: 'Teks baru', fontSize: 36, color: '#ECEAF4', align: 'left' },
  chat: { lines: 5, fontSize: 22, color: '#ECEAF4', accent: '#B892FF' },
  alert: { text: '{{user}} baru saja follow!', fontSize: 40, color: '#B892FF' },
  poll: { fontSize: 22, color: '#ECEAF4' },
  nowplaying: { text: 'Sedang diputar', fontSize: 24, color: '#ECEAF4' },
  clock: { fontSize: 30, color: '#ECEAF4' },
  scene: { text: '{{scene}}', fontSize: 28, color: '#ECEAF4' },
  image: { fontSize: 30, color: '#ECEAF4', src: '' }
}

export default function Designer({ sona }) {
  const [elements, setElements] = useState(sona.overlayState?.elements ?? [])
  const [selectedId, setSelectedId] = useState(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setElements(sona.overlayState?.elements ?? [])
  }, [sona.overlayState, dirty])

  const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId])

  function patchElement(id, patch) {
    setDirty(true)
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)))
  }

  function addElement(type) {
    const id = `el-${type}-${Date.now().toString(36).slice(-4)}`
    const next = {
      id,
      type,
      x: 120,
      y: 120,
      width: type === 'chat' ? 620 : 720,
      visible: true,
      ...DEFAULTS[type]
    }
    setDirty(true)
    setElements((prev) => [...prev, next])
    setSelectedId(id)
  }

  function removeElement(id) {
    setDirty(true)
    setElements((prev) => prev.filter((el) => el.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  async function save() {
    await sona.overlayUpdate(elements)
    setDirty(false)
    sona.notify('Overlay disimpan. OBS otomatis menerima perubahan.')
  }

  async function addImage() {
    const res = await window.sona.overlay.pickImage()
    if (!res.ok) return
    const id = `el-image-${Date.now().toString(36).slice(-4)}`
    setDirty(true)
    setElements((prev) => [...prev, { id, type: 'image', x: 120, y: 120, width: 320, visible: true, src: res.src }])
    setSelectedId(id)
  }

  const url = sona.overlayState?.url

  return (
    <div className="stack stack--wide">
      <section className="card">
        <div className="card-head">
          <h2>Browser source</h2>
          <span className={`pill ${sona.overlayState?.running ? 'pill--ok' : 'pill--off'}`}>
            {sona.overlayState?.running ? `:${sona.overlayState.port}` : 'mati'}
          </span>
        </div>
        <p className="muted tiny">
          Di OBS: Sources → + → Browser, tempel URL di bawah, resolusi 1920×1080, centang “Shutdown source when not visible”
          mati. Latar transparan, jadi tidak perlu chroma key.
        </p>
        <div className="row">
          <input className="url-box" readOnly value={url ?? 'overlay belum berjalan'} />
          <button
            type="button"
            className="ghost"
            disabled={!url}
            onClick={() => {
              navigator.clipboard?.writeText(url)
              sona.notify('URL overlay dicopy.')
            }}
          >
            copy
          </button>
          <button type="button" className="ghost" onClick={sona.overlayStart}>
            {sona.overlayState?.running ? 'restart' : 'jalankan'}
          </button>
          <button type="button" className="ghost" onClick={sona.overlayStop} disabled={!sona.overlayState?.running}>
            stop
          </button>
        </div>
      </section>

      <div className="grid-designer">
        <section className="card">
          <div className="card-head">
            <h2>Elemen</h2>
            <span className="muted tiny">{elements.length} elemen</span>
          </div>
          <div className="chips">
            {TYPES.map((t) => (
              <button key={t.id} type="button" className="chip" onClick={() => addElement(t.id)}>
                + {t.label}
              </button>
            ))}
            <button type="button" className="chip" onClick={addImage}>
              + gambar
            </button>
          </div>

          <ul className="element-list">
            {elements.map((el) => (
              <li key={el.id} className={el.id === selectedId ? 'element-list--on' : ''}>
                <button type="button" className="element-pick" onClick={() => setSelectedId(el.id)}>
                  <code>{el.type}</code>
                  <span className="muted tiny">
                    {el.x},{el.y} · {el.fontSize ?? 0}px{el.visible === false ? ' · hidden' : ''}
                  </span>
                </button>
                <button type="button" className="ghost tiny-btn" onClick={() => removeElement(el.id)}>
                  ✕
                </button>
              </li>
            ))}
            {!elements.length && <li className="muted tiny">Belum ada elemen.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Preview</h2>
            {dirty && <span className="pill pill--off">belum disimpan</span>}
          </div>
          <div className="preview-frame">
            {url ? (
              <iframe title="preview" src={url} />
            ) : (
              <div className="empty">
                <p className="muted tiny">Jalankan overlay untuk melihat preview.</p>
              </div>
            )}
          </div>
          <div className="row row--end">
            <button type="button" className="primary" onClick={save} disabled={!dirty}>
              simpan overlay
            </button>
          </div>
        </section>
      </div>

      {selected && (
        <section className="card">
          <div className="card-head">
            <h2>Properti · {selected.type}</h2>
          </div>
          <div className="form form-grid">
            {selected.type === 'text' || selected.type === 'alert' || selected.type === 'scene' || selected.type === 'nowplaying' ? (
              <label className="span-2">
                <span>Teks</span>
                <input value={selected.text ?? ''} onChange={(e) => patchElement(selected.id, { text: e.target.value })} />
              </label>
            ) : null}

            {selected.type === 'image' ? (
              <label className="span-2">
                <span>Path gambar</span>
                <input value={selected.src ?? ''} readOnly />
              </label>
            ) : null}

            <label>
              <span>X</span>
              <input type="number" value={selected.x ?? 0} onChange={(e) => patchElement(selected.id, { x: Number(e.target.value) })} />
            </label>
            <label>
              <span>Y</span>
              <input type="number" value={selected.y ?? 0} onChange={(e) => patchElement(selected.id, { y: Number(e.target.value) })} />
            </label>
            <label>
              <span>Lebar</span>
              <input type="number" value={selected.width ?? 400} onChange={(e) => patchElement(selected.id, { width: Number(e.target.value) })} />
            </label>
            <label>
              <span>Font</span>
              <input type="number" value={selected.fontSize ?? 26} onChange={(e) => patchElement(selected.id, { fontSize: Number(e.target.value) })} />
            </label>
            <label>
              <span>Warna</span>
              <input type="color" value={selected.color ?? '#ECEAF4'} onChange={(e) => patchElement(selected.id, { color: e.target.value })} />
            </label>
            {selected.type === 'chat' && (
              <>
                <label>
                  <span>Jumlah baris</span>
                  <input type="number" value={selected.lines ?? 5} onChange={(e) => patchElement(selected.id, { lines: Number(e.target.value) })} />
                </label>
                <label>
                  <span>Warna nama</span>
                  <input type="color" value={selected.accent ?? '#B892FF'} onChange={(e) => patchElement(selected.id, { accent: e.target.value })} />
                </label>
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={selected.visible !== false} onChange={(e) => patchElement(selected.id, { visible: e.target.checked })} />
              <span>tampil</span>
            </label>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Tes alert</h2>
        </div>
        <div className="row">
          {['follow', 'sub', 'raid', 'cheer'].map((kind) => (
            <button key={kind} type="button" className="ghost" onClick={() => window.sona.overlay.alert({ user: 'Penonton', kind })}>
              {kind}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
