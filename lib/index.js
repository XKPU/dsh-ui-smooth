/**
 * Host loader entry for dsh-ui-smooth.
 *
 * The page does the work; this half owns the one thing a page cannot do for
 * itself: the config file. Both thresholds live in
 * `$DSH_HOME/dsh-ui-smooth.json` and are served to the page over
 * `/dsh-ui-smooth/config`, so the settings section reads and writes one value
 * that survives a rebuild.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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
	follow: true,
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
		follow: source.follow !== false,
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
	let config = normalizeConfig(DEFAULTS)

	const sync = (next) => {
		config = normalizeConfig(next)
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
						return sendJson(response, 200, { config })
					}
					if (method !== 'POST') return sendJson(response, 405, { status: 'method' })
					const body = await readBody(request)
					if (body === undefined) return sendJson(response, 400, { status: 'invalid' })
					sync(body)
					try {
						await writeConfig(config)
					} catch (reason) {
						return sendJson(response, 500, { status: 'unstored', config })
					}
					return sendJson(response, 200, { config })
				}
			})
		}
	} catch (reason) {
		unregister = undefined
	}

	if (typeof ctx?.effect === 'function') {
		ctx.effect(() => () => {
			if (typeof unregister === 'function') unregister()
		}, 'dsh-ui-smooth: host wiring')
	}
}
