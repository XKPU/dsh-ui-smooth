# 安全政策

项目的一般说明见 [README.md](../README.md)，使用问题与缺陷报告见 [SUPPORT.md](SUPPORT.md)。

## 支持的版本

| 版本 | 支持状态 |
| --- | --- |
| 最新版本 | :white_check_mark: |
| 任意旧版本 | :x: |

安全修复只进入最新版本，不回溯到旧版本。安全更新通常与常规更新一并发版，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 报告漏洞

**请勿通过公开 Issue 报告安全漏洞。**

请通过以下渠道私下报告：

- GitHub 私密漏洞报告：[https://github.com/XKPU/dsh-ui-smooth/security/advisories/new](https://github.com/XKPU/dsh-ui-smooth/security/advisories/new)
- 邮箱：`knight-z@foxmail.com`（见 [`package.json`](../package.json) 的 `author` 字段）

仓库地址：[https://github.com/XKPU/dsh-ui-smooth](https://github.com/XKPU/dsh-ui-smooth)

### 接收范围

- `dsh-ui-smooth` 自身的缺陷：配置读写、样式注入、轮次回收、设置界面、Electron 后台节流控制。
- 插件引入的本地配置文件权限问题，或 `/dsh-ui-smooth/config` 路由的输入校验问题。

### 不在接收范围

- DSH 本体、Web UI、Electron 或 Chromium 的漏洞，请向对应上游报告。
- 第三方插件的漏洞，请向其维护者报告。

### 请在报告中包含

1. **受影响版本** —— 插件版本、DSH 版本，以及 Web / 桌面端环境。
2. **问题描述** —— 漏洞会造成什么影响。
3. **复现步骤** —— 尽量给出最小复现；如涉及配置，附上相关 JSON 片段（先移除敏感信息）。
4. **可能的修复建议**（如有）。

### 我们的响应流程

- **确认收到** —— 尽快答复，通常在 7 天内。
- **评估与修复** —— 确认后在私下处理，避免披露细节。
- **发布与披露** —— 修复随新版本发布后，在变更记录或安全公告中给出简要说明，并注明报告者（除非你希望匿名）。

在修复发布前，请勿公开披露问题。使用问题、功能建议和一般缺陷请走 [SUPPORT.md](SUPPORT.md) 的渠道。

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
