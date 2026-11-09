// Reuse the existing four-square brand geometry, not a new logo.
import sharp from 'sharp';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
const res = new URL('../android/app/src/main/res/', import.meta.url);
const square = 'M6,3 H10 A3,3 0 0,1 13,6 V10 A3,3 0 0,1 10,13 H6 A3,3 0 0,1 3,10 V6 A3,3 0 0,1 6,3 Z';
const foreground = (mono=false)=>`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
 <group android:translateX="25.5" android:translateY="25.5" android:scaleX="1.9" android:scaleY="1.9">
 ${[[0,0],[14,0],[0,14]].map(([x,y])=>`<group android:translateX="${x}" android:translateY="${y}"><path android:pathData="${square}" android:fillColor="#00000000" android:strokeColor="${mono?'#000000':'#241B24'}" android:strokeWidth="2.4"/></group>`).join('\n ')}
 <group android:translateX="14" android:translateY="14"><path android:pathData="${square}" android:fillColor="${mono?'#000000':'#9A315E'}"/></group>
 </group>
</vector>
`;
await writeFile(new URL('drawable/ic_launcher_foreground.xml',res),foreground());
await writeFile(new URL('drawable/ic_launcher_monochrome.xml',res),foreground(true));
await rm(new URL('drawable-v24/ic_launcher_foreground.xml',res),{force:true});
for(const api of [26,33]){
 const dir=new URL(`mipmap-anydpi-v${api}/`,res);await mkdir(dir,{recursive:true});
 const xml=`<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n <background android:drawable="@color/ic_launcher_background"/>\n <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n${api>=33?' <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n':''}</adaptive-icon>\n`;
 for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(new URL(`${name}.xml`,dir),xml);
}
// Legacy API 24/25 launchers: rasterize the SAME existing PWA artwork.
const icon = new URL('../public/icons/icon-512.png',import.meta.url);
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
 const dir=new URL(`mipmap-${density}/`,res);
 await sharp(await readFile(icon)).resize(size,size).png().toFile(new URL('ic_launcher.png',dir).pathname);
 const round=Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`);
 await sharp(await readFile(icon)).resize(size,size).composite([{input:round,blend:'dest-in'}]).png().toFile(new URL('ic_launcher_round.png',dir).pathname);
 await rm(new URL('ic_launcher_foreground.png',dir),{force:true});
}
console.log('Android launcher resources generated from the existing QRFerry mark.');
