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
