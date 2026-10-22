// Checks the packaged WebView through a loopback debugging port used only for this test.
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const [port, screenshot, fixture, management] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? "")) throw new Error("Pass the test WebView debugging port");
let target;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && !target) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) });
    const pages = await response.json();
    target = pages.find((page) => page.type === "page" && /tauri[.:]/.test(page.url));
  } catch { /* The newly launched runtime may still be starting. */ }
  if (!target) await delay(500);
}
if (!target) throw new Error("Packaged application WebView did not appear within 30 seconds");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 25_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  const result = await call("Runtime.evaluate", {
    expression: `(async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const cards = [...document.querySelectorAll('.theme-item strong')].map(el => el.textContent);
        const status = document.querySelector('[role="status"]')?.textContent;
        if (status === '已连接' && document.querySelectorAll('[role="switch"]').length === 3) return { title: document.title, status, themes: cards, url: location.href, footerCount: document.querySelectorAll("footer").length, brandIcon: document.querySelector('img.brand-symbol')?.currentSrc ?? null };
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Expected three application switches and a successful Rust health check: ' + document.body.innerText);
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value, null, 2));
  if(management==='appearance'){
    const verified=await call('Runtime.evaluate',{expression:`(async()=>{
      const wait=async f=>{const end=Date.now()+10000;while(Date.now()<end){if(f())return;await new Promise(r=>setTimeout(r,80));}throw new Error('UI condition timed out');};
      const themes=await window.__TAURI_INTERNALS__.invoke('list_themes');
      const searchBox=document.querySelector('.search').getBoundingClientRect(),searchIcon=document.querySelector('.search-icon')?.getBoundingClientRect();
      if(!searchIcon||Math.abs((searchIcon.top+searchIcon.height/2)-(searchBox.top+searchBox.height/2))>.5)throw new Error('Search icon is not vertically centered');
      const hex=value=>'#'+[value&255,(value>>8)&255,(value>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');
      const normalized=hex=>{const probe=document.createElement('i');probe.style.color=hex;document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;};
      for(const card of document.querySelectorAll('.theme-item')){
        const theme=themes.find(t=>t.name===card.querySelector('strong').textContent),icon=card.querySelector('.mini-preview');
        if(getComputedStyle(icon).backgroundColor!==normalized(hex(theme.colors.SchematicColor12)))throw new Error('Icon background mismatch');
        const keys=['SchematicColor0','SchematicColor2','SchematicColor5'];
        [...icon.children].forEach((bar,i)=>{if(getComputedStyle(bar).backgroundColor!==normalized(hex(theme.colors[keys[i]])))throw new Error('Icon palette mismatch: '+theme.name);});
      }
      const importedName='ICON-IMPORT-'+Date.now();
      const importedColors={...themes[0].colors,SchematicColor12:0x332211,SchematicColor0:0xcc8844,SchematicColor2:0x44cc88,SchematicColor5:0xbb55aa};
      try{
        const content='; ThemeName='+importedName+'\\r\\n[Colors]\\r\\n'+Object.entries(importedColors).map(([k,v])=>k+'='+v).join('\\r\\n');
        const transfer=new DataTransfer();transfer.items.add(new File([content],importedName+'.txt',{type:'text/plain'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>document.querySelector('h1').textContent===importedName);
        const card=[...document.querySelectorAll('.theme-item')].find(c=>c.querySelector('strong').textContent===importedName),icon=card.querySelector('.mini-preview');
        if(getComputedStyle(icon).backgroundColor!==normalized('#112233'))throw new Error('Imported background did not adapt');
        ['#4488cc','#88cc44','#aa55bb'].forEach((color,i)=>{if(getComputedStyle(icon.children[i]).backgroundColor!==normalized(color))throw new Error('Imported theme icon did not adapt');});
        [...document.querySelectorAll('.theme-actions button')].find(b=>b.textContent==='删除').click();await wait(()=>document.querySelector('dialog[open]'));
        [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='确认删除').click();await wait(()=>!document.querySelector('dialog'));
        const remaining=await window.__TAURI_INTERNALS__.invoke('list_themes');if(JSON.stringify(remaining)!==JSON.stringify(themes))throw new Error('Existing themes changed');
      }finally{const remaining=await window.__TAURI_INTERNALS__.invoke('list_themes');if(remaining.some(t=>t.name===importedName))await window.__TAURI_INTERNALS__.invoke('delete_theme',{name:importedName});}
      if(document.querySelector('.eyebrow').textContent!=='MAKE YOUR CIRCUITS FEEL AT LTSPICE THEMER')throw new Error('Heading mismatch');
      const input=document.querySelector('[aria-label="LTspice 配置路径"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(fixture)});input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='验证 / 刷新').click();
      await wait(()=>document.querySelector('.scope-note').textContent==='打开开关才应用该类别；关闭时保留配置文件当前配色。预览已读取当前LTspice配置文件。');
      if(document.documentElement.dataset.appearance!=='light')document.querySelector('[aria-label="切换界面亮暗模式"]').click();
      await new Promise(r=>setTimeout(r,100));
      window.scrollTo(0,0);
      return {themeIcons:themes.length,importedThemeIcon:'automatically adapted; test theme removed; existing themes unchanged',colors:'schematic wire, symbol and component text',caption:document.querySelector('.scope-note').textContent,heading:document.querySelector('.eyebrow').textContent};
    })()`,awaitPromise:true,returnByValue:true});
    if(verified.exceptionDetails)throw new Error(JSON.stringify(verified.exceptionDetails));console.log(JSON.stringify(verified.result.value,null,2));
    if(screenshot){
      const bounds=await call('Runtime.evaluate',{expression:"(()=>{const r=document.querySelector('.search').getBoundingClientRect();return {x:r.left-5,y:r.top-5,width:r.width+10,height:r.height+10,scale:3};})()",returnByValue:true});
      const detail=await call('Page.captureScreenshot',{format:'png',clip:bounds.result.value});await writeFile(screenshot.replace(/\.png$/,'-search.png'),Buffer.from(detail.data,'base64'));
    }
  }
  if(management==='matlab'){
    const expected=JSON.parse(await readFile(new URL('../themes/builtin.json',import.meta.url),'utf8')).themes;
    const check=await call('Runtime.evaluate',{expression:`(async()=>{
      const invoke=window.__TAURI_INTERNALS__.invoke;const expected=${JSON.stringify(expected)};
      if(document.querySelectorAll('[role="switch"]:checked').length!==3)throw new Error('Application switches should start enabled');
      const themes=await invoke('list_themes');const matlab=themes.find(t=>t.name==='matlab');
      if(!matlab||JSON.stringify(matlab.colors)!==JSON.stringify(Object.fromEntries(Object.entries(expected.find(t=>t.name==='matlab').colors).sort())))throw new Error('MATLAB colors mismatch');
      for(const [name,reference] of [['blackwhite','matlab'],['blackred','matlab'],['redblack','default']]){
        const item=themes.find(t=>t.name===name),base=expected.find(t=>t.name===reference);if(!item)continue;
        for(const key of Object.keys(base.colors))if(!key.startsWith('SchematicColor')&&item.colors[key]!==base.colors[key])throw new Error(name+' mismatch: '+key);
      }
      const button=[...document.querySelectorAll('.theme-item')].find(b=>b.querySelector('strong')?.textContent==='matlab');button.click();
      await new Promise(r=>setTimeout(r,150));
      if(document.querySelector('h1').textContent!=='matlab'||!button.textContent.includes('内置主题'))throw new Error('MATLAB builtin card missing');
      const content=await invoke('preview_export_theme',{name:'matlab'});await invoke('export_theme',{name:'matlab',path:${JSON.stringify(fixture)},expectedContent:content});
      return {switchesEnabled:3,matlabColors:35,styleGroups:'blackwhite/blackred match matlab; redblack matches default',content};
    })()`,awaitPromise:true,returnByValue:true});
    if(check.exceptionDetails)throw new Error(JSON.stringify(check.exceptionDetails));
    const verified=check.result.value;if(await readFile(fixture,'utf8')!==verified.content)throw new Error('MATLAB export mismatch');delete verified.content;console.log(JSON.stringify(verified,null,2));
  }
  if(management==='icon'||management==='icon-source'){
    const svg=await readFile(fixture,'utf8');
    const width=management==='icon-source'?512:1040,height=management==='icon-source'?512:560;
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    if(management==='icon-source')await call('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
    await call('Runtime.evaluate',{expression:`document.body.innerHTML='';document.documentElement.style.background='transparent';document.body.style.margin='0';document.body.style.background='transparent';document.body.style.overflow='hidden';const img=document.createElement('img');img.src=${JSON.stringify('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))};img.style.cssText=${JSON.stringify(`width:${width}px;height:${height}px;display:block`)};document.body.append(img);`});
    await delay(400);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(screenshot,Buffer.from(shot.data,'base64'));
  }
  if(management==='backups') {
    if(resolve(dirname(dirname(fixture))).toLowerCase()!==resolve(tmpdir()).toLowerCase()||!basename(dirname(fixture)).startsWith('themer-backups-'))throw new Error('Backup smoke requires a dedicated themer-backups-* directory directly under OS temp');
    const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const original=await readFile(fixture);
    const canonical=await evaluate(`window.__TAURI_INTERNALS__.invoke('inspect_config',{path:${JSON.stringify(fixture)}}).then(info=>info.path)`);
    const folder=join(dirname(fixture),'.ltspice-themer-backups');await mkdir(folder,{recursive:true});
    const stamp=Date.now();
    const record=(suffix,sourcePath=canonical)=>({id:String(stamp)+suffix,createdAt:stamp+Number(suffix),sourcePath,sha256:createHash('sha256').update(original).digest('hex'),size:original.length});
    const first=record('01'),second=record('02'),foreign=record('03',canonical+'-other.ini');
    for(const entry of [first,second,foreign])await writeFile(join(folder,entry.id+'.ini'),original);
    await writeFile(join(folder,'index.json'),JSON.stringify([first,foreign]));
    const prelude=`const wait=async f=>{const end=Date.now()+10000;while(Date.now()<end){if(f())return;await new Promise(r=>setTimeout(r,80));}throw new Error('UI condition timed out');};const click=text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw new Error('Missing '+text);button.click();};const options=()=>[...document.querySelector('[aria-label="选择备份"]').options].map(o=>o.value).filter(Boolean);`;
    await evaluate(`(async()=>{${prelude}const input=document.querySelector('[aria-label="LTspice 配置路径"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(fixture)});input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,150));click('验证 / 刷新');await wait(()=>options().length===1&&options()[0]===${JSON.stringify(first.id)});})()`);
    await writeFile(join(folder,'index.json'),JSON.stringify([first,second,foreign]));
    await evaluate(`(async()=>{${prelude}click('刷新备份');await wait(()=>options().length===2);click('删除选中备份');await wait(()=>document.querySelector('.backup-delete-dialog[open]'));click('取消');await wait(()=>!document.querySelector('.backup-delete-dialog'));if(options().length!==2)throw new Error('Cancel removed a backup');click('删除选中备份');await wait(()=>document.querySelector('.backup-delete-dialog[open]'));click('确认删除备份');await wait(()=>!document.querySelector('.backup-delete-dialog')&&options().length===1);})()`);
    const after=JSON.parse(await readFile(join(folder,'index.json'),'utf8'));
    if(after.some(b=>b.id===first.id)||!after.some(b=>b.id===foreign.id))throw new Error('Delete touched the wrong records');
    let absent=false;try{await readFile(join(folder,first.id+'.ini'));}catch(error){absent=error.code==='ENOENT';}if(!absent)throw new Error('Backup file was not deleted');
    await unlink(join(folder,second.id+'.ini'));
    await evaluate(`(async()=>{${prelude}window.dispatchEvent(new Event('focus'));await wait(()=>options().length===0);const rect=s=>document.querySelector(s).getBoundingClientRect();const schematic=rect('.schematic-window'),wave=rect('.wave-window'),net=rect('.netlist-window');if(Math.abs(wave.top-net.top)>1||wave.right>net.left||schematic.bottom>wave.top)throw new Error('Expected schematic above side-by-side wave and netlist');})()`);
    if(!(await readFile(fixture)).equals(original))throw new Error('Backup management changed the INI');
    console.log(JSON.stringify({backupDelete:'confirmed file and record removal',refresh:'external additions and removals reflected',foreignRecordsPreserved:true,iniUnchanged:true,layout:'schematic above waveform and netlist side by side'},null,2));
  }
  if (management === "management") {
    const verification = await call("Runtime.evaluate", {
      expression: `(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const wait = async predicate => { const end=Date.now()+10000; while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('UI condition timed out');};
        const setInput=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
        const clickText=(text,root=document)=>{const button=[...root.querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw new Error('Missing button '+text);button.click();};
        const initial = await invoke('list_themes');
        const base = initial.find(t=>t.name==='dracula')??initial[0];
        if(!base)throw new Error('Management smoke requires a seed theme');
        const name='SMOKE-'+Date.now();const renamed=name+'-renamed';
        try {
          const text='; ThemeName='+name+'\\r\\n[Colors]\\r\\n'+Object.entries(base.colors).map(([k,v])=>k+'='+v).join('\\r\\n');
          const transfer=new DataTransfer();transfer.items.add(new File([text],name+'.txt',{type:'text/plain'}));
          const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
          await wait(()=>document.querySelector('h1')?.textContent===name);
          clickText('编辑内容');await wait(()=>document.querySelector('dialog[open]'));
          setInput(document.querySelector('[aria-label="主题名称"]'),renamed);
          setInput(document.querySelector('[aria-label="SourceUrl"]'),'https://example.com/theme-review');
          await new Promise(r=>setTimeout(r,100));clickText('保存修改',document.querySelector('dialog'));
          await wait(()=>document.querySelector('h1')?.textContent===renamed&&!document.querySelector('dialog'));
          clickText('编辑内容');await wait(()=>document.querySelector('dialog[open]'));
          if(document.querySelectorAll('.color-field').length!==14)throw new Error('Expected 14 schematic colors');
          setInput(document.querySelector('[aria-label="SchematicColor0 HEX"]'),'#123456');
          await new Promise(r=>setTimeout(r,100));clickText('保存修改',document.querySelector('dialog'));
          await wait(()=>!document.querySelector('dialog'));
          const edited=(await invoke('list_themes')).find(t=>t.name===renamed);
          if(edited?.sourceUrl!=='https://example.com/theme-review')throw new Error('SourceUrl persistence mismatch');
          if(edited?.colors.SchematicColor0!==0x563412)throw new Error('Edited HEX/BGR persistence mismatch');
          clickText('删除');await wait(()=>document.querySelector('dialog[open]'));clickText('确认删除',document.querySelector('dialog'));
          await wait(()=>!document.querySelector('dialog'));
          const final=await invoke('list_themes');
          if(final.length!==initial.length||final.some(t=>t.name===name||t.name===renamed))throw new Error('Delete did not persist');
          for(const seed of initial){const current=final.find(t=>t.name===seed.name);if(JSON.stringify(current)!==JSON.stringify(seed))throw new Error('Existing theme changed');}
          const dracula=[...document.querySelectorAll('.theme-item')].find(b=>b.querySelector('strong')?.textContent===base.name);dracula?.click();
          for(const input of document.querySelectorAll('[role="switch"]'))if(!input.checked)input.click();
          await new Promise(r=>setTimeout(r,150));
          if(!document.body.innerText.includes('Buck-converter.asc')||document.querySelectorAll('.schematic-drawing g[transform]').length!==7)throw new Error('Buck geometry missing');
          const texts=[...document.querySelectorAll('.schematic-drawing text')].map(t=>({text:t.textContent,box:t.getBBox()}));
          const overlaps=[];
          for(let a=0;a<texts.length;a++)for(let b=a+1;b<texts.length;b++){const x=texts[a].box,y=texts[b].box;if(Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)>1&&Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)>1)overlaps.push([texts[a].text,texts[b].text]);}
          if(overlaps.length)throw new Error('Schematic label overlap: '+JSON.stringify(overlaps));
          const toHex=value=>'#'+[value&255,(value>>8)&255,(value>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');
          const configPath=document.querySelector('[aria-label="LTspice 配置路径"]').value;
          const inspected=await invoke('inspect_config',{path:configPath});
          const background=(selector)=>{const probe=document.createElement('div');probe.style.color=document.querySelector(selector).style.backgroundColor||document.querySelector(selector).style.background;document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;};
          for(const [label,selector,key] of [['应用原理图配色','.schematic-canvas','SchematicColor12'],['应用波形查看器配色','.wave-canvas','WaveColor0'],['应用网表配色','.netlist-window pre','NetlistBackgroundColor']]){
            const input=document.querySelector('[aria-label="'+label+'"]');
            const expectedColor=value=>{const probe=document.createElement('div');probe.style.color=toHex(value);document.body.append(probe);const result=getComputedStyle(probe).color;probe.remove();return result;};
            if(background(selector)!==expectedColor(base.colors[key]))throw new Error('Enabled preview mismatch: '+key);
            input.click();await new Promise(r=>setTimeout(r,100));
            if(background(selector)!==expectedColor(inspected.currentColors[key]))throw new Error('Unchecked preview should use INI: '+key);
            input.click();await new Promise(r=>setTimeout(r,100));
          }
          if([...document.querySelectorAll('.theme-actions button')].some(b=>b.textContent==='重命名'))throw new Error('Standalone rename button should be removed');
          const search=document.querySelector('[aria-label="搜索主题"]');search.focus();
          const inputRect=search.getBoundingClientRect(),outer=document.querySelector('.search').getBoundingClientRect();
          if(getComputedStyle(search).outlineStyle!=='none'||inputRect.left<outer.left||inputRect.right>outer.right)throw new Error('Search focus protrudes beyond outer frame');
          return {management:'import-rename-edit-delete passed',existingThemesPreserved:final.length,switches:document.querySelectorAll('[role="switch"]:checked').length,buckSymbols:7,labelOverlaps:overlaps.length};
        } finally {
          for(const item of await invoke('list_themes'))if(item.name===name||item.name===renamed)await invoke('delete_theme',{name:item.name});
        }
      })()`,awaitPromise:true,returnByValue:true,
    });
    if(verification.exceptionDetails)throw new Error(JSON.stringify(verification.exceptionDetails));
    console.log(JSON.stringify(verification.result.value,null,2));
    if(screenshot){
      await call('Runtime.evaluate',{expression:"[...document.querySelectorAll('button')].find(b=>b.textContent==='编辑内容').click()"});
      await delay(250);const capture=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(screenshot.replace(/\.png$/,'-editor.png'),Buffer.from(capture.data,'base64'));
      await call('Runtime.evaluate',{expression:"document.querySelector('[aria-label=\"关闭编辑窗口\"]').click();document.querySelector('[aria-label=\"搜索主题\"]').focus()"});
    }
  }
  if (management === "transient") {
    const check=await call("Runtime.evaluate",{expression:`(async()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      const post=window.chrome.webview.postMessage;
      const fetch=window.fetch;
      const calls=[];let destination=null;
      window.chrome.webview.postMessage=function(message){const data=typeof message==='string'?JSON.parse(message):message;calls.push(data.cmd);if(data.cmd==='plugin:dialog|save'){queueMicrotask(()=>window.__TAURI_INTERNALS__.runCallback(data.callback,destination));return;}return post.call(this,message);};
      window.fetch=function(resource,options){const url=decodeURIComponent(String(resource));if(url.includes('ipc.localhost/')){const command=url.split('ipc.localhost/')[1];calls.push(command);if(command==='plugin:dialog|save')return Promise.resolve(new Response(JSON.stringify(destination),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));}return fetch.call(this,resource,options);};
      const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,80));}throw new Error('Condition timed out');};
      const click=(text)=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw new Error('Missing '+text);button.click();};
      try {
        for(const input of document.querySelectorAll('[role="switch"]'))if(!input.checked)input.click();
        await new Promise(r=>setTimeout(r,100));
        const paths=[...document.querySelectorAll('[data-signal]')];
        if(paths.map(p=>p.dataset.signal).join(',')!=='V(SW),I(L1),I(D1)')throw new Error('Wrong transient traces');
        if(paths.some(p=>p.getAttribute('d').includes('NaN')||!p.getAttribute('clip-path')||p.getAttribute('d').split('L').length!==21))throw new Error('Missing raw samples or clipping');
        if(!document.querySelector('.wave-window').innerText.includes('18.54–18.69ms'))throw new Error('Wrong time range');
        const name=document.querySelector('h1').textContent;
        const sw=[...document.querySelectorAll('.schematic-drawing text')].find(t=>t.textContent==='SW');
        if(!sw||sw.getAttribute('x')!=='272'||sw.getAttribute('y')!=='87')throw new Error('SW node label missing or misplaced');
        if([...document.querySelectorAll('.schematic-drawing path')].some(p=>p.getAttribute('d')==='M272 96V78'))throw new Error('SW label must not extend the junction wire');
        click('恢复默认');await wait(()=>document.querySelector('#reset-title'));click('取消');await wait(()=>!document.querySelector('#reset-title'));
        click('恢复全部内置主题');await wait(()=>document.querySelector('#reset-title'));click('取消');await wait(()=>!document.querySelector('#reset-title'));
        const selected=(await original('list_themes')).find(t=>t.name===name);
        const hex=value=>'#'+[value&255,(value>>8)&255,(value>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(paths.some((path,index)=>path.getAttribute('stroke')!==hex(selected.colors['WaveColor'+(index+2)])))throw new Error('Trace color mapping mismatch');
        click('导出 TXT ↗');await wait(()=>document.querySelector('.export-dialog[open]'));
        if(calls.includes('plugin:dialog|save')||calls.includes('export_theme'))throw new Error('First click must only preview');
        const expected=await original('preview_export_theme',{name});
        const shown=document.querySelector('.export-content').textContent;
        if(shown!==expected||(shown.match(/^[A-Za-z][A-Za-z0-9]*=\\d+$/gm)||[]).length!==35)throw new Error('Incomplete export preview');
        click('保存 TXT…');await new Promise(r=>setTimeout(r,150));await wait(()=>[...document.querySelectorAll('.export-dialog button')].some(b=>b.textContent==='保存 TXT…'&&!b.disabled));
        if(!document.querySelector('.export-dialog[open]')||calls.includes('export_theme'))throw new Error('Cancelled save must keep preview and not write');
        destination=${JSON.stringify(fixture)};
        click('保存 TXT…');await wait(()=>!document.querySelector('.export-dialog'));
        if(calls.filter(c=>c==='export_theme').length!==1)throw new Error('Expected one confirmed write');
        let staleRejected=false;try{await original('export_theme',{path:destination+'.rejected.txt',name,expectedContent:'stale preview'});}catch{staleRejected=true;}
        if(!staleRejected)throw new Error('Stale export preview was accepted');
        return {traces:paths.map(p=>p.dataset.signal),samplesPerTrace:21,timeWindow:'18.54–18.69ms',previewContent:expected,exported:destination,cancelledSavePreservedPreview:true,staleRejected};
      }finally{window.chrome.webview.postMessage=post;window.fetch=fetch;}
    })()`,awaitPromise:true,returnByValue:true});
    if(check.exceptionDetails)throw new Error(JSON.stringify(check.exceptionDetails));
    const verified=check.result.value;
    if((await readFile(verified.exported,'utf8'))!==verified.previewContent)throw new Error('Saved TXT differs from reviewed content');
    delete verified.previewContent;console.log(JSON.stringify(verified,null,2));
    if(screenshot){
      await call('Runtime.evaluate',{expression:"[...document.querySelectorAll('button')].find(b=>b.textContent==='导出 TXT ↗').click()"});
      await delay(300);
      const capture=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(screenshot.replace(/\.png$/,'-export.png'),Buffer.from(capture.data,'base64'));
      await call('Runtime.evaluate',{expression:"document.querySelector('[aria-label=\"关闭导出预览\"]').click()"});
      const node=await call('Runtime.evaluate',{expression:"(()=>{const svg=document.querySelector('.schematic-drawing');const point=svg.createSVGPoint();point.x=272;point.y=96;const screen=point.matrixTransform(svg.getScreenCTM());return {x:screen.x+scrollX,y:screen.y+scrollY};})()",returnByValue:true});
      const detail=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:node.result.value.x-90,y:node.result.value.y-65,width:180,height:130,scale:2}});
      await writeFile(screenshot.replace(/\.png$/,'-sw-detail.png'),Buffer.from(detail.data,'base64'));
    }
  }
  if (fixture && management !== "transient" && management !== "backups" && management !== "icon" && management !== "icon-source" && management !== "matlab" && management !== "appearance") {
    const original = await readFile(fixture);
    const transaction = await call("Runtime.evaluate", {
      expression: `(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const targets = {schematic:true,waveform:true,netlist:true};
        const path = ${JSON.stringify(fixture)};
        const status = await invoke('get_status');
        const before = await invoke('inspect_config', {path});
        if (!before.valid) throw new Error('Fixture should be valid');
        let staleRejected = false;
        try { await invoke('apply_theme', {path, name:'dracula', expectedHash:'stale', targets}); } catch { staleRejected = true; }
        if (!staleRejected) throw new Error('Stale hash was accepted');
        if (status.running) {
          let blocked = false;
          try { await invoke('apply_theme', {path, name:'dracula', expectedHash:before.sha256, targets}); } catch { blocked = true; }
          if (!blocked) throw new Error('Running LTspice did not block application');
          return { mode:'running-process-blocked', staleRejected };
        }
        const applied = await invoke('apply_theme', {path, name:'dracula', expectedHash:before.sha256, targets});
        if (applied.sha256 === before.sha256 || applied.backups.length !== before.backups.length + 1) throw new Error('Application or backup failed');
        const backup = applied.backups[applied.backups.length - 1];
        const restored = await invoke('restore_backup', {path, id:backup.id, expectedHash:applied.sha256});
        if (restored.sha256 !== before.sha256 || restored.backups.length !== applied.backups.length + 1) throw new Error('Restore failed');
        const exported = path + '.txt';
        await invoke('export_theme', {path:exported, name:'dracula'});
        return { mode:'apply-backup-restore-export', staleRejected, backups:restored.backups.length, exported };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (transaction.exceptionDetails) throw new Error(JSON.stringify(transaction.exceptionDetails));
    if (!(await readFile(fixture)).equals(original)) throw new Error("Fixture was not restored byte for byte");
    console.log(JSON.stringify(transaction.result.value, null, 2));
    if (transaction.result.value.exported) {
      const exported = await readFile(transaction.result.value.exported, "utf8");
      const entries = exported.split(/\r?\n/).filter(line => /^[A-Za-z][A-Za-z0-9]*=\d+$/.test(line));
      if (!exported.includes("[Colors]\r\n") || !exported.includes("; ThemeName=dracula") || entries.length !== 35) throw new Error("Invalid INI-compatible TXT export");
    }
  }
  if (screenshot && management !== 'icon' && management !== 'icon-source') {
    await call("Runtime.evaluate", {expression:"document.querySelector('[aria-label=\"关闭提示\"]')?.click()"});
    const metrics = await call("Page.getLayoutMetrics");
    const capture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x:0, y:0, width:metrics.cssContentSize.width, height:metrics.cssContentSize.height, scale:1 } });
    await writeFile(screenshot, Buffer.from(capture.data, "base64"));
  }
} finally {
  socket.close();
}
