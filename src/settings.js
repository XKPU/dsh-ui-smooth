/**
 * The 流畅性 settings panel.
 *
 * Rendered into the app's own settings section slot, so it inherits the shell's
 * tokens and needs no portal of its own. Every switch here maps to one field of
 * the shared config, and each card states what the switch does to the page.
 */

const react = require('react')
const h = react.createElement

const { VERSION, cloneConfig, getConfig, hostElectron, onConfig, saveConfig } = require('./config.js')

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
	const electron = hostElectron()
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
