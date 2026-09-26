[English](README.md) · **简体中文**

<p align="center">
  <img src="README.png" alt="PhiAI-Player">
</p>

<h1 align="center">PhiAI-Player</h1>

<p align="center">
  <em>一个在浏览器里运行的 Phigros 风格谱面播放器。</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License"></a>
  <a href="https://dvd1145.github.io/PhiAI-Player/"><img src="https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E5%A3%B9%E7%8E%A9-online-brightgreen.svg" alt="在线游玩"></a>
</p>

---

PhiAI-Player 解析 `.pez` / `.pec` / `.json` 谱面包,并在 `<canvas>` 上实时渲染游玩过程——下落音符、判定线、连击、计分、打击音效。任意现代浏览器都能运行,无需安装。

可以[在线游玩](https://dvd1145.github.io/PhiAI-Player/)(GitHub Pages),也可以下载单文件构建版,在本地直接打开。

---

## 演示

游玩带动画视频背景与打击粒子特效的谱面:

<table><tr>
<td width="50%"><img src="assets/demos/wh-1.png" width="100%"></td>
<td width="50%"><img src="assets/demos/wh-2.png" width="100%"></td>
</tr><tr>
<td colspan="2" align="center"><sub>谱面作者: <b>WH_Constantinxx</b> — <a href="https://www.bilibili.com/video/BV1wL411r7dy">发布视频</a></sub></td>
</tr></table>

<table><tr>
<td width="50%"><img src="assets/demos/knyorg-1.png" width="100%"></td>
<td width="50%"><img src="assets/demos/knyorg-2.png" width="100%"></td>
</tr><tr>
<td colspan="2" align="center"><sub>谱面作者: <b>KNYORG</b>《without colorful passion》 — <a href="https://www.bilibili.com/video/BV1AoWZeWEHP">发布视频</a></sub></td>
</tr></table>

<table><tr>
<td width="50%"><img src="assets/demos/pingze-1.png" width="100%"></td>
<td width="50%"><img src="assets/demos/pingze-2.png" width="100%"></td>
</tr><tr>
<td colspan="2" align="center"><sub>谱面作者: <b>平方秒和立方吨</b> — <a href="https://www.bilibili.com/video/BV1LFYYeZEiV">发布视频</a></sub></td>
</tr></table>

---

## 关于名字

项目名来自最初的原型——一个用 LLM 随手拼出来的快速读谱工具。播放器本身不含任何 AI 功能,完全本地运行,谱面不会离开你的设备。

---

## 快速开始

**① 在线游玩** — 打开 <https://dvd1145.github.io/PhiAI-Player/>。

**② 准备谱面** — 任意 `.pez` / `.pec` / `.json` 谱面文件,或一个谱面文件夹。

**③ 开始游戏** — 把文件拖到页面上,或在加载界面点击 **选择文件 / 加载资源包 / 进入谱面文件夹**,再点 **游玩**。支持自动演示。

Windows / macOS / Linux,电脑或手机。

开发者方式:

```bash
git clone https://github.com/DVD1145/PhiAI-Player.git
cd PhiAI-Player
python -m http.server 8000      # 开发版布局
# 打开 http://localhost:8000
node build.js                   # → dist/rpe-player.html(单文件构建)
```

直接双击打开 `index.html` 也可以:内置资源包带有回退副本,核心功能照常可用。

---

## 功能

- **判定阶梯** — `PERFECT` / `GOOD` / `BAD` / `MISS`,含连击、准确度与实时计分
- **游玩方式** — 键盘(任意键打击最近音符)、指针 / 触屏(点击、上划、拖划、长按)
- **谱面格式** — `.pez` / `.pec` / `.json`,单文件或整个文件夹;Phi 格式自动识别并在加载时转换
- **录制** — 录下游玩过程并导出视频(ffmpeg,按需从 CDN 加载)
- **资源包** — `.zip` 包自带音符皮肤、打击音效、歌词(`.lrc` / `.ttml`)与动画 / 视频背景(`extra.json`)
- **特效** — WebGL 后期着色器与粒子打击效果
- 超过 256 MB 的大 `.json` 谱面采用流式解析,避免阻塞界面

---

## LIFE 模式(控制台)

仿 Phigros 4.0.0 的「LIFE 生命值」游玩界面。它是临时游玩特效,不持久化,通过浏览器控制台(`F12`)调用 `lifeMode` 命令切换:

```js
lifeMode()            // 切换开/关
lifeMode(true)        // 开启
lifeMode(false)       // 关闭
lifeMode(100)         // 开启并把 LIFE 数字设为 100(数字可填任意值)
lifeMode(0)           // 开启并把 LIFE 数字设为 0
```

开启后连击区始终显示,标签为 `LIFE`,数字为控制台设置的固定值,黑字红色描边;顶部叠加一层覆盖判定线的黑色渐变遮罩与红色光条特效。关闭后恢复普通游玩界面。

---

## 项目状态

| 状态 | 内容 |
| --- | --- |
| ✅ 可用 | 完整游玩闭环、计分、录制、资源包、特效 |
| 🚧 进行中 | 演示 GIF、更多谱面兼容性边界用例 |

单文件构建(`dist/rpe-player.html`)是可部署产物;本仓库是该文件的源码拆分,便于维护。

> **历史:** 本项目**原名为 AIRE-Player**。旧的"游玩 UI 编辑器"已停用——它维护困难,且可被用于伪造游玩成绩(自定义 HUD 遮挡或替换判定)。相关源文件保留在仓库中供参考,但不再加载。

---

## 贡献

欢迎提交 Issue 与 Pull Request。基础约定:

- 保持现有文件布局(`js/player/` 一文件一职责)
- 修改 JS 后运行 `node --check`
- 确认 `node build.js` 仍能产出可运行的 `dist/rpe-player.html`

## 许可证

GPL-3.0——见 [LICENSE](LICENSE)。内置的第三方库、字体与资源包资源遵循各自的许可证/版权——见 [THIRD_PARTY.md](THIRD_PARTY.md)。