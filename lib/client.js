/**
 * GENERATED FILE — do not edit. Sources live in src/, built by scripts/build.mjs.
 *
 * dsh-ui-smooth — client half.
 *
 * Four jobs, all of them about keeping the Web UI's main thread and heap free:
 *
 * 1. Animation budget. Idle CPU comes from decorative animations that run
 *    forever on properties the renderer cannot composite: `infinite` on `left`
 *    relayouts its subtree every frame, and `background-position` behind
 *    `background-clip: text` re-rasterizes glyphs. Those are rewritten onto
 *    `transform` (same trajectory) or stepped with `steps()`. Finite
 *    animations, composited animations and `prefers-reduced-motion` users are
 *    left alone.
 *
 * 2. Transcript recycling. The transcript mounts every entry of the session and
 *    collapsed rows keep their subtrees (`hidden="until-found"`), so a long
 *    session costs more on every interaction. Turns that are old *and* have not
 *    been looked at for a while are put behind CSS containment, or detached into
 *    a fragment with their height held. Detaching is as far as the DOM alone can
 *    go: React still holds every node of that subtree.
 *
 * 3. Aggressive release. The only way to hand a turn's memory back is to make
 *    React let go of it, which means unmounting, not detaching. This tier drops
 *    the oldest part of the session's loaded history window through the session
 *    controller's own window API, so React unmounts those turns and their fibers
 *    release the DOM they own. `hasMore` stays true, so 加载更早 pages the same
 *    history back from disk.
 *
 * 4. Settings. Every threshold and the desktop background-throttle switch live
 *    in one config owned by the host half, edited in Settings → 流畅性.
 */

