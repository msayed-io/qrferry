import test from 'node:test';
import assert from 'node:assert/strict';
import {intensity, sampleRim, rasterRim, boundary, type Linear} from '../lib/specular-rim';
const close=(a:number,b:number,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
test('physical rim reference intensities, including straight edges',()=>{
 const n=1/Math.SQRT2;close(intensity(-n,-n),.6);close(intensity(n,n),.34);
 close(intensity(0,-1),.1275);close(intensity(0,1),.095);close(intensity(n,-n),.06);
});
for(const [w,h,r] of [[350,60,30],[44,44,22],[36,36,18]])for(const dpr of [1,2,3]){
 test(`edge-only 1px ring ${w}x${h} at DPR${dpr}`,()=>{
  const frame=rasterRim(w,h,r,undefined,dpr);let count=0;
  for(let row=0;row<frame.height;row++)for(let col=0;col<frame.width;col++){
   const at=(row*frame.width+col)*4,alpha=frame.pixels[at+3];
   const x=(col+.5)*w/frame.width,y=(row+.5)*h/frame.height;
   const d=boundary(x,y,w,h,r).distance;
   if(d < -1-.5/dpr || d > .5/dpr)assert.equal(alpha,0,'Outside 1px band plus pixel AA');
   if(alpha){count++;assert.equal(frame.pixels[at],255);assert.equal(frame.pixels[at+1],255);assert.equal(frame.pixels[at+2],255);}
   // Also catches any missing pixel accidentally skipped by the perimeter optimization.
   const reference=sampleRim(x,y,w,h,r,undefined,dpr);
   assert.equal(alpha,Math.round(255*reference.coverage*reference.intensity));
  }
  assert.ok(count>100);assert.equal(sampleRim(w/2,h/2,w,h,r).coverage,0);
 });
}
test('rotation keeps light screen-fixed; scaled stroke stays one screen pixel',()=>{
 const turn:Linear=[0,1,-1,0];close(sampleRim(175,.5,350,60,30,turn).intensity,.095);
 const scale:Linear=[2,0,0,2];close(sampleRim(175,.25,350,60,30,scale,3).coverage,1);
 close(sampleRim(175,.75,350,60,30,scale,3).coverage,0);
 const rotate45:Linear=[Math.SQRT1_2,Math.SQRT1_2,-Math.SQRT1_2,Math.SQRT1_2];
 close(sampleRim(.5,30,350,60,30,rotate45).intensity,.6);
});
test('nonuniform scale uses inverse-transpose normals, not rotated local light',()=>{
 const m:Linear=[1.3,0,0,1.15];const d=sampleRim(8.95,8.95,60,60,30,m,3);
 const nx=-1/1.3,ny=-1/1.15,n=Math.hypot(nx,ny);close(d.intensity,intensity(nx/n,ny/n));
});
