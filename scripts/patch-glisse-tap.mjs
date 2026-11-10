// Opt-in navigation tap recognition, separate from upstream drag handlers.
// Keep the original onPointerDown/Move/End, DRAG and refraction code verbatim.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../node_modules/glisse/',import.meta.url);
const marker='// QRFerry: short unselected navigation taps never enter the held-lens path.';
const additions=`${marker}
 let pendingTap = null, tapTimer = 0, tapSettle = false;
 const clearTap = () => {
  clearTimeout(tapTimer); tapTimer = 0;
  const pending = pendingTap; pendingTap = null; return pending;
 };
 const beginHeld = () => {
  const pending = clearTap();
  if (!pending) return;
  tapSettle = false;
  onPointerDown(pending);
 };
 const tapDown = (event) => {
  const tab = event.target.closest(".lg-tab");
  if (bar.dataset.qfTap !== "settle" || !tab || tabs.indexOf(tab) === active ||
      !event.isPrimary || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
   tapSettle = false; onPointerDown(event); return;
  }
  if (pendingTap || gesture) return;
  pendingTap = event;
  tapTimer = setTimeout(beginHeld, 150);
 };
 const tapMove = (event) => {
  if (event.pointerId === pendingTap?.pointerId && Math.abs(event.clientX - pendingTap.clientX) > 6) beginHeld();
  onPointerMove(event);
 };
 const tapEnd = (event) => {
  if (event.pointerId !== pendingTap?.pointerId) { onPointerEnd(event); return; }
  if (event.type === "lostpointercapture" && event.target !== bar) return;
  const pending = clearTap();
  const box = bar.getBoundingClientRect();
  if (event.type !== "pointerup" || event.clientY < box.top - 24 || event.clientY > box.bottom + 24) return;
  // The normal click selects through the same React callback, but only x moves.
  tapSettle = true; suppressClick = true;
  pending.target.closest(".lg-tab")?.click();
 };
`;
const changes=[
 ['\tconst move = (target, lifted, instant = false) => {','\tconst move = (target, lifted, instant = false) => {'],
 ['\t\tx.tune(slideStiffness, slideDamping);','\t\tx.tune(tapSettle && !gesture ? 420 : slideStiffness, tapSettle && !gesture ? 41 : slideDamping);'],
 ['\tconst reset = () => {',additions+'\n\tconst reset = () => {\n  clearTap(); tapSettle = false;'],
 ...['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'].flatMap(type=>{
  const owner=['pointerdown','lostpointercapture'].includes(type)?'bar':'window';
  const old=type==='pointerdown'?'onPointerDown':type==='pointermove'?'onPointerMove':'onPointerEnd';
  const next=type==='pointerdown'?'tapDown':type==='pointermove'?'tapMove':'tapEnd';
  return ['add','remove'].map(action=>[`${owner}.${action}EventListener("${type}", ${old});`,`${owner}.${action}EventListener("${type}", ${next});`]);
 }),
 ['\t\t\tdisposed = true;','\t\t\tclearTap();\n\t\t\tdisposed = true;'],
];
const outputs=[];
for(const name of ['dist/index.js','dist/index.cjs']){
 let source=await readFile(new URL(name,root),'utf8');
 if(source.includes(marker))continue;
 if(!source.includes('// QRFerry: physical rim owns this edge;'))throw Error('Apply verified baseline patch first');
 for(const [before,after] of changes){
  if(source.split(before).length!==2)throw Error('Tap patch drift: '+name+': '+before);
  source=source.replace(before,after);
 }
 outputs.push([name,source]);
}
for(const [name,source] of outputs)await writeFile(new URL(name,root),source);
console.log('Glisse: isolated navigation tap path; original held/drag functions unchanged.');
