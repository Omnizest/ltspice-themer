import { useEffect, useRef, useState } from "react";

export interface ExportSnapshot {name:string;content:string}
export default function ExportPreview({snapshot,onClose,onSave}:{snapshot:ExportSnapshot;onClose:()=>void;onSave:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function save() {
    setBusy(true);setError("");
    try{await onSave();}catch(e){setError(String(e));}finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="theme-dialog wide export-dialog" aria-labelledby="export-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <div className="editor-heading"><div><h2 id="export-title">导出内容预览</h2><p>{snapshot.name}.txt · LTspice INI 兼容格式 · 35 项颜色</p></div><button className="icon-button" aria-label="关闭导出预览" disabled={busy} onClick={onClose}>×</button></div>
    <p className="editor-note">以下为将要保存的完整内容。点击“保存 TXT…”后选择文件位置。</p>
    <pre className="export-content" aria-label="完整导出内容" tabIndex={0}>{snapshot.content}</pre>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy} onClick={()=>void save()}>{busy?"正在保存…":"保存 TXT…"}</button></div>
  </dialog>;
}
