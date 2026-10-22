mod config;
mod theme;
mod library;

use std::{path::Path, sync::Mutex};
use tauri::Manager;

fn library(app: &tauri::AppHandle) -> Result<library::Library, String> {
    Ok(library::Library(app.path().app_data_dir().map_err(|e| e.to_string())?))
}

fn all_themes(app: &tauri::AppHandle) -> Result<Vec<theme::Theme>, String> {
    library(app)?.all()
}

#[tauri::command]
fn update_theme(app: tauri::AppHandle, original_name: String, edited: theme::Theme) -> Result<Vec<theme::Theme>, String> {
    library(&app)?.update(&original_name, edited)
}

#[tauri::command]
fn delete_theme(app: tauri::AppHandle, name: String) -> Result<Vec<theme::Theme>, String> {
    library(&app)?.delete(&name)
}

#[tauri::command]
fn health_check() -> &'static str { "Rust 后端已连接" }

#[tauri::command]
fn reset_builtin_themes(app: tauri::AppHandle, name: Option<String>) -> Result<Vec<theme::Theme>,String> {
    library(&app)?.reset_builtins(name.as_deref())
}

#[tauri::command]
fn list_themes(app: tauri::AppHandle) -> Result<Vec<theme::Theme>, String> { all_themes(&app) }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Status { running: bool, candidates: Vec<String>, platform: String }

#[tauri::command]
async fn get_status() -> Result<Status, String> {
    Ok(Status { running: config::running()?, candidates: config::locate(), platform: std::env::consts::OS.into() })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigInfo { path: String, sha256: String, backups: Vec<config::Backup>, valid: bool, error: Option<String>, current_colors: std::collections::BTreeMap<String,u32> }

fn inspect(path: &str) -> Result<ConfigInfo, String> {
    let path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    if !path.extension().is_some_and(|s| s.eq_ignore_ascii_case("ini")) { return Err("请选择 .ini 配置文件".into()); }
    let bytes = config::read(&path)?;
    let error = config::patch(&bytes, &theme::builtin()?[0]).err();
    Ok(ConfigInfo { path: path.to_string_lossy().into_owned(), sha256: config::digest(&bytes), backups: config::backups(&path)?, valid: error.is_none(), error, current_colors: config::current_colors(&bytes) })
}

fn check_before_write(path: &Path, expected_hash: &str) -> Result<bool, String> {
    if config::digest(&config::read(path)?) != expected_hash { return Err("配置已变化，请刷新后重试".into()); }
    config::running()
}

#[tauri::command]
async fn inspect_config(path: String) -> Result<ConfigInfo, String> { inspect(&path) }

#[tauri::command]
fn delete_backup(lock: tauri::State<'_, Mutex<()>>, path: String, id: String) -> Result<ConfigInfo, String> {
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    let info=inspect(&path)?;
    config::delete_backup(Path::new(&info.path),&id)?;
    inspect(&info.path)
}

#[tauri::command]
async fn apply_theme(app: tauri::AppHandle, lock: tauri::State<'_, Mutex<()>>, path: String, name: String, expected_hash: String, targets: config::Targets) -> Result<ConfigInfo, String> {
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    let info = inspect(&path)?;
    if info.sha256 != expected_hash { return Err("配置已变化，请点击刷新后重试".into()); }
    let theme = all_themes(&app)?.into_iter().find(|t| t.name == name).ok_or("主题不存在")?;
    config::apply_selected_with_guard(Path::new(&info.path), &theme, targets, || check_before_write(Path::new(&info.path), &expected_hash))?;
    inspect(&info.path)
}

#[tauri::command]
async fn restore_backup(lock: tauri::State<'_, Mutex<()>>, path: String, id: String, expected_hash: String) -> Result<ConfigInfo, String> {
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    let info = inspect(&path)?;
    if info.sha256 != expected_hash { return Err("配置已变化，请点击刷新后重试".into()); }
    config::restore_with_guard(Path::new(&info.path), &id, || check_before_write(Path::new(&info.path), &expected_hash))?;
    inspect(&info.path)
}

#[tauri::command]
fn import_themes(app: tauri::AppHandle, lock: tauri::State<'_, Mutex<()>>, content: Vec<u8>, file_name: String) -> Result<Vec<theme::Theme>, String> {
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    library(&app)?.import(theme::parse_ini_bytes(&content, &file_name)?)
}

#[tauri::command]
fn preview_export_theme(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let theme = all_themes(&app)?.into_iter().find(|t| t.name == name).ok_or("主题不存在")?;
    theme::to_ini(&theme)
}

#[tauri::command]
fn export_theme(app: tauri::AppHandle, path: String, name: String, expected_content: Option<String>) -> Result<(), String> {
    let path = Path::new(&path);
    if !path.extension().is_some_and(|s| s.eq_ignore_ascii_case("txt")) { return Err("导出文件必须使用 .txt 扩展名".into()); }
    let content = preview_export_theme(app, name)?;
    if expected_content.is_some_and(|expected| expected != content) { return Err("主题内容已变化，请关闭预览并重新导出".into()); }
    config::atomic_write(path, content.as_bytes())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(()))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![health_check, list_themes, reset_builtin_themes, update_theme, delete_theme, get_status, inspect_config, delete_backup, apply_theme, restore_backup, import_themes, preview_export_theme, export_theme])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
