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
