use crate::{config, theme::{self, Catalog, Theme}};
use std::{collections::HashSet, fs::{self, File, OpenOptions}, path::PathBuf};

pub struct Library(pub PathBuf);

fn validate(themes: &[Theme]) -> Result<(), String> {
    if themes.len() > 200 { return Err("主题库最多保存 200 个主题".into()); }
    let mut used = HashSet::new();
    for item in themes {
        theme::validate(item)?;
        if !used.insert(item.name.to_lowercase()) { return Err("主题名称重复".into()); }
    }
    Ok(())
}

impl Library {
    fn path(&self) -> PathBuf { self.0.join("theme-library.json") }
    fn lock(&self) -> Result<File, String> {
        fs::create_dir_all(&self.0).map_err(|e| e.to_string())?;
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(self.0.join(".theme-library.lock")).map_err(|e| e.to_string())?;
        file.try_lock().map_err(|_| "其他窗口正在修改主题库，请稍后重试".to_string())?;
        Ok(file)
    }
    pub fn all(&self) -> Result<Vec<Theme>, String> {
        let _lock=self.lock()?;
        self.read_all()
    }
    fn read_all(&self) -> Result<Vec<Theme>, String> {
        let themes = if self.path().exists() {
            let bytes = config::read(&self.path())?;
            let catalog: Catalog = serde_json::from_slice(&bytes).map_err(|e| format!("主题库读取失败：{e}"))?;
            if catalog.schema_version != 1 || catalog.color_encoding != "COLORREF_BGR24" { return Err("主题库版本不支持".into()); }
            if catalog.builtin_revision < 2 {
                let revision=catalog.builtin_revision;let before=catalog.themes;
                let mut after=before.clone();let originals=theme::builtin()?;
                for target in ["blackwhite","blackred","redblack"].into_iter().filter(|_|revision<1) {
                    if let Some(item)=after.iter_mut().find(|t|t.name==target) {
                        let updated=originals.iter().find(|t|t.name==target).unwrap();
                        for (key,value) in &updated.colors {if !key.starts_with("SchematicColor"){item.colors.insert(key.clone(),*value);}}
                    }
                }
                after.retain(|t|t.name!="matlab");
                self.save(before,after)?
            }else{catalog.themes}
        } else {
            let mut themes = theme::builtin()?;
            let previous = self.0.join("custom-themes.json");
            if previous.exists() { themes.extend(theme::parse(&fs::read_to_string(previous).map_err(|e| e.to_string())?)?); }
            themes
        };
        validate(&themes)?;
        Ok(themes)
    }
    fn save(&self, before: Vec<Theme>, after: Vec<Theme>) -> Result<Vec<Theme>, String> {
        validate(&after)?;
        let bytes = serde_json::to_vec_pretty(&theme::catalog(after.clone())).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 { return Err("主题库超过 2MB".into()); }
        let previous = serde_json::to_vec_pretty(&theme::catalog(before)).map_err(|e| e.to_string())?;
        config::atomic_write(&self.0.join("theme-library.previous.json"), &previous)?;
        config::atomic_write(&self.path(), &bytes)?;
        Ok(after)
    }
    pub fn update(&self, original: &str, edited: Theme) -> Result<Vec<Theme>, String> {
        let _lock = self.lock()?;
        theme::validate(&edited)?;
        let before = self.read_all()?;
        let index = before.iter().position(|t| t.name == original).ok_or("主题已不存在，请刷新主题库")?;
        let mut after = before.clone();
        after[index] = edited;
        self.save(before, after)
    }
    pub fn reset_builtins(&self, name: Option<&str>) -> Result<Vec<Theme>, String> {
        let _lock=self.lock()?;
        let originals=theme::builtin()?;
        if name.is_some_and(|n| !originals.iter().any(|t|t.name==n)) {return Err("只能恢复内置主题".into());}
        let before=self.read_all()?;let mut after=before.clone();
        for original in originals.into_iter().filter(|t|name.is_none_or(|n|n==t.name)) {
            if let Some(index)=after.iter().position(|t|t.name.eq_ignore_ascii_case(&original.name)){after[index]=original;}
            else {after.push(original);}
        }
        self.save(before,after)
    }
    pub fn delete(&self, name: &str) -> Result<Vec<Theme>, String> {
        let _lock = self.lock()?;
        let before = self.read_all()?;
        let mut after = before.clone();
        let index = after.iter().position(|t| t.name == name).ok_or("主题已不存在，请刷新主题库")?;
        after.remove(index);
        self.save(before, after)
    }
    pub fn import(&self, mut incoming: Vec<Theme>) -> Result<Vec<Theme>, String> {
        let _lock = self.lock()?;
        let before = self.read_all()?;
        let mut used = before.iter().map(|t| t.name.to_lowercase()).collect();
        for item in &mut incoming { item.name = theme::reserve_import_name(&item.name, &mut used); }
        let mut after = before.clone(); after.extend(incoming);
        self.save(before, after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrades_old_library_once_preserving_schematic_customizations() {
        let root=std::env::temp_dir().join(format!("ltspice-upgrade-test-{}",config::now()));fs::create_dir(&root).unwrap();
        // Fixture for an older library: built-in themes whose waveform/netlist
        // colours still carry the pre-revision values, plus one user customisation.
        let mut old=theme::builtin().unwrap();
        for item in &mut old {
            for key in theme::keys().into_iter().filter(|key|!key.starts_with("SchematicColor")) {
                if let Some(value)=item.colors.get_mut(&key) { *value=(*value+1)&0xffffff; }
            }
        }
        old.iter_mut().find(|t|t.name=="blackwhite").unwrap().colors.insert("SchematicColor0".into(),12345);
        let mut custom=old[0].clone();custom.name="my-custom".into();old.push(custom.clone());
        let mut catalog=theme::catalog(old.clone());catalog.builtin_revision=0;
        let bytes=serde_json::to_vec(&catalog).unwrap();fs::write(root.join("theme-library.json"),&bytes).unwrap();
        let lib=Library(root.clone());let upgraded=lib.all().unwrap();assert_eq!(upgraded.len(),10);
        assert_eq!(upgraded.iter().find(|t|t.name=="my-custom").unwrap().colors,custom.colors);
        let builtins=theme::builtin().unwrap();
        for (name,reference) in [("blackwhite","blackwhite"),("blackred","blackred"),("redblack","default")] {
            let item=upgraded.iter().find(|t|t.name==name).unwrap();let original=old.iter().find(|t|t.name==name).unwrap();let reference=builtins.iter().find(|t|t.name==reference).unwrap();
            for key in theme::keys(){assert_eq!(item.colors[&key],if key.starts_with("SchematicColor"){original.colors[&key]}else{reference.colors[&key]});}
        }
        let snapshot:Catalog=serde_json::from_slice(&fs::read(root.join("theme-library.previous.json")).unwrap()).unwrap();assert_eq!(snapshot.themes.len(),old.len());
        let mut edited=upgraded.iter().find(|t|t.name=="blackwhite").unwrap().clone();edited.colors.insert("WaveColor2".into(),77);lib.update("blackwhite",edited).unwrap();
        assert_eq!(lib.all().unwrap().iter().find(|t|t.name=="blackwhite").unwrap().colors["WaveColor2"],77);
        assert!(!lib.all().unwrap().iter().any(|t|t.name=="matlab"));
        assert!(root.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn resets_modified_and_deleted_builtins_preserving_custom_themes() {
        let root=std::env::temp_dir().join(format!("ltspice-reset-test-{}",config::now()));let lib=Library(root.clone());
        let original=theme::builtin().unwrap();let mut edited=original[0].clone();edited.colors.insert("Grid".into(),123);
        lib.update("default",edited.clone()).unwrap();edited.name="custom-copy".into();lib.import(vec![edited.clone()]).unwrap();
        lib.reset_builtins(Some("default")).unwrap();assert_eq!(lib.all().unwrap()[0].colors,original[0].colors);
        lib.delete("dracula").unwrap();lib.reset_builtins(None).unwrap();
        let all=Library(root.clone()).all().unwrap();assert_eq!(all.len(),10);
        assert_eq!(all.iter().find(|t|t.name=="custom-copy").unwrap().colors,edited.colors);
        assert!(lib.reset_builtins(Some("custom-copy")).is_err());
        assert!(root.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn edit_rename_delete_builtins_persist_and_allow_empty_library() {
        let root = std::env::temp_dir().join(format!("ltspice-library-test-{}", config::now()));
        let library = Library(root.clone());
        let original = library.all().unwrap();
        let mut edited = original[0].clone();
        edited.name = "改名主题".into(); edited.colors.insert("Grid".into(), 123);
        library.update("default", edited.clone()).unwrap();
        assert_eq!(Library(root.clone()).all().unwrap()[0].name, "改名主题");
        let mut conflict = edited.clone(); conflict.name = "dracula".into();
        assert!(library.update("改名主题", conflict).is_err());
        assert_eq!(library.all().unwrap()[0].colors["Grid"], 123);
        library.delete("改名主题").unwrap();
        assert!(library.all().unwrap().iter().all(|t| t.name != "default" && t.name != "改名主题"));
        for item in library.all().unwrap() { library.delete(&item.name).unwrap(); }
        assert!(library.all().unwrap().is_empty());
        assert_eq!(library.import(vec![edited]).unwrap().len(), 1);
        assert!(root.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn imports_existing_custom_library_without_changing_old_file() {
        let root = std::env::temp_dir().join(format!("ltspice-library-test-{}", config::now()));
        fs::create_dir(&root).unwrap();
        let mut custom = theme::builtin().unwrap().remove(0); custom.name = "原有自定义".into();
        let old = serde_json::to_vec(&theme::catalog(vec![custom])).unwrap();
        fs::write(root.join("custom-themes.json"), &old).unwrap();
        let library = Library(root.clone());
        assert_eq!(library.all().unwrap().len(), 10);
        library.delete("default").unwrap();
        assert_eq!(library.all().unwrap().len(), 9);
        assert_eq!(fs::read(root.join("custom-themes.json")).unwrap(), old);
        assert!(root.canonicalize().unwrap().starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
}
