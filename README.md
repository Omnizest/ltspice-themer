# AT LTSPICE THEMER

基于 Tauri 2、Rust、React 和 TypeScript 的 Windows LTspice 配色管理器。界面支持明暗模式，数据保存在本地。

## 功能

- 9 个内置主题，支持 TXT / INI 导入和导出。
- 主题名称、SourceUrl、35 项颜色编辑，删除与内置主题恢复默认。
- Buck 原理图、局部瞬态波形和网表预览，波形显示 V(SW)、I(L1)、I(D1)。
- 原理图、波形、网表独立应用开关，默认开启；关闭类别保留配置当前颜色。
- 应用前自动备份，支持还原、删除和刷新备份。
- 配置写入前检查 LTspice 进程、文件变化与目录锁。

## 使用

下载发布页提供的 Windows x64 EXE，系统需安装 Microsoft Edge WebView2 Runtime。
选择主题和 LTspice INI，验证配置，关闭 LTspice 后应用；重新打开 LTspice 查看结果。
导出先显示完整内容，再确认保存。备份位于所选 INI 旁的 `.ltspice-themer-backups`。
主题库位于当前用户应用数据目录 `io.github.ltspicethemer.desktop`。
本项目预览是内置静态样例，不是 LTspice 实时渲染窗口；目前主要验证 Windows INI 流程。

## 开发环境

- Node.js 24 与 npm。
- Rust 1.99.1（由 rust-toolchain.toml 固定）。
- Windows Visual Studio 2022 Build Tools：C++ 桌面工具、MSVC 和 Windows SDK。
- WebView2 Runtime。
- Python 3：主题目录生成及测试使用标准库。

以下命令在含 package.json 的项目目录执行。PowerShell 可用 npm.cmd 代替 npm。

```sh
npm ci
npm --prefix src-ui ci
npm run tauri dev
```

仅查看前端：`npm run dev`；浏览器模式不提供本地配置读写。

## 构建

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_windows.ps1
```

生成 `release/LTspiceThemer.exe` 和 SHA256SUMS.txt。原文件被占用时，脚本可能另存为 LTspiceThemer-Buck.exe。
这是便携可执行文件，不是安装器。构建产物不应提交到源码仓库，建议通过 Releases 发布。

## 检查

```sh
python scripts/migrate_themes.py --check
python -m unittest discover -s tests -v
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

Rust 测试需要 MSVC 开发环境；可从 Developer PowerShell 执行。
`scripts/smoke_windows.mjs` 是 Windows WebView 的可选集成测试，需要自行启动启用本机调试端口的测试实例。
部分模式会导入并删除临时主题，应在隔离测试账户或备份主题库后执行，勿对生产数据盲目运行。

## 项目结构与二次开发

| 路径 | 用途 |
| --- | --- |
| src-ui/src/App.tsx | 主界面、命令调用及状态 |
| src-ui/src/components | 原理图、波形、编辑与确认窗口 |
| src-ui/src/assets/buck.json | 内置电路图元、波形采样及示例网表 |
| src-tauri/src/theme.rs | 主题格式、颜色校验与 TXT 编解码 |
| src-tauri/src/library.rs | 主题库、内置主题恢复与版本升级 |
| src-tauri/src/config.rs | INI 补丁、原子写入、备份与还原 |
| src-tauri/src/lib.rs | Tauri 命令注册 |
| themes | 内置主题目录，`builtin.json` 为唯一真源 |
| legacy | 原版主题数据快照，仅用于来源核对；构建和测试不依赖 |
| tests | Python 主题数据测试 |
| scripts | 构建、主题生成和验证脚本 |
| src-tauri/icons | 应用图标资源 |

内置主题以 `themes/builtin.json` 为准：直接编辑该文件后运行 `python scripts/migrate_themes.py --check` 校验字段契约与规范格式；校验不通过时去掉 `--check` 执行一次，脚本会把文件重写为规范格式。`builtin.json` 在编译期嵌入，改完需重新构建生效。
旧用户库的更新策略在 library.rs 中维护；变更内置主题时应考虑版本升级、用户编辑保留和删除语义。
颜色使用 Windows COLORREF：十进制 `0x00BBGGRR`，不是 RGB 整数。
所有主题必须包含完整 35 个键；SourceUrl 可为空，非空需为 HTTP/HTTPS。
配置写入只修改开启类别的已知颜色项，保留其他配置、注释和支持的编码。

普通构建无需安装 LTspice，也无需原始 RAW 文件：预览使用已提交的 buck.json。
`scripts/generate_buck_preview.py` 是可选资产生成工具，当前依赖本机 Buck ASC、ASY 和导出的 SQLite 数据；其他开发者需先配置输入路径和数据，不能作为普通构建步骤直接运行。

图标已采用 B 方案。候选源为 design/icon-review/candidate-B2.svg，已渲染源为 icon-B-approved.png；可用 `npm run tauri icon -- design/icon-review/icon-B-approved.png --output src-tauri/icons` 重新生成。
修改图标后如资源缓存未更新，需让 Cargo 重新执行 build.rs 并核对最终 EXE 图标。

## 来源与许可状态

本项目是独立主题工具，不是 Analog Devices 官方产品。
部分主题保留原始 SourceUrl；`themes/builtin.json` 的 `sourceFile` 与 `sourceSha256` 记录了来源文件及其摘要，原版快照见 `legacy/LTspice-themes.txt`（可选文件，不参与构建与测试）。
应用图标参考 LTspice 的三角与 LT 识别重新绘制；电路预览包含本机 LTspice ASY 图元导出的几何。

本项目源代码以 **MIT 许可证**发布，见 [LICENSE](LICENSE)。第三方主题配色、应用图标与电路图元可能另有授权条件，不在 MIT 许可范围内；二次分发前请自行核对并保留原始 SourceUrl 与声明。

底部版本/宣传文字已移除；matlab 不再作为内置主题，其波形与网表配色已合并进 `themes/builtin.json` 的 blackwhite/blackred/redblack，无需额外的调色板文件。旧用户库升级时会移除名为 matlab 的旧内置项。
