/** Build-specific, atomic precache. No HTML scraping and no caching of received files. */
const CACHE='qrferry-build-__BUILD_ID__';
const ASSETS=/*__PRECACHE__*/[];
const ROUTES=new Set(['/','/scan','/bridge','/pc','/tv','/history','/privacy','/share']);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  if(!ASSETS.length)throw new Error('Build the application before registering its worker.');
  const cache=await caches.open(CACHE);
  try{await cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})));}
  catch(error){await caches.delete(CACHE);throw error;}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Keep one previous complete build for still-open tabs with old lazy imports.
  const keys=(await caches.keys()).filter(key=>key.startsWith('qrferry-build-'));
  const previous=keys.filter(key=>key!==CACHE).slice(-1);
  await Promise.all((await caches.keys()).filter(key=>key.startsWith('qrferry-')&&key!==CACHE&&!previous.includes(key)).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
function storeSharedFiles(files){return new Promise((resolve,reject)=>{
  const open=indexedDB.open('qrferry-shared',1);
  open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('pending'))open.result.createObjectStore('pending',{keyPath:'key'});};
  open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
    const db=open.result;const transaction=db.transaction('pending','readwrite');
    transaction.objectStore('pending').put({key:'pending',files,at:Date.now()});
    transaction.oncomplete=()=>{db.close();resolve();};
    transaction.onerror=()=>{db.close();reject(transaction.error);};
    transaction.onabort=()=>{db.close();reject(transaction.error);};
  };
});}
async function share(request){
  try{
    const data=await request.formData();
    const files=data.getAll('files').filter(value=>value instanceof File);
    if(!files.length||files.length>3||files.reduce((sum,file)=>sum+file.size,0)>512*1024*1024)return Response.redirect(new URL('/share?error=limits',self.location.origin),303);
    const entries=await Promise.all(files.map(async file=>({name:file.name,mime:file.type||'application/octet-stream',data:await file.arrayBuffer()})));
    await storeSharedFiles(entries);
    return Response.redirect(new URL('/?shared=1',self.location.origin),303);
  }catch{return Response.redirect(new URL('/share?error=storage',self.location.origin),303);}
}
self.addEventListener('fetch',event=>{
  const {request}=event;const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.method==='POST'&&url.pathname==='/share'){event.respondWith(share(request));return;}
  if(request.method!=='GET')return;
  if(request.mode==='navigate'&&ROUTES.has(url.pathname)){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match('/index.html'))||fetch(request)));return;
  }
  if(ASSETS.includes(url.pathname)||url.pathname.startsWith('/assets/')){
    event.respondWith((async()=>{
      const current=await caches.open(CACHE);const cached=await current.match(url.pathname);if(cached)return cached;
      for(const name of (await caches.keys()).filter(key=>key.startsWith('qrferry-build-')&&key!==CACHE)){
        const previous=await(await caches.open(name)).match(url.pathname);if(previous)return previous;
      }
      return fetch(request);
    })());
  }
});
