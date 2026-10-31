/** Minimal MediaRecorder wrapper for push-to-talk capture. */
export class Mic {
  #recorder = null
  #chunks = []
  #stream = null
  #mime = ''

  get recording() {
    return this.#recorder?.state === 'recording'
  }

  static supported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
  }

  async start() {
    if (this.recording) return
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    })
    this.#mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) || ''
    this.#chunks = []
    this.#recorder = new MediaRecorder(this.#stream, this.#mime ? { mimeType: this.#mime } : undefined)
    this.#recorder.ondataavailable = (event) => {
      if (event.data?.size) this.#chunks.push(event.data)
    }
    this.#recorder.start(250)
  }

  async stop() {
    if (!this.#recorder) return null
    const recorder = this.#recorder
    await new Promise((resolve) => {
      recorder.onstop = resolve
      recorder.stop()
    })
    this.#stream?.getTracks().forEach((track) => track.stop())
    const blob = new Blob(this.#chunks, { type: this.#mime || 'audio/webm' })
    const buffer = await blob.arrayBuffer()
    this.#recorder = null
    this.#stream = null
    this.#chunks = []
    return { buffer, mime: blob.type || 'audio/webm' }
  }
}
