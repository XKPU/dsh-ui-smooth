/**
 * Unit tests for the dsh-smooth planner.
 *
 * The planner only talks to the CSSOM through a handful of duck-typed members
 * (`cssRules`, `selectorText`, `style`, `name`, `keyText`), so the tests drive
 * it with a small fake that resolves the `animation` shorthand into longhands
 * the way a browser does. No DOM, no browser, no network.
 */

import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/* -------------------------------------------------------------------------- *
 * Fake CSSOM
 * -------------------------------------------------------------------------- */

const TIME = /^-?\d*\.?\d+(ms|s)$/
const EASING = /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps\(.*\)|cubic-bezier\(.*\)|linear\(.*\))$/
const ANIMATION_KEYWORDS = new Set([
  'normal', 'reverse', 'alternate', 'alternate-reverse',
  'none', 'forwards', 'backwards', 'both',
  'running', 'paused', 'infinite'
])

function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  parts.push(current.trim())
  return parts.filter((part) => part !== '')
}

function animationLonghands(shorthand) {
  const names = []
  const durations = []
  const iterations = []
  for (const animation of splitTopLevel(shorthand)) {
    const tokens = []
    let depth = 0
    let current = ''
    for (const character of animation) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (character === ' ' && depth === 0) {
        if (current !== '') tokens.push(current)
        current = ''
        continue
      }
      current += character
    }
    if (current !== '') tokens.push(current)

    let name = ''
    let duration = ''
    let iteration = ''
    const leftovers = []
    for (const token of tokens) {
      if (TIME.test(token) && duration === '') duration = token
      else if (EASING.test(token)) continue
      else if (ANIMATION_KEYWORDS.has(token)) {
        if (token === 'infinite') iteration = token
        else if (token === 'none') continue
        continue
      } else if (/^\d*\.?\d+$/.test(token) && iteration === '') iteration = token
      else leftovers.push(token)
    }
    for (const token of leftovers) {
      if (name === '') name = token
    }
    names.push(name)
    durations.push(duration === '' ? '0s' : duration)
    iterations.push(iteration === '' ? '1' : iteration)
  }
  return {
    'animation-name': names.join(', '),
    'animation-duration': durations.join(', '),
    'animation-iteration-count': iterations.join(', ')
  }
}

class FakeStyle {
  constructor(declarations = {}) {
    this.declarations = { ...declarations }
  }

  get length() {
    return Object.keys(this.declarations).length
  }

  item(index) {
    return Object.keys(this.declarations)[index] ?? null
  }

  getPropertyValue(property) {
    if (Object.hasOwn(this.declarations, property)) return this.declarations[property]
    const shorthand = this.declarations.animation
    if (shorthand !== undefined && property.startsWith('animation-')) {
      return animationLonghands(shorthand)[property] ?? ''
    }
    return ''
  }
}

function styleRule(selectorText, declarations) {
  return { type: 1, selectorText, style: new FakeStyle(declarations) }
}

function keyframesRule(name, frames) {
  return {
    type: 7,
    name,
    cssRules: Object.entries(frames).map(([keyText, declarations]) => ({
      type: 8,
      keyText,
      style: new FakeStyle(declarations)
    })),
    appendRule() {}
  }
}

function sheet(...rules) {
  return { cssRules: rules }
}

function grouping(...rules) {
  return { type: 4, cssRules: rules }
}

/* -------------------------------------------------------------------------- *
 * Load the client module without a DOM
 * -------------------------------------------------------------------------- */

globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      globalThis.__dshUiSmoothExports = factory((name) => {
        if (name === 'react') return { createElement: () => null }
        if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, jsxDEV: () => null }
        throw new Error('the planner must not require any module')
      })
    }
  }
}

const source = await readFile(join(root, 'lib/client.js'), 'utf8')
new Function('window', source)(globalThis.window)
const { planSheets, planSweep, coarsen, classify, readAnimations, sliceHistory } = globalThis.__dshUiSmoothExports.internals

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

const SWEEP_RULE = styleRule('.Row_sweep_abc::after', {
  position: 'absolute',
  left: '-300px',
  width: '300px',
  'background-color': 'transparent',
  'background-image': 'linear-gradient(90deg, transparent, #fff, transparent)',
  animation: '2.6s ease-out infinite dsh-tool-row-sweep'
})

