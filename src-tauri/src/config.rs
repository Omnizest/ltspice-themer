use crate::theme::{self, Theme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, process::Command, time::{SystemTime, UNIX_EPOCH}};

const MAX_CONFIG: u64 = 16 * 1024 * 1024;

fn io(error: impl std::fmt::Display) -> String { format!("文件操作失败：{error}") }
pub fn now() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() }
pub fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(io)?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG { return Err("配置必须是小于 16MB 的普通文件".into()); }
    let bytes = fs::read(path).map_err(io)?;
    if bytes.len() as u64 > MAX_CONFIG { return Err("配置超过 16MB".into()); }
    Ok(bytes)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("路径没有父目录")?;
    let temp = parent.join(format!(".ltspice-themer-{}.tmp", now()));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(io)?;
        file.write_all(bytes).map_err(io)?;
        if let Ok(metadata) = fs::metadata(path) { fs::set_permissions(&temp, metadata.permissions()).map_err(io)?; }
        file.sync_all().map_err(io)?;
        drop(file);
        fs::rename(&temp, path).map_err(io)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

// Retain original bytes for non-color lines, including ANSI comments and line endings.
#[derive(Clone, Copy, Deserialize)]
pub struct Targets { pub schematic: bool, pub waveform: bool, pub netlist: bool }
impl Targets {
    pub fn all() -> Self { Self { schematic: true, waveform: true, netlist: true } }
    fn includes(self, key: &str) -> bool {
        if key.starts_with("SchematicColor") { self.schematic }
        else if key.starts_with("Netlist") || key == "ContinuationLineColor" { self.netlist }
        else { self.waveform }
    }
}
fn patch_ascii(bytes: &[u8], theme: &Theme, targets: Targets) -> Result<Vec<u8>, String> {
    let expected: Vec<_> = theme::keys().into_iter().filter(|key| targets.includes(key)).collect();
    let mut output = Vec::new();
    let mut colors = false;
    let mut sections = 0;
    let mut seen = HashSet::new();
    let newline: &[u8] = if bytes.windows(2).any(|b| b == b"\r\n") { b"\r\n" } else { b"\n" };
    let append_missing = |output: &mut Vec<u8>, seen: &HashSet<String>| {
        if !output.ends_with(b"\n") { output.extend_from_slice(newline); }
        for key in &expected {
            if !seen.contains(key) { output.extend_from_slice(format!("{key}={}", theme.colors[key]).as_bytes()); output.extend_from_slice(newline); }
        }
    };
    for (index, line) in bytes.split_inclusive(|b| *b == b'\n').enumerate() {
        let content = if index == 0 { line.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(line) } else { line };
        let trimmed = String::from_utf8_lossy(content).trim().to_string();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if colors { append_missing(&mut output, &seen); }
            colors = trimmed.eq_ignore_ascii_case("[Colors]");
            if colors { sections += 1; if sections > 1 { return Err("发现重复 [Colors] 段，已拒绝修改".into()); } }
        } else if colors && !trimmed.starts_with([';', '#']) {
            if let Some(equal) = content.iter().position(|b| *b == b'=') {
                let original_key = String::from_utf8_lossy(&content[..equal]).trim().to_string();
                if let Some(key) = expected.iter().find(|key| key.eq_ignore_ascii_case(&original_key)) {
                    if !seen.insert(key.clone()) { return Err(format!("发现重复颜色键 {key}，已拒绝修改")); }
                    output.extend_from_slice(&line[..line.len() - content.len()]);
                    output.extend_from_slice(&content[..=equal]);
                    let after = &content[equal + 1..];
                    let leading = after.iter().take_while(|b| **b == b' ' || **b == b'\t').count();
                    output.extend_from_slice(&after[..leading]);
                    let end = after[leading..].iter().take_while(|b| b.is_ascii_digit()).count() + leading;
                    if end == leading { return Err(format!("颜色键 {key} 不是十进制整数")); }
                    let suffix = &after[end..];
                    let suffix_text = String::from_utf8_lossy(suffix).trim().to_string();
                    if !suffix_text.is_empty() && !suffix_text.starts_with([';', '#']) { return Err(format!("颜色键 {key} 有无法识别的内容")); }
                    output.extend_from_slice(theme.colors[key].to_string().as_bytes());
                    output.extend_from_slice(suffix);
                    continue;
                }
            }
        }
        output.extend_from_slice(line);
    }
    if sections == 0 { return Err("未找到 [Colors] 段，请选择 LTspice 的 INI 配置文件".into()); }
    if colors { append_missing(&mut output, &seen); }
    Ok(output)
}

