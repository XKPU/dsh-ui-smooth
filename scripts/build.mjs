/**
 * Bundle src/ into the one client artifact DSH serves.
 *
 * The client module system gives a package exactly one `lib/client.js`
 * (`/plugins/<id>/client.js`), so the sources live as small modules under `src/`
 * and this build inlines them behind a minimal CommonJS registry: `require('./x.js')`
 * resolves inside the bundle, anything else (`react`) is forwarded to the loader.
 *
 * Run `node scripts/build.mjs`; nothing else in the package is generated.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceDir = join(root, 'src')
const target = join(root, 'lib/client.js')
const ENTRY = './main.js'

const names = (await readdir(sourceDir)).filter((name) => name.endsWith('.js')).sort()
if (!names.includes(ENTRY.slice(2))) throw new Error(`src/${ENTRY.slice(2)} is the entry module and must exist`)

const indent = (text, prefix) => text.split('\n').map((line) => (line === '' ? '' : prefix + line)).join('\n')

const modules = []
for (const name of names) {
	const code = (await readFile(join(sourceDir, name), 'utf8')).replace(/\s+$/, '')
	modules.push(`\t\tregistry['./${name}'] = function (module, exports, require) {\n${indent(code, '\t\t\t')}\n\t\t}`)
}

const body = `/**
 * GENERATED FILE — do not edit. Sources live in src/, built by scripts/build.mjs.
 *
 * dsh-ui-smooth — client half.
 *
 * Four jobs, all of them about keeping the Web UI's main thread and heap free:
 *
 * 1. Animation budget. Idle CPU comes from decorative animations that run
 *    forever on properties the renderer cannot composite: \`infinite\` on \`left\`
 *    relayouts its subtree every frame, and \`background-position\` behind
 *    \`background-clip: text\` re-rasterizes glyphs. Those are rewritten onto
 *    \`transform\` (same trajectory) or stepped with \`steps()\`. Finite
 *    animations, composited animations and \`prefers-reduced-motion\` users are
 *    left alone.
 *
 * 2. Transcript recycling. The transcript mounts every entry of the session and
 *    collapsed rows keep their subtrees (\`hidden="until-found"\`), so a long
 *    session costs more on every interaction. Turns that are old *and* have not
 *    been looked at for a while are put behind CSS containment, or detached into
 *    a fragment with their height held. Detaching is as far as the DOM alone can
 *    go: React still holds every node of that subtree.
 *
 * 3. Aggressive release. The only way to hand a turn's memory back is to make
 *    React let go of it, which means unmounting, not detaching. This tier drops
 *    the oldest part of the session's loaded history window through the session
 *    controller's own window API, so React unmounts those turns and their fibers
 *    release the DOM they own. \`hasMore\` stays true, so 加载更早 pages the same
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
			const id = specifier.endsWith('.js') ? specifier : \`\${specifier}.js\`
			const cached = cache[id]
			if (cached !== undefined) return cached.exports
			const factory = registry[id]
			if (factory === undefined) throw new Error(\`dsh-ui-smooth: unknown module \${id}\`)
			const module = { exports: {} }
			cache[id] = module
			factory(module, module.exports, require)
			return module.exports
		}

${modules.join('\n\n')}

		return require('${ENTRY}')
	}
})
`

await writeFile(target, body)
const { count } = { count: body.split('\n').length }
console.log(`lib/client.js <- src/ (${names.length} modules, ${count} lines)`)
