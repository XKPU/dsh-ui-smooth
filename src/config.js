/**
 * The host half owns the file at `$DSH_HOME/dsh-ui-smooth.json` and serves it over
 * `/dsh-ui-smooth/config`; the page keeps a copy, publishes it to every listener,
 * and writes back through the same route.
 */

const CONFIG_URL = '/dsh-ui-smooth/config'
const DEBUG_KEY = 'dsh-ui-smooth:debug'

/** Shown in the settings header and reported by the debug handle. */
const VERSION = '1.0.0'

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const DEFAULTS = {
	animations: true,
	backgroundThrottle: true,
	duringStream: true,
	skip: { enabled: true, turns: 3, minutes: 5 },
	unmount: { enabled: true, turns: 5, minutes: 23 },
	release: { enabled: false, turns: 8 }
}

let config = cloneConfig(DEFAULTS)
let hostElectron = false
const configListeners = new Set()

/** Read one tier of the thresholds; anything missing falls back to the default. */
function readTier(source, key) {
	const tier = source?.[key] ?? {}
	return {
		enabled: tier.enabled !== false,
		turns: numberOr(tier.turns, DEFAULTS[key].turns),
		minutes: numberOr(tier.minutes, DEFAULTS[key].minutes)
	}
}

/** The aggressive tier has no age threshold: it keeps a tail and drops the rest. */
function readRelease(source) {
	const tier = source?.release ?? {}
	return {
		enabled: tier.enabled === true,
		turns: Math.max(2, numberOr(tier.turns, DEFAULTS.release.turns))
	}
}

function cloneConfig(source) {
	const base = source !== null && typeof source === 'object' ? source : {}
	return {
		animations: base.animations !== false,
		backgroundThrottle: base.backgroundThrottle !== false,
		duringStream: base.duringStream !== false,
		skip: readTier(base, 'skip'),
		unmount: readTier(base, 'unmount'),
		release: readRelease(base)
	}
}

function numberOr(value, fallback) {
	const number = Number(value)
	if (!Number.isFinite(number) || number < 0) return fallback
	return Math.min(10000, Math.floor(number))
}

function publishConfig(next) {
	config = cloneConfig(next)
	for (const listener of configListeners) {
		try {
			listener(config)
		} catch (reason) {
			/* a settings panel that threw must not stop the rest */
		}
	}
}

async function loadConfig() {
	try {
		const response = await fetch(CONFIG_URL, { headers: { accept: 'application/json' } })
		if (!response.ok) return
		const body = await response.json()
		hostElectron = body?.electron === true
		if (body?.config !== undefined) publishConfig(body.config)
	} catch (reason) {
		/* a page without the host route keeps the defaults */
	}
}

async function saveConfig(patch) {
	publishConfig({ ...config, ...patch })
	try {
		await fetch(CONFIG_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(config)
		})
	} catch (reason) {
		/* the in-memory value still applies; the next page reads the stored one */
	}
}

/** Whether the page asked for the console diagnostics. */
function debugEnabled() {
	try {
		return window.localStorage.getItem(DEBUG_KEY) === '1'
	} catch (reason) {
		return false
	}
}

/** Whether this page runs inside the Electron shell rather than a browser. */
function desktop() {
	try {
		return typeof navigator !== 'undefined' && navigator.userAgent.indexOf('Electron/') >= 0
	} catch (reason) {
		return false
	}
}

/** Subscribe to config changes; returns the unsubscribe. */
function onConfig(listener) {
	configListeners.add(listener)
	return () => configListeners.delete(listener)
}

module.exports = {
	DEFAULTS,
	VERSION,
	cloneConfig,
	debugEnabled,
	desktop,
	getConfig: () => config,
	hostElectron: () => hostElectron,
	loadConfig,
	onConfig,
	publishConfig,
	saveConfig
}