const SWEEP_KEYFRAMES = keyframesRule('dsh-tool-row-sweep', {
  '0%': { left: '-300px' },
  '100%': { left: '100%' }
})

const SHIMMER_RULE = styleRule('.turnStatus_xyz', {
  'background-clip': 'text',
  'background-position': '0% 50%',
  animation: '2.6s ease-in-out infinite retry-shimmer'
})

const SHIMMER_KEYFRAMES = keyframesRule('retry-shimmer', {
  from: { 'background-position': '0% 50%' },
  to: { 'background-position': '100% 50%' }
})

const SPIN_RULE = styleRule('.spinner_q', {
  animation: '1s linear infinite spin'
})

const SPIN_KEYFRAMES = keyframesRule('spin', {
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' }
})

const ENTER_RULE = styleRule('.panel_p', {
  animation: '180ms ease-out reveal'
})

const ENTER_KEYFRAMES = keyframesRule('reveal', {
  from: { transform: 'translateY(4px)', opacity: '0' },
  to: { transform: 'translateY(0)', opacity: '1' }
})

/* -------------------------------------------------------------------------- *
 * Tests
 * -------------------------------------------------------------------------- */

test('a running sweep becomes a composited transform sweep', () => {
  const { css, entries } = planSheets([sheet(SWEEP_RULE, SWEEP_KEYFRAMES)])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'sweep')
  assert.equal(entries[0].selector, '.Row_sweep_abc::after')
  assert.match(css, /\.Row_sweep_abc::after \{/)
  assert.match(css, /left: 0 !important/)
  assert.match(css, /width: 100% !important/)
  assert.match(css, /background-size: 300px 100% !important/)
  assert.match(css, /background-repeat: no-repeat !important/)
  assert.match(css, /animation-name: dsh-ui-smooth-sweep-1 !important/)
  assert.match(css, /@keyframes dsh-ui-smooth-sweep-1 \{/)
  assert.match(css, /0% \{ transform: translateX\(-300px\) \}/)
  assert.match(css, /100% \{ transform: translateX\(100%\) \}/)
  assert.doesNotMatch(css, /left: -300px/)
})

test('override rules stay inside a reduced-motion guard', () => {
  const { css } = planSheets([sheet(SWEEP_RULE, SWEEP_KEYFRAMES)])
  assert.match(css, /^@media \(prefers-reduced-motion: no-preference\) \{/)
})

test('a text shimmer is coarsened with steps() instead of being rerouted', () => {
  const { css, entries } = planSheets([sheet(SHIMMER_RULE, SHIMMER_KEYFRAMES)])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'steps-paint')
  assert.match(css, /animation-name: dsh-ui-smooth-steps-1 !important/)
  assert.match(css, /animation-timing-function: steps\(\d+, end\)/)
  assert.match(css, /background-position: 0% 50%/)
  assert.doesNotMatch(css, /transform/)
})

test('finite entrance animations are left alone', () => {
  const { css, entries } = planSheets([sheet(ENTER_RULE, ENTER_KEYFRAMES)])
  assert.equal(entries.length, 0)
  assert.equal(css, '')
})

test('composited infinite animations are left alone', () => {
  const { css, entries } = planSheets([sheet(SPIN_RULE, SPIN_KEYFRAMES)])
  assert.equal(entries.length, 0)
  assert.equal(css, '')
})

test('only the expensive animation of a multi-animation rule is renamed', () => {
  const rule = styleRule('.Mixed_m', { animation: '1s linear infinite spin, 2.6s ease-in-out infinite retry-shimmer' })
  const { css } = planSheets([sheet(rule, SPIN_KEYFRAMES, SHIMMER_KEYFRAMES)])
  assert.match(css, /animation-name: spin, dsh-ui-smooth-steps-1 !important/)
})

test('a left animation that is not a sweep falls back to steps()', () => {
  const rule = styleRule('.Slider_s', {
    position: 'relative',
    left: '0px',
    width: '40px',
    'background-color': 'red',
    'background-image': 'none',
    animation: '1.2s linear infinite slide'
  })
  const keyframes = keyframesRule('slide', {
    '0%': { left: '0px' },
    '100%': { left: 'calc(100% - 40px)' }
  })
  const { css, entries } = planSheets([sheet(rule, keyframes)])
  assert.equal(entries[0].kind, 'steps-layout')
  assert.match(css, /@keyframes dsh-ui-smooth-steps-1/)
  assert.doesNotMatch(css, /background-size/)
})

test('a pixel-based left sweep keeps every intermediate frame', () => {
  const frames = [
    { offsets: [0], declarations: [['left', '-300px']] },
    { offsets: [0.5], declarations: [['left', '360px']] },
    { offsets: [1], declarations: [['left', '100%']] }
  ]
  const sweep = planSweep('.Sweep_s::after', SWEEP_RULE.style, frames)
  assert.ok(sweep !== null)
  assert.match(sweep.keyframes.body, /50% \{ transform: translateX\(360px\) \}/)
})

test('rules nested in a media query are planned too', () => {
  const { entries } = planSheets([sheet(grouping(SWEEP_RULE, SWEEP_KEYFRAMES))])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'sweep')
})

