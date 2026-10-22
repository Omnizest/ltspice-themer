import { useEffect, useRef, useState } from "react";
import type { Theme, Targets } from "../lib/theme";
import { category, rgb } from "../lib/theme";

export type EditorMode = "edit" | "delete";
export default function ThemeEditor({theme,mode,busy,onClose,onSave,onDelete}:{theme:Theme;mode:EditorMode;busy:boolean;onClose:()=>void;onSave:(edited:Theme)=>Promise<void>;onDelete:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [name,setName]=useState(theme.name);
  const [sourceUrl,setSourceUrl]=useState(theme.sourceUrl??"");
  const [tab,setTab]=useState<keyof Targets>("schematic");
  const [values,setValues]=useState(Object.fromEntries(Object.entries(theme.colors).map(([key,value])=>[key,rgb(value)])));
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const valid=Object.values(values).every(v=>/^#[0-9a-f]{6}$/i.test(v));
  const blocked=busy||saving;
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function submit() {
    setError("");setSaving(true);
    try {
      if(mode==="delete") { await onDelete(); return; }
      if(!name.trim()||!valid) throw new Error("请填写主题名称和有效的六位 HEX 颜色。");
      const colors=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,parseInt(value.slice(1,3),16)+(parseInt(value.slice(3,5),16)<<8)+(parseInt(value.slice(5,7),16)<<16)]));
      await onSave({...theme,name:name.trim(),sourceUrl:sourceUrl.trim()||null,colors});
    } catch(e) { setError(String(e)); } finally {setSaving(false);}
  }
  return <dialog ref={dialog} className={`theme-dialog ${mode==="edit"?"wide":""}`} aria-labelledby="editor-title" onCancel={e=>{e.preventDefault();if(!blocked)onClose();}}>
    <form onSubmit={e=>{e.preventDefault();void submit();}}>
      <div className="editor-heading"><div><h2 id="editor-title">{mode==="delete"?"删除主题":"编辑主题内容"}</h2><p>{theme.name}</p></div><button type="button" className="icon-button" aria-label="关闭编辑窗口" disabled={blocked} onClick={onClose}>×</button></div>
      {mode==="delete"?<p className="delete-description">确定从主题库删除“{theme.name}”？已应用到 LTspice 的配色和配置备份会继续保留。</p>:<label className="name-field">主题名称<input autoFocus aria-label="主题名称" value={name} disabled={blocked} onChange={e=>setName(e.target.value)} required/></label>}
      {mode==="edit"&&<label className="name-field source-field">SourceUrl<input aria-label="SourceUrl" type="url" pattern="https?://.+" maxLength={2048} placeholder="https://…（可留空）" value={sourceUrl} disabled={blocked} onChange={e=>setSourceUrl(e.target.value)}/></label>}
      {mode==="edit"&&<><div className="editor-tabs" role="tablist" aria-label="配色类别">{([["schematic","原理图 · 14"],["waveform","波形 · 16"],["netlist","网表 · 5"]] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div><div className="color-fields" role="tabpanel">{Object.keys(values).filter(key=>category(key)===tab).map(key=><label className="color-field" key={key}><span>{key}</span><input type="color" aria-label={`${key} 取色`} value={/^#[0-9a-f]{6}$/i.test(values[key])?values[key]:rgb(theme.colors[key])} disabled={blocked} onChange={e=>setValues({...values,[key]:e.target.value})}/><input aria-label={`${key} HEX`} value={values[key]} spellCheck={false} maxLength={7} disabled={blocked} aria-invalid={!/^#[0-9a-f]{6}$/i.test(values[key])} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}</div><p className="editor-note">支持全部 35 项颜色。保存后更新预览；应用到 LTspice 时仍由三个开关决定范围。</p></>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="button secondary" disabled={blocked} onClick={onClose}>取消</button><button type="submit" className={`button ${mode==="delete"?"danger":"primary"}`} disabled={blocked||(mode!=="delete"&&(!name.trim()||!valid))}>{blocked?"正在保存…":mode==="delete"?"确认删除":"保存修改"}</button></div>
    </form>
  </dialog>;
}
