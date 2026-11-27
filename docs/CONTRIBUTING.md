# 参与贡献

项目的一般说明见 [README.md](../README.md)，使用与问题报告见 [SUPPORT.md](SUPPORT.md)，安全政策见 [SECURITY.md](SECURITY.md)。

## 目录

- [我可以做什么](#我可以做什么)
- [开发环境](#开发环境)
- [代码结构](#代码结构)
- [测试与验证](#测试与验证)
- [提交规范](#提交规范)
- [提交前自查](#提交前自查)
- [许可](#许可)

## 我可以做什么

- **问题报告**：按 [SUPPORT.md](SUPPORT.md) 提供环境、配置和复现步骤。
- **功能建议**：说明使用场景与期望行为，不必附实现。
- **Pull Request**：欢迎任何大小的改动，包括文档与测试。未完成或未经实机验证的改动也可以先开草稿 PR，但请注明状态。

不接受的改动：提交会话数据、API Key、Cookie、调试密钥、构建产物或大体积缓存；复制 DSH Web UI 上游源码进本仓库。

## 开发环境

| 依赖 | 说明 |
| --- | --- |
| Node.js | 支持 ESM 与 `node:test`（建议 20 LTS）；本项目无 npm 运行时依赖 |
| DSH | `>=0.2.0 <=0.2.3`|

仓库地址：[https://github.com/XKPU/dsh-ui-smooth](https://github.com/XKPU/dsh-ui-smooth)。

仓库中没有 `package-lock.json` 或构建脚本，不需要 `npm install` / `npm run build`。插件通过 DSH 的插件系统加载。

本地安装方式见 [README.md 的安装小节](../README.md#安装)：执行 `dsh plugin --profile web add dsh-ui-smooth`，确认 profile 的 `dsh.profile.bundles` 包含 `dsh-ui-smooth`，然后重启 `dsh web`。

## 代码结构

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半：注入 `webServer`，提供 `/dsh-ui-smooth/config`，读写 `$DSH_HOME/dsh-ui-smooth.json` |
| `src/` | 页面半的源码，九个模块，每个不超过 500 行 |
| `src/animations.js` | 动画计划器：属性分类、`steps()` 降采样、扫光改写 |
| `src/animate.js` | 把计划写进页面的那一个 `<style>`，样式表变化后重算 |
| `src/config.js` | 页面半的配置：默认值、归一化、读写 `/dsh-ui-smooth/config` |
| `src/recycle.js` | 旧轮次回收：`skip` 与 `parked` 两档，观察器与调度 |
| `src/release.js` | 激进档：截断已加载窗口并把分页流的头一起挪动 |
| `src/settings.js` | 设置页「流畅性」面板 |
| `src/keepawake.js` | 后台保活：关闭节流时用 40 Hz、增益 0.0001 的 AudioContext 顶住渲染进程，suspended 时等首次手势或切回前台重试播放 |
| `src/follow.js` | 切回前台：若隐藏前停在会话底部则滚回最新消息，否则保持原位置 |
| `src/main.js` | 模块面：`apply`、调试句柄 `window.__dshUiSmooth`、插槽注册与卸载 |
| `lib/client.js` | **构建产物**，不要手改：`npm run build` 由 `scripts/build.mjs` 从 `src/` 生成 |
| `scripts/build.mjs` | 无依赖打包器，把 `src/` 拼成 DSH 只认的那一个 `client.js` |
| `test/engine.test.mjs` | 计划器单测，用假 CSSOM 驱动，不需要浏览器或网络 |
| `cordis.patch.yml` | bundle patch，声明 `dsh-ui-smooth` loader 行 |
| `docs/CHANGELOG.md` | 版本变更记录 |
| `README.md` | 功能说明、实测数据与安装方式 |

关键约定：

- 插件不修改 DSH 前端源码，只注入 `<style>` 和通过 `settings.section` 插槽注册设置界面。
- 动画改写只针对无限循环动画；有限动画、已合成的属性和 `prefers-reduced-motion: reduce` 不动。
- 轮次回收只搬动节点在文档中的位置，不删除 React 持有的节点；流式输出期间不回收。
- 配置不做向后兼容：字段缺失才回落到默认值，旧键名一律忽略。改动配置结构时同步更新宿主半与页面半的归一化。
- 发布时若修改行为，同步更新 `docs/CHANGELOG.md`；若修改版本号，同步 `package.json` 与 `lib/client.js` 中 `handle.version`。

缩进跟随文件现有风格：`src/` 与 `test/` 使用 Tab。

不得直接修改 `lib/client.js`，应在 `src/` 下分模块更改后使用 `scripts/build.mjs` 构建。

## 测试与验证

自动测试：

```bash
npm test
# 或
node test/engine.test.mjs
```

调试输出：

```js
localStorage['dsh-ui-smooth:debug'] = '1'
```

性能对照：`window.__dshUiSmooth.restore()` 清空动画改写，再用 `rescan()` 恢复；CDP 侧可用 `Performance.getMetrics` 比较 `TaskDuration`、`LayoutDuration`、`LayoutCount`、`RecalcStyleDuration`。

## 提交规范

- 首行一句话概括，必要时在正文分点说明动机与影响，例如：
  ```
  修复历史分块后新增轮次不会被回收的问题
  ```
- 一个提交只做一件事；格式化与逻辑改动分开。

## 提交前自查

- [ ] `npm test` 通过
- [ ] 原有功能没有因更改失效
- [ ] 新功能确认可以在 Web UI 与 Desktop 壳中可用
- [ ] 没有把API Key 等敏感信息带进提交

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
