import { useId } from "react";
import buck from "../assets/buck.json";

// Real transient samples; preserve the switching edges and triangular currents.
// Voltage and current use independent axes matching the LTspice reference view.
export default function BuckWaveform({color}:{color:(key:string)=>string}) {
  const clip=useId().replace(/:/g,"");
  const {start,end,samples}=buck.transient;
  const left=64,right=836,top=42,bottom=326;
  const x=(t:number)=>left+(t-start)/(end-start)*(right-left);
  const y=(value:number,current:boolean)=>bottom-(value+(current?.6:10))/(current?6.6:110)*(bottom-top);
  const trace=(column:number)=>samples.map((row,i)=>`${i?"L":"M"}${x(row[0]).toFixed(4)} ${y(row[column],column!==1).toFixed(4)}`).join(" ");
  return <div className="wave-canvas" style={{background:color("WaveColor0")}}>
    <svg className="buck-waveform" viewBox="0 0 900 380" role="img" aria-label="Buck 瞬态局部放大：18.54至18.69毫秒，开关节点电压 V(n004)、电感电流 I(L1)、二极管电流 I(D1)，左侧电压轴、右侧电流轴">
      <defs><clipPath id={clip}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath></defs>
      <g fill="none" stroke={color("Grid")} strokeWidth=".7" strokeDasharray="3 4">
        {Array.from({length:12},(_,i)=><path key={`y${i}`} d={`M${left} ${y(-10+i*10,false)}H${right}`}/>)}
        {Array.from({length:8},(_,i)=><path key={`x${i}`} d={`M${x(start+i*.00002)} ${top}V${bottom}`}/>)}</g>
      <rect x={left} y={top} width={right-left} height={bottom-top} fill="none" stroke={color("InActiveAxis")} strokeWidth=".8"/>
      <g clipPath={`url(#${clip})`} fill="none" strokeWidth="1.6" strokeLinejoin="miter">
        {[1,2,3].map(column=><path data-signal={buck.transient.signals[column-1]} key={column} d={trace(column)} stroke={color(`WaveColor${column}`)}/>)}</g>
      <g fill={color("InActiveAxis")} fontFamily="Consolas, monospace" fontSize="12">
        {Array.from({length:12},(_,i)=><g key={i}><text x={left-9} y={y(-10+i*10,false)+4} textAnchor="end">{-10+i*10}V</text><text x={right+9} y={y(-10+i*10,false)+4}>{(-.6+i*.6).toFixed(1)}A</text></g>)}
        {Array.from({length:8},(_,i)=><text key={i} x={x(start+i*.00002)} y={bottom+23} textAnchor="middle">{((start+i*.00002)*1000).toFixed(2)}ms</text>)}
      </g>
      {["V(n004) · 开关节点","I(L1) · 电感电流","I(D1) · 二极管电流"].map((label,i)=><text key={label} x={193+i*257} y="23" textAnchor="middle" fill={color(`WaveColor${i+1}`)} fontFamily="Arial, sans-serif" fontSize="14">{label}</text>)}
      <text x="450" y="371" textAnchor="middle" fill={color("InActiveAxis")} fontSize="11">瞬态局部放大 · 150 µs · 左轴 V / 右轴 A</text>
    </svg>
  </div>;
}
