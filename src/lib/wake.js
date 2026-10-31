/**
 * Always-listening wake gate. A cheap RMS gate decides when speech starts and
 * ends, then the utterance is handed to the configured STT endpoint. Detection
 * of the wake phrase happens on the transcript, so it works with any local
 * whisper server and stays entirely on the machine.
 */
export class WakeListener {
  #audio = null
  #stream = null
  #analyser = null
  #recorder = null
  #chunks = []
  #timer = null
  #speaking = false
  #silenceStart = 0
  #speechStart = 0
  #onUtterance
  #opts

  constructor({ phrase = 'sona', threshold = 0.055, silenceMs = 850, maxUtteranceMs = 9000, onUtterance }) {
    this.phrase = String(phrase || 'sona').toLowerCase()
    this.#opts = { threshold, silenceMs, maxUtteranceMs }
    this.#onUtterance = onUtterance
    this.listening = false
  }

  static supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined'
  }

  async start() {
    if (this.listening) return true
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    })
    this.#audio = new AudioContext()
    const source = this.#audio.createMediaStreamSource(this.#stream)
    this.#analyser = this.#audio.createAnalyser()
    this.#analyser.fftSize = 1024
    source.connect(this.#analyser)

    this.#recorder = new MediaRecorder(this.#stream, { mimeType: pickMime() })
    this.#recorder.ondataavailable = (event) => {
      if (event.data?.size) this.#chunks.push(event.data)
    }
    this.#recorder.onstop = async () => {
      const blob = new Blob(this.#chunks, { type: this.#recorder.mimeType || 'audio/webm' })
      this.#chunks = []
      if (blob.size > 2000) this.#onUtterance?.(blob)
    }

    this.listening = true
    this.#timer = setInterval(() => this.#tick(), 60)
    return true
  }

  stop() {
    this.listening = false
    clearInterval(this.#timer)
    this.#timer = null
    if (this.#recorder?.state === 'recording') {
      try {
        this.#recorder.stop()
      } catch {
        /* ignore */
      }
    }
    this.#stream?.getTracks().forEach((track) => track.stop())
    this.#audio?.close().catch(() => {})
    this.#stream = null
    this.#audio = null
    this.#analyser = null
    this.#speaking = false
  }

  #tick() {
    if (!this.#analyser || !this.#recorder) return
    const buffer = new Uint8Array(this.#analyser.fftSize)
    this.#analyser.getByteTimeDomainData(buffer)
    let sum = 0
    for (const value of buffer) {
      const centered = (value - 128) / 128
      sum += centered * centered
    }
    const rms = Math.sqrt(sum / buffer.length)
    const now = Date.now()

    if (rms > this.#opts.threshold) {
      this.#silenceStart = 0
      if (!this.#speaking) {
        this.#speaking = true
        this.#speechStart = now
        this.#chunks = []
        if (this.#recorder.state !== 'recording') this.#recorder.start(200)
      }
      return
    }

    if (!this.#speaking) return
    if (!this.#silenceStart) this.#silenceStart = now
    const silentFor = now - this.#silenceStart
    const spokenFor = now - this.#speechStart
    if (silentFor > this.#opts.silenceMs || spokenFor > this.#opts.maxUtteranceMs) {
      this.#speaking = false
      this.#silenceStart = 0
      if (this.#recorder.state === 'recording') this.#recorder.stop()
    }
  }
}

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? ''
}
