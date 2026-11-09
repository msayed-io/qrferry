/** Screen-space normal model selected by the user. No fill, shadow or blur.
 * Matrices contain only the linear part of the CSS transform, in DOM order. */
export type Linear = readonly [number, number, number, number];
export const IDENTITY: Linear = [1, 0, 0, 1];
export function multiply(a: Linear, b: Linear): Linear {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3]];
}
export function intensity(nx: number, ny: number) {
  const dot = -(nx + ny) / Math.SQRT2;
  return .06 + .54 * Math.max(0, dot) ** 6 + .28 * Math.max(0, -dot) ** 6;
}
/** Signed distance and outward normal of a rounded rectangle. */
export function boundary(x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w/2, h/2));
  const px=x-w/2, py=y-h/2, qx=Math.abs(px)-(w/2-r), qy=Math.abs(py)-(h/2-r);
  const ox=Math.max(qx,0), oy=Math.max(qy,0), length=Math.hypot(ox,oy);
  const distance=Math.min(Math.max(qx,qy),0)+length-r;
  const nx=length>0 ? Math.sign(px)*ox/length : qx>qy ? Math.sign(px) : 0;
  const ny=length>0 ? Math.sign(py)*oy/length : qx>qy ? 0 : Math.sign(py);
  return {distance,nx,ny};
}
export function sampleRim(x:number,y:number,w:number,h:number,r:number,m:Linear=IDENTITY,dpr=1) {
  const {distance,nx,ny}=boundary(x,y,w,h,r);
  const det=m[0]*m[3]-m[1]*m[2];
  if(Math.abs(det)<1e-8)return {coverage:0,intensity:0};
  // Normals transform by inverse transpose: rotation never rotates the light.
  const sx=(m[3]*nx-m[1]*ny)/det, sy=(-m[2]*nx+m[0]*ny)/det;
  const norm=Math.hypot(sx,sy);
  if(!norm)return {coverage:0,intensity:0};
  const d=distance/norm, aa=1/dpr;
  const coverage=Math.max(0,Math.min(1,.5-(Math.abs(d+.5)-.5)/aa));
  return {coverage,intensity:intensity(sx/norm,sy/norm)};
}
export function rasterRim(w:number,h:number,r:number,m:Linear=IDENTITY,dpr=1) {
  // Higher local sampling for a scaled control keeps the *screen* stroke 1px.
  const scale=Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]),.01);
  // CSS matrices are serialized with finite precision. Do not allocate a
  // spurious extra backing pixel for e.g. 120.00000001 after a quarter turn.
  const pw=Math.max(1,Math.ceil(w*dpr*scale-1e-4)), ph=Math.max(1,Math.ceil(h*dpr*scale-1e-4));
  const pixels=new Uint8ClampedArray(pw*ph*4);
  const det=Math.abs(m[0]*m[3]-m[1]*m[2]);
  if(det<1e-8)return {pixels,width:pw,height:ph};
  const inverseBound=Math.hypot(...m)/det;
  const band=(1+1/dpr)*inverseBound;
  const radius=Math.max(0,Math.min(r,w/2,h/2));
  // Only the boundary band is sampled; work scales with perimeter, not area.
  for(let row=0;row<ph;row++) {
    const y=(row+.5)*h/ph, dy=Math.max(radius-y,y-(h-radius),0);
    const outer=radius-Math.sqrt(Math.max(0,(radius+band)**2-dy*dy));
    const inner= Math.max(band,radius-Math.sqrt(Math.max(0,Math.max(0,radius-band)**2-dy*dy)));
    const full=y<band || y>h-band || dy>Math.max(0,radius-band);
    const left=Math.max(0,Math.floor(outer*pw/w));
    const leftEnd=Math.min(pw,Math.ceil(inner*pw/w));
    const right=Math.max(leftEnd,Math.floor((w-inner)*pw/w));
    const rightEnd=Math.min(pw,Math.ceil((w-outer)*pw/w));
    for(let col=full?0:left;col<(full?pw:rightEnd);col++) {
      if(!full&&col>=leftEnd&&col<right){col=right-1;continue;}
      const s=sampleRim((col+.5)*w/pw,y,w,h,radius,m,dpr);
      if(!s.coverage)continue;
      const at=(row*pw+col)*4;
      pixels[at]=pixels[at+1]=pixels[at+2]=255;
      pixels[at+3]=Math.round(255*s.coverage*s.intensity);
    }
  }
  return {pixels,width:pw,height:ph};
}