window.__ModuleLoader__.load({
	id: 'dsh-ui-smooth',
	factory: (requireExternal) => {
		const registry = {}
		const cache = {}

		function require(specifier) {
			if (!specifier.startsWith('.')) return requireExternal(specifier)
			const id = specifier.endsWith('.js') ? specifier : `${specifier}.js`
			const cached = cache[id]
			if (cached !== undefined) return cached.exports
			const factory = registry[id]
			if (factory === undefined) throw new Error(`dsh-ui-smooth: unknown module ${id}`)
			const module = { exports: {} }
			cache[id] = module
			factory(module, module.exports, require)
			return module.exports
		}

		registry['./animate.js'] = function (module, exports, require) {
			/**
			 * The page keeps adding stylesheets, so the plan is rebuilt whenever one arrives
			 * and the result lives in a single injected stylesheet.
			 */

			const { debugEnabled, getConfig, onConfig } = require('./config.js')
			const { planSheets } = require('./animations.js')

			const STYLE_ID = 'dsh-ui-smooth/animations'

			function pageSheets(own) {
				const sheets = []
				const adopted = document.adoptedStyleSheets
				if (adopted !== undefined && adopted !== null) {
					for (const sheet of adopted) sheets.push(sheet)
				}
				const list = document.styleSheets
				for (let index = 0; index < list.length; index += 1) {
					const sheet = list[index]
					if (sheet === own) continue
					sheets.push(sheet)
				}
				return sheets
			}

			function installAnimations() {
				const element = document.createElement('style')
				element.id = STYLE_ID
				element.setAttribute('data-dsh-ui-smooth', '')
				const host = document.head ?? document.documentElement
				host.appendChild(element)

				const state = { entries: [], css: '', scans: 0 }
				let scheduled = false
				let disposed = false

				/** The switch is on by default; off means the page's own animations stay as written. */
				const enabled = () => getConfig().animations !== false

				const clear = () => {
					if (state.css === '') return
					state.css = ''
					state.entries = []
					element.textContent = ''
				}

				const run = () => {
					if (disposed) return
					if (!enabled()) {
						clear()
						return
					}
					const plan = planSheets(pageSheets(element.sheet))
					state.entries = plan.entries
					state.scans += 1
					if (plan.css !== state.css) {
						state.css = plan.css
						element.textContent = plan.css
					}
					if (debugEnabled()) {
						console.info(`[dsh-ui-smooth] ${plan.entries.length} idle animation(s) moved off the layout/paint path`, plan.entries)
					}
				}

				const schedule = () => {
					if (scheduled || disposed || !enabled()) return
					scheduled = true
					requestAnimationFrame(() => {
						scheduled = false
						run()
					})
				}

				const observer = new MutationObserver((records) => {
					for (const record of records) {
						if (record.target === element) continue
						for (const node of record.addedNodes ?? []) {
							if (node === element) continue
							if (node.nodeType === 1) {
								const tag = node.tagName
								if (tag === 'STYLE' || tag === 'LINK') return schedule()
							}
						}
						for (const node of record.removedNodes ?? []) {
							if (node !== element && node.nodeType === 1) {
								const tag = node.tagName
								if (tag === 'STYLE' || tag === 'LINK') return schedule()
							}
						}
					}
				})
				observer.observe(host, { childList: true, subtree: true })

				const onResource = (event) => {
					if (event.target instanceof HTMLLinkElement) schedule()
				}
				document.addEventListener('load', onResource, true)
				document.addEventListener('error', onResource, true)

				const stopListening = onConfig(() => {
					if (enabled()) schedule()
					else clear()
				})

				run()
				schedule()

				return {
					status: () => ({ scans: state.scans, entries: state.entries.slice() }),
					rescan: () => {
						run()
						return state.entries.slice()
					},
					restore: () => {
						element.textContent = ''
						state.css = ''
						state.entries = []
					},
					dispose: () => {
						disposed = true
						stopListening()
						observer.disconnect()
						document.removeEventListener('load', onResource, true)
						document.removeEventListener('error', onResource, true)
						element.remove()
					}
				}
			}

			module.exports = { installAnimations }
		}

		registry['./animations.js'] = function (module, exports, require) {
			/**
			 * Animation budget: find the expensive idle animations and rewrite the rule.
			 *
			 * Only `infinite` animations are touched. A sweep on the layout path becomes the
			 * same trajectory on `transform`; everything else is stepped down to a rate the
			 * renderer can afford. Finite, composited and reduced-motion animations are left
			 * exactly as they are.
			 */

			/**
			 * Update rates kept for a coarsened animation. A layout update is cheap per
			 * sample and visibly choppy when under-sampled, so it keeps more steps; a
			 * paint-path shimmer re-rasterizes its glyphs on every update, so it is stepped
			 * harder.
			 */
			const LAYOUT_UPDATES_PER_SECOND = 8
			const PAINT_UPDATES_PER_SECOND = 4

			/* ------------------------------------------------------------------ *
			 * Property classification
			 * ------------------------------------------------------------------ */

			const LAYOUT_PROPERTIES = new Set([
				'left', 'right', 'top', 'bottom', 'inset',
				'inset-block', 'inset-block-start', 'inset-block-end',
				'inset-inline', 'inset-inline-start', 'inset-inline-end',
				'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
				'inline-size', 'block-size', 'min-inline-size', 'min-block-size', 'max-inline-size', 'max-block-size',
				'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
				'margin-block', 'margin-block-start', 'margin-block-end',
				'margin-inline', 'margin-inline-start', 'margin-inline-end',
				'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
				'padding-block', 'padding-block-start', 'padding-block-end',
				'padding-inline', 'padding-inline-start', 'padding-inline-end',
				'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
				'gap', 'row-gap', 'column-gap', 'flex-basis',
				'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
				'font-size', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
				'column-width', 'column-count'
			])

			const PAINT_PROPERTIES = new Set([
				'background', 'background-image', 'background-position',
				'background-position-x', 'background-position-y', 'background-size'
			])

			/* ------------------------------------------------------------------ *
			 * CSSOM helpers
			 * ------------------------------------------------------------------ */

			function splitList(value) {
				const parts = []
				let depth = 0
				let current = ''
				for (const character of value ?? '') {
					if (character === '(') depth += 1
					else if (character === ')') depth = Math.max(0, depth - 1)
					if (character === ',' && depth === 0) {
						parts.push(current.trim())
						current = ''
						continue
					}
					current += character
				}
				if (current.trim() !== '') parts.push(current.trim())
				return parts
			}

			function at(list, index) {
				if (list.length === 0) return ''
				return list[index % list.length]
			}

			function parseTime(value) {
				const match = /^(-?\d*\.?\d+)(ms|s)$/.exec((value ?? '').trim())
				if (match === null) return 0
				const amount = Number(match[1])
				return match[2] === 'ms' ? amount : amount * 1000
			}

			function pixelValue(value) {
				const match = /^(-?\d*\.?\d+)px$/.exec((value ?? '').trim())
				return match === null ? null : Number(match[1])
			}

			function declarationEntries(style) {
				const entries = []
				if (style === undefined || style === null) return entries
				const count = typeof style.length === 'number' ? style.length : 0
				for (let index = 0; index < count; index += 1) {
					const property = style.item === undefined ? style[index] : style.item(index)
					if (typeof property !== 'string' || property === '') continue
					entries.push([property, style.getPropertyValue(property)])
				}
				return entries
			}

			function readAnimations(style) {
				const names = splitList(style.getPropertyValue('animation-name'))
				if (names.length === 0) return []
				const durations = splitList(style.getPropertyValue('animation-duration'))
				const iterations = splitList(style.getPropertyValue('animation-iteration-count'))
				return names.map((name, index) => ({
					name,
					durationMs: parseTime(at(durations, index)),
					infinite: at(iterations, index).trim() === 'infinite'
				}))
			}

			function keyframeOffsets(keyText) {
				return splitList(keyText).map((token) => {
					const trimmed = token.toLowerCase()
					if (trimmed === 'from') return 0
					if (trimmed === 'to') return 1
					const match = /^(-?\d*\.?\d+)%$/.exec(trimmed)
					return match === null ? null : Number(match[1]) / 100
				})
			}

			function readKeyframes(rule) {
				const frames = []
				const frames_ = rule.cssRules ?? []
				for (let index = 0; index < frames_.length; index += 1) {
					const frame = frames_[index]
					const offsets = keyframeOffsets(frame.keyText ?? '')
					if (offsets.length === 0 || offsets.some((offset) => offset === null)) continue
					frames.push({ offsets, declarations: declarationEntries(frame.style) })
				}
				frames.sort((left, right) => left.offsets[0] - right.offsets[0])
				return frames
			}

			function animatedProperties(frames) {
				const properties = new Set()
				for (const frame of frames) {
					for (const [property] of frame.declarations) properties.add(property)
				}
				return properties
			}

			function classify(properties) {
				for (const property of properties) {
					if (LAYOUT_PROPERTIES.has(property)) return 'layout'
				}
				for (const property of properties) {
					if (PAINT_PROPERTIES.has(property)) return 'paint'
				}
				return null
			}

			/* ------------------------------------------------------------------ *
			 * Animation repairs
			 * ------------------------------------------------------------------ */

			function stepCount(durationMs, updatesPerSecond) {
				const duration = durationMs > 0 ? durationMs : 2600
				return Math.min(60, Math.max(3, Math.round((duration / 1000) * updatesPerSecond)))
			}

			function coarsen(name, frames, durationMs, updatesPerSecond) {
				const total = stepCount(durationMs, updatesPerSecond)
				const body = []
				for (let index = 0; index < frames.length; index += 1) {
					const frame = frames[index]
					const next = frames[index + 1]
					const declarations = frame.declarations.map(([property, value]) => `${property}: ${value}`)
					if (next !== undefined) {
						const share = Math.max(0, (next.offsets[0] ?? 1) - (frame.offsets[0] ?? 0))
						const steps = Math.max(2, Math.round(total * (share === 0 ? 1 : share)))
						declarations.push(`animation-timing-function: steps(${steps}, end)`)
					}
					const selectorText = frame.offsets.map((offset) => `${round(offset * 100)}%`).join(', ')
					body.push(`  ${selectorText} { ${declarations.join('; ')} }`)
				}
				return { name, body: body.join('\n') }
			}

			function round(value) {
				return Math.round(value * 10000) / 10000
			}

			function planSweep(selector, style, frames) {
				if (!/::?(after|before)\s*$/.test(selector)) return null

				const properties = animatedProperties(frames)
				if (properties.size !== 1 || !properties.has('left')) return null
				if (frames.length < 2) return null

				const values = []
				for (const frame of frames) {
					const left = frame.declarations.find(([property]) => property === 'left')
					if (left === undefined) return null
					values.push(left[1].trim())
				}

				const start = pixelValue(values[0])
				if (start === null || start >= 0) return null
				if (!/^100%$/.test(values[values.length - 1])) return null
				for (const value of values.slice(1, -1)) {
					if (pixelValue(value) === null && !/^-?\d*\.?\d+%$/.test(value)) return null
				}

				const base = new Map(declarationEntries(style))
				const position = (base.get('position') ?? '').trim()
				if (position !== 'absolute' && position !== 'fixed') return null
				const backgroundImage = (base.get('background-image') ?? '').trim()
				if (backgroundImage === '' || backgroundImage === 'none') return null
				const backgroundColor = (base.get('background-color') ?? '').trim()
				if (backgroundColor !== '' && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)') return null

				const bandWidth = pixelValue(base.get('width') ?? '')
				const width = bandWidth === null ? Math.abs(start) : bandWidth
				if (width <= 0) return null

				return {
					declarations: [
						'left: 0 !important',
						'width: 100% !important',
						`background-size: ${width}px 100% !important`,
						'background-repeat: no-repeat !important'
					],
					keyframes: {
						body: frames
							.map((frame) => {
								const left = frame.declarations.find(([property]) => property === 'left')[1].trim()
								const selectorText = frame.offsets.map((offset) => `${round(offset * 100)}%`).join(', ')
								return `  ${selectorText} { transform: translateX(${left}) }`
							})
							.join('\n')
					}
				}
			}

			function isKeyframesRule(rule) {
				if (rule === null || typeof rule !== 'object') return false
				if (rule.type === 7) return true
				return typeof rule.name === 'string' && typeof rule.appendRule === 'function'
			}

			function isStyleRule(rule) {
				if (rule === null || typeof rule !== 'object') return false
				if (typeof rule.selectorText !== 'string' || rule.style === undefined) return false
				return rule.selectorText.trim() !== ''
			}

			function walkRules(rules, visit) {
				for (let index = 0; index < rules.length; index += 1) {
					const rule = rules[index]
					if (rule === null || typeof rule !== 'object') continue
					visit(rule)
					const nested = rule.cssRules
					if (nested !== undefined && nested !== null && nested.length > 0 && !isKeyframesRule(rule)) {
						walkRules(nested, visit)
					}
				}
			}

			function planSheets(sheets) {
				const keyframesByName = new Map()
				const styleRules = []

				for (const sheet of sheets) {
					let rules
					try {
						rules = sheet.cssRules
					} catch (reason) {
						continue
					}
					if (rules === undefined || rules === null) continue
					walkRules(rules, (rule) => {
						if (isKeyframesRule(rule)) {
							keyframesByName.set(rule.name, rule)
							return
						}
						if (isStyleRule(rule)) styleRules.push(rule)
					})
				}

				const entries = []
				const blocks = []
				let generated = 0

				for (const rule of styleRules) {
					const animations = readAnimations(rule.style)
					if (animations.length === 0) continue

					const patches = []
					for (const animation of animations) {
						if (!animation.infinite) continue
						const keyframes = keyframesByName.get(animation.name)
						if (keyframes === undefined) continue
						const frames = readKeyframes(keyframes)
						const kind = classify(animatedProperties(frames))
						if (kind === null) continue

						if (kind === 'layout' && animations.length === 1) {
							const sweep = planSweep(rule.selectorText, rule.style, frames)
							if (sweep !== null) {
								generated += 1
								patches.push({
									animation,
									kind: 'sweep',
									name: `dsh-ui-smooth-sweep-${generated}`,
									declarations: sweep.declarations,
									keyframes: sweep.keyframes
								})
								continue
							}
						}

						generated += 1
						patches.push({
							animation,
							kind: kind === 'layout' ? 'steps-layout' : 'steps-paint',
							name: `dsh-ui-smooth-steps-${generated}`,
							declarations: [],
							keyframes: coarsen(
								`dsh-ui-smooth-steps-${generated}`,
								frames,
								animation.durationMs,
								kind === 'layout' ? LAYOUT_UPDATES_PER_SECOND : PAINT_UPDATES_PER_SECOND
							)
						})
					}

					if (patches.length === 0) continue

					const renamed = new Map(patches.map((patch) => [patch.animation.name, patch.name]))
					const declarations = patches.flatMap((patch) => patch.declarations)
					declarations.push(`animation-name: ${animations.map((animation) => renamed.get(animation.name) ?? animation.name).join(', ')} !important`)

					blocks.push(`${rule.selectorText} {\n  ${declarations.join(';\n  ')};\n}`)
					for (const patch of patches) blocks.push(`@keyframes ${patch.name} {\n${patch.keyframes.body}\n}`)

					for (const patch of patches) {
						entries.push({ selector: rule.selectorText, animation: patch.animation.name, kind: patch.kind })
					}
				}

				const css = blocks.length === 0
					? ''
					: `@media (prefers-reduced-motion: no-preference) {\n${blocks.join('\n')}\n}\n`

				return { css, entries }
			}

			module.exports = {
				LAYOUT_PROPERTIES,
				PAINT_PROPERTIES,
				classify,
				coarsen,
				planSheets,
				planSweep,
				readAnimations,
				readKeyframes
			}
		}

		registry['./config.js'] = function (module, exports, require) {
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
		}

		registry['./keepawake.js'] = function (module, exports, require) {
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
		}

		registry['./main.js'] = function (module, exports, require) {
			/**
			 * Module face: install the page halves into one cordis plugin.
			 *
			 * Everything the page does hangs off this `apply`: the animation stylesheet, the
			 * transcript recycler, the settings section, and the debug handle that reports
			 * what they are doing.
			 */

			const { installAnimations } = require('./animate.js')
			const { LAYOUT_PROPERTIES, PAINT_PROPERTIES, classify, coarsen, planSheets, planSweep, readAnimations, readKeyframes } = require('./animations.js')
			const { VERSION, cloneConfig, desktop, getConfig, hostElectron, loadConfig, onConfig } = require('./config.js')
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
						electron: hostElectron(),
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
					throttle: () => ({ host: hostElectron(), desktop: desktop(), ...keepAwake.status() }),
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
					const off = getConfig().backgroundThrottle === false
					if (off && (hostElectron() || desktop())) keepAwake.start()
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
		}

		registry['./recycle.js'] = function (module, exports, require) {
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
								seenAt.set(record.target, Date.now())
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

					for (const entry of found.rows) {
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
						releases += releaseHistory(ctx?.sessions, config.release.turns)
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
		}

		registry['./release.js'] = function (module, exports, require) {
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
		}

		registry['./settings.js'] = function (module, exports, require) {
			/**
			 * The 流畅性 settings panel.
			 *
			 * Rendered into the app's own settings section slot, so it inherits the shell's
			 * tokens and needs no portal of its own. Every switch here maps to one field of
			 * the shared config, and each card states what the switch does to the page.
			 */

			const react = require('react')
			const h = react.createElement

			const { VERSION, cloneConfig, desktop, getConfig, hostElectron, onConfig, saveConfig } = require('./config.js')

			function Switch({ checked, disabled, onChange }) {
				return h('button', {
					type: 'button',
					role: 'switch',
					'aria-checked': checked ? 'true' : 'false',
					disabled: disabled === true,
					className: `uis-switch${checked ? ' is-on' : ''}`,
					onClick: () => onChange(!checked)
				}, h('span', { className: 'uis-knob' }))
			}

			function NumberField({ value, min, max, suffix, onChange }) {
				return h('label', { className: 'uis-number' },
					h('input', {
						type: 'number',
						value: String(value),
						min: String(min),
						max: String(max),
						onChange: (event) => {
							const next = Number(event.target.value)
							if (!Number.isFinite(next)) return
							onChange(Math.min(max, Math.max(min, Math.floor(next))))
						}
					}),
					suffix !== undefined ? h('span', { className: 'uis-suffix' }, suffix) : null
				)
			}

			function Card({ title, hint, control, children }) {
				return h('div', { className: 'uis-card' }, [
					h('div', { className: 'uis-row' }, [
						h('div', { className: 'uis-text' }, [
							h('div', { className: 'uis-title' }, title),
							hint === undefined ? null : h('div', { className: 'uis-hint' }, hint)
						]),
						control
					]),
					children === undefined ? null : h('div', { className: 'uis-thresholds' }, children)
				])
			}

			function SettingsSection() {
				const [state, setState] = react.useState(getConfig)
				const electron = hostElectron() || desktop()
				react.useEffect(() => onConfig((next) => setState(cloneConfig(next))), [])

				const patch = (next) => {
					saveConfig(next)
					setState((current) => cloneConfig({ ...current, ...next }))
				}
				const patchTier = (key, changes) => patch({ [key]: { ...state[key], ...changes } })
				const toggle = (key) => h(Switch, {
					checked: state[key],
					onChange: (checked) => patch({ [key]: checked })
				})

				return h('div', { className: 'uis-section' }, [
					h('div', { className: 'uis-head' }, [
						h('span', { className: 'uis-brand' }, 'DSH-UI-Smooth'),
						h('span', { className: 'uis-version' }, `v${VERSION}`)
					]),
					h(Card, {
						title: '启用动画优化',
						hint: '降低无限循环动画布局/重绘次数。DSH 已经对自身的旧动画进行了优化，此项主要解决其他插件/后续引入的动画每帧布局/重绘问题。',
						control: toggle('animations')
					}),

					h(Card, {
						title: '后台节流',
						hint: electron
							? '当关闭后 DSH 不是前台窗口时仍然保持界面照常推进，这样的好处是可以在切换回前台窗口时不用一次性加载积压的内容，保证观感流畅。'
							: '当关闭后 DSH 不是前台窗口时仍然保持界面照常推进，这样的好处是可以在切换回前台窗口时不用一次性加载积压的内容，保证观感流畅。该项仅在 Electron 壳的桌面端有效。',
						control: h(Switch, {
							checked: state.backgroundThrottle,
							disabled: !electron,
							onChange: (checked) => patch({ backgroundThrottle: checked })
						})
					}),

					h(Card, {
						title: '流式输出期间回收',
						hint: '在流式输出期间仍按下方阈值处理。',
						control: toggle('duringStream')
					}),

					h(Card, {
						title: '旧轮次跳过渲染',
						hint: '当满足以下设置条件时，将不再渲染该条目的子树，在滚动接近时恢复渲染。',
						control: h(Switch, {
							checked: state.skip.enabled,
							onChange: (checked) => patchTier('skip', { enabled: checked })
						}),
						children: [
							h(NumberField, {
								value: state.skip.turns, min: 1, max: 200, suffix: '轮以前',
								onChange: (turns) => patchTier('skip', { turns })
							}),
							h('span', { className: 'uis-label' }, '且'),
							h(NumberField, {
								value: state.skip.minutes, min: 1, max: 1440, suffix: '分钟未查看',
								onChange: (minutes) => patchTier('skip', { minutes })
							})
						]
					}),

					h(Card, {
						title: '旧轮次从文档流摘除',
						hint: '当满足以下设置条件时，将条目从文档流摘除，在滚动接近时重新填入。',
						control: h(Switch, {
							checked: state.unmount.enabled,
							onChange: (checked) => patchTier('unmount', { enabled: checked })
						}),
						children: [
							h(NumberField, {
								value: state.unmount.turns, min: 1, max: 500, suffix: '轮以前',
								onChange: (turns) => patchTier('unmount', { turns })
							}),
							h('span', { className: 'uis-label' }, '且'),
							h(NumberField, {
								value: state.unmount.minutes, min: 1, max: 4320, suffix: '分钟未查看',
								onChange: (minutes) => patchTier('unmount', { minutes })
							})
						]
					}),

					h(Card, {
						title: '激进策略：旧轮次从内存卸载',
						hint: '当满足以下设置条件时，将条目从内存卸载，重新加载需要从硬盘获取。',
						control: h(Switch, {
							checked: state.release.enabled,
							onChange: (checked) => patch({ release: { ...state.release, enabled: checked } })
						}),
						children: [
							h(NumberField, {
								value: state.release.turns, min: 2, max: 500, suffix: '轮以前',
								onChange: (turns) => patch({ release: { ...state.release, turns } })
							})
						]
					})
				])
			}

			const SETTINGS_CSS = `
			.uis-section { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
			.uis-head { display: flex; align-items: baseline; gap: 8px; }
			.uis-brand { font-weight: 600; letter-spacing: .01em; }
			.uis-version { color: var(--dsw-alias-label-tertiary, inherit); font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }
			.uis-card { border: 1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.24)); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
			.uis-row { display: flex; align-items: flex-start; gap: 16px; justify-content: space-between; }
			.uis-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
			.uis-title { font-weight: 600; }
			.uis-hint { color: var(--dsw-alias-label-tertiary, inherit); line-height: 1.5; }
			.uis-thresholds { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary, inherit); }
			.uis-label { white-space: nowrap; }
			.uis-number { display: inline-flex; align-items: center; gap: 4px; }
			.uis-number input { width: 62px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.32)); background: var(--dsw-alias-fill-secondary, transparent); color: inherit; font: inherit; }
			.uis-suffix { color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; }
			.uis-switch { width: 38px; height: 22px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.32)); background: var(--dsw-alias-fill-secondary, rgba(127,127,127,.2)); padding: 2px; cursor: pointer; flex: none; transition: background .15s ease; }
			.uis-switch.is-on { background: var(--dsw-alias-state-success-primary, #3b82f6); border-color: transparent; }
			.uis-switch:disabled { opacity: .5; cursor: not-allowed; }
			.uis-knob { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
			.uis-switch.is-on .uis-knob { transform: translateX(16px); }
			`

			module.exports = { SETTINGS_CSS, SettingsSection }
		}

		return require('./main.js')
	}
})
