import { useEffect, useRef } from 'react'

/** Single always-mounted audio element: playback survives tab switches. */
export function MusicDeck() {
  const ref = useRef(null)

  useEffect(() => {
    const audio = ref.current
    if (!audio || !window.sona) return

    const applySink = (sinkId) => {
      if (!sinkId || typeof audio.setSinkId !== 'function') return
      audio.setSinkId(sinkId).catch(() => {})
    }

    const offs = [
      window.sona.on('music:play', ({ item, volume, sinkId }) => {
        if (!item) return
        audio.src = item.path ? `sona-media://track/${encodeURIComponent(item.id)}` : item.url || ''
        audio.volume = Math.max(0, Math.min(1, (Number(volume) || 75) / 100))
        applySink(sinkId)
        audio.play().catch(() => {})
      }),
      window.sona.on('music:pause', () => audio.pause()),
      window.sona.on('music:resume', () => audio.play().catch(() => {})),
      window.sona.on('music:volume', ({ volume }) => {
        audio.volume = Math.max(0, Math.min(1, (Number(volume) || 0) / 100))
      }),
      window.sona.on('music:sink', ({ sinkId }) => applySink(sinkId))
    ]

    const onEnded = () => window.sona.music.ended()
    const onPlay = () => window.sona.music.setPlaying(true)
    const onPause = () => window.sona.music.setPlaying(false)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      offs.forEach((off) => off())
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [])

  return <audio ref={ref} hidden />
}
