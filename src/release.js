/**
 * React owns the transcript, so a plugin that deletes nodes fails the next
 * reconcile. The one safe way to free them is to make React unmount those turns,
 * and the session controller already knows how: replace its loaded window with a
 * shorter one, then move the paging stream`s head with it so 加载更早 can bring the
 * history back from disk.
 */

/* ------------------------------------------------------------------ *
 * Aggressive release
 * ------------------------------------------------------------------ */

/**
 * Never bother dropping fewer turns than this: the next 加载更早 brings a
 * whole page (up to 500 messages) back, so a one-turn trim would only buy
 * a refetch loop.
 */
const MIN_RELEASED_TURNS = 4

/**
 * Cut a loaded history window down to its newest `keepTurns` turns.
 *
 * @param entries - the session's loaded window, oldest first.
 * @param keepTurns - turns to keep at the tail.
 * @returns the slice to keep, or `null` when there is nothing worth dropping.
 */
function sliceHistory(entries, keepTurns) {
	if (!Array.isArray(entries) || entries.length === 0) return null
	if (!Number.isSafeInteger(keepTurns) || keepTurns < 1) return null
	const starts = []
	for (let index = 0; index < entries.length; index += 1) {
		if (entries[index]?.event?.type === 'turn/start') starts.push(index)
	}
	if (starts.length - keepTurns < MIN_RELEASED_TURNS) return null
	const cut = starts[starts.length - keepTurns]
	if (cut <= 0) return null
	return entries.slice(cut)
}

/** The sessions the main view is showing (a retained session may also be a background one). */
function mainSessions(service) {
	const sessions = []
	if (service === undefined || service === null) return sessions
	let snapshot
	try {
		snapshot = service.list?.getSnapshot?.()
	} catch (reason) {
		return sessions
	}
	for (const [id, row] of Object.entries(snapshot?.byId ?? {})) {
		if ((row?.retainedBy?.mainView ?? 0) === 0) continue
		try {
			const session = service.manager?.get?.(id)
			if (session !== undefined && session !== null) sessions.push(session)
		} catch (reason) {
			/* a session still opening simply is not a candidate yet */
		}
	}
	return sessions
}

/**
 * Hand the oldest turns back to the disk.
 *
 * React owns the transcript, so a node a plugin deletes comes back as a
 * `NotFoundError` on the next reconcile. The one safe way to free those
 * nodes is to make React itself unmount the turns, and the session
 * controller already knows how: replace its loaded window with a shorter
 * one. `hasMore` stays true, so the app offers 加载更早 for exactly the
 * history that was dropped.
 *
 * A session that is streaming is left alone: the answer is still being written
 * into its tail, and trimming under it would move the page the reader is
 * watching. Everything else is fair game, wherever the reader has scrolled to.
 *
 * @returns how many sessions were trimmed.
 */
function releaseHistory(service, keepTurns) {
	let released = 0
	for (const session of mainSessions(service)) {
		if (session.openState !== 'open') continue
		if (session.running === true || session.loadingOlder === true) continue
		if (typeof session.installWindow !== 'function') continue
		let entries
		try {
			entries = session.eventSource?.getSnapshot?.()?.entries
		} catch (reason) {
			continue
		}
		const kept = sliceHistory(entries, keepTurns)
		if (kept === null) continue
		try {
			session.installWindow(kept, true)
		} catch (reason) {
			if (typeof console !== 'undefined') console.warn('[dsh-ui-smooth] release failed:', reason)
			continue
		}
		// The paging stream keeps its own idea of the oldest seq it holds,
		// and prepend drops every record newer than that idea. Move it with
		// the window or the dropped history can never be paged back.
		const stream = session.events
		if (stream !== null && stream !== undefined && 'firstCursor' in stream) {
			stream.firstCursor = kept[0]?.event?.seq
		}
		released += 1
	}
	return released
}

module.exports = { mainSessions, releaseHistory, sliceHistory }
