/**
 * Come back to the tail.
 *
 * A hidden window produces no frames, so the transcript keeps growing unseen
 * while the scroll offset stays where the reader left it: the burst that lands
 * on return is added above the viewport, and the newest answer sits below it.
 *
 * A reader who was at the bottom before the window left wanted to see that
 * answer, so returning puts them back on it — one scroll past the frames the
 * renderer queued while hidden, which is after the app's own catch-up. A reader
 * who was somewhere in the history keeps their place: the offset they were
 * reading at is the one thing that must not move.
 */

const { getConfig } = require('./config.js')

const SCROLL_SELECTOR = '[data-conversation-scroll]'

/** Slack allowed when deciding the reader was at the bottom. */
const TAIL_SLACK = 24

function createFollow() {
	/** Whether the reader was at the bottom when the window left; null until it does. */
	let pinned = null

	function remember() {
		if (getConfig().follow === false) {
			pinned = null
			return
		}
		const scroller = document.querySelector(SCROLL_SELECTOR)
		if (scroller === null) {
			pinned = null
			return
		}
		pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= TAIL_SLACK
	}

	function land() {
		const scroller = document.querySelector(SCROLL_SELECTOR)
		if (scroller === null) return
		scroller.scrollTop = scroller.scrollHeight
	}

	function onVisibility() {
		if (document.visibilityState === 'hidden') {
			remember()
			return
		}
		const wasPinned = pinned
		pinned = null
		if (wasPinned !== true) return
		// Two frames: the first lets the app finish the paint it owed the reader,
		// the second lands on the tail that paint produced.
		requestAnimationFrame(() => {
			land()
			requestAnimationFrame(land)
		})
	}

	document.addEventListener('visibilitychange', onVisibility)

	return {
		dispose: () => document.removeEventListener('visibilitychange', onVisibility)
	}
}

module.exports = { createFollow }
