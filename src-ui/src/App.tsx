import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import catalog from "../../themes/builtin.json";
import type { ConfigInfo, Status, Theme, Targets } from "./lib/theme";
import { displayPath, rgb } from "./lib/theme";
import PreviewPane from "./components/PreviewPane";
import ThemeEditor from "./components/ThemeEditor";
import type { EditorMode } from "./components/ThemeEditor";
import ExportPreview from "./components/ExportPreview";
import type { ExportSnapshot } from "./components/ExportPreview";
import BackupDeleteDialog from "./components/BackupDeleteDialog";
import type { BackupDeleteRequest } from "./components/BackupDeleteDialog";
import ResetBuiltinsDialog from "./components/ResetBuiltinsDialog";
import appIcon from "./assets/app-icon.png";
import "./App.css";

export default function App() {
  const desktop = isTauri();
  const [themes, setThemes] = useState<Theme[]>(catalog.themes);
  const [selected, setSelected] = useState("dracula");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [backend, setBackend] = useState(desktop ? "正在连接…" : "浏览器预览");
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [path, setPath] = useState(localStorage.getItem("configPath") ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [backupId, setBackupId] = useState("");
  const [light, setLight] = useState(localStorage.getItem("appearance") === "light");
  const [editor,setEditor]=useState<EditorMode|null>(null);
  const [exportSnapshot,setExportSnapshot]=useState<ExportSnapshot|null>(null);
  const [backupDelete,setBackupDelete]=useState<BackupDeleteRequest|null>(null);
  const [resetRequest,setResetRequest]=useState<{name:string|null}|null>(null);
  const [targets,setTargets]=useState<Targets>({schematic:true,waveform:true,netlist:true});
  const fileInput = useRef<HTMLInputElement>(null);
  const theme = themes.find(t => t.name === selected) ?? themes[0] ?? catalog.themes[0];
  const hasTheme=themes.length>0;
  const current:Theme={...catalog.themes[0],colors:info?.currentColors??catalog.themes[0].colors};
  const backups = [...(info?.backups ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const error = (e: unknown) => setNotice({ text: String(e), error: true });

  async function inspect(next: string) {
    const result = await invoke<ConfigInfo>("inspect_config", { path: next });
    setInfo(result); setPath(displayPath(result.path));
    localStorage.setItem("configPath", result.path);
    setBackupId(previous=>result.backups.some(b=>b.id===previous)?previous:([...result.backups].sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? ""));
    return result;
  }
  useEffect(() => {
    document.documentElement.dataset.appearance = light ? "light" : "dark";
    localStorage.setItem("appearance", light ? "light" : "dark");
  }, [light]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    Promise.all([invoke<Theme[]>("list_themes"), invoke<Status>("get_status"), invoke<string>("health_check")]).then(async ([list, current, health]) => {
      if (!active) return;
      setThemes(list); setStatus(current); setBackend(health ? "已连接" : "连接失败");
      const saved = localStorage.getItem("configPath");
      const initial = saved || (current.candidates.length === 1 ? current.candidates[0] : "");
      if (initial) { try { await inspect(initial); } catch (e) { if (active) error(e); } }
    }).catch(e => { if (active) { setBackend("连接失败"); error(e); } });
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      invoke<Status>("get_status").then(value => { if (active) setStatus(value); }, () => { if (active) setStatus(null); }).finally(() => { polling = false; });
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [desktop]);
  useEffect(()=>{
    if(!desktop||!info||busy||backupDelete||exportSnapshot||editor)return;
    let active=true;
    const refreshOnFocus=()=>{invoke<ConfigInfo>("inspect_config",{path:info.path}).then(result=>{
      if(!active)return;setInfo(result);
      setBackupId(previous=>result.backups.some(b=>b.id===previous)?previous:([...result.backups].sort((a,b)=>b.createdAt-a.createdAt)[0]?.id??""));
    }).catch(()=>{if(active)setInfo(null);});};
    window.addEventListener("focus",refreshOnFocus);
    return()=>{active=false;window.removeEventListener("focus",refreshOnFocus);};
  },[desktop,info?.path,busy,backupDelete,exportSnapshot,editor]);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await work(); } catch (e) { error(e); } finally { setBusy(false); }
  }
  async function chooseConfig() {
    const next = await open({ multiple: false, directory: false, filters: [{ name: "LTspice 配置", extensions: ["ini"] }] });
    if (typeof next === "string") await inspect(next);
  }
  async function refresh() {
    setStatus(await invoke<Status>("get_status"));
    setInfo(null);
    if (path.trim()) await inspect(path.trim());
    setNotice({ text: "配置与运行状态已刷新", error: false });
  }
  async function apply() {
    if (!info || !hasTheme) return;
    const result = await invoke<ConfigInfo>("apply_theme", { path: info.path, name: theme.name, expectedHash: info.sha256, targets });
    setInfo(result); setBackupId([...result.backups].sort((a,b) => b.createdAt-a.createdAt)[0]?.id ?? "");
    setNotice({ text: `已应用 ${theme.name} 的开启类别，关闭类别保持原配色。原配置已自动备份，重新打开 LTspice 即可查看。`, error: false });
  }
  async function restore() {
    if (!info || !backupId) return;
    const result = await invoke<ConfigInfo>("restore_backup", { path: info.path, id: backupId, expectedHash: info.sha256 });
    setInfo(result); setNotice({ text: "备份已还原，还原前的配置也已保存为新备份。", error: false });
  }
  async function refreshBackups(){
    try{await inspect(path.trim());setNotice({text:"已重新读取当前配置文件夹的备份记录",error:false});}
    catch(e){setInfo(null);throw e;}
  }
  async function removeBackup(){
    if(!backupDelete)return;
    setBusy(true);
    try{
      const result=await invoke<ConfigInfo>("delete_backup",{path:backupDelete.path,id:backupDelete.id});
      setInfo(result);setBackupId([...result.backups].sort((a,b)=>b.createdAt-a.createdAt)[0]?.id??"");
      setBackupDelete(null);setNotice({text:"备份已删除，列表已刷新",error:false});
    }finally{setBusy(false);}
  }
  async function importFile(file: File) {
    if (file.size > 1024 * 1024) throw new Error("主题文件不能超过 1MB");
    const result = await invoke<Theme[]>("import_themes", { content: Array.from(new Uint8Array(await file.arrayBuffer())), fileName: file.name });
    setThemes(result); setSelected(result[result.length - 1].name);
    setNotice({ text: "主题已导入并保存", error: false });
  }
  async function exportFile() {
    const content=await invoke<string>("preview_export_theme",{name:theme.name});
    setExportSnapshot({name:theme.name,content});
  }
  async function saveExport() {
    if(!exportSnapshot)return;
    const {name,content}=exportSnapshot;
    const target = await save({ defaultPath: `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "")}.txt`, filters: [{ name: "LTspice 主题 TXT", extensions: ["txt"] }] });
    if (target) { await invoke("export_theme", { path: target, name, expectedContent:content }); setExportSnapshot(null);setNotice({ text: "主题已导出", error: false }); }
  }
  async function saveTheme(edited:Theme) {
    setBusy(true);
    try {
      const list=await invoke<Theme[]>("update_theme",{originalName:theme.name,edited});
      setThemes(list);setSelected(edited.name);setEditor(null);
      setNotice({text:"主题修改已保存",error:false});
    } finally {setBusy(false);}
  }
  async function deleteTheme() {
    setBusy(true);
    try {
      const list=await invoke<Theme[]>("delete_theme",{name:theme.name});
      setThemes(list);setSelected(list[0]?.name??"");setEditor(null);
      setNotice({text:"主题已从主题库删除",error:false});
    } finally {setBusy(false);}
  }
  async function resetBuiltins(){
    if(!resetRequest)return;setBusy(true);
    try{const list=await invoke<Theme[]>("reset_builtin_themes",{name:resetRequest.name});setThemes(list);setSelected(resetRequest.name??"default");setResetRequest(null);setNotice({text:"内置主题已恢复默认",error:false});}finally{setBusy(false);}
  }
  const canWrite = desktop && status !== null && !status.running && !busy;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-symbol" src={appIcon} alt=""/><div>LTspice<span>THEMER</span></div></div>
      <div className="library-heading"><span>主题库</span><span className="count">{themes.length}</span></div>
      <label className="search"><svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索主题" aria-label="搜索主题" /></label>
      <nav className="theme-list" aria-label="主题列表">
        {themes.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).map((t, index) => <button key={t.name} className={`theme-item ${theme.name === t.name ? "selected" : ""}`} onClick={() => setSelected(t.name)}>
          <div className="mini-preview" style={{ background: rgb(t.colors.SchematicColor12) }}><span style={{ background: rgb(t.colors.SchematicColor0) }} /><span style={{ background: rgb(t.colors.SchematicColor2) }} /><span style={{ background: rgb(t.colors.SchematicColor5) }} /></div>
          <div><strong>{t.name}</strong><small>{catalog.themes.some(b => b.name === t.name) ? "内置主题" : "自定义主题"}</small></div><span className="item-marker">{theme.name === t.name ? "✓" : String(index + 1).padStart(2, "0")}</span>
        </button>)}
        {!themes.some(t => t.name.toLowerCase().includes(search.toLowerCase())) && <p className="empty">没有找到匹配主题</p>}
      </nav>
      <div className="sidebar-bottom"><button className="button secondary full" style={{marginBottom:8}} disabled={!desktop||busy} onClick={()=>setResetRequest({name:null})}>恢复全部内置主题</button><button className="button secondary full" disabled={!desktop || busy} onClick={() => fileInput.current?.click()}>＋ 导入主题 TXT</button><p>支持 TXT / INI · 全部 35 项配色</p><input type="file" accept=".txt,.ini,text/plain" hidden ref={fileInput} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void action(() => importFile(file)); }} /></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><span className="breadcrumb">主题工作台 <span>/</span> <strong>实时预览</strong></span><div className="header-actions"><span className="connection" role="status"><i />{backend}</span><button className="icon-button" onClick={() => setLight(!light)} aria-label="切换界面亮暗模式" title="切换界面亮暗模式">{light ? "☾" : "☀"}</button></div></header>
      <div className="workspace-content">
        <div className="page-title"><div><p className="eyebrow">MAKE YOUR CIRCUITS FEEL AT LTSPICE THEMER</p><h1>{hasTheme?theme.name:"主题库为空"}</h1><p className="subtitle">{hasTheme?"为原理图、波形与网表，找到更舒适的色彩。":"导入 TXT / INI 文件即可重新添加主题。"}</p></div><div className="theme-actions">{hasTheme&&catalog.themes.some(t=>t.name===theme.name)&&<button className="button secondary" disabled={!desktop||busy} onClick={()=>setResetRequest({name:theme.name})}>恢复默认</button>}<button className="button secondary" disabled={!desktop||busy||!hasTheme} onClick={()=>setEditor("edit")}>编辑内容</button><button className="button secondary danger-text" disabled={!desktop||busy||!hasTheme} onClick={()=>setEditor("delete")}>删除</button><button className="button secondary" disabled={!desktop || busy || !hasTheme} onClick={() => void action(exportFile)}>导出 TXT ↗</button></div></div>
        <p className="scope-note">打开开关才应用该类别；关闭时保留配置文件当前配色。{info?.valid?"预览已读取当前LTspice配置文件。":"请先选择并验证LTspice配置文件。"}</p>
        <PreviewPane theme={hasTheme?theme:current} current={current} targets={targets} onToggle={key=>setTargets({...targets,[key]:!targets[key]})} />
        <div className="preview-caption"><span>Buck-converter.asc · 原始仿真数据 · 实际效果以 LTspice 为准</span><span title={theme.sourceUrl ?? ""}>{hasTheme?(theme.sourceUrl??""):""}</span></div>
        <section className="palette-panel"><div className="section-heading"><h2>主题色板</h2><span>35 项配色完整保留</span></div><div className="swatches">{["SchematicColor12", "SchematicColor0", "SchematicColor1", "SchematicColor2", "SchematicColor5", "Grid", "WaveColor0", "WaveColor1", "WaveColor2", "NetlistBackgroundColor", "NetlistNormalTextColor", "NetlistDotcmdTextColor"].map(key => <div className="swatch" key={key} title={`${key} · ${theme.colors[key]}`}><i style={{ background: rgb(theme.colors[key]) }} /><span>{rgb(theme.colors[key]).toUpperCase()}</span><small>{key.replace("SchematicColor", "原理图 ").replace("WaveColor", "波形 ").replace("NetlistBackgroundColor", "网表背景").replace("NetlistNormalTextColor", "网表文本").replace("NetlistDotcmdTextColor", "网表指令").replace("Grid", "网格")}</small></div>)}</div></section>
        <section className="config-panel"><div className="section-heading"><h2>应用到 LTspice</h2><span className={`process-badge ${status?.running ? "running" : ""}`}>{!desktop ? "桌面应用中可用" : status === null ? "运行状态未知" : status.running ? "LTspice 正在运行，请先关闭" : "LTspice 已关闭"}</span></div>
          <div className="path-row"><input aria-label="LTspice 配置路径" placeholder="选择或输入 LTspice.ini / LTspiceXVII.ini 路径" value={path} onChange={e => { setPath(e.target.value); setInfo(null); }} disabled={busy || !desktop} /><button className="button secondary" disabled={busy || !desktop} onClick={() => void action(chooseConfig)}>浏览…</button><button className="button secondary" disabled={busy || !desktop} onClick={() => void action(refresh)}>验证 / 刷新</button></div>
          {!info && status && status.candidates.length > 0 && <div className="candidates">{status.candidates.map(p => <button key={p} disabled={busy} onClick={() => void action(() => inspect(p).then(() => {}))}>{displayPath(p)}</button>)}</div>}
          {info && !info.valid && <p className="inline-error">{info.error}；仍可从已保存的备份恢复。</p>}
          <div className="apply-row"><div><strong>{info ? info.valid ? "配置已验证" : "配置需要修复" : "请选择并验证配置文件"}</strong><p>每次应用前自动备份 · 仅修改开关已开启的类别{!Object.values(targets).some(Boolean)?" · 请至少打开一个开关":""}</p></div><button className="button primary" disabled={!canWrite || !info?.valid || !hasTheme || !Object.values(targets).some(Boolean)} onClick={() => void action(apply)}>{busy ? "正在处理…" : `应用 ${hasTheme?theme.name:"主题"} →`}</button></div>
          <div className="restore-row"><div><span className="restore-icon">↶</span><strong>配置备份</strong><small>{backups.length} 份可用</small></div><select aria-label="选择备份" value={backupId} disabled={busy || !backups.length} onChange={e => setBackupId(e.target.value)}><option value="">选择要恢复的备份</option>{backups.map(b => <option value={b.id} key={b.id}>{new Date(b.createdAt).toLocaleString()} · {b.size} 字节</option>)}</select><button className="button secondary" disabled={!desktop||busy||!path.trim()} onClick={()=>void action(refreshBackups)}>刷新备份</button><button className="button secondary danger-text" disabled={!desktop||busy||!info||!backups.some(b=>b.id===backupId)} onClick={()=>{const selected=backups.find(b=>b.id===backupId);if(info&&selected)setBackupDelete({path:info.path,...selected});}}>删除选中备份</button><button className="button secondary" disabled={!canWrite || !info || !backupId} onClick={() => void action(restore)}>还原选中备份</button></div><p className="backup-note">还原前也会保存当前配置。备份目录：{info?`${displayPath(info.path).replace(/[\\/][^\\/]+$/,"")}\\.ltspice-themer-backups`:"所选 INI 旁的 .ltspice-themer-backups 文件夹"}。刷新或切回窗口时重新读取记录，已移除的文件不再列出。</p>
        </section>
        {notice && <div className={`notice ${notice.error ? "error" : "success"}`} role="alert"><span>{notice.error ? "!" : "✓"}</span><p>{notice.text}</p><button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
      </div>
    </main>
    {editor&&hasTheme&&<ThemeEditor key={`${editor}:${theme.name}`} theme={theme} mode={editor} busy={busy} onClose={()=>setEditor(null)} onSave={saveTheme} onDelete={deleteTheme}/>}
    {exportSnapshot&&<ExportPreview snapshot={exportSnapshot} onClose={()=>setExportSnapshot(null)} onSave={saveExport}/>}
    {backupDelete&&<BackupDeleteDialog backup={backupDelete} onClose={()=>setBackupDelete(null)} onDelete={removeBackup}/>}
    {resetRequest&&<ResetBuiltinsDialog name={resetRequest.name} onClose={()=>setResetRequest(null)} onReset={resetBuiltins}/>}
  </div>;
}
