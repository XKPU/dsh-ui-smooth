# dsh-ui-smooth

[![npm](https://img.shields.io/npm/v/dsh-ui-smooth?logo=npm)](https://www.npmjs.com/package/dsh-ui-smooth)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-green?logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzg2ODczMTA1MjgwIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjY2MzEiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDE2QzIzOC4wNjYgMTYgMTYgMjM4LjA2NiAxNiA1MTJzMjIyLjA2NiA0OTYgNDk2IDQ5NiA0OTYtMjIyLjA2NiA0OTYtNDk2Uzc4NS45MzQgMTYgNTEyIDE2eiBtMCA4OTZjLTIyMS4wNjQgMC00MDAtMTc4LjkwMi00MDAtNDAwIDAtMjIxLjA2MiAxNzguOTAyLTQwMCA0MDAtNDAwIDIyMS4wNjQgMCA0MDAgMTc4LjkwMiA0MDAgNDAwIDAgMjIxLjA2NC0xNzguOTAyIDQwMC00MDAgNDAweiBtMjE0LjcwMi0yMDIuMTI4Yy0xOS4yMjggMTkuNDI0LTkxLjA2IDgyLjc5Mi0yMDguMTMgODIuNzkyLTE2NC44NiAwLTI4MC45NjgtMTIyLjg1LTI4MC45NjgtMjgzLjEzNCAwLTE1OC4zMDQgMTIwLjU1LTI3OC44MDIgMjc5LjUyNC0yNzguODAyIDExMS4wNjIgMCAxNzcuNDc2IDUzLjI0IDE5NS4xODYgNjkuNTU4YTIzLjkzIDIzLjkzIDAgMCAxIDMuODcyIDMwLjY0NGwtMzYuMzEgNTYuMjI2Yy03LjY4MiAxMS45LTIzLjkzMiAxNC41NjQtMzQuOTk4IDUuODQyLTE3LjE5LTEzLjU1Mi02My42MjgtNDUuMDc2LTEyMy40MTYtNDUuMDc2LTk2LjYwNiAwLTE1NS44MzIgNzAuNjYtMTU1LjgzMiAxNjAuMTY0IDAgODMuMTc4IDUzLjc3NiAxNjcuMzg0IDE1Ni41NTQgMTY3LjM4NCA2NS4zMTQgMCAxMDMuNjg2LTM4LjA3OCAxMzEuNDUyLTU0LjQ1IDEwLjU0LTkuNzE0IDI3LjE5Mi04LjA3OCAzNS42NCAzLjQ3NmwzOS43MyA1NC4zNGEyMy44OTQgMjMuODk0IDAgMCAxLTIuMzA0IDMxLjAzNnoiIGZpbGw9IiNmZmZmZmYiIHAtaWQ9IjY2MzIiPjwvcGF0aD48L3N2Zz4=)](LICENSE)

使您的 DSH UI 更加流畅。

- **空闲动画不再每帧布局/重绘**（默认开启，可关）：`left` 扫光改为同轨迹的 `transform`，`background-clip: text` 上的 `background-position` 微光换成 `steps()`。DSH 自己的旧动画早已优化，这一项主要针对其他插件和后续引入的动画。
- **旧轮次回收**（默认开启，可关）：够旧又够久没查看的轮次整棵跳过渲染；更旧的从文档流里摘除，接近视口时重新填入。流式输出期间是否回收也可以单独关掉。
- **激进档：旧轮次从内存卸载**（默认关闭，默认阈值 8 轮）：把已加载的历史窗口截到最近 N 轮，React 随之真正卸载它们，fiber 与节点的内存一起还给系统；「加载更早」随时从磁盘读回来。
- **后台节流**（默认开启，可关）：关掉之后 DSH 不是前台窗口时界面照常推进，切回来不用等它把积压的输出补完。桌面端宿主可用时优先走 Electron 的窗口接口，否则由页面用听不见的音频流保持渲染进程活跃。

设置入口：**设置 → 流畅性**。

## 目录

- [安装](#安装)
- [文档](#文档)
- [它具体做什么](#它具体做什么)
- [实测](#实测)
- [如果您想自己测量](#如果您想自己测量)
- [卸载](#卸载)
- [许可](#许可)

## 安装

当前宿主声明为 ≥ 0.2.0，≤ 0.2.3。

### 从 npm 安装（推荐）

**DSH Desktop:** 打开 **插件 -> 添加插件**，输入 `dsh-ui-smooth`

**DSH Web：**

```sh
dsh plugin --profile web add dsh-ui-smooth
```

### 从 GitHub 安装

适合想直接跟随 `main` 分支的情况：

**DSH Desktop:** 打开 **插件 -> 添加插件**，输入 `github:XKPU/dsh-ui-smooth`

**DSH Web：**

```sh
dsh plugin --profile web add github:XKPU/dsh-ui-smooth
```

## 文档

- [支持文档](docs/SUPPORT.md)
- [贡献指南](docs/CONTRIBUTING.md)
- [更新日志](docs/CHANGELOG.md)
- [安全政策](docs/SECURITY.md)

## 它具体做什么

### 1. 动画预算

每次样式表变动（首次加载、HMR、插件懒加载）跑一遍计划器：

1. 索引所有 `@keyframes`，按关键帧里出现的属性分成 `layout` / `paint` / 其它。
2. 只处理**无限循环**的动画。入场动画、一次性交互动画不动。
3. 命中 `layout` 且形状是「伪元素 + `left: -Npx → 100%` + 纯图片背景」时改成：伪元素 `width: 100%` + `background-size: Npx 100%` + 新的 `transform: translateX(-Npx) → translateX(100%)` 关键帧。改写后元素宽度等于包含块宽度，百分比与像素都对应同一段位移，**轨迹逐点等价**（6 个采样点实测差 ≤0.01px）。
4. 其余命中 `layout` / `paint` 的，复制原关键帧并给每个区间加 `steps()`：布局类约 8 次/秒，绘制类约 4 次/秒。
5. 生成的规则整段包在 `@media (prefers-reduced-motion: no-preference)` 里。

全部用 `!important` 覆盖，不依赖任何具体类名，对手写 CSS、CSS Modules 哈希类名、第三方插件皮肤同样生效。

扫光本身是「这一行还在跑」的指示，时长、缓动、光带宽度、无限循环都不动，只换驱动属性，所以这层信息不会丢；可访问状态由行首 spinner 与状态文本承担，扫光层是 `aria-hidden` + `inert` 的装饰。

### 2. 旧轮次回收

以正文里的轮次行（`[data-chat-turn]`）为单位，按「够旧 **且** 够久没看」判定：

| 档位 | 条件（默认） | 效果 |
| --- | --- | --- |
| 跳过渲染 `skip` | 早于 3 轮、超过 5 分钟未查看 | `content-visibility: hidden`：整棵子树（含折叠内容）不参与布局、样式与绘制，DOM 还在 React 放的位置 |
| 从文档流摘除 `parked` | 早于 5 轮、超过 23 分钟未查看 | 把这一行的子节点搬进一个游离的 `DocumentFragment`，行本身按测量到的高度原地占位，文档里只剩一个空壳 |

- 是否「进过视口」由 `IntersectionObserver` 记录（前后各 600px 就开始算），滚动、切回前台、窗口 resize 时重算；任何阈值改动会先把已卸载的全部装回，再按新阈值处理。
- 卸载的轮次一接近视口就装回去，顺序与原来一致，所以滚进去不会看到空白，滚动条长度也不跳。
- **流式输出期间是否回收**由「流式输出期间回收」开关决定（默认开启）。关掉后检测到 `[data-streaming]` 就整轮不做回收，等这一轮结束再按阈值处理。
- 卸载的是「文档里的位置」，不是节点对象：React 仍持有那些节点，插件删掉它们会在下一次 reconcile 里炸掉，所以只能摘下再装回。省下的是浏览器的布局、样式、绘制缓存与文档树，**不是内存**。要真把内存还回去，得让 React 自己卸载——见下一档。

### 3. 激进：把旧历史交还磁盘

这一档默认关闭，因为它改变的是「哪些历史已经在内存里」，而不只是渲染方式。

会话的历史本来就是分页加载的（每页最多 500 条、对齐到轮次），所以窗口可以缩回去：插件把已加载窗口截成最近的 N 轮（设置里「激进策略：旧轮次从内存卸载」的阈值，默认 8），交给会话控制器自己的 `installWindow`，React 于是真的卸载被截掉的那些轮次——fiber 消失，fiber 持有的 DOM、监听器、样式与布局缓存一并变成垃圾。随后 `hasMore` 保持为真，界面顶部的「加载更早」会把它们从磁盘原样读回来。

### 4. 后台节流

开关默认开启，保持默认的后台节流。关掉后两层生效：宿主半若确实运行在 Electron 主进程里，优先给每个 `webContents` 调 `setBackgroundThrottling(false)` 并监听新建窗口；但 DSH 的壳没有给宿主任何窗口控制通道（与壳的 IPC 只有 shutdown / quit-inspection / update-tasks），所以页面半同时开一条听不见的音频流——40 Hz 振荡器、增益 0.0001——让 Chromium 不把渲染进程放进后台节流集合。开关打开时音频流随即关闭。

是否在桌面壳中由页面 `navigator.userAgent` 里的 `Electron/` 判定，不再依赖宿主回报，设置项也不会置灰。

## 实测

环境：DSH 0.2.2-rc.5，Edge 158 headless（软件光栅，无 GPU），Windows 11，同一页面同一台机器。

**动画预算**（探针按教程复现两种形态后注入，`Performance.getMetrics` 10 秒差分）：

| 场景 | 布局次数 | 布局耗时 | 主线程占用 |
| --- | --- | --- | --- |
| 280 条扫光，原样 | 1609 | 1977 ms | 8730 ms / 10 s（87%） |
| 280 条扫光，开启插件 | **0** | **0 ms** | **244 ms（2.4%）** |
| 20 条文字微光，原样 | 0 | 0 ms | 1359 ms（14%） |
| 20 条文字微光，开启插件 | 0 | 0 ms | **651 ms（6.5%）** |

**旧轮次回收**（同一个 19.7MB 会话，把历史全部加载到 229 轮之后）：

| | 轮次行 | 文档节点 | 卸载/跳过 |
| --- | --- | --- | --- |
| 不收 | 229 | 143,562 | 0 / 0 |
| 激进阈值下收一遍 | 229 | **55,989（−61%）** | 194 / 5 |

再用真实滚轮上下滚过整段历史：卸载数随滚动回落（93 → 91 → 88 → 87），节点数随之回升（35,899 → 41,892 → 44,334 → 52,536），全程**零 React 异常**——摘下来的节点在被需要时按原顺序装回，行高占位让滚动条长度基本不动（28,236 → 28,252 → 28,279，差值来自亚像素）。

**激进档的真卸载**（另一个会话，53 轮 / 263 行 / 27,401 个事件，全量加载后触发；两次测量都先 `HeapProfiler.collectGarbage` 强制 GC）：

| | 轮次行 | 文档节点 | JS 堆 | 事件监听器 |
| --- | --- | --- | --- | --- |
| 全量窗口 | 263 | 315,601 | 494.9 MB | 21,439 |
| 保留最近 30 轮（阈值调到 30 测的） | 155 | **227,181（−88,420）** | **462.7 MB（−32.2 MB）** | 15,506（−5,933） |

同一页面里前两档把文档节点砍掉 61% 时，堆纹丝不动；这一档砍掉 108 行，堆跟着降了 32 MB——差别只在于 React 这次真的松手了。随后点一次「加载更早」：轮次 30 → 33、事件 19,580 → 20,058，历史原样回来，零异常。

**后台节流**：headless 沙箱里没有窗口，无法在这里给出对照；桌面端宿主可用时走 `webContents.setBackgroundThrottling`，其余情况由页面侧的静音音频流保持渲染进程活跃。

## 如果您想自己测量

```js
window.__dshUiSmooth.status()    // 动画命中项、当前被回收的轮次数、配置、是否桌面端
window.__dshUiSmooth.recycle()   // 立刻跑一遍回收
window.__dshUiSmooth.rescan()    // 立刻重扫样式表
window.__dshUiSmooth.restore()   // 清空动画改写表，做 A/B 对照
localStorage['dsh-ui-smooth:debug'] = '1'
```

CDP 侧用 `Performance.getMetrics` 取差分，看 `TaskDuration`、`LayoutDuration`、`LayoutCount`、`RecalcStyleDuration`。判断是不是动画问题，先比「布局次数/秒」和「rAF 次数/秒」。

## 卸载

在应用的插件管理器中移除，或执行：

```sh
dsh plugin --profile web remove dsh-ui-smooth
```

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
