/**
 * Keep the page running while it is not in front.
 *
 * Chromium backgrounds a renderer whose window is hidden or covered: timers
 * fall to one tick a second and frames stop, so a streamed answer piles up and
 * lands in one burst when the reader returns. A page that is playing audio is
 * exempt from that, so this holds a tone that adds no sound and keeps the
 * context awake, since it can be suspended at any time.
 */

const TONE_HZ = 40
/**
 * Chromium calls a stream audible at -72.25 dBFS of power, so the tone has to
 * stay above that: a 0.002 amplitude sine measures about -63 dBFS, which clears
 * the floor while staying far below anything a speaker reproduces.
 */
const TONE_GAIN = 0.002
const GUARD_MS = 15000
const PROBE_MS = 500
const GESTURES = ['pointerdown', 'keydown', 'wheel', 'touchstart']

function createKeepAwake() {
	let context = null
	let oscillator = null
	let guard = 0
	let probe = 0
	let last = 0
	let worst = 0
	let waiting = false

	const start = () => {
		if (context !== null) return false
		if (typeof window.AudioContext !== 'function') return false
		try {
			const next = new window.AudioContext()
			const gain = next.createGain()
			gain.gain.value = TONE_GAIN
			const tone = next.createOscillator()
			tone.frequency.value = TONE_HZ
			tone.connect(gain)
			gain.connect(next.destination)
			tone.start()
			context = next
			oscillator = tone
			guard = setInterval(wake, GUARD_MS)
			probe = setInterval(tick, PROBE_MS)
			wake()
			return true
		} catch (reason) {
			context = null
			oscillator = null
			return false
		}
	}

	function tick() {
		const now = performance.now()
		if (last !== 0) worst = Math.max(worst, Math.round(now - last))
		last = now
	}

	function wake() {
		if (context === null || context.state === 'running') {
			unlisten()
			return
		}
		context.resume().catch(() => {})
		if (waiting) return
		waiting = true
		for (const name of GESTURES) window.addEventListener(name, wake, { capture: true, once: true, passive: true })
		document.addEventListener('visibilitychange', wake)
	}

	function unlisten() {
		if (!waiting) return
		waiting = false
		for (const name of GESTURES) window.removeEventListener(name, wake, { capture: true })
		document.removeEventListener('visibilitychange', wake)
	}

	const stop = () => {
		if (context === null) return false
		try {
			oscillator?.stop()
			oscillator?.disconnect()
			context.close()
		} catch (reason) {
			/* a closed context has nothing left to release */
		}
		clearInterval(guard)
		clearInterval(probe)
		context = null
		oscillator = null
		guard = 0
		probe = 0
		last = 0
		worst = 0
		unlisten()
		return true
	}

	return {
		start,
		stop,
		status: () => ({
			active: context !== null,
			state: context === null ? 'idle' : context.state,
			/** Longest wait a 500ms timer has actually had: ~500 means the page is not throttled. */
			gap: worst
		})
	}
}

module.exports = { createKeepAwake }
