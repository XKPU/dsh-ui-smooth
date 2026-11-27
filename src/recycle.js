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

/** How far outside the viewport a row still counts as being looked at. */
const NEAR_BAND = 800

/**
 * Frames kept free of recycling work after the window comes back: the renderer
 * owes that moment to everything it skipped while hidden, and the transcript is
 * the heaviest thing to lay out.
 */
const RESUME_GRACE_MS = 900

const CONTAINMENT_CSS = `
[data-conversation-content] [${ROW_ATTRIBUTE}] {
  box-sizing: border-box;
}
[data-conversation-content] [${ROW_ATTRIBUTE}="skip"] {
  content-visibility: hidden;
  contain-intrinsic-size: auto var(${HEIGHT_PROPERTY}, 320px);
  min-height: var(${HEIGHT_PROPERTY}, 0);
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
	let resumedAt = 0
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

		const fragment = document.createDocumentFragment()
		while (row.firstChild !== null) fragment.appendChild(row.firstChild)
		row.style.setProperty(HEIGHT_PROPERTY, `${Math.max(1, measuredHeight).toFixed(2)}px`)
		row.setAttribute(ROW_ATTRIBUTE, 'parked')
		parked.set(row, fragment)
		return true
	}

	function keepHeight(row, measured) {
		if (!(measured >= 1)) return
		row.style.setProperty(HEIGHT_PROPERTY, `${measured.toFixed(2)}px`)
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
		for (const row of document.querySelectorAll(`[${ROW_ATTRIBUTE}="skip"]`)) {
			row.removeAttribute(ROW_ATTRIBUTE)
			row.style.removeProperty(HEIGHT_PROPERTY)
		}
	}

	function pass() {
		const found = inspect()
		if (found === null) return
		watchNear(found.flow, found.rows)

		const config = getConfig()

		// Streaming is the one moment the app re-renders on its own, so the pass
		// stays away from the transcript unless the reader asked it not to.
		if (!config.duringStream && document.querySelector('[data-streaming]') !== null) return

		// A hidden window paints nothing, so every measurement here would only
		// cost layout for a frame nobody sees — and parking by a box measured
		// while hidden risks a wrong height. The next visible frame re-measures.
		if (document.visibilityState !== 'visible') return

		let newest = 0
		for (const entry of found.rows) newest = Math.max(newest, entry.turn)
		const now = Date.now()
		// The app is still catching up on the frames the hidden window skipped;
		// measuring the transcript in the same window would queue behind it.
		if (now - resumedAt < RESUME_GRACE_MS) {
			schedule(RESUME_GRACE_MS - (now - resumedAt) + 50)
			return
		}
		const skipMinutes = config.skip.minutes * 60000
		const unmountMinutes = config.unmount.minutes * 60000
		const scroller = found.flow.closest('[data-conversation-scroll]')
		const viewport = scroller === null
			? { top: 0, bottom: window.innerHeight }
			: scroller.getBoundingClientRect()

		// Read every box before the first mutation: interleaving the two forces a
		// fresh layout per row, which is the whole transcript's height at once.
		const boxes = new Map()
		const slots = new Map()
		const gap = parseFloat(getComputedStyle(found.flow).rowGap)
		const flowBottom = found.flow.getBoundingClientRect().bottom
		let previous = null
		for (const entry of found.rows) {
			const box = entry.row.getBoundingClientRect()
			boxes.set(entry.row, box)
			// The space a row takes in the flow is not its border box: a turn's
			// children carry margins that collapse through the row and count in the
			// layout without ever landing inside its measured height. Taking the gap
			// to the next row keeps that space, so parking one row moves nothing
			// below it.
			if (previous !== null) slots.set(previous.row, previous.top === null ? box.height : box.top - previous.top - (Number.isFinite(gap) ? gap : 0))
			previous = { row: entry.row, top: box.top }
		}
		if (previous !== null) slots.set(previous.row, flowBottom - previous.top - (Number.isFinite(gap) ? gap : 0))

		let skipped = 0
		let unmounted = 0

		if (warmth.size > 5000) warmth.clear()
		for (const entry of found.rows) {
			const box = boxes.get(entry.row)
			// A row in or near the viewport was just looked at, whatever the
			// observer has had time to report: keep it warm and leave it alone.
			const near = box.bottom > viewport.top - NEAR_BAND && box.top < viewport.bottom + NEAR_BAND
			if (near || !seenAt.has(entry.row)) {
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
				if (!near && box.height >= 1 && park(entry.row, slots.get(entry.row) ?? box.height)) unmounted += 1
				continue
			}

			unpark(entry.row)
			// A row with nothing to measure has nothing to hold open either: skipping
			// it would leave the transcript a 320px placeholder it never had.
			if (skip && box.height >= 1) {
				if (entry.row.getAttribute(ROW_ATTRIBUTE) !== 'skip') {
					keepHeight(entry.row, box.height)
					entry.row.setAttribute(ROW_ATTRIBUTE, 'skip')
				}
				skipped += 1
			} else if (entry.row.hasAttribute(ROW_ATTRIBUTE)) {
				entry.row.removeAttribute(ROW_ATTRIBUTE)
				entry.row.style.removeProperty(HEIGHT_PROPERTY)
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
		// Coming back must not put every parked row back into the document at
		// once: that lays the whole transcript out in one frame, on top of the
		// app's own catch-up. The observer returns only the rows near the
		// viewport, and this pass waits out the grace period first.
		if (document.visibilityState !== 'visible') return
		resumedAt = Date.now()
		schedule(RESUME_GRACE_MS + 200)
	}
	const onResize = () => {
		// Restoring a minimized window fires this, and putting every parked row
		// back here is the same whole-transcript burst the visibility handler
		// used to cause. The heights held for distant rows are stale, but only
		// the ones on screen need a real number now: the near band returns
		// those, and the rest re-measure when they are next looked at.
		resumedAt = Date.now()
		schedule(RESUME_GRACE_MS + 200)
	}
	const mutations = new MutationObserver(() => schedule(400))
	const ticker = setInterval(() => {
		if (document.visibilityState !== 'visible') return
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
