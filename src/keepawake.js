/**
 * Keep the desktop page running while it is not in front.
 *
 * Chromium throttles a hidden renderer, and Electron's own escape hatch —
 * `webContents.setBackgroundThrottling(false)` — lives in the shell's main
 * process. The DSH host is a Node-mode child of that shell with no channel to
 * it, so the host half can configure the switch but cannot reach the window.
 *
 * What a page can do for itself is hold an audio stream open: Chromium keeps a
 * renderer that is playing audio out of the throttled set. The stream here is a
 * 40 Hz oscillator at a gain far below audibility, so it adds no sound.
 */

const INAUDIBLE_GAIN = 0.0001
const INAUDIBLE_HZ = 40

function createKeepAwake() {
	let context = null
	let source = null

	const start = () => {
		if (context !== null) return false
		const AudioContext = window.AudioContext ?? window.webkitAudioContext
		if (typeof AudioContext !== 'function') return false
		try {
			const next = new AudioContext()
			const gain = next.createGain()
			gain.gain.value = INAUDIBLE_GAIN
			const oscillator = next.createOscillator()
			oscillator.frequency.value = INAUDIBLE_HZ
			oscillator.connect(gain)
			gain.connect(next.destination)
			oscillator.start()
			context = next
			source = oscillator
			// A shell that has not seen a gesture yet starts the context suspended.
			if (next.state === 'suspended') next.resume().catch(() => {})
			return true
		} catch (reason) {
			context = null
			source = null
			return false
		}
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