pub fn patch(bytes: &[u8], theme: &Theme) -> Result<Vec<u8>, String> {
    patch_selected(bytes, theme, Targets::all())
}
pub fn current_colors(bytes: &[u8]) -> std::collections::BTreeMap<String, u32> {
    let mut colors = theme::builtin().expect("bundled themes")[0].colors.clone();
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let words: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| if bytes[0] == 0xff { u16::from_le_bytes([c[0],c[1]]) } else { u16::from_be_bytes([c[0],c[1]]) }).collect();
        String::from_utf16_lossy(&words)
    } else { String::from_utf8_lossy(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(bytes)).into_owned() };
    let mut inside = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') { inside = line.eq_ignore_ascii_case("[Colors]"); continue; }
        if inside {
            if let Some((key, value)) = line.split_once('=') {
                if let Some(known) = theme::keys().into_iter().find(|k| k.eq_ignore_ascii_case(key.trim())) {
                    if let Ok(value) = value.split([';','#']).next().unwrap_or("").trim().parse::<u32>() {
                        if value <= 0xffffff { colors.insert(known, value); }
                    }
                }
            }
        }
    }
    colors
}
pub fn patch_selected(bytes: &[u8], theme: &Theme, targets: Targets) -> Result<Vec<u8>, String> {
    if !targets.schematic && !targets.waveform && !targets.netlist { return Err("请至少打开一个应用开关".into()); }
    theme::validate(theme)?;
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 { return Err("UTF-16 配置长度无效".into()); }
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| if little { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        let text = String::from_utf16(&words).map_err(io)?;
        let patched = String::from_utf8(patch_ascii(text.as_bytes(), theme, targets)?).map_err(io)?;
        let mut output = bytes[..2].to_vec();
        for word in patched.encode_utf16() { output.extend_from_slice(&if little { word.to_le_bytes() } else { word.to_be_bytes() }); }
        Ok(output)
    } else {
        if bytes.contains(&0) { return Err("无法识别配置编码；不支持无 BOM 的 UTF-16 或二进制文件".into()); }
        patch_ascii(bytes, theme, targets)
    }
}

pub fn running() -> Result<bool, String> {
    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        Command::new("tasklist.exe").args(["/FO", "CSV", "/NH"]).creation_flags(0x08000000).output()
    };
    #[cfg(not(windows))]
    let output = Command::new("ps").args(["-A", "-o", "comm="]).output();
    let output = output.map_err(|e| format!("无法检测 LTspice 进程：{e}"))?;
    if !output.status.success() { return Err("进程检测失败，已禁用配置写入".into()); }
    let names = ["ltspice.exe", "ltspice", "xviix64.exe", "xvii.exe", "scad3.exe", "ltspice64.exe"];
    Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        let name = line.trim().trim_start_matches('"').split(['"', ',']).next().unwrap_or("").replace('\\', "/");
        names.contains(&name.rsplit('/').next().unwrap_or("").to_ascii_lowercase().as_str())
    }))
}

pub fn locate() -> Vec<String> {
    let mut candidates = Vec::new();
    for root in [std::env::var_os("APPDATA"), std::env::var_os("LOCALAPPDATA"), std::env::var_os("USERPROFILE"), std::env::var_os("HOME")] .into_iter().flatten() {
        let root = PathBuf::from(root);
        for relative in ["LTspice/LTspice.ini", "LTspiceXVII/LTspiceXVII.ini", "LTspice.ini", "LTspiceXVII.ini", "Documents/LTspice/LTspice.ini", "Documents/LTspiceXVII/LTspiceXVII.ini", "OneDrive/Documents/LTspice/LTspice.ini", "OneDrive/Documents/LTspiceXVII/LTspiceXVII.ini"] {
            let path = root.join(relative);
            if path.is_file() { candidates.push(path); }
        }
    }
    if let Some(prefix) = std::env::var_os("WINEPREFIX").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".wine"))) {
        if let Ok(users) = fs::read_dir(prefix.join("drive_c/users")) {
            for user in users.flatten() {
                for relative in ["Documents/LTspice/LTspice.ini", "Documents/LTspiceXVII/LTspiceXVII.ini", "AppData/Roaming/LTspice/LTspice.ini"] {
                    let path = user.path().join(relative);
                    if path.is_file() { candidates.push(path); }
                }
            }
        }
    }
    // Resolve redirected Windows Documents without assuming OneDrive location.
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        if let Ok(result) = Command::new("reg.exe").args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"]).creation_flags(0x08000000).output() {
            let text = String::from_utf8_lossy(&result.stdout);
            for line in text.lines() {
                if let Some((_, value)) = line.split_once("REG_EXPAND_SZ").or_else(|| line.split_once("REG_SZ")) {
                    let mut documents = value.trim().to_string();
                    for (key, value) in std::env::vars() { documents = documents.replace(&format!("%{key}%"), &value); }
                    for relative in ["LTspice/LTspice.ini", "LTspiceXVII/LTspiceXVII.ini"] {
                        let path = PathBuf::from(&documents).join(relative);
                        if path.is_file() { candidates.push(path); }
                    }
                }
            }
        }
    }
    let mut result: Vec<String> = candidates.into_iter().filter_map(|p| p.canonicalize().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
    result.sort(); result.dedup(); result
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    pub created_at: u128,
    pub source_path: String,
    pub sha256: String,
    pub size: usize,
}

