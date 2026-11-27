/**
 * Transcript recycling: keep old turns out of the render path.
 *
 * Two tiers, both gated on "old enough and cold enough". `skip` asks the browser
 * to stop rendering the subtree (`content-visibility: hidden`); `unmount` moves
 * the row's nodes into a detached fragment and holds its measured height, so the
 * transcript does not jump, and puts them back before the row can scroll into
 * view. Neither frees memory: React still owns every node.
 */

const { debugEnabled, getConfig, loadConfig } = require('./config.js')
const { releaseHistory } = require('./release.js')

/* ------------------------------------------------------------------ *
 * Transcript recycling
 * ------------------------------------------------------------------ */

const ROW_ATTRIBUTE = 'data-ui-smooth'
const HEIGHT_PROPERTY = '--ui-smooth-height'

const CONTAINMENT_CSS = `
[data-conversation-content] [${ROW_ATTRIBUTE}="skip"] {
  content-visibility: hidden;
  contain-intrinsic-size: auto 320px;
}
[data-conversation-content] [${ROW_ATTRIBUTE}="parked"] {
  display: block;
  min-height: var(${HEIGHT_PROPERTY}, 40px);
}
`

/**
 * Two tiers, both gated on "old enough and cold enough" — a turn has to
 * be more than N turns behind the newest one *and* have been out of the
 * viewport for M minutes:
 *
 *   skip     the browser stops rendering the subtree (`content-visibility:
 *            hidden`), which drops its layout, style and paint work while
 *            the DOM stays where React put it.
 *   unmount  the subtree's nodes are moved out of the document into a
 *            detached fragment, and the row keeps its measured height, so
 *            the transcript does not jump. Scrolling anywhere near the
 *            row puts the nodes back before it can be seen.
 *
 * Nothing is destroyed: React still owns the nodes, and a plugin that
 * deleted them would fail the next time React reconciles that subtree.
 * Detaching is the furthest a plugin can go, and it does drop the
 * browser's per-node layout and style bookkeeping along with the paint.
 */
