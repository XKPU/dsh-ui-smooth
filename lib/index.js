/**
 * Host loader entry for dsh-ui-smooth.
 *
 * The page does the heavy lifting; this half owns the two things a page cannot
 * do for itself:
 *
 * 1. Background throttling. Chromium stops producing frames for an occluded or
 *    minimized window, so a running agent's output only piles up and the switch
 *    back pays for all of it at once. Electron can turn that off per
 *    `webContents`; browsers cannot, so on a plain web host this is a no-op.
 *
 * 2. The config file. Both thresholds live in `$DSH_HOME/dsh-ui-smooth.json`
 *    and are served to the page over `/dsh-ui-smooth/config`, so the settings
 *    section can read and write one value that survives a rebuild, and the
 *    throttle switch can apply before any page exists.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

export const name = 'dsh-ui-smooth'
/** The route needs the HTTP server; a host without one simply does not mount this plugin. */
export const inject = ['webServer']

const ROUTE = '/dsh-ui-smooth/config'
const FILE_NAME = 'dsh-ui-smooth.json'
const MAX_BODY = 8 * 1024

const DEFAULTS = {
	animations: true,
	backgroundThrottle: true,
	duringStream: true,
	skip: { enabled: true, turns: 3, minutes: 5 },
	unmount: { enabled: true, turns: 5, minutes: 16 },
	release: { enabled: false, turns: 8, minutes: 20 }
}

function configPath() {
	const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
	return join(home, FILE_NAME)
}

function clampNumber(value, fallback, max) {
	const number = Number(value)
	if (!Number.isFinite(number) || number < 0) return fallback
	return Math.min(max, Math.floor(number))
}

/** Accept only the shape the page is allowed to store. */
function normalizeTier(source, key) {
	const tier = source?.[key] ?? {}
	return {
		enabled: tier.enabled !== false,
		turns: clampNumber(tier.turns, DEFAULTS[key].turns, 10000),
		minutes: clampNumber(tier.minutes, DEFAULTS[key].minutes, 10000)
	}
}

/** The aggressive tier keeps a tail of turns and waits out a quiet period. */
function normalizeRelease(source) {
	const tier = source?.release ?? {}
	return {
		enabled: tier.enabled === true,
		turns: Math.max(2, clampNumber(tier.turns, DEFAULTS.release.turns, 10000)),
		minutes: clampNumber(tier.minutes, DEFAULTS.release.minutes, 10000)
	}
}

function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {}
	return {
		animations: source.animations !== false,
		backgroundThrottle: source.backgroundThrottle !== false,
		duringStream: source.duringStream !== false,
		skip: normalizeTier(source, 'skip'),
		unmount: normalizeTier(source, 'unmount'),
		release: normalizeRelease(source)
	}
}

async function readConfig() {
	try {
		const text = await readFile(configPath(), 'utf8')
		return normalizeConfig(JSON.parse(text))
	} catch (reason) {
		return normalizeConfig(DEFAULTS)
	}
}

async function writeConfig(config) {
	const path = configPath()
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/**
 * `electron` resolves only inside the desktop shell's main process. A web or
 * CLI host has no window to un-throttle, which is not an error.
 */
function loadElectron() {
	try {
		const electron = createRequire(import.meta.url)('electron')
		if (electron === null || typeof electron !== 'object') return null
		if (typeof electron.webContents?.getAllWebContents !== 'function') return null
		if (typeof electron.app?.on !== 'function') return null
		return electron
	} catch (reason) {
		return null
	}
}

/**
 * Keep the shell's windows throttled in the background (the Electron default)
 * or let them keep rendering there, for every window the shell owns and for the
 * ones it opens later.
 */
function createThrottleControl(electron) {
	let watch = null
	const applyOne = (contents, throttled) => {
		if (contents === null || contents === undefined) return false
		if (typeof contents.setBackgroundThrottling !== 'function') return false
		if (contents.getType?.() === 'window' && typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return false
		try {
			contents.setBackgroundThrottling(throttled)
			return true
		} catch (reason) {
			return false
		}
	}

	const applyAll = (throttled) => {
		let count = 0
		for (const contents of electron.webContents.getAllWebContents()) {
			if (applyOne(contents, throttled)) count += 1
		}
		return count
	}

	return {
		apply: (throttled) => {
			if (electron === null) return 0
			const base = applyAll(throttled)
			if (watch === null) {
				watch = (_event, contents) => {
					applyOne(contents, state.throttled)
				}
				electron.app.on('web-contents-created', watch)
			}
			state.throttled = throttled
			return base
		},
		dispose: () => {
			if (watch !== null && typeof electron?.app?.removeListener === 'function') {
				electron.app.removeListener('web-contents-created', watch)
				watch = null
			}
		}
	}
}

const state = { throttled: true }

function sendJson(response, status, payload) {
	const body = JSON.stringify(payload)
	response.statusCode = status
	response.setHeader('content-type', 'application/json; charset=utf-8')
	response.setHeader('cache-control', 'no-store')
	response.end(body)
}

function readBody(request) {
	return new Promise((resolve) => {
		const chunks = []
		let size = 0
		request.on('data', (chunk) => {
			size += chunk.length
			if (size > MAX_BODY) {
				resolve(undefined)
				request.destroy()
				return
			}
			chunks.push(chunk)
		})
		request.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
			} catch (reason) {
				resolve(undefined)
			}
		})
		request.on('error', () => resolve(undefined))
	})
}

export function apply(ctx) {
	const electron = loadElectron()
	const throttle = createThrottleControl(electron)
	let config = normalizeConfig(DEFAULTS)

	const sync = (next) => {
		config = normalizeConfig(next)
		// The switch says "throttle me in the background", which is Electron's own
		// default; turning it off is what buys a page that keeps rendering.
		throttle.apply(config.backgroundThrottle)
	}

	readConfig()
		.then((stored) => sync(stored))
		.catch(() => sync(DEFAULTS))

	let unregister
	try {
		const server = ctx?.webServer ?? (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined)
		if (server !== undefined && server !== null && typeof server.register === 'function') {
			unregister = server.register({
				kind: 'exact',
				path: ROUTE,
				handler: async (request, response) => {
					const method = String(request?.method ?? 'GET').toUpperCase()
					if (method === 'GET' || method === 'HEAD') {
						return sendJson(response, 200, { config, electron: electron !== null })
					}
					if (method !== 'POST') return sendJson(response, 405, { status: 'method' })
					const body = await readBody(request)
					if (body === undefined) return sendJson(response, 400, { status: 'invalid' })
					sync(body)
					try {
						await writeConfig(config)
					} catch (reason) {
						return sendJson(response, 500, { status: 'unstored', config, electron: electron !== null })
					}
					return sendJson(response, 200, { config, electron: electron !== null })
				}
			})
		}
	} catch (reason) {
		unregister = undefined
	}

	if (typeof ctx?.effect === 'function') {
		ctx.effect(() => () => {
			if (typeof unregister === 'function') unregister()
			throttle.dispose()
		}, 'dsh-ui-smooth: host wiring')
	}
}
