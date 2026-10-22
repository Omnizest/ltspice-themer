import { useId } from "react";
import { rgb } from "../lib/theme";
import buck from "../assets/buck.json";

const {start,end,samples}=buck.transient;
const left=66,right=824,top=38,bottom=282;
const x=(time:number)=>left+(time-start)/(end-start)*(right-left);
const y=(value:number,current:boolean)=>bottom-(value+(current ? 0.6 : 10))/(current ? 6.6 : 110)*(bottom-top);
const traces=[{name:"V(SW)",description:"开关节点电压",column:1,current:false},{name:"I(L1)",description:"电感电流",column:2,current:true},{name:"I(D1)",description:"二极管电流",column:3,current:true}];
export default function WaveformPreview({colors}:{colors:Record<string,number>}) {
  const clip=useId().replace(/:/g,"");
  const color=(key:string)=>rgb(colors[key]??0);
  return <div className="wave-canvas transient-canvas" style={{background:color("WaveColor0")}}>
    <svg viewBox="0 0 900 326" role="img" aria-label="Buck 瞬态局部波形：18.54至18.69毫秒，开关电压 V(SW)、电感电流 I(L1) 和二极管电流 I(D1)，左轴电压、右轴电流">
      <defs><clipPath id={clip}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath></defs>
      <g stroke={color("Grid")} strokeWidth=".7" strokeDasharray="3 5">{Array.from({length:12},(_,i)=><path key={i} d={`M${left} ${top+i*(bottom-top)/11}H${right}`}/>)}{Array.from({length:8},(_,i)=><path key={i} d={`M${x(start+i*.00002)} ${top}V${bottom}`}/>)}</g>
      <rect x={left} y={top} width={right-left} height={bottom-top} fill="none" stroke={color("WaveColor1")} strokeWidth=".8"/>
      <g fill={color("WaveColor1")} fontFamily="Consolas, monospace" fontSize="18">{Array.from({length:12},(_,i)=><g key={i}><text x={left-10} y={top+i*(bottom-top)/11+4} textAnchor="end">{100-i*10}V</text><text x={right+10} y={top+i*(bottom-top)/11+4}>{(6-i*.6).toFixed(1)}A</text></g>)}{Array.from({length:8},(_,i)=><text key={i} x={x(start+i*.00002)} y="304" textAnchor="middle">{((start+i*.00002)*1000).toFixed(2)}ms</text>)}</g>
      {traces.map((trace,i)=><g key={trace.name}><text x={200+i*250} y="22" textAnchor="middle" fill={color(`WaveColor${i+2}`)} fontFamily="Arial, sans-serif" fontSize="20">{trace.name}<title>{trace.description}</title></text><path data-signal={trace.name} clipPath={`url(#${clip})`} d={samples.map((row,j)=>`${j?"L":"M"}${x(row[0]).toFixed(5)} ${y(row[trace.column],trace.current).toFixed(5)}`).join(" ")} fill="none" stroke={color(`WaveColor${i+2}`)} strokeWidth="1.6" strokeLinejoin="miter"/></g>)}
    </svg>
  </div>;
}