test('stepped keyframes keep the source declarations and step each interval', () => {
  const keyframes = coarsen('dsh-ui-smooth-steps-9', [
    { offsets: [0], declarations: [['background-position', '0% 50%']] },
    { offsets: [1], declarations: [['background-position', '100% 50%']] }
  ], 2600, 4)
  assert.match(keyframes.body, /0% \{ background-position: 0% 50%; animation-timing-function: steps\(\d+, end\) \}/)
  assert.match(keyframes.body, /100% \{ background-position: 100% 50% \}/)
  const steps = Number(/steps\((\d+), end\)/.exec(keyframes.body)[1])
  assert.ok(steps >= 3 && steps <= 60, `unexpected step count ${steps}`)
})

test('classification separates layout, paint and composited properties', () => {
  assert.equal(classify(new Set(['left'])), 'layout')
  assert.equal(classify(new Set(['background-position'])), 'paint')
  assert.equal(classify(new Set(['transform', 'opacity'])), null)
})

test('the animation shorthand is read as a name, duration and iteration count', () => {
  const animations = readAnimations(SWEEP_RULE.style)
  assert.deepEqual(animations, [{ name: 'dsh-tool-row-sweep', durationMs: 2600, infinite: true }])
})

test('planning twice yields the same document', () => {
  const sheets = [sheet(SWEEP_RULE, SHIMMER_RULE, SPIN_RULE, ENTER_RULE, SWEEP_KEYFRAMES, SHIMMER_KEYFRAMES, SPIN_KEYFRAMES, ENTER_KEYFRAMES)]
  assert.equal(planSheets(sheets).css, planSheets(sheets).css)
})

/* -------------------------------------------------------------------------- *
 * Aggressive release
 * -------------------------------------------------------------------------- */

/** A window made of N turns, each a start plus one message, in seq order. */
function windowOf(turns, preamble = 0) {
  const entries = []
  let seq = 1
  for (let index = 0; index < preamble; index += 1) entries.push({ event: { type: 'session/start', seq: seq++ } })
  for (let turn = 1; turn <= turns; turn += 1) {
    entries.push({ event: { type: 'turn/start', seq: seq++, data: { turn } } })
    entries.push({ event: { type: 'user/message', seq: seq++, data: { turn } } })
  }
  return entries
}

test('a long window keeps only its newest turns', () => {
  const entries = windowOf(40)
  const kept = sliceHistory(entries, 10)
  assert.notEqual(kept, null)
  assert.equal(kept.length, 20, 'ten turns, two entries each')
  assert.equal(kept[0].event.type, 'turn/start')
  assert.equal(kept[0].event.data.turn, 31)
  assert.equal(kept[kept.length - 1], entries[entries.length - 1], 'the tail is untouched')
})

test('the preamble before the first turn is dropped with the old history', () => {
  const entries = windowOf(20, 3)
  const kept = sliceHistory(entries, 5)
  assert.equal(kept[0].event.type, 'turn/start')
  assert.equal(kept[0].event.data.turn, 16)
})

test('a window barely over the tail is left alone', () => {
  assert.equal(sliceHistory(windowOf(13), 10), null, 'three droppable turns are below the floor')
  assert.notEqual(sliceHistory(windowOf(14), 10), null, 'four are worth a page')
})

test('a window shorter than the tail is left alone', () => {
  assert.equal(sliceHistory(windowOf(5), 10), null)
  assert.equal(sliceHistory([], 10), null)
  assert.equal(sliceHistory(null, 10), null)
  assert.equal(sliceHistory(windowOf(40), 0), null)
})
