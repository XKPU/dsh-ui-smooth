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
 * Only a prefix goes: a turn is dropped when it sits before the kept tail *and*
 * nothing has looked at it for a while — a turn that was just paged back in
 * stays put until its own quiet period runs out. One warm turn stops the cut
 * there, because everything older goes with it.
 *
 * @param entries - the session's loaded window, oldest first.
 * @param keepTurns - turns to keep at the tail.
 * @param isCold - whether a turn has been out of sight long enough to drop.
 * @returns the slice to keep, or `null` when there is nothing worth dropping.
 */
function sliceHistory(entries, keepTurns, isCold) {
	if (!Array.isArray(entries) || entries.length === 0) return null
	if (!Number.isSafeInteger(keepTurns) || keepTurns < 1) return null
	const starts = []
	const turns = []
	for (let index = 0; index < entries.length; index += 1) {
		const event = entries[index]?.event
		if (event?.type !== 'turn/start') continue
		const turn = Number(event.data?.turn)
		starts.push(index)
		turns.push(Number.isSafeInteger(turn) ? turn : starts.length)
	}
	const droppable = starts.length - keepTurns
	if (droppable < MIN_RELEASED_TURNS) return null
	let cut = -1
	for (let group = 0; group < droppable; group += 1) {
		if (typeof isCold === 'function' && !isCold(turns[group])) break
		cut = group
	}
	if (cut < MIN_RELEASED_TURNS - 1) return null
	return entries.slice(starts[cut + 1])
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
function releaseHistory(service, release, isCold) {
	const keepTurns = release.turns
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
		const kept = sliceHistory(entries, keepTurns, isCold)
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