function createRecycler(ctx) {
	const seenAt = new WeakMap()
	/** When each turn was last mounted or looked at; outlives the row itself. */
	const warmth = new Map()
	const parked = new WeakMap()
	let root = null
	let nearObserver = null
	let timer = 0
	let idleHandle = 0
	let releases = 0

	/** The top-level flow and the turn rows directly inside it. */
	function inspect() {
		const flow = document.querySelector('[data-conversation-content] [data-chat-flow]')
		if (flow === null) return null
		const rows = []
		const candidates = flow.querySelectorAll('[data-chat-turn]')
		for (const row of candidates) {
			if (row.closest('[data-chat-flow]') !== flow) continue
			const turn = Number(row.getAttribute('data-chat-turn'))
			if (!Number.isSafeInteger(turn)) continue
			rows.push({ row, turn })
		}
		return rows.length === 0 ? null : { flow, rows }
	}

	function watchNear(flow, rows) {
		const scroller = flow.closest('[data-conversation-scroll]')
		if (nearObserver === null || root !== scroller) {
			if (nearObserver !== null) nearObserver.disconnect()
			nearObserver = new IntersectionObserver((records) => {
				for (const record of records) {
					if (!record.isIntersecting) continue
					const seen = Date.now()
					seenAt.set(record.target, seen)
					const turn = Number(record.target.getAttribute('data-chat-turn'))
					if (Number.isSafeInteger(turn)) warmth.set(turn, seen)
					unpark(record.target)
					record.target.removeAttribute(ROW_ATTRIBUTE)
				}
			}, { root: scroller ?? null, rootMargin: '600px 0px 600px 0px' })
			root = scroller ?? null
		}
		// History arrives in chunks, so rows appear long after the observer was
		// built: observe on every pass or the late ones are never watched and
		// their parked content is never released.
		for (const entry of rows) nearObserver.observe(entry.row)
	}

	/**
	 * Move a turn's content out of the document, keeping its height so the
	 * scroll position and every measurement around it stay stable.
	 */
	function park(row, measuredHeight) {
		if (parked.has(row)) return false
		if (row.contains(document.activeElement)) return false
		const selection = window.getSelection()
		const anchor = selection === null || selection === undefined ? null : selection.anchorNode
		if (anchor !== null && row.contains(anchor)) return false

		const height = Math.round(measuredHeight)
		const fragment = document.createDocumentFragment()
		while (row.firstChild !== null) fragment.appendChild(row.firstChild)
		row.style.setProperty(HEIGHT_PROPERTY, `${Math.max(1, height)}px`)
		row.setAttribute(ROW_ATTRIBUTE, 'parked')
		parked.set(row, fragment)
		return true
	}

	/** Put a parked turn's content back where it was. */
	function unpark(row) {
		const fragment = parked.get(row)
		if (fragment === undefined) return false
		while (fragment.firstChild !== null) row.appendChild(fragment.firstChild)
		row.style.removeProperty(HEIGHT_PROPERTY)
		if (row.getAttribute(ROW_ATTRIBUTE) === 'parked') row.removeAttribute(ROW_ATTRIBUTE)
		parked.delete(row)
		return true
	}

	/** Put everything back: the cheapest safe answer to any doubt. */
	function restoreAll() {
		for (const row of document.querySelectorAll(`[${ROW_ATTRIBUTE}="parked"]`)) unpark(row)
		for (const row of document.querySelectorAll(`[${ROW_ATTRIBUTE}="skip"]`)) row.removeAttribute(ROW_ATTRIBUTE)
	}

	function pass() {
		const found = inspect()
		if (found === null) return
		watchNear(found.flow, found.rows)

		const config = getConfig()

		// Streaming is the one moment the app re-renders on its own, so the pass
		// stays away from the transcript unless the reader asked it not to.
		if (!config.duringStream && document.querySelector('[data-streaming]') !== null) return

		let newest = 0
		for (const entry of found.rows) newest = Math.max(newest, entry.turn)
		const now = Date.now()
		const skipMinutes = config.skip.minutes * 60000
		const unmountMinutes = config.unmount.minutes * 60000
		const scroller = found.flow.closest('[data-conversation-scroll]')
		const viewport = scroller === null ? null : scroller.getBoundingClientRect()
		let skipped = 0
		let unmounted = 0

		if (warmth.size > 5000) warmth.clear()
		for (const entry of found.rows) {
			if (!seenAt.has(entry.row)) {
				seenAt.set(entry.row, now)
				warmth.set(entry.turn, now)
			}
			const age = newest - entry.turn
			const cold = now - (seenAt.get(entry.row) ?? 0)
			const unmount = config.unmount.enabled
				&& age > config.unmount.turns
				&& age > config.skip.turns
				&& cold > unmountMinutes
			const skip = config.skip.enabled
				&& age > config.skip.turns
				&& cold > skipMinutes

			if (unmount) {
				if (entry.row.getAttribute(ROW_ATTRIBUTE) === 'parked') {
					unmounted += 1
					continue
				}
				// One read answers both questions: how tall is it, and is it far
				// enough from the viewport that nothing on screen moves.
				const box = entry.row.getBoundingClientRect()
				const near = viewport !== null && box.bottom > viewport.top - 800 && box.top < viewport.bottom + 800
				if (!near && park(entry.row, box.height)) unmounted += 1
				continue
			}

			unpark(entry.row)
			if (skip) {
				if (entry.row.getAttribute(ROW_ATTRIBUTE) !== 'skip') entry.row.setAttribute(ROW_ATTRIBUTE, 'skip')
				skipped += 1
			} else if (entry.row.hasAttribute(ROW_ATTRIBUTE)) {
				entry.row.removeAttribute(ROW_ATTRIBUTE)
			}
		}

		if (config.release.enabled) {
			const quietMs = config.release.minutes * 60000
			releases += releaseHistory(ctx?.sessions, config.release, (turn) => now - (warmth.get(turn) ?? 0) > quietMs)
		}

		if (debugEnabled()) {
			console.info(`[dsh-ui-smooth] ${skipped} turn(s) not rendered, ${unmounted} turn(s) parked outside the document, ${releases} window trim(s) total`, config)
		}
	}

	function schedule(delayMs) {
		if (idleHandle !== 0 || timer !== 0) return
		const run = () => {
			idleHandle = 0
			timer = 0
			pass()
		}
		if (typeof requestIdleCallback === 'function') {
			idleHandle = requestIdleCallback(run, { timeout: Math.max(500, delayMs) })
		} else {
			timer = setTimeout(run, delayMs)
		}
	}

	const onScroll = () => schedule(150)
	const onVisibility = () => {
		if (document.visibilityState !== 'visible') return
		restoreAll()
		schedule(0)
	}
	const onResize = () => {
		restoreAll()
		schedule(200)
	}
	const mutations = new MutationObserver(() => schedule(400))
	const ticker = setInterval(() => {
		loadConfig().then(() => schedule(0))
	}, 30000)

	document.addEventListener('scroll', onScroll, { capture: true, passive: true })
	document.addEventListener('visibilitychange', onVisibility)
	window.addEventListener('resize', onResize)
	mutations.observe(document.body, { childList: true, subtree: true })
	schedule(0)

	return {
		pass: () => pass(),
		restoreAll: () => restoreAll(),
		stats: () => ({
			skipped: document.querySelectorAll(`[${ROW_ATTRIBUTE}="skip"]`).length,
			parked: document.querySelectorAll(`[${ROW_ATTRIBUTE}="parked"]`).length,
			released: releases
		}),
		dispose: () => {
			restoreAll()
			if (nearObserver !== null) nearObserver.disconnect()
			mutations.disconnect()
			clearInterval(ticker)
			if (timer !== 0) clearTimeout(timer)
			if (idleHandle !== 0 && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
			document.removeEventListener('scroll', onScroll, { capture: true })
			document.removeEventListener('visibilitychange', onVisibility)
			window.removeEventListener('resize', onResize)
		}
	}
}

module.exports = { CONTAINMENT_CSS, createRecycler }
