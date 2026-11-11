import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
export interface LocalFile { id: string; name: string; label?: string; mime?: string; size: number; selected?: boolean; splitCount?: number; thumb?: string }
export interface LocalTransfer extends LocalFile { direction: 'in'|'out'; status: string; bytes: number }
export interface LocalMessage { id: string; text: string; direction: 'in'|'out'; status: string; time: number }
export interface LocalState {
 recovered?: boolean; recoveryWarning?: boolean;
 revision: number; phase: string; error: string; role: string; method: string; authenticated: boolean; started: boolean;
 paused: boolean; peer: string; selected: LocalFile[]; files: LocalTransfer[]; messages: LocalMessage[];
 qrReady: boolean; expires: number; bytes: number; native?: boolean; sdk?: number; allFiles?: boolean; storageReady?: boolean; media?: boolean; storageAsked?: boolean; destination?: string;
 camera?: boolean; nearby?: boolean; wifi?: boolean;
}
export interface NativeBounds { x: number; y: number; width: number; height: number; viewport: number }
interface LocalPlugin {
 getState(): Promise<LocalState>;
 addListener(event:'state',listener:(state:LocalState)=>void):Promise<PluginListenerHandle>;
 addListener(event:'lifecycle',listener:(state:{active:boolean})=>void):Promise<PluginListenerHandle>;
 listFiles(options:{category:string;page:number}):Promise<{files:LocalFile[]}>;
 selectFile(options:{id:string;selected:boolean}):Promise<LocalState>;
 pickFiles(options:{mime:string}):Promise<LocalState>;
 requestStorage():Promise<LocalState>;
 requestMedia():Promise<LocalState>;
 requestNearby():Promise<LocalState>;
 openSettings(options:{which:'wifi'|'storage'|'app'}):Promise<void>;
 chooseDestination():Promise<LocalState>;
 startReceive(options:{method:'auto'|'hotspot'|'lan'}):Promise<LocalState>;
 startScan(options:NativeBounds):Promise<{scanning?:boolean;cancelled?:boolean}>;
 showPairingCode(options:NativeBounds):Promise<void>;
 updateNativeView(options:NativeBounds):Promise<void>;
 hideNativeView():Promise<void>;
 pause(options:{paused:boolean}):Promise<LocalState>;
 sendSelected():Promise<LocalState>;
 sendMessage(options:{text:string}):Promise<LocalState>;
 disconnect():Promise<LocalState>;
}
export const NativeLocal=registerPlugin<LocalPlugin>('QRFerryLocal');
export const localSupported=()=>Capacitor.getPlatform()==='android';
export const emptyLocalState:LocalState={revision:0,phase:'idle',error:'',role:'',method:'',authenticated:false,started:false,paused:false,peer:'',selected:[],files:[],messages:[],qrReady:false,expires:0,bytes:0};
/** Gate uses native authentication AND actual accepted file data/verified completion. */
export function localSessionVisible(state:Pick<LocalState,'authenticated'|'started'>){return state.authenticated&&state.started;}
export function transferRatio(file:Pick<LocalTransfer,'size'|'bytes'|'status'>){return file.status==='complete'?1:file.size>0?Math.max(0,Math.min(1,file.bytes/file.size)):0;}
/** The list shows the platform display name; the extension stays in the metadata. */
/** Rows show a name without its technical extension; the real name is kept for
 * file identity, saving and integrity metadata. */
export function displayLabel(file:{name:string;label?:string}){
 if(file.label)return file.label;
 const match=/^(.*)\.([A-Za-z0-9]{1,8})$/.exec(file.name);
 return match&&match[1]?match[1]:file.name;
}
