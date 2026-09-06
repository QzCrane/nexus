import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { generatedToolLoaders, SCRIPT_PLUGIN_IDS } from '../src/components/_generated-tool-loader';
import { isLaunchablePlugin, normalizeReleaseStatus } from '../src/kernel/registry/release-admission';
import { parseClipboardSettings, SETTINGS_STORAGE_KEY } from '../src/tools/clipboard/types';

const baseline = JSON.parse(readFileSync(new URL('../legacy-release-baseline.json', import.meta.url), 'utf8')) as {
 sourceCommit: string; panels: string[]; scripts: string[];
};

describe('frozen main business preservation', () => {
 test('retains historical panels and both packaged scripts', () => {
  expect(baseline.sourceCommit).toBe('664d0615f850c568a8840ac312ca7c92cb81ceee');
  expect(baseline.panels).toHaveLength(88); expect(new Set(baseline.panels).size).toBe(88);
  for (const id of baseline.panels) expect(Object.hasOwn(generatedToolLoaders,id),id).toBe(true);
  expect(baseline.scripts).toEqual(['bilibili-enhancer','bilibili-plus']);
  for (const id of baseline.scripts) expect(SCRIPT_PLUGIN_IDS).toContain(id);
 });
 test('keeps availability independent of unknown/unfinished maturity', () => {
  expect(normalizeReleaseStatus(undefined)).toBe('unclassified');
  expect(normalizeReleaseStatus('coming')).toBe('coming');
  expect(isLaunchablePlugin({id:'base64',pluginType:'tool'})).toBe(true);
  expect(isLaunchablePlugin({id:'unreviewed-new-tool',pluginType:'tool'})).toBe(false);
  expect(isLaunchablePlugin({id:'my-script',pluginType:'script',isUserScript:true})).toBe(true);
  expect(isLaunchablePlugin({id:'my-tool',pluginType:'tool',isUserScript:true})).toBe(false);
 });
});

function clipboardHost() {
 const listeners = new Map<string,()=>void>(); const tasks: Array<()=>void> = []; const sent: unknown[] = [];
 let resolveRead: (value: unknown)=>void = ()=>{throw new Error('read not initialized');};
 let storageListener: (changes:Record<string,{newValue:unknown}>,area:string)=>void = ()=>{throw new Error('listener not initialized');};
 class Input {type='text';}
 const document = {
  activeElement:null as Input|null,title:'fixture',getSelection:()=>({toString:()=>'selected text'}),
  addEventListener:(name:string,listener:()=>void)=>listeners.set(name,listener),
  removeEventListener:(name:string)=>listeners.delete(name),
 };
 const source=readFileSync(new URL('../src/entry/content-clipboard.ts',import.meta.url),'utf8')
  .replace(/import \{ parseClipboardSettings, SETTINGS_STORAGE_KEY \} from '[^']+';/u,'');
 runInNewContext(new Bun.Transpiler({loader:'ts'}).transformSync(source),{
  parseClipboardSettings,SETTINGS_STORAGE_KEY,document,HTMLInputElement:Input,
  window:{location:{href:'https://fixture.invalid/'}},console,setTimeout:(task:()=>void)=>tasks.push(task),
  chrome:{runtime:{sendMessage:(message:unknown)=>{sent.push(message);return Promise.resolve();}},
   storage:{onChanged:{addListener:(fn:typeof storageListener)=>{storageListener=fn;}},
    local:{get:()=>new Promise(resolve=>{resolveRead=resolve;})}}},
 });
 return {document,Input,sent,
  hydrate:async(value:unknown)=>{resolveRead({[SETTINGS_STORAGE_KEY]:value});await Promise.resolve();},
  change:(value:unknown)=>storageListener({[SETTINGS_STORAGE_KEY]:{newValue:value}},'local'),
  copy:()=>listeners.get('copy')?.(),flush:()=>{for(const task of tasks.splice(0))task();},attached:()=>listeners.has('copy')};
}
describe('retained clipboard content ownership',()=>{
 test('missing settings fail closed, explicit enablement permits capture',async()=>{
  const host=clipboardHost();await host.hydrate(undefined);expect(host.attached()).toBe(false);
  host.change({enabled:true});host.copy();host.flush();expect(host.sent).toHaveLength(1);
 });
 test('new events defeat delayed hydration and disable retires pending copy',async()=>{
  const host=clipboardHost();host.change({enabled:true});await host.hydrate({enabled:false});expect(host.attached()).toBe(true);
  host.copy();host.change({ enabled: false });host.flush();expect(host.sent).toHaveLength(0);
 });
 test('does not harvest a password field',async()=>{
  const host=clipboardHost();await host.hydrate({enabled:true});const input=new host.Input();input.type='password';host.document.activeElement=input;
  host.copy();host.flush();expect(host.sent).toHaveLength(0);
 });
});
describe('retained Bilibili Plus runtime',()=>{
 test('repeated injection keeps one keyboard owner and a bounded observer',()=>{
  const source=readFileSync(new URL('../src/scripts/bilibili-plus/script.js',import.meta.url),'utf8');
  const listeners:string[]=[];const deadlines:number[]=[];const timers:Array<()=>void>=[];let observers=0;let disconnected=0;
  class Observer {constructor(_callback:()=>void){observers++;} observe(){return true;} disconnect(){disconnected++;}}
  const node={appendChild:(_child:unknown)=>true};
  const context={window:{addEventListener:(type:string)=>listeners.push(`window:${type}`)},
   document:{readyState:'complete',head:node,body:node,documentElement:node,
    createElement:()=>({textContent:'',setAttribute:()=>true}),addEventListener:(type:string)=>listeners.push(type),
    getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null},
   MutationObserver:Observer,sessionStorage:{getItem:()=>null},
   setTimeout:(task:()=>void,ms:number)=>{timers.push(task);deadlines.push(ms);return timers.length;},clearTimeout:(_id:number)=>true,console};
  runInNewContext(source,context);runInNewContext(source,context);
  expect(listeners.filter(name=>name==='keydown')).toHaveLength(1);expect(observers).toBe(1);
  expect(deadlines).toContain(30000);timers[deadlines.indexOf(30000)]?.();expect(disconnected).toBe(1);
 });
});
