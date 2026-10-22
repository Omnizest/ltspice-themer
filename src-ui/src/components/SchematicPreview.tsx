import type { Theme } from "../lib/theme";
import { rgb } from "../lib/theme";
import buck from "../assets/buck.json";

// Geometry comes directly from Buck-converter.asc and LTspice's installed ASY symbols.
// Labels are placed separately to avoid collisions with wires and adjacent symbols.
const labels = [
  {name:"V1",value:"100",x:-46,y:156,anchor:"end"},
  {name:"D1",value:"",x:305,y:171,anchor:"start"},
  {name:"L1",value:"1m",x:392,y:39,anchor:"middle"},
  {name:"C1",value:"10µ",x:526,y:165,anchor:"start"},
  {name:"R1",value:"10",x:660,y:165,anchor:"start"},
  {name:"S1",value:"MOSFET",x:137,y:157,anchor:"middle"},
  {name:"V2",value:"PULSE",x:136,y:-122,anchor:"middle"},
] as const;
export default function SchematicPreview({theme,showGrid}:{theme:Theme;showGrid:boolean}) {
  const color=(n:number)=>rgb(theme.colors[`SchematicColor${n}`]);
  return <div className="schematic-canvas" style={{backgroundColor:color(12),backgroundImage:showGrid?`radial-gradient(${color(11)} 0.7px, transparent 0.85px)`:"none"}}>
    <svg className="schematic-drawing" viewBox="-100 -160 1010 575" role="img" aria-label="Buck 变换器：100V 输入、MOSFET 开关、续流二极管、1mH 电感、10µF 电容和10欧负载；16kHz、50%占空比">
      <g fill="none" stroke={color(0)} strokeWidth="1.5">{buck.wires.map(([x1,y1,x2,y2],i)=><path key={i} d={`M${x1} ${y1}L${x2} ${y2}`}/>)}</g>
      <g fill="none" stroke={color(2)} strokeWidth="1.5">{buck.symbols.map(s=><g key={s.name} transform={`translate(${s.x} ${s.y}) rotate(${s.rotation})`}>{s.paths.map((d,i)=><path key={i} d={d}/>)}</g>)}</g>
      <g fill={color(1)}>{[[0,240],[64,48],[208,48],[272,96],[496,96],[272,240],[496,240]].map(([x,y])=><circle key={`${x},${y}`} cx={x} cy={y} r="3"/>)}</g>
      <path d="M0 272L-12 272L0 284L12 272Z" fill="none" stroke={color(3)} strokeWidth="1.5"/>
      <text x="272" y="87" textAnchor="middle" fill={color(6)} fontFamily="Arial, sans-serif" fontSize="18">SW</text>
      <g fill={color(5)} fontFamily="Arial, sans-serif" fontSize="18">{labels.map(l=><text key={l.name} x={l.x} y={l.y} textAnchor={l.anchor}>{l.name}{l.value&&<tspan x={l.x} dy="24">{l.value}</tspan>}</text>)}</g>
      <g fill={color(7)} fontFamily="Arial, sans-serif" fontSize="17">
        <text x="440" y="-48">.tran 50m</text>
        <text x="440" y="-12">.param Fs = 16k</text><text x="440" y="16">.param D = 0.5</text>
        <text x="-55" y="333">.model MOSFET SW(Ron=1u Roff=100Meg Vt=90)</text>
        <text x="-55" y="365">V2: PULSE(0 100 0 1n 1n {'{D/Fs} {1/Fs}'} 1Meg)</text>
      </g>
      <text x="440" y="-105" fill={color(8)} fontFamily="Arial, sans-serif" fontSize="18">Switching frequency: 16 kHz</text>
    </svg>
  </div>;
}