fn backup_dir(path: &Path) -> Result<PathBuf, String> { Ok(path.parent().ok_or("配置路径无效")?.join(".ltspice-themer-backups")) }
pub fn backups(path: &Path) -> Result<Vec<Backup>, String> {
    let index = backup_dir(path)?.join("index.json");
    if !index.exists() { return Ok(Vec::new()); }
    let bytes = read(&index)?;
    let all: Vec<Backup> = serde_json::from_slice(&bytes).map_err(|e| format!("备份清单损坏：{e}"))?;
    Ok(all.into_iter().filter(|b| b.source_path == path.to_string_lossy()
        && !b.id.is_empty() && b.id.bytes().all(|c| c.is_ascii_digit())
        && index.parent().unwrap().join(format!("{}.ini",b.id)).is_file()).collect())
}

pub fn delete_backup(path: &Path, id: &str) -> Result<(), String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) { return Err("备份编号无效".into()); }
    let path = path.canonicalize().map_err(io)?;
    let _lock = lock_directory(&path)?;
    let index = backup_dir(&path)?.join("index.json");
    let original = read(&index)?;
    let mut all: Vec<Backup> = serde_json::from_slice(&original).map_err(io)?;
    let matching: Vec<_> = all.iter().filter(|b| b.id == id).collect();
    if matching.len() != 1 || matching[0].source_path != path.to_string_lossy() {
        return Err("备份不存在或不属于当前配置，请刷新列表".into());
    }
    all.retain(|b| b.id != id);
    atomic_write(&index, &serde_json::to_vec_pretty(&all).map_err(io)?)?;
    if let Err(error) = fs::remove_file(backup_dir(&path)?.join(format!("{id}.ini"))) {
        if error.kind() != std::io::ErrorKind::NotFound {
            atomic_write(&index, &original).map_err(|rollback| format!("删除失败：{error}；恢复备份清单失败：{rollback}"))?;
            return Err(io(error));
        }
    }
    Ok(())
}

fn backup(path: &Path, bytes: &[u8]) -> Result<Backup, String> {
    let dir = backup_dir(path)?;
    fs::create_dir_all(&dir).map_err(io)?;
    let index = dir.join("index.json");
    let mut all: Vec<Backup> = if index.exists() { serde_json::from_slice(&read(&index)?).map_err(io)? } else { Vec::new() };
    let record = Backup { id: now().to_string(), created_at: now() / 1_000_000, source_path: path.to_string_lossy().into_owned(), sha256: digest(bytes), size: bytes.len() };
    let file = dir.join(format!("{}.ini", record.id));
    let mut output = OpenOptions::new().write(true).create_new(true).open(&file).map_err(io)?;
    output.write_all(bytes).map_err(io)?; output.sync_all().map_err(io)?; drop(output);
    if digest(&read(&file)?) != record.sha256 { return Err("备份校验失败，未修改配置".into()); }
    all.push(record.clone());
    atomic_write(&index, &serde_json::to_vec_pretty(&all).map_err(io)?)?;
    Ok(record)
}

#[cfg(test)]
pub fn apply_with_guard(path: &Path, theme: &Theme, guard: impl Fn() -> Result<bool, String>) -> Result<Backup, String> {
    apply_selected_with_guard(path, theme, Targets::all(), guard)
}
pub fn apply_selected_with_guard(path: &Path, theme: &Theme, targets: Targets, guard: impl Fn() -> Result<bool, String>) -> Result<Backup, String> {
    if guard()? { return Err("请先关闭 LTspice，再应用主题".into()); }
    let path = path.canonicalize().map_err(io)?;
    let _lock = lock_directory(&path)?;
    let original = read(&path)?;
    let output = patch_selected(&original, theme, targets)?;
    let record = backup(&path, &original)?;
    if guard()? { return Err("检测到 LTspice 已启动，已保留备份并取消写入".into()); }
    if read(&path)? != original { return Err("配置已被其他程序修改，已取消写入，请刷新后重试".into()); }
    atomic_write(&path, &output)?;
    Ok(record)
}

