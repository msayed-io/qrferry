const $=(s: string,r: ParentNode=document)=>[...r.querySelectorAll<HTMLElement>(s)];
const RIM='.glass,.seg [aria-selected=true],.mini .on,.tab[aria-selected=true]';
function setO(){$(RIM).forEach(e=>{const w=e.offsetWidth,h=e.offsetHeight;if(!w)return;
  const R=Math.min(parseFloat(getComputedStyle(e).borderTopLeftRadius)||0,w/2,h/2);e.style.setProperty('--o',(R*.4142).toFixed(2)+'px')})}

export function observeRims() {
 let frame = 0;
 const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(setO); };
 const resize = new ResizeObserver(update);
 resize.observe(document.body);
 const mutation = new MutationObserver(update);
 mutation.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:["class","aria-selected","hidden"]});
 addEventListener("click",update); addEventListener("resize",update);
 document.fonts?.ready.then(update); update();
 return () => { resize.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame); removeEventListener("click",update); removeEventListener("resize",update); };
}
