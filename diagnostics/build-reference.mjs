import {build} from 'vite';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
await mkdir('diagnostics/reference',{recursive:true});
await writeFile('diagnostics/reference/index.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0;background:#f7f4f6"><div id="root"></div><script type="module" src="/entry.jsx"></script></body></html>');
await writeFile('diagnostics/reference/entry.jsx',`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TabBar} from 'glisse-original';
function App(){const[value,setValue]=useState('send');return React.createElement('nav',{style:{position:'fixed',bottom:14,left:0,right:0,display:'flex',justifyContent:'center'}},React.createElement(TabBar,{items:['pair','scan','send'].map(value=>({value,label:value,icon:React.createElement('svg',{width:26,height:26,viewBox:'0 0 26 26'},React.createElement('rect',{x:5,y:5,width:16,height:16,fill:'none',stroke:'currentColor',strokeWidth:1.7}))})),value,onValueChange:setValue}))};createRoot(document.getElementById('root')).render(React.createElement(App));`);
await build({configFile:false,root:resolve('diagnostics/reference'),base:'/reference/',resolve:{alias:{'glisse-original':resolve('node_modules/.glisse-original/dist/index.js'),'react-dom':resolve('node_modules/react-dom'),'react':resolve('node_modules/react')}},build:{outDir:resolve('android/app/src/debug/assets/public/reference'),emptyOutDir:true,target:'es2022'}});
