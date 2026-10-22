use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Theme {
    pub name: String,
    pub source_url: Option<String>,
    pub colors: BTreeMap<String, u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    #[serde(default)]
    pub builtin_revision: u32,
    pub schema_version: u32,
    pub color_encoding: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sha256: Option<String>,
    pub themes: Vec<Theme>,
}

pub fn keys() -> Vec<String> {
    let mut keys = vec!["Grid".into(), "InActiveAxis".into()];
    for prefix in ["WaveColor", "SchematicColor"] {
        keys.extend((0..14).map(|i| format!("{prefix}{i}")));
    }
    keys.extend(["NetlistNormalTextColor", "NetlistCommentTextColor", "NetlistDotcmdTextColor", "NetlistBackgroundColor", "ContinuationLineColor"].map(String::from));
    keys
}

pub fn validate(theme: &Theme) -> Result<(), String> {
    if theme.name.trim().is_empty() || theme.name.len() > 100 || theme.name.chars().any(char::is_control) {
        return Err("主题名称不能为空、不能包含控制字符，且不能超过 100 字节".into());
    }
    if let Some(url) = &theme.source_url {
        if url.len() > 2048 || !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(char::is_whitespace) {
            return Err("来源链接必须是有效的 HTTP/HTTPS 地址".into());
        }
        let parsed = tauri::Url::parse(url).map_err(|_| "来源链接格式无效".to_string())?;
        if parsed.host_str().is_none() { return Err("来源链接缺少主机名".into()); }
    }
    let expected = keys();
    if theme.colors.len() != expected.len() || expected.iter().any(|key| !theme.colors.contains_key(key)) {
        return Err(format!("主题 {} 必须包含全部 35 个标准颜色字段", theme.name));
    }
    if theme.colors.values().any(|value| *value > 0xffffff) {
        return Err("颜色值必须在 0 至 16777215 之间".into());
    }
    Ok(())
}

pub fn parse(text: &str) -> Result<Vec<Theme>, String> {
    if text.len() > 1024 * 1024 { return Err("主题文件不能超过 1MB".into()); }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("JSON 无效：{e}"))?;
    let themes = if value.get("themes").is_some() {
        let catalog: Catalog = serde_json::from_value(value).map_err(|e| e.to_string())?;
        if catalog.schema_version != 1 || catalog.color_encoding != "COLORREF_BGR24" {
            return Err("不支持的主题格式版本或颜色编码".into());
        }
        catalog.themes
    } else { vec![serde_json::from_value(value).map_err(|e| e.to_string())?] };
    if themes.is_empty() || themes.len() > 100 { return Err("一次只能导入 1 至 100 个主题".into()); }
    let mut names = HashSet::new();
    for theme in &themes {
        validate(theme)?;
        if !names.insert(theme.name.to_lowercase()) { return Err("主题名称重复".into()); }
    }
    Ok(themes)
}

pub fn builtin() -> Result<Vec<Theme>, String> {
    parse(include_str!("../../themes/builtin.json"))
}

pub fn catalog(themes: Vec<Theme>) -> Catalog {
    Catalog { builtin_revision: 2, schema_version: 1, color_encoding: "COLORREF_BGR24".into(), source_file: None, source_sha256: None, themes }
}

pub fn to_ini(theme: &Theme) -> Result<String, String> {
    validate(theme)?;
    let mut text = format!("; LTspice color theme\r\n; ThemeName={}\r\n", theme.name);
    if let Some(url) = &theme.source_url { text.push_str(&format!("; SourceUrl={url}\r\n")); }
    text.push_str("[Colors]\r\n");
    for key in keys() { text.push_str(&format!("{key}={}\r\n", theme.colors[&key])); }
    Ok(text)
}

pub fn parse_ini_bytes(bytes: &[u8], file_name: &str) -> Result<Vec<Theme>, String> {
    if bytes.len() > 1024 * 1024 { return Err("主题文件不能超过 1MB".into()); }
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 { return Err("UTF-16 主题文件长度无效".into()); }
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..].chunks_exact(2).map(|pair| {
            if little { u16::from_le_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], pair[1]]) }
        }).collect();
        String::from_utf16(&words).map_err(|_| "UTF-16 主题文件编码无效".to_string())?
    } else {
        // Color keys and decimal values are ASCII even in legacy ANSI INI files.
        String::from_utf8_lossy(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)).into_owned()
    };
    if text.contains('\0') { return Err("文件包含二进制内容或不支持的无 BOM UTF-16 编码".into()); }
    parse_ini(&text, file_name)
}

fn section(line: &str) -> Option<&str> {
    let line = line.trim();
    let rest = line.strip_prefix('[')?;
    let (name, suffix) = rest.split_once(']')?;
    let suffix = suffix.trim();
    if suffix.is_empty() || suffix.starts_with([';', '#']) { Some(name.trim()) } else { None }
}

