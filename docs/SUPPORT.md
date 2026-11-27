# 支持

项目的一般说明见 [README.md](../README.md)，开发参与见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全漏洞报告见 [SECURITY.md](SECURITY.md)。

## 目录

- [兼容范围](#兼容范围)
- [提问之前](#提问之前)
- [报告问题与建议](#报告问题与建议)
- [诊断信息](#诊断信息)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 兼容范围

| 项目 | 说明 |
| --- | --- |
| 插件版本 | `1.0.0`（见 [`package.json`](../package.json)） |
| DSH | `>=0.2.0 <=0.2.3` |
| 宿主 | Web UI profile；桌面壳由页面 UA 中的 `Electron/` 判定 |
| 浏览器端 | 动画预算、旧轮次回收与「后台不节流」均可用 |

插件是 DSH 插件，不是独立应用，也不会修改 DSH 前端源码。它用注入样式和页面侧脚本工作，依赖 DSH 暴露的 `settings.section` 插槽与 `webServer` 能力。

## 提问之前

### 关于「拖拽窗口 = ResizeObserver 写内联样式 × 昂贵 restyle」

这条机制是真的（实测 20 步 resize 里，同一个元素被写了 80 次自定义属性，其中 **39 次值是重复的**，样式重算动辄 400–800ms、单次约 4.7ms），但**插件没有进行此项修正**：

- 「值相同就不写」的去重，3 组对照下来样式重算中位数 428ms（关）vs 434ms（开），没有任何收益。
- 真正能改的是把 `--dsh-conversation-column-width` 这类变量挂到更窄的容器、或换成 container query，但那应该是宿主侧的改动，插件无法对其产生精确、不破坏页面的改动。

### 「后台不节流」怎么生效

关掉开关后，页面开一段 40 Hz、增益 0.0001 的静音音频流，让 Chromium 不把渲染进程放进后台节流集合；开关打开即关闭音频流。桌面端若宿主确实运行在 Electron 主进程里，会优先使用 `setBackgroundThrottling(false)`，但壳并没有给宿主窗口控制通道，所以页面这一层是实际兜底。是否在壳中由 `navigator.userAgent` 的 `Electron/` 判定，设置项不会置灰。

### 长会话滚回旧轮次会看到空白吗

不会。满足阈值的轮次会先被标记为跳过渲染（`data-ui-smooth="skip"`），更旧的会被摘下子节点并留一个等高占位行（`data-ui-smooth="parked"`）。有 IntersectionObserver 在接近视口时把节点按原顺序装回。以下情况也会先把已卸载的轮次全部装回再重算：

- 修改任一轮次阈值或开关；
- 切回前台；
- 窗口 resize；
- 重新拉取配置后发现变化。

### 流式输出时会不会把正在写的轮次收走

默认会：「流式输出期间回收」开关默认开启，流式输出时仍按阈值处理。关掉该开关后，检测到 `[data-streaming]` 时整轮回收暂停，等这一轮结束再按阈值处理。

### 为什么节点数降了，内存没明显降

「跳过渲染」和「从文档流摘除」减少的是浏览器对子树的布局、样式、绘制和相应缓存；从文档摘下的节点仍由 React 持有，并不是销毁。要真正释放这部分内存，请打开「激进策略：旧轮次从内存卸载」：默认需同时满足「早于 8 轮」和「重新加载后 20 分钟内没再查看过」，才会截断会话控制器已加载的历史窗口、让 React 真正卸载旧轮次，「加载更早」可从磁盘读回。

### 开了插件会不会影响 `prefers-reduced-motion`

不会。动画改写规则整体包在 `@media (prefers-reduced-motion: no-preference)` 内；用户要求减少动态效果时，改写表不生效。

## 报告问题与建议

请优先提交到 [GitHub Issues](https://github.com/XKPU/dsh-ui-smooth/issues)。如果无法使用 Issue，也可以联系维护者：`knight-z@foxmail.com`。

一份有用的报告通常包含：

1. **做了什么** —— 触发问题的操作步骤。
2. **预期结果** 与 **实际结果**。
3. **环境** —— 插件版本、DSH 版本、Web / 桌面端、浏览器与操作系统版本。
4. **配置** —— `window.__dshUiSmooth?.config()` 的返回值。
5. **诊断信息**（可选）—— 打开 `dsh-ui-smooth:debug` 后的控制台输出，或 `window.__dshUiSmooth.status()`。

> 请勿附带会话正文、API Key、Cookie、令牌或其他个人数据。涉及隐私时可以把具体文本替换成占位符。

安全漏洞不要开公开 Issue，见 [SECURITY.md](SECURITY.md)。

## 诊断信息

```js
window.__dshUiSmooth.status()
```

返回值包括：

- `animations`：样式表扫描次数与命中的动画列表；
- `recycling`：当前 `skip` / `parked` 的轮次数；
- `config`：当前配置；
- `electron`：宿主回报是否为 Electron；
- `throttle()`：`host`（宿主回报）、`desktop`（页面 UA 判定）与静音音频流的 `active` / `state`；
- `settingsSection`：已注册的设置插槽 ID。

历史变更见 [CHANGELOG.md](CHANGELOG.md)。

## 参与贡献

欢迎 Issue 讨论、文档修正和 Pull Request。开发环境、测试方法与提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。未完成但方向明确的改动也可以先开草稿 PR，并注明未验证的部分。

## 许可

本项目基于 **GNU General Public License v3.0 Or Later (GPL-3.0-or-later)** 发布。

```
dsh-ui-smooth - 使您的 DSH UI 更流畅。
Copyright (C) 2026 knight

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