pub fn restore_with_guard(path: &Path, id: &str, guard: impl Fn() -> Result<bool, String>) -> Result<Backup, String> {
    if guard()? { return Err("请先关闭 LTspice，再还原备份".into()); }
    let path = path.canonicalize().map_err(io)?;
    let _lock = lock_directory(&path)?;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) { return Err("备份编号无效".into()); }
    let record = backups(&path)?.into_iter().find(|b| b.id == id).ok_or("找不到此配置对应的备份")?;
    let bytes = read(&backup_dir(&path)?.join(format!("{id}.ini")))?;
    if digest(&bytes) != record.sha256 || bytes.len() != record.size { return Err("备份校验失败，无法还原".into()); }
    let original = read(&path)?;
    let saved = backup(&path, &original)?;
    if guard()? || read(&path)? != original { return Err("LTspice 已启动或配置已变化，已取消还原".into()); }
    atomic_write(&path, &bytes)?;
    Ok(saved)
}

fn lock_directory(path: &Path) -> Result<std::fs::File, String> {
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(path.parent().ok_or("配置目录无效")?.join(".ltspice-themer.lock")).map_err(io)?;
    file.try_lock().map_err(|_| "另一个主题管理器正在操作此目录，请稍后重试".to_string())?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn theme() -> Theme { crate::theme::builtin().unwrap().into_iter().find(|t| t.name == "dracula").unwrap() }
    #[test]
    fn delete_and_refresh_backups_are_scoped_to_the_selected_config() {
        let dir = std::env::temp_dir().join(format!("ltspice-backup-test-{}", now()));
        fs::create_dir(&dir).unwrap();
        let a=dir.join("a.ini");let b=dir.join("b.ini");
        fs::write(&a,b"[Colors]\nGrid=1\n").unwrap();fs::write(&b,b"[Colors]\nGrid=2\n").unwrap();
        let a=a.canonicalize().unwrap();let b=b.canonicalize().unwrap();
        let original=read(&a).unwrap();let first=backup(&a,&original).unwrap();let other=backup(&b,&read(&b).unwrap()).unwrap();
        assert!(delete_backup(&a,&other.id).is_err());assert!(delete_backup(&a,"../index").is_err());
        let held=lock_directory(&a).unwrap();assert!(delete_backup(&a,&first.id).is_err());drop(held);
        delete_backup(&a,&first.id).unwrap();
        assert!(backups(&a).unwrap().is_empty());assert_eq!(backups(&b).unwrap().len(),1);
        assert!(!backup_dir(&a).unwrap().join(format!("{}.ini",first.id)).exists());
        assert_eq!(read(&a).unwrap(),original);
        let external=backup(&a,&original).unwrap();assert_eq!(backups(&a).unwrap()[0].id,external.id);
        fs::remove_file(backup_dir(&a).unwrap().join(format!("{}.ini",external.id))).unwrap();
        assert!(backups(&a).unwrap().is_empty());
        delete_backup(&a,&external.id).unwrap();assert_eq!(backups(&b).unwrap().len(),1);
        assert!(dir.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn all_switch_combinations_preserve_unchecked_colors() {
        let mut original = theme();
        for value in original.colors.values_mut() { *value = 12345; }
        let source = theme::to_ini(&original).unwrap() + "Unrelated=unchanged\r\n";
        for mask in 0..8 {
            let targets = Targets { schematic: mask & 1 != 0, waveform: mask & 2 != 0, netlist: mask & 4 != 0 };
            let result = patch_selected(source.as_bytes(), &theme(), targets);
            if mask == 0 { assert!(result.is_err()); continue; }
            let output = result.unwrap();
            let actual = current_colors(&output);
            for key in theme::keys() {
                assert_eq!(actual[&key], if targets.includes(&key) { theme().colors[&key] } else { 12345 }, "mask {mask}: {key}");
                if !targets.includes(&key) { assert!(String::from_utf8_lossy(&output).contains(&format!("{key}=12345\r\n"))); }
            }
            assert!(output.ends_with(b"Unrelated=unchanged\r\n"));
        }
        let targets = Targets { schematic:true, waveform:false, netlist:false };
        let output = patch_selected(b"[Colors]\nGrid=42 ; keep\n", &theme(), targets).unwrap();
        assert!(output.starts_with(b"[Colors]\nGrid=42 ; keep\n"));
        assert!(!String::from_utf8_lossy(&output).contains("WaveColor"));
        for little in [true, false] {
            let mut bytes = if little { vec![255,254] } else { vec![254,255] };
            for c in source.encode_utf16() { bytes.extend_from_slice(&if little { c.to_le_bytes() } else { c.to_be_bytes() }); }
            let output = patch_selected(&bytes, &theme(), targets).unwrap();
            assert_eq!(current_colors(&output)["Grid"], 12345);
            assert_eq!(current_colors(&output)["SchematicColor0"], theme().colors["SchematicColor0"]);
        }
    }
    #[test]
    fn preserves_unknown_lines_and_comments() {
        let source = b";\xff comment\r\n[General]\r\nKeep=abc\r\n[Colors]\r\n Grid = 1 ; comment\r\nOther=7\r\n[Other]\r\nSetting=2\r\n";
        let result = patch(source, &theme()).unwrap();
        assert!(result.starts_with(b";\xff comment\r\n[General]\r\nKeep=abc\r\n[Colors]\r\n Grid = 10777186 ; comment\r\nOther=7\r\n"));
        assert!(result.ends_with(b"[Other]\r\nSetting=2\r\n"));
        assert_eq!(patch(&result, &theme()).unwrap(), result);
        assert!(patch(b"[Colors]\nGrid=1\nGrid=2\n", &theme()).is_err());
        assert!(patch(b"[General]\nX=1\n", &theme()).is_err());
    }
    #[test]
    fn utf16_and_utf8_bom_roundtrip() {
        for little in [true, false] {
            let mut bytes = if little { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
            for word in "[Colors]\r\nGrid=1\r\n; 中文\r\n".encode_utf16() { bytes.extend_from_slice(&if little { word.to_le_bytes() } else { word.to_be_bytes() }); }
            let output = patch(&bytes, &theme()).unwrap();
            assert_eq!(&output[..2], &bytes[..2]);
            assert_eq!(patch(&output, &theme()).unwrap(), output);
        }
        assert!(patch(b"\xef\xbb\xbf[Colors]\nGrid=1\n", &theme()).unwrap().starts_with(&[0xef, 0xbb, 0xbf]));
    }
    #[test]
    fn backup_apply_restore_and_running_guard() {
        let dir = std::env::temp_dir().join(format!("ltspice-themer-test-{}", now()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("test.ini");
        let original = b"[Colors]\r\nGrid=1\r\n[Other]\r\nA=2\r\n";
        fs::write(&path, original).unwrap();
        let held = lock_directory(&path.canonicalize().unwrap()).unwrap();
        assert!(apply_with_guard(&path, &theme(), || Ok(false)).is_err());
        drop(held);
        assert!(apply_with_guard(&path, &theme(), || Ok(true)).is_err());
        assert_eq!(read(&path).unwrap(), original);
        let record = apply_with_guard(&path, &theme(), || Ok(false)).unwrap();
        assert_ne!(read(&path).unwrap(), original);
        assert!(restore_with_guard(&path, &record.id, || Ok(true)).is_err());
        fs::write(&path, b"corrupted configuration").unwrap();
        restore_with_guard(&path, &record.id, || Ok(false)).unwrap();
        assert_eq!(read(&path).unwrap(), original);
        let canonical = path.canonicalize().unwrap();
        fs::write(backup_dir(&canonical).unwrap().join(format!("{}.ini", record.id)), b"tampered").unwrap();
        assert!(restore_with_guard(&path, &record.id, || Ok(false)).is_err());
        // Delete only this uniquely created test directory under the OS temporary directory.
        assert!(dir.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn changes_after_backup_abort_the_write() {
        let dir = std::env::temp_dir().join(format!("ltspice-themer-test-{}", now()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("test.ini");
        fs::write(&path, b"[Colors]\nGrid=1\n").unwrap();
        let checks = std::cell::Cell::new(0);
        assert!(apply_with_guard(&path, &theme(), || {
            checks.set(checks.get() + 1);
            if checks.get() == 2 { fs::write(&path, b"[Colors]\nGrid=2\n").unwrap(); }
            Ok(false)
        }).is_err());
        assert_eq!(read(&path).unwrap(), b"[Colors]\nGrid=2\n");
        assert!(dir.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }
}