fn parse_ini(text: &str, file_name: &str) -> Result<Vec<Theme>, String> {
    let fallback = std::path::Path::new(file_name).file_stem().and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty()).unwrap_or("导入主题").to_string();
    let full_ini = text.lines().filter_map(section).any(|s| s.eq_ignore_ascii_case("Colors"));
    let expected = keys();
    let mut themes: Vec<Theme> = Vec::new();
    let mut current: Option<usize> = None;
    let mut seen_section = false;
    let mut metadata_name: Option<String> = None;
    let mut metadata_url: Option<String> = None;
    let mut pending_url: Option<String> = None;
    for (number, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() { continue; }
        if line.starts_with([';', '#']) {
            if !seen_section {
                let comment = line[1..].trim();
                if let Some(value) = comment.strip_prefix("ThemeName=") { metadata_name = Some(value.trim().into()); }
                if let Some(value) = comment.strip_prefix("SourceUrl=") { metadata_url = Some(value.trim().into()); }
            }
            continue;
        }
        if let Some(name) = section(line) {
            seen_section = true;
            current = None;
            if full_ini && !name.eq_ignore_ascii_case("Colors") { continue; }
            if full_ini && !themes.is_empty() { return Err("文件中包含重复的 [Colors] 段".into()); }
            if themes.len() >= 100 { return Err("一次最多导入 100 个主题".into()); }
            themes.push(Theme {
                name: if full_ini { metadata_name.clone().unwrap_or_else(|| fallback.clone()) } else { name.into() },
                source_url: if full_ini { metadata_url.clone() } else { pending_url.take() },
                colors: BTreeMap::new(),
            });
            current = Some(themes.len() - 1);
            continue;
        }
        if !full_ini && (line.starts_with("https://") || line.starts_with("http://")) {
            if pending_url.is_some() { return Err(format!("第 {} 行来源链接重复", number + 1)); }
            pending_url = Some(line.into());
            continue;
        }
        let Some(index) = current else {
            if full_ini { continue; }
            return Err(format!("第 {} 行之前缺少 [Colors] 或主题名称段", number + 1));
        };
        let (key, value) = line.split_once('=').ok_or_else(|| format!("第 {} 行不是有效键值", number + 1))?;
        let Some(key) = expected.iter().find(|known| known.eq_ignore_ascii_case(key.trim())) else {
            if full_ini { continue; } // Preserve compatibility with future LTspice color keys.
            return Err(format!("第 {} 行颜色键无效：{}", number + 1, key.trim()));
        };
        let value = value.split([';', '#']).next().unwrap_or("").trim();
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) { return Err(format!("{key} 必须是十进制整数")); }
        let value: u32 = value.parse().map_err(|_| format!("{key} 数值超出范围"))?;
        if themes[index].colors.insert(key.clone(), value).is_some() { return Err(format!("颜色键 {key} 重复")); }
    }
    if themes.is_empty() { return Err("未找到 [Colors] 配色段".into()); }
    if pending_url.is_some() { return Err("来源链接之后缺少主题段".into()); }
    let mut names = HashSet::new();
    for theme in &themes {
        validate(theme)?;
        if !names.insert(theme.name.to_lowercase()) { return Err("文件中的主题名称重复".into()); }
    }
    Ok(themes)
}

pub fn reserve_import_name(name: &str, used: &mut HashSet<String>) -> String {
    if used.insert(name.to_lowercase()) { return name.into(); }
    for count in 1.. {
        let suffix = if count == 1 { " (导入)".into() } else { format!(" (导入 {count})") };
        let mut base = name.to_string();
        while base.len() + suffix.len() > 100 { base.pop(); }
        let candidate = format!("{base}{suffix}");
        if used.insert(candidate.to_lowercase()) { return candidate; }
    }
    unreachable!()
}

