import { useEffect, useRef, useState } from "react";

export interface BackupDeleteRequest {path:string;id:string;createdAt:number;size:number}
export default function BackupDeleteDialog({backup,onClose,onDelete}:{backup:BackupDeleteRequest;onClose:()=>void;onDelete:()=>Promise<void>}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  async function confirm(){setBusy(true);setError("");try{await onDelete();}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <dialog ref={ref} className="theme-dialog backup-delete-dialog" aria-labelledby="backup-delete-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <div className="editor-heading"><h2 id="backup-delete-title">删除选中备份</h2></div>
    <p className="delete-description">确定删除 {new Date(backup.createdAt).toLocaleString()} 的备份（{backup.size} 字节）？删除后无法从此备份还原。</p>
    <p className="editor-note">当前配置：{display(backup.path)}。删除仅移除这份备份文件及记录。</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button danger" disabled={busy} onClick={()=>void confirm()}>{busy?"正在删除…":"确认删除备份"}</button></div>
  </dialog>;
}
function display(path:string){return path.replace(/^\\\\\?\\/,"");}
