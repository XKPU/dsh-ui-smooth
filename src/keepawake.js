/**
 * Keep the page running while it is not in front.
 *
 * Every Chromium browser, and the Electron shell around DSH, throttles a
 * renderer whose window is hidden or covered: timers slow to a crawl and frames
 * stop, so a streamed answer piles up and lands in one burst when the reader
 * comes back. A page that is playing audio is exempt from that throttling,
 * wherever it runs, so the switch holds an audio stream open — a 40 Hz
 * oscillator at a gain far below audibility, which adds no sound.
 */

const INAUDIBLE_GAIN = 0.0001
const INAUDIBLE_HZ = 40

const GESTURES = ['pointerdown', 'keydown', 'wheel', 'touchstart']

function createKeepAwake() {
	let context = null
	let source = null
	let waiting = false

	const start = () => {
		if (context !== null) return false
		if (typeof window.AudioContext !== 'function') return false
		try {
			const next = new window.AudioContext()
			const gain = next.createGain()
			gain.gain.value = INAUDIBLE_GAIN
			const oscillator = next.createOscillator()
			oscillator.frequency.value = INAUDIBLE_HZ
			oscillator.connect(gain)
			gain.connect(next.destination)
			oscillator.start()
			context = next
			source = oscillator
			wake()
			return true
		} catch (reason) {
			context = null
			source = null
			return false
		}
	}

	/**
	 * A context built before the page saw a gesture starts suspended, and a
	 * suspended context buys nothing: Chromium only exempts a renderer that is
	 * actually playing. Hold the first gesture and the return to the front as
	 * the moments to ask again.
	 */
	function wake() {
		if (context === null || context.state !== 'suspended') {
			waiting = false
			return
		}
		context.resume().then(() => {
			if (context !== null && context.state === 'running') waiting = false
		}).catch(() => {})
		if (waiting) return
		waiting = true
		for (const name of GESTURES) window.addEventListener(name, wake, { capture: true, once: true, passive: true })
		document.addEventListener('visibilitychange', wake)
	}

	function unwind() {
		for (const name of GESTURES) window.removeEventListener(name, wake, { capture: true })
		document.removeEventListener('visibilitychange', wake)
		waiting = false
	}

	const stop = () => {
		if (context === null) return false
		try {
			source?.stop()
			source?.disconnect()
			context.close()
		} catch (reason) {
			/* a closed context has nothing left to release */
		}
		context = null
		source = null
		unwind()
		return true
	}

	return {
		start,
		stop,
		status: () => ({
			active: context !== null,
			state: context === null ? 'idle' : context.state
		})
	}
}

module.exports = { createKeepAwake }