pub fn rgb(value: u32) -> String {
    format!("#{:02x}{:02x}{:02x}", value & 255, (value >> 8) & 255, (value >> 16) & 255)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn color_order_and_validation() {
        assert_eq!(rgb(255), "#ff0000");
        assert_eq!(rgb(16711680), "#0000ff");
        assert_eq!(rgb(0x563412), "#123456");
        let mut themes = builtin().unwrap();
        assert_eq!(themes.len(), 9);
        themes[0].colors.insert("Grid".into(), 0x1000000);
        assert!(validate(&themes[0]).is_err());
        assert!(parse(r#"{"name":"x","colors":{}}"#).is_err());
    }

    #[test]
    fn import_export_contract() {
        let themes = builtin().unwrap();
        let json = serde_json::to_string(&catalog(themes.clone())).unwrap();
        assert_eq!(parse(&json).unwrap()[3].colors, themes[3].colors);
        let duplicates = catalog(vec![themes[0].clone(), themes[0].clone()]);
        assert!(parse(&serde_json::to_string(&duplicates).unwrap()).is_err());
        assert!(parse(&json.replace("COLORREF_BGR24", "RGB")).is_err());
        assert!(parse(&" ".repeat(1024 * 1024 + 1)).is_err());
        let mut bad = themes[0].clone();
        bad.source_url = Some("http://".into());
        assert!(validate(&bad).is_err());
    }

    #[test]
    fn txt_roundtrip_is_an_ltspice_colors_section() {
        for theme in builtin().unwrap() {
            let text = to_ini(&theme).unwrap();
            assert!(text.contains("\r\n[Colors]\r\n"));
            assert_eq!(text.lines().filter(|l| !l.starts_with(';') && l.contains('=')).count(), 35);
            let read = parse_ini_bytes(text.as_bytes(), "export.txt").unwrap();
            assert_eq!(read[0].name, theme.name);
            assert_eq!(read[0].source_url, theme.source_url);
            assert_eq!(read[0].colors, theme.colors);
            // The same text can be read and modified by the actual INI writer.
            assert_eq!(crate::config::patch(text.as_bytes(), &theme).unwrap(), text.as_bytes());
        }
    }

    #[test]
    fn imports_full_ini_and_windows_encodings() {
        let theme = builtin().unwrap().remove(3);
        let exported = to_ini(&theme).unwrap();
        let section = &exported[exported.find("[Colors]").unwrap()..];
        let full = format!("[Options]\r\nKeep=user settings\r\n{section}FutureColor=1\r\n[Other]\r\nGrid=999\r\n");
        let imported = parse_ini_bytes(full.as_bytes(), "我的配色.ini").unwrap();
        assert_eq!(imported[0].name, "我的配色");
        assert_eq!(imported[0].colors, theme.colors);
        for little in [true, false] {
            let mut bytes = if little { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
            for word in full.encode_utf16() { bytes.extend_from_slice(&if little { word.to_le_bytes() } else { word.to_be_bytes() }); }
            assert_eq!(parse_ini_bytes(&bytes, "test.ini").unwrap()[0].colors, theme.colors);
        }
        let bom = [vec![0xef, 0xbb, 0xbf], exported.as_bytes().to_vec()].concat();
        assert_eq!(parse_ini_bytes(&bom, "test.txt").unwrap()[0].colors, theme.colors);
        let ansi = [b"; ANSI comment: \xff\n".to_vec(), section.as_bytes().to_vec()].concat();
        assert_eq!(parse_ini_bytes(&ansi, "test.ini").unwrap()[0].colors, theme.colors);
    }

    #[test]
    fn builtin_catalog_is_the_source_of_truth() {
        // themes/builtin.json is authoritative: it is compiled in, so every built-in
        // theme must satisfy the full colour contract without help from legacy data.
        let all = builtin().unwrap();
        assert_eq!(all.len(), 9);
        let expected = keys();
        let mut seen = HashSet::new();
        for theme in &all {
            assert_eq!(theme.name, theme.name.trim());
            assert!(!theme.name.is_empty());
            assert!(seen.insert(theme.name.to_lowercase()), "duplicate built-in {}", theme.name);
            assert_eq!(theme.colors.len(), expected.len(), "{}", theme.name);
            for key in &expected { assert!(theme.colors.contains_key(key), "{} missing {key}", theme.name); }
            assert!(theme.colors.values().all(|value| *value <= 0xffffff), "{}", theme.name);
            validate(theme).unwrap();
        }
        let built = catalog(all.clone());
        assert_eq!(built.builtin_revision, 2);
        assert_eq!(built.schema_version, 1);
        assert_eq!(built.color_encoding, "COLORREF_BGR24");
        let reimported = parse(&serde_json::to_string(&built).unwrap()).unwrap();
        assert_eq!(reimported.len(), all.len());
        for (read, original) in reimported.iter().zip(&all) {
            assert_eq!(read.name, original.name);
            assert_eq!(read.source_url, original.source_url);
            assert_eq!(read.colors, original.colors);
        }
    }

    #[test]
    fn rejects_ambiguous_or_invalid_txt() {
        let text = to_ini(&builtin().unwrap()[0]).unwrap();
        for bad in [
            String::new(), text.replace("Grid=6579300", "Grid=-1"),
            text.replace("Grid=6579300", "Grid=16777216"),
            text.replace("Grid=6579300", "Grid=1.5"),
            text.replace("Grid=6579300", "Grid=1\r\ngrid=2"),
            text.replace("Grid=6579300\r\n", ""),
            text.clone() + "[Colors]\nGrid=1\n",
        ] { assert!(parse_ini_bytes(bad.as_bytes(), "bad.txt").is_err(), "{bad}"); }
        assert!(parse_ini_bytes(&[0xff, 0xfe, 1], "bad.ini").is_err());
        assert!(parse_ini_bytes(&vec![b' '; 1024 * 1024 + 1], "large.txt").is_err());
        let mut used = HashSet::from(["dracula".into()]);
        assert_eq!(reserve_import_name("dracula", &mut used), "dracula (导入)");
        assert_eq!(reserve_import_name("dracula", &mut used), "dracula (导入 2)");
        let name = "中".repeat(33);
        used.insert(name.clone());
        assert!(reserve_import_name(&name, &mut used).len() <= 100);
    }
}
