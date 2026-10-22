export interface Theme { name: string; sourceUrl: string | null; colors: Record<string, number> }
export interface Backup { id: string; createdAt: number; sourcePath: string; sha256: string; size: number }
export interface ConfigInfo { path: string; sha256: string; backups: Backup[]; valid: boolean; error: string | null; currentColors: Record<string,number> }
export interface Targets { schematic:boolean; waveform:boolean; netlist:boolean }
export function category(key:string):keyof Targets { return key.startsWith("SchematicColor")?"schematic":key.startsWith("Netlist")||key==="ContinuationLineColor"?"netlist":"waveform"; }
export interface Status { running: boolean; candidates: string[]; platform: string }
export function rgb(value: number) {
  return `#${[value & 255, (value >> 8) & 255, (value >> 16) & 255].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
export function displayPath(path: string) { return path.replace(/^\\\\\?\\/, ""); }
