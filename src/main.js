/**
 * Module face: install the page halves into one cordis plugin.
 *
 * Everything the page does hangs off this `apply`: the animation stylesheet, the
 * transcript recycler, the settings section, and the debug handle that reports
 * what they are doing.
 */

const { installAnimations } = require('./animate.js')
const { LAYOUT_PROPERTIES, PAINT_PROPERTIES, classify, coarsen, planSheets, planSweep, readAnimations, readKeyframes } = require('./animations.js')
const { VERSION, cloneConfig, getConfig, loadConfig, onConfig } = require('./config.js')
const { createFollow } = require('./follow.js')
const { createKeepAwake } = require('./keepawake.js')
const { CONTAINMENT_CSS, createRecycler } = require('./recycle.js')
const { mainSessions, sliceHistory } = require('./release.js')
const { SETTINGS_CSS, SettingsSection } = require('./settings.js')

const CSS_ID = 'dsh-ui-smooth/css'

function installStyleSheet() {
	if (document.getElementById(CSS_ID) !== null) return
	const element = document.createElement('style')
	element.id = CSS_ID
	element.textContent = `${CONTAINMENT_CSS}\n${SETTINGS_CSS}`
	;(document.head ?? document.documentElement).appendChild(element)
}

function apply(ctx) {
	installStyleSheet()
	const animations = installAnimations()
	const recycler = createRecycler(ctx)
	const follow = createFollow()
	const keepAwake = createKeepAwake()
	const slotIds = () => {
		try {
			return ctx?.slots?.entries?.('settings.section')?.map?.((entry) => entry.id) ?? []
		} catch (reason) {
			return []
		}
	}

	const handle = {
		version: VERSION,
		status: () => ({
			animations: animations.status(),
			recycling: recycler.stats(),
			config: cloneConfig(getConfig()),
			settingsSection: slotIds()
		}),
		rescan: () => animations.rescan(),
		recycle: () => recycler.pass(),
		refreshConfig: () => loadConfig().then(() => {
			recycler.pass()
			return cloneConfig(getConfig())
		}),
		restore: () => animations.restore(),
		config: () => cloneConfig(getConfig()),
		throttle: () => keepAwake.status(),
		/** What the aggressive tier sees: the loaded window it would trim. */
		history: () => {
			const session = mainSessions(ctx?.sessions)[0]
			if (session === undefined || session === null) return null
			let entries = []
			try {
				entries = session.eventSource?.getSnapshot?.()?.entries ?? []
			} catch (reason) {
				entries = []
			}
			return {
				sessionId: session.sessionId,
				entries: entries.length,
				turns: entries.filter((entry) => entry?.event?.type === 'turn/start').length,
				baseSeq: session.baseSeq,
				hasMore: session.hasMore === true
			}
		}
	}
	window.__dshUiSmooth = handle

	/**
	 * The switch reads "throttle me in the background". Off means the page keeps
	 * running there: the host half asks the shell when it is inside one, and the
	 * page holds an inaudible audio stream open for the case where it is not.
	 */
	const syncThrottle = () => {
		// "Do not throttle in the background" is a request the page can honour
		// whatever hosts it: the shell's own escape hatch is out of reach from a
		// Node-mode host, so the audio stream is the only lever, and a browser
		// tab wants the same thing. Asking for it twice would only cost an
		// idle oscillator.
		if (getConfig().backgroundThrottle === false) keepAwake.start()
		else keepAwake.stop()
	}

	onConfig(() => {
		recycler.restoreAll()
		syncThrottle()
	})

	loadConfig().then(() => {
		recycler.pass()
		syncThrottle()
	})

	if (ctx !== undefined && ctx !== null && typeof ctx.slots?.inject === 'function') {
		ctx.slots.inject('settings.section', () =>
			ctx.slots.register({
				name: 'settings.section',
				id: 'dsh-ui-smooth',
				order: 60,
				label: () => '流畅性',
				registrant: 'dsh-ui-smooth'
			}, SettingsSection)
		)
	}

	if (ctx !== undefined && ctx !== null && typeof ctx.effect === 'function') {
		ctx.effect(() => () => {
			animations.dispose()
			follow.dispose()
			keepAwake.stop()
			recycler.dispose()
			const css = document.getElementById(CSS_ID)
			if (css !== null) css.remove()
			if (window.__dshUiSmooth === handle) delete window.__dshUiSmooth
		}, 'dsh-ui-smooth: page passes')
	}
}

exports.apply = apply
exports.inject = ['slots', 'sessions']
exports.internals = {
	LAYOUT_PROPERTIES,
	PAINT_PROPERTIES,
	classify,
	coarsen,
	planSheets,
	planSweep,
	readAnimations,
	readKeyframes,
	sliceHistory
}
