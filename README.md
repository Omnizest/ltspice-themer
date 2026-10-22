# LTspice Themer

[![version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/Omnizest/ltspice-themer/releases)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#下载与使用)

基于 Tauri 2 + Rust + React + TypeScript 的 LTspice 配色管理器。用可视化的方式管理原理图、波形和网表三类配色，写盘前自动备份，界面支持明暗模式，数据全部保存在本地。

不是 Analog Devices 官方产品，也不修改 LTspice 本体，只读写它的 INI 配置。

## 下载与使用

从 [Releases](https://github.com/Omnizest/ltspice-themer/releases) 下载 `LTspiceThemer.exe`（Windows x64，便携版，无需安装），系统需具备 Microsoft Edge WebView2 Runtime，Windows 10/11 通常已自带。

校验下载完整性：

```powershell
Get-FileHash .\LTspiceThemer.exe -Algorithm SHA256
```

结果应与同目录 `SHA256SUMS.txt` 中的值一致。

使用流程：选择主题和 LTspice INI → 验证配置 → 关闭 LTspice → 应用 → 重新打开 LTspice 查看结果。导出会先显示完整内容再确认保存；备份位于所选 INI 旁的 `.ltspice-themer-backups`；用户主题库位于当前用户应用数据目录 `io.github.ltspicethemer.desktop`。

## 功能

- 9 个内置主题，支持 TXT / INI 导入和导出。
- 主题名称、SourceUrl 与 35 项颜色编辑，支持删除自定义主题、恢复内置默认。
- Buck 原理图、局部瞬态波形（V(SW)、I(L1)、I(D1)）与网表三区预览。
- 原理图、波形、网表可独立选择是否应用，默认开启；关闭的类别保留配置当前颜色。
- 应用前自动备份，支持还原、删除和刷新备份。
- 配置写入前检查 LTspice 进程、文件变化与目录锁。

## 开发环境

- Node.js 24 与 npm（22 亦可运行）。
- Rust 1.99.1，由 `rust-toolchain.toml` 固定，`rustup` 会自动拉取。
- Windows Visual Studio 2022 Build Tools：C++ 桌面开发、MSVC 与 Windows SDK。
- WebView2 Runtime。
- Python 3：主题目录校验与测试，仅用标准库。

以下命令在含 `package.json` 的项目目录执行（即仓库根目录）。在 PowerShell 中可用 `npm.cmd` 代替 `npm`。

```sh
npm ci
npm --prefix src-ui ci
npm run tauri dev
```

只调界面时可 `npm run dev` 在浏览器中预览；浏览器模式没有本地文件读写能力。

## 构建

产物是单个便携 EXE，不是安装器。构建产物已被 `.gitignore` 排除，请通过 Releases 分发，不要提交进仓库。

### 方式一：直接调用 Tauri CLI（推荐，最快）

```powershell
npm ci
npm --prefix src-ui ci
npm.cmd run tauri build -- --no-bundle
```

生成的 EXE 位于 `src-tauri\target\release\lt-spice-themer.exe`。首次全量编译约 3 分钟（含依赖下载与 release 优化），之后增量构建明显更快。

### 方式二：一键脚本（额外产出 release 目录与校验值）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_windows.ps1
```

脚本会先准备 MSVC 环境，再执行上面的 Tauri 构建，最后复制为 `release/LTspiceThemer.exe` 并写入 `release/SHA256SUMS.txt`。若目标文件正被占用，会改存为 `LTspiceThemer-Buck.exe`。

脚本通过 `vswhere` 定位 Visual Studio，并把安装路径显式传给 `Launch-VsDevShell.ps1`。这一点很关键：机器上存在多套 Visual Studio 时，不传该参数会触发交互式选择提示，导致非交互或 CI 环境永久挂起且不产生任何编译输出。

## 检查与测试

```sh
python scripts/migrate_themes.py --check
python -m unittest discover -s tests -v
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

Rust 测试需要 MSVC 开发环境，可从 Developer PowerShell 执行。
`scripts/smoke_windows.mjs` 是 Windows WebView 的可选集成测试，需要自行启动启用本机调试端口的测试实例。
部分模式会导入并删除临时主题，应在隔离测试账户或备份主题库后执行，勿对生产数据盲目运行。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| src-ui/src/App.tsx | 主界面、命令调用及状态 |
| src-ui/src/components | 原理图、波形、编辑与确认窗口 |
| src-ui/src/assets/buck.json | 内置电路图元、波形采样及示例网表 |
| src-tauri/src/theme.rs | 主题格式、颜色校验与 TXT 编解码 |
| src-tauri/src/library.rs | 主题库、内置主题恢复与版本升级 |
| src-tauri/src/config.rs | INI 补丁、原子写入、备份与还原 |
| src-tauri/src/lib.rs | Tauri 命令注册 |
| src-tauri/icons | 应用图标资源 |
| themes | 内置主题目录，`builtin.json` 为唯一真源 |
| legacy | 原版主题数据快照，仅用于来源核对；构建和测试不依赖 |
| tests | Python 主题数据测试 |
| scripts | 构建、主题校验与验证脚本 |
| design | 图标候选源文件，供二次修改 |
| release | 本地构建输出的 EXE 与校验值，不纳入版本控制 |

## 二次开发

### 修改内置主题

`themes/builtin.json` 是唯一真源，编译期通过 `include_str!` 嵌入，改完需要重新构建才生效。

1. 直接编辑 `themes/builtin.json`。
2. 运行 `python scripts/migrate_themes.py --check` 校验；不通过时去掉 `--check` 再执行一次，脚本会把文件重写为规范格式。
3. 重新构建。

校验覆盖：9 个主题、每主题恰好 35 个颜色键且顺序固定、取值为 `0..0xFFFFFF` 的整数、名称大小写不敏感去重、SourceUrl 为 `null` 或 HTTP/HTTPS、顶层字段集合严格。

`--from-legacy LTspice-themes.txt` 是可选的单向导入，只做格式转换，用于把原版 txt 转成 json，不会对颜色做任何补丁。

### 修改颜色写入规则

- 颜色为 Windows COLORREF，十进制 `0x00BBGGRR`，不是 RGB 整数；`theme.rs` 里的 `rgb()` 负责转换。
- `config.rs` 只修改已开启类别中的已知颜色项，保留其他配置、注释和受支持的编码（UTF-8 / UTF-16 / ANSI）。
- 写入是原子的，并且会在写入前比对文件是否被外部改动。

### 修改用户主题库的升级行为

`library.rs` 用 `builtinRevision` 记录内置主题版本。改动内置主题时需要考虑三件事：旧库如何升级、用户自己改过的颜色是否保留、删除语义是否一致。当前第 2 版会为 `blackwhite` / `blackred` / `redblack` 补上新的波形与网表配色，同时保留用户对原理图配色的修改，并移除旧的 `matlab` 内置项。

### 修改界面或预览

- 预览是内置静态样例（`src-ui/src/assets/buck.json`），不是 LTspice 实时渲染。
- 普通构建不需要安装 LTspice，也不需要原始 RAW 文件。
- `scripts/generate_buck_preview.py` 是可选资产生成工具，依赖本机 Buck ASC、ASY 与导出的 SQLite 数据；其他开发者需先配置输入路径，不能作为普通构建步骤直接运行。

### 修改图标

候选源为 `design/icon-review/candidate-B2.svg`，已渲染源为 `design/icon-review/icon-B-approved.png`，可用下面的命令重新生成各平台图标：

```sh
npm run tauri icon -- design/icon-review/icon-B-approved.png --output src-tauri/icons
```

若改完图标后 EXE 图标没变，需要让 Cargo 重新执行 `build.rs`（清理对应 target 缓存）后再核对产物。

## 已知限制

- 仅验证 Windows x64 的 INI 写入流程；macOS / Linux（含 Wine 下的 LTspice）尚未验证。
- 预览为静态样例，与真实原理图不会逐像素一致。
- 不负责主题的在线分发，导入导出走本地文件。

## 来源与许可

源代码以 [MIT 许可证](LICENSE) 发布。

部分主题保留原始 SourceUrl；`themes/builtin.json` 的 `sourceFile` 与 `sourceSha256` 记录了来源文件及其摘要，原版快照见 `legacy/LTspice-themes.txt`（可选文件，不参与构建与测试）。应用图标参考 LTspice 的三角与 LT 识别重新绘制；电路预览包含本机 LTspice ASY 图元导出的几何。

第三方主题配色、应用图标与电路图元可能另有授权条件，不在 MIT 许可范围内；二次分发前请自行核对并保留原始 SourceUrl 与声明。

`matlab` 不再作为内置主题，其波形与网表配色已合并进 `builtin.json` 的 blackwhite / blackred / redblack，无需额外的调色板文件。
