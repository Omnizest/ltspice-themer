import {useEffect,useRef,useState} from "react";
export default function ResetBuiltinsDialog({name,onClose,onReset}:{name:string|null;onClose:()=>void;onReset:()=>Promise<void>}){
  const ref=useRef<HTMLDialogElement>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  return <dialog ref={ref} className="theme-dialog backup-delete-dialog" aria-labelledby="reset-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><h2 id="reset-title">恢复内置主题默认值</h2><p className="delete-description" style={{marginTop:20}}>{name?`将“${name}”的配色和来源恢复为出厂值。`:"恢复全部 9 个内置主题，补回已删除的内置主题。同名内置主题的修改将被覆盖，其他名称的主题保留。"} 此操作不会修改 LTspice 当前配置。</p>{error&&<p className="inline-error">{error}</p>}<div className="editor-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy} onClick={()=>{setBusy(true);void onReset().catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{busy?"正在恢复…":"确认恢复默认"}</button></div></dialog>;
}
