import type { Theme, Targets } from "../lib/theme";
import { rgb, category } from "../lib/theme";
import SchematicPreview from "./SchematicPreview";
import { useState } from "react";
import buck from "../assets/buck.json";
import WaveformPreview from "./WaveformPreview";

export default function PreviewPane({theme,current,targets,onToggle}:{theme:Theme;current:Theme;targets:Targets;onToggle:(key:keyof Targets)=>void}) {
  const [showGrid,setShowGrid]=useState(false);
  const colors=Object.fromEntries(Object.keys(theme.colors).map(key=>[key,targets[category(key)]?theme.colors[key]:current.colors[key]]));
  const color=(key:string)=>rgb(colors[key]??0);
  const toggle=(key:keyof Targets,label:string)=><label className="apply-switch"><input type="checkbox" role="switch" aria-label={`应用${label}配色`} checked={targets[key]} onChange={()=>onToggle(key)}/><span className="switch-track"/><span>{targets[key]?"应用主题":"保留当前"}</span></label>;
  return <div className="preview-grid">
    <section className="preview-window schematic-window">
      <div className="window-label"><span className="window-dot"/>原理图 {toggle("schematic","原理图")}<button className="schematic-grid-toggle" aria-pressed={showGrid} onClick={()=>setShowGrid(!showGrid)}>网格{showGrid?"：开":"：关"}</button><span className="window-file">Buck-converter.asc</span></div>
      <SchematicPreview theme={{...theme,colors}} showGrid={showGrid}/>
    </section>
    <section className="preview-window wave-window">
      <div className="window-label"><span className="window-dot"/>波形查看器 {toggle("waveform","波形查看器")}<span className="window-file">瞬态 · 18.54–18.69ms · 左 V / 右 A</span></div>
      <WaveformPreview colors={colors}/>
    </section>
    <section className="preview-window netlist-window">
      <div className="window-label"><span className="window-dot"/>网表 {toggle("netlist","网表")}<span className="window-file">Buck-converter.net</span></div>
      <pre style={{background:color("NetlistBackgroundColor"),color:color("NetlistNormalTextColor")}}>{buck.netlist.map((line,i)=><span key={i} style={{color:color(line.startsWith("*")?"NetlistCommentTextColor":line.startsWith(".")?"NetlistDotcmdTextColor":line.startsWith("+")?"ContinuationLineColor":"NetlistNormalTextColor")}}>{line+"\n"}</span>)}</pre>
    </section>
  </div>;
}
