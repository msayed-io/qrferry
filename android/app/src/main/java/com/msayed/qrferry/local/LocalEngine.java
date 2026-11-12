package com.msayed.qrferry.local;

import android.content.Context;
import android.net.Network;
import android.util.Log;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.net.ssl.*;

/** One native session owner. UI receives immutable metadata snapshots, never file bytes/URIs/secrets. */
public final class LocalEngine implements AutoCloseable {
 public interface Listener{void changed(JSONObject snapshot);}
 public final LocalFiles files;private final LocalNetwork wifi;private final ExecutorService io=Executors.newFixedThreadPool(4);
 private final Object writeLock=new Object();private volatile long writeDeadline;private final AtomicBoolean pingPending=new AtomicBoolean();
 private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
 private final CopyOnWriteArrayList<Listener>listeners=new CopyOnWriteArrayList<>();
 private final Map<String,JSONObject> transfers=new LinkedHashMap<>();private final List<JSONObject>messages=new ArrayList<>();
 private final ConcurrentHashMap<String,Integer> incoming=new ConcurrentHashMap<>(),finalizing=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,BlockingQueue<JSONObject>> responses=new ConcurrentHashMap<>();
 private final AtomicInteger pumpOwner=new AtomicInteger(-1),clientOwner=new AtomicInteger(-1);private final ConcurrentHashMap<Integer,Socket>pendingConnections=new ConcurrentHashMap<>();private final AtomicInteger connectionVersion=new AtomicInteger();private volatile int retries;private volatile boolean peerPaused;private final Set<String> sent=ConcurrentHashMap.newKeySet();
 private final AtomicInteger epoch=new AtomicInteger();private volatile String phase="idle",error="",role="",method="",peer="",ticket="";
 private volatile boolean authenticated,started,paused,outgoingRequested;private volatile long revision,bytes,lastProgress;
 private volatile LocalPairing pairing;private volatile Network route;private volatile LocalIdentity identity;private volatile SSLServerSocket server;
 private volatile SSLSocket socket;private volatile DataOutputStream output;private volatile String receiverTicket="",receiverPeer="",pendingTicket="",pendingPeer="";
 private final LocalRecovery recovery;private volatile boolean recovered;
 private final String myPeer=UUID.randomUUID().toString();
 public LocalEngine(Context context){this(context,false);}
 LocalEngine(Context context,boolean persistent){
  files=new LocalFiles(context);wifi=new LocalNetwork(context);recovery=persistent?new LocalRecovery(context):null;
  if(recovery!=null){JSONObject saved=recovery.read();if(saved!=null)try{
   files.restoreSources(saved.optJSONArray("sources")==null?new JSONArray():saved.getJSONArray("sources"));revision=saved.optLong("revision",0)+1;
   String previous=saved.optString("phase");role=saved.optString("role");
   if(!role.isEmpty()&&!previous.equals("closed")&&!previous.equals("idle")){
    recovered=true;phase="recovery";paused=true;method=saved.optString("method");started=saved.optBoolean("started");bytes=saved.optLong("bytes");
    JSONArray rows=saved.optJSONArray("files");if(rows!=null)for(int i=0;i<Math.min(rows.length(),LocalProtocol.MAX_FILES);i++){JSONObject row=rows.getJSONObject(i);if(!row.optString("status").equals("complete"))row.put("status","paused");transfers.put(row.getString("id"),row);}
    JSONArray chat=saved.optJSONArray("messages");if(chat!=null)for(int i=Math.max(0,chat.length()-500);i<chat.length();i++){JSONObject row=chat.getJSONObject(i);if(row.optString("status").equals("sending")||row.optString("status").equals("sent"))row.put("status","failed");messages.add(row);}
   }else role="";
  }catch(Exception invalid){error="RECOVERY_UNAVAILABLE";role="";phase="idle";recovered=false;transfers.clear();messages.clear();}}
  clock.scheduleAtFixedRate(this::heartbeat,10,10,TimeUnit.SECONDS);
 }
 void checkpointRecovery(){if(recovery!=null){changed();recovery.flush();}}
 /** OS/service interruption preserves the recoverable record but destroys transport trust. */
 public synchronized void suspend(){
  epoch.incrementAndGet();files.cancelFileWork();closeTransport();pairing=null;route=null;ticket="";receiverTicket="";receiverPeer="";pendingTicket="";pendingPeer="";incoming.clear();finalizing.clear();responses.clear();
  if(!role.isEmpty()){recovered=true;paused=true;phase="recovery";}changed();if(recovery!=null)recovery.flush();
 }
 private void newSession(String nextRole){
  boolean keep=recovered&&role.equals(nextRole);Map<String,JSONObject>previousFiles=keep?new LinkedHashMap<>(transfers):null;List<JSONObject>previousChat=keep?new ArrayList<>(messages):null;
  reset();if(keep){transfers.putAll(previousFiles);messages.addAll(previousChat);}
 }

 private synchronized void heartbeat(){
  if(writeDeadline!=0&&android.os.SystemClock.elapsedRealtime()>writeDeadline)lost(epoch.get());
  if(authenticated){if(pingPending.compareAndSet(false,true))io.execute(()->{try{send(new JSONObject().put("type","ping"));for(String id:finalizing.keySet())send(new JSONObject().put("type","pending").put("id",id));}catch(Exception ignored){}finally{pingPending.set(false);}});}
  else if(pairing!=null&&role.equals("receive")&&pairing.expires<System.currentTimeMillis()&&receiverTicket.isEmpty()){fail("PAIRING_EXPIRED");closeTransport();}
 }
 public void subscribe(Listener l){listeners.add(l);l.changed(snapshot());}public void unsubscribe(Listener l){listeners.remove(l);}
 public synchronized JSONObject snapshot(){try{JSONArray list=new JSONArray();for(JSONObject f:transfers.values())list.put(new JSONObject(f.toString()));JSONArray chat=new JSONArray();for(JSONObject m:messages)chat.put(new JSONObject(m.toString()));return new JSONObject().put("revision",revision).put("recovered",recovered).put("recoveryWarning",recovery!=null&&recovery.failed()).put("phase",phase).put("error",error).put("role",role).put("method",method).put("authenticated",authenticated).put("started",started).put("paused",paused||peerPaused).put("peer",peer).put("selected",files.selected()).put("files",list).put("messages",chat).put("qrReady",pairing!=null&&role.equals("receive")&&!authenticated&&receiverTicket.isEmpty()&&pairing.expires>System.currentTimeMillis()).put("expires",pairing==null?0:pairing.expires).put("bytes",bytes);}catch(Exception e){return new JSONObject();}}
 public void changed(){JSONObject s;synchronized(this){revision++;s=snapshot();if(recovery!=null)try{recovery.save(s,files.recoverySources());}catch(Exception ignored){}}for(Listener l:listeners)l.changed(s);}
 private void state(String p){phase=p;error="";changed();}public void fail(String code){error=code;phase=started?"paused":"error";changed();}
 public boolean busy(){return !Arrays.asList("idle","error","closed","recovery").contains(phase);}
 public synchronized void receive(String requested){newSession("receive");role="receive";state("preparing");int g=epoch.get();wifi.receive(requested,new LocalNetwork.Receiver(){
  public void ready(String host,String ssid,String password,String chosen){synchronized(LocalEngine.this){if(epoch.get()!=g||io.isShutdown())return;io.execute(()->{try{listen(host,ssid,password,chosen,g);}catch(Exception e){failSession(g,code(e));}});}}
  public void failed(String code){failSession(g,code);}
 });}
 void listen(String host,String ssid,String password,String chosen,int g)throws Exception{
  if(epoch.get()!=g)return;
  LocalIdentity fresh=new LocalIdentity(UUID.randomUUID().toString());SSLServerSocket listening;
  try{listening=(SSLServerSocket)fresh.server.getServerSocketFactory().createServerSocket(0,4);}catch(Exception e){fresh.close();throw e;}
  listening.setEnabledProtocols(protocols(listening.getSupportedProtocols()));
  LocalPairing offer=new LocalPairing(UUID.randomUUID().toString(),host,listening.getLocalPort(),fresh.fingerprint,LocalPairing.token(),ssid,password,chosen,System.currentTimeMillis()+5*60*1000);
  offer.security=wifi.security();
  synchronized(this){if(epoch.get()!=g){listening.close();fresh.close();return;}identity=fresh;server=listening;pairing=offer;method=chosen;state("waiting");}
  while(epoch.get()==g&&!listening.isClosed()){
   SSLSocket candidate=null;
   try{
    candidate=(SSLSocket)listening.accept();
    synchronized(this){if(epoch.get()!=g){candidate.close();break;}if(authenticated){candidate.close();continue;}pendingConnections.put(g,candidate);}
    candidate.setSoTimeout(15000);candidate.startHandshake();DataInputStream in=new DataInputStream(candidate.getInputStream());DataOutputStream out=new DataOutputStream(candidate.getOutputStream());
    JSONObject hello=new JSONObject(LocalProtocol.readControl(in));String id=hello.optString("peer"),proposed=authorizeHello(hello,offer,g);
    LocalProtocol.writeControl(out,new JSONObject().put("type","welcome").put("v",1).put("ticket",proposed).put("peer",myPeer).toString());
    JSONObject confirm=new JSONObject(LocalProtocol.readControl(in));
    if(!confirm.optString("type").equals("confirm")||!LocalProtocol.secret(confirm.optString("ticket"),proposed))throw new IOException("PAIRING_REJECTED");
    confirmPeer(id,proposed,offer,g);
    LocalProtocol.writeControl(out,new JSONObject().put("type","ready").toString());
    activate(candidate,out,id,g);pendingConnections.remove(g,candidate);candidate=null;
    sendOn(new JSONObject().put("type","pause").put("value",paused),g,connectionVersion.get());readLoop(in,g);
   }catch(Exception e){if(epoch.get()!=g)break;if(authenticated){String reason=code(e);try{sendOn(new JSONObject().put("type","error").put("code",reason),g,connectionVersion.get());}catch(Exception ignored){}connectionError(g,reason);}}
   finally{if(candidate!=null){pendingConnections.remove(g,candidate);try{candidate.close();}catch(Exception ignored){}}}
  }
 }
 private synchronized String authorizeHello(JSONObject hello,LocalPairing offer,int g)throws Exception{
  if(epoch.get()!=g)throw new IOException("CANCELLED");String id=hello.optString("peer"),supplied=hello.optString("credential");boolean first=receiverTicket.isEmpty();
  if(!hello.optString("type").equals("hello")||hello.optInt("v")!=1||!hello.optString("session").equals(offer.session)||!id.matches("[a-f0-9-]{36}"))throw new IOException("PAIRING_REJECTED");
  if(!first){if(!receiverPeer.equals(id)||!LocalProtocol.secret(supplied,receiverTicket))throw new IOException("PAIRING_REJECTED");return receiverTicket;}
  boolean original=LocalProtocol.secret(supplied,offer.secret),pending=id.equals(pendingPeer)&&!pendingTicket.isEmpty()&&LocalProtocol.secret(supplied,pendingTicket);
  if(System.currentTimeMillis()>offer.expires||(!original&&!pending))throw new IOException("PAIRING_REJECTED");
  if(!id.equals(pendingPeer)||pendingTicket.isEmpty()){pendingPeer=id;pendingTicket=LocalPairing.token();}return pendingTicket;
 }
 private synchronized void confirmPeer(String id,String proposed,LocalPairing offer,int g)throws IOException{
  if(epoch.get()!=g)throw new IOException("CANCELLED");
  if(receiverTicket.isEmpty()){
   if(System.currentTimeMillis()>offer.expires||!pendingPeer.equals(id)||!LocalProtocol.secret(pendingTicket,proposed))throw new IOException("PAIRING_REJECTED");
   receiverPeer=id;receiverTicket=proposed;pendingPeer="";pendingTicket="";
  }else if(!receiverPeer.equals(id)||!LocalProtocol.secret(receiverTicket,proposed))throw new IOException("PAIRING_REJECTED");
 }
 public String pairingCode()throws Exception{LocalPairing p=pairing;if(p==null||!role.equals("receive")||authenticated||!receiverTicket.isEmpty()||p.expires<System.currentTimeMillis())throw new IOException("QR_NOT_READY");return p.encode();}
 public synchronized void join(String raw)throws Exception{
  LocalPairing p=LocalPairing.decode(raw);
  Log.i("QRFerryLocal","qr accepted: method="+p.method+" host="+p.host+":"+p.port);if(files.sources().isEmpty())throw new IOException("SELECT_FILES_FIRST");newSession("send");role="send";pairing=p;method=p.method;state("connecting");int g=epoch.get();
  wifi.connect(p,new LocalNetwork.Sender(){public void ready(Network n){synchronized(LocalEngine.this){if(epoch.get()!=g)return;route=n;Log.i("QRFerryLocal","joined, opening socket");connect(g);}}public void failed(String code){Log.i("QRFerryLocal","join failed: "+code);connectionError(g,code);}});
 }
 private synchronized void connect(int g){
  if(io.isShutdown()||epoch.get()!=g||clientOwner.get()==g||pairing==null)return;
  final LocalPairing offer=pairing;final Network network=route;final String credential=ticket.isEmpty()?offer.secret:ticket;clientOwner.set(g);
  io.execute(()->{
   Socket raw=null;SSLSocket candidate=null;boolean retry=false;
   try{
    raw=new Socket();synchronized(this){if(epoch.get()!=g)return;pendingConnections.put(g,raw);}
    if(network!=null)network.bindSocket(raw);raw.connect(new InetSocketAddress(offer.host,offer.port),15000);
    SSLSocket connection=candidate=(SSLSocket)LocalIdentity.client(offer.pin).getSocketFactory().createSocket(raw,offer.host,offer.port,true);
    connection.setEnabledProtocols(protocols(connection.getSupportedProtocols()));connection.setSoTimeout(15000);connection.startHandshake();
    DataInputStream in=new DataInputStream(connection.getInputStream());DataOutputStream out=new DataOutputStream(connection.getOutputStream());
    LocalProtocol.writeControl(out,new JSONObject().put("type","hello").put("v",1).put("session",offer.session).put("credential",credential).put("peer",myPeer).toString());
    JSONObject welcome=new JSONObject(LocalProtocol.readControl(in));
    if(!welcome.optString("type").equals("welcome")||welcome.optInt("v")!=1||!welcome.optString("ticket").matches("[A-Za-z0-9_-]{43}")||!welcome.optString("peer").matches("[a-f0-9-]{36}"))throw new IOException("INVALID_HANDSHAKE");
    String proposed=welcome.getString("ticket");synchronized(this){if(epoch.get()!=g)throw new IOException("CANCELLED");ticket=proposed;}
    LocalProtocol.writeControl(out,new JSONObject().put("type","confirm").put("ticket",proposed).toString());
    if(!new JSONObject(LocalProtocol.readControl(in)).optString("type").equals("ready"))throw new IOException("INVALID_HANDSHAKE");
    Log.i("QRFerryLocal","secure session established");
    activate(connection,out,welcome.getString("peer"),g);pendingConnections.remove(g,raw);
    sendOn(new JSONObject().put("type","pause").put("value",paused),g,connectionVersion.get());pump();readLoop(in,g);
   }catch(Exception e){Log.i("QRFerryLocal","connect error: "+code(e));retry=e instanceof EOFException||e instanceof java.net.SocketException||e instanceof java.net.SocketTimeoutException;connectionError(g,code(e));}
   finally{
    if(candidate!=null)try{candidate.close();}catch(Exception ignored){}else if(raw!=null)try{raw.close();}catch(Exception ignored){}
    if(raw!=null)pendingConnections.remove(g,raw);clientOwner.compareAndSet(g,-1);if(retry)reconnectLater(g);
   }
  });
 }
 private synchronized void reconnectLater(int g){
  if(epoch.get()!=g||clock.isShutdown()||authenticated||paused||(ticket.isEmpty()&&(pairing==null||pairing.expires<System.currentTimeMillis()))||retries>=3)return;
  retries++;clock.schedule(()->connect(g),Math.min(8,1<<retries),TimeUnit.SECONDS);
 }
 private synchronized void activate(SSLSocket s,DataOutputStream out,String id,int g)throws Exception{if(epoch.get()!=g)throw new IOException("CANCELLED");closeSocket();socket=s;output=out;s.setSoTimeout(90000);authenticated=true;peer=id;state(started?"transferring":"paired");}
 private void readLoop(DataInputStream in,int g)throws Exception{
  while(epoch.get()==g&&authenticated){JSONObject m=new JSONObject(LocalProtocol.readControl(in));if(epoch.get()!=g||!authenticated)throw new IOException("CANCELLED");String type=m.getString("type"),id=m.optString("id");
   switch(type){
    case "pause":pauseFromPeer(m.getBoolean("value"),g);break;
    case "ping":reply(new JSONObject().put("type","pong"),g);break;case "pong":break;
    case "offer":{
     if(!LocalProtocol.hash(id))throw new IOException("INVALID_FILE_ID");long size=m.getLong("size");String name=LocalProtocol.safeName(m.getString("name")),mime=m.optString("mime","application/octet-stream");if(mime.length()>200)throw new IOException("INVALID_MIME");
     synchronized(this){if(transfers.size()>=LocalProtocol.MAX_FILES&&!transfers.containsKey(id))throw new IOException("TOO_MANY_FILES");}
     if(finalizing.containsKey(id)){reply(new JSONObject().put("type","pending").put("id",id),g);break;}if(!finalizing.isEmpty())throw new IOException("TRANSFER_BUSY");
     long offset=files.prepare(id,name,mime,size,m.getString("sha256"));String completed=files.published(id);recordIncoming(id,name,size,completed==null?"receiving":"verifying",completed==null?offset:size,g);
     if(completed!=null){finalizeIncoming(id,g);reply(new JSONObject().put("type","pending").put("id",id),g);}
     else reply(new JSONObject().put("type","accept").put("id",id).put("offset",offset),g);break;
    }
    case "chunk":{
     requireIncoming(id,g);long offset=m.getLong("offset");int count=m.getInt("length");if(!LocalProtocol.hash(id)||count<1||count>LocalProtocol.CHUNK)throw new IOException("INVALID_CHUNK");byte[]data=new byte[count];in.readFully(data);long end=files.append(id,offset,data,count);receivedChunk(id,end,count,g);reply(new JSONObject().put("type","ack").put("id",id).put("offset",end),g);break;
    }
    case "finish":finalizeIncoming(id,g);break;
    case "pending":case "accept":case "ack":case "complete":case "reject":{synchronized(this){checkEpoch(g);BlockingQueue<JSONObject> q=responses.get(id);if(q!=null&&!q.offer(m))throw new IOException("UNEXPECTED_RESPONSE");}break;}
    case "message":{String text=m.getString("text");if(!authenticated||!started||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16000||!id.matches("[a-f0-9-]{36}"))throw new IOException("INVALID_MESSAGE");synchronized(this){checkEpoch(g);boolean exists=false;for(JSONObject item:messages)if(id.equals(item.optString("id")))exists=true;if(!exists){if(messages.size()>=500)messages.remove(0);messages.add(new JSONObject().put("id",id).put("text",text).put("direction","in").put("status","received").put("time",System.currentTimeMillis()));}}reply(new JSONObject().put("type","messageAck").put("id",id),g);changed();break;}
    case "messageAck":synchronized(this){checkEpoch(g);for(JSONObject item:messages)if(id.equals(item.optString("id")))item.put("status","delivered");}changed();break;
    case "error":throw new IOException(m.optString("code","PEER_ERROR"));
    case "close":throw new IOException("PEER_DISCONNECTED");default:throw new IOException("UNKNOWN_FRAME");
   }
  }
 }
 private void reply(JSONObject json,int g)throws Exception{sendOn(json,g,connectionVersion.get());}
 private synchronized void pauseFromPeer(boolean value,int g)throws Exception{checkEpoch(g);peerPaused=value;phase=peerPaused||paused?"paused":started?"transferring":"paired";changed();if(!peerPaused&&!paused)pump();}
 private void requireIncoming(String id,int g)throws IOException{if(!Integer.valueOf(g).equals(incoming.get(id))||finalizing.containsKey(id))throw new IOException("FILE_NOT_ACCEPTED");}
 private synchronized void finalizeIncoming(String id,int g)throws Exception{
  if(epoch.get()!=g||io.isShutdown())throw new IOException("CANCELLED");requireIncoming(id,g);finalizing.put(id,g);
  JSONObject row=transfers.get(id);if(row!=null)row.put("status","verifying");changed();
  io.execute(()->{
   try{
    files.finish(id,()->epoch.get()==g&&!Thread.currentThread().isInterrupted());
    synchronized(this){if(epoch.get()!=g)return;finalizing.remove(id,g);incoming.remove(id,g);started=true;complete(id,g);phase="transferring";changed();}
    // The file stays committed even if the final ACK is lost. A re-offer reads
    // the receipt; never discard a committed file because a socket closed.
    try{sendOn(new JSONObject().put("type","complete").put("id",id),g,connectionVersion.get());}catch(Exception disconnected){}
   }catch(Exception e){
    finalizing.remove(id,g);incoming.remove(id,g);if(epoch.get()==g){error=code(e);phase="paused";changed();try{sendOn(new JSONObject().put("type","error").put("code",error).put("id",id),g,connectionVersion.get());}catch(Exception disconnected){}}
   }
  });
 }
 private void checkEpoch(int g)throws IOException{if(epoch.get()!=g)throw new IOException("CANCELLED");}
 private void checkConnection(int g,int version)throws IOException{checkEpoch(g);if(connectionVersion.get()!=version||!authenticated)throw new IOException("DISCONNECTED");}
 private synchronized void recordIncoming(String id,String name,long size,String status,long offset,int g)throws Exception{checkEpoch(g);incoming.put(id,g);record(id,name,size,"in",status,offset,g);}
 private synchronized void receivedChunk(String id,long offset,int count,int g)throws Exception{checkEpoch(g);started=true;bytes+=count;phase="transferring";progress(id,offset,g);}
 private synchronized void acknowledgedChunk(String id,long offset,int count,int g,int version)throws Exception{checkConnection(g,version);started=true;bytes+=count;retries=0;phase="transferring";progress(id,offset,g);}
 private synchronized void markSent(String id,int g,int version)throws Exception{checkConnection(g,version);sent.add(id);started=true;complete(id,g);}
 private synchronized void preparingSource(int g,int version)throws Exception{checkConnection(g,version);state(started?"transferring":"preparing-files");}
 private synchronized void record(String id,String name,long size,String direction,String status,long offset,int g)throws Exception{checkEpoch(g);transfers.put(id,new JSONObject().put("id",id).put("name",name).put("size",size).put("direction",direction).put("status",status).put("bytes",offset));changed();}
 private synchronized void progress(String id,long offset,int g)throws Exception{checkEpoch(g);JSONObject f=transfers.get(id);if(f==null)throw new IOException("UNKNOWN_TRANSFER");f.put("bytes",offset);long now=android.os.SystemClock.elapsedRealtime();if(now-lastProgress>=100){lastProgress=now;changed();}}
 private synchronized void accepted(String id,long offset,int g,int version)throws Exception{checkConnection(g,version);JSONObject f=transfers.get(id);if(f==null)throw new IOException("UNKNOWN_TRANSFER");f.put("bytes",offset).put("resumeOffset",offset).put("status","sending");changed();}
 private synchronized void awaitingCommit(String id,int g,int version)throws Exception{checkConnection(g,version);JSONObject f=transfers.get(id);if(f!=null)f.put("status","awaiting-commit");changed();}
 private synchronized void complete(String id,int g)throws Exception{checkEpoch(g);JSONObject f=transfers.get(id);if(f!=null)f.put("bytes",f.getLong("size")).put("status","complete");changed();}
 public synchronized void sendSelected(){outgoingRequested=true;pump();}
 public synchronized void pump(){if((!role.equals("send")&&!outgoingRequested)||io.isShutdown()||!authenticated||paused||peerPaused||pumpOwner.get()==epoch.get())return;int g=epoch.get(),version=connectionVersion.get();pumpOwner.set(g);io.execute(()->{try{
  for(LocalFiles.Source source:files.sources()){
   if(!authenticated||epoch.get()!=g||paused)break;preparingSource(g,version);String digest=hashSource(source,g),id=source.transferId(digest);if(epoch.get()!=g||connectionVersion.get()!=version)throw new IOException("DISCONNECTED");if(sent.contains(id))continue;
   BlockingQueue<JSONObject> q=new ArrayBlockingQueue<>(4);responses.put(id,q);
   try{
    record(id,source.name,source.size,"out","offering",0,g);sendOn(new JSONObject().put("type","offer").put("id",id).put("name",source.name).put("mime",source.mime).put("size",source.size).put("sha256",digest),g,version);JSONObject answer=await(q,g,version);
    if(answer.getString("type").equals("complete")){markSent(id,g,version);continue;}
    if(!answer.getString("type").equals("accept"))throw new IOException("TRANSFER_REJECTED");long offset=answer.getLong("offset");if(offset<0||offset>source.size)throw new IOException("INVALID_RESUME_OFFSET");accepted(id,offset,g,version);
    try(InputStream in=files.open(source)){
     LocalProtocol.skipFully(in,offset);byte[]buffer=new byte[LocalProtocol.CHUNK];
     while(offset<source.size){if(epoch.get()!=g||!authenticated||connectionVersion.get()!=version)throw new IOException("DISCONNECTED");while((paused||peerPaused)&&epoch.get()==g&&authenticated&&connectionVersion.get()==version)Thread.sleep(100);if(epoch.get()!=g||!authenticated||connectionVersion.get()!=version)throw new IOException("DISCONNECTED");int want=(int)Math.min(buffer.length,source.size-offset),n=0;while(n<want){int read=in.read(buffer,n,want-n);if(read<0)throw new EOFException("SOURCE_CHANGED");n+=read;}
      sendChunk(id,offset,buffer,n,g,version);JSONObject ack=await(q,g,version);if(!ack.getString("type").equals("ack")||ack.getLong("offset")!=offset+n)throw new IOException("INVALID_ACK");offset+=n;acknowledgedChunk(id,offset,n,g,version);
     }
    }
    sendOn(new JSONObject().put("type","finish").put("id",id),g,version);awaitingCommit(id,g,version);JSONObject done=await(q,g,version);if(!done.getString("type").equals("complete"))throw new IOException("TRANSFER_NOT_COMMITTED");markSent(id,g,version);
   }finally{responses.remove(id,q);}
  }
  finishPump(g,version);
 }catch(Exception e){failPump(e,g,version);}finally{pumpOwner.compareAndSet(g,-1);if(epoch.get()==g&&authenticated&&connectionVersion.get()!=version&&!paused&&!peerPaused)pump();}});}
 private String hashSource(LocalFiles.Source source,int g)throws Exception{java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");long size=0;try(InputStream in=files.open(source)){byte[]buffer=new byte[LocalProtocol.CHUNK];for(int n;(n=in.read(buffer))!=-1;){if(epoch.get()!=g)throw new IOException("CANCELLED");size+=n;digest.update(buffer,0,n);}}if(size!=source.size)throw new IOException("SOURCE_CHANGED");return source.hash=LocalProtocol.hex(digest.digest());}
 private JSONObject await(BlockingQueue<JSONObject> q,int g,int version)throws Exception{long end=android.os.SystemClock.elapsedRealtime()+300000;while(epoch.get()==g&&connectionVersion.get()==version&&authenticated&&android.os.SystemClock.elapsedRealtime()<end){JSONObject m=q.poll(1,TimeUnit.SECONDS);if(m!=null&&epoch.get()==g&&connectionVersion.get()==version&&authenticated){if(m.optString("type").equals("pending")){end=android.os.SystemClock.elapsedRealtime()+300000;continue;}return m;}}throw new IOException("ACK_TIMEOUT_OR_DISCONNECTED");}
 public void pause(boolean value){
  int g,version;boolean notify;
  synchronized(this){g=epoch.get();version=connectionVersion.get();if(!value)retries=0;paused=value;notify=authenticated;state(value?"paused":authenticated?(started?"transferring":"paired"):"connecting");}
  if(notify)try{sendOn(new JSONObject().put("type","pause").put("value",value),g,version);}catch(Exception e){connectionError(g,"CONNECTION_LOST");}
  synchronized(this){if(epoch.get()!=g)return;if(!value){if(authenticated)pump();else if(role.equals("send")&&pairing!=null)connect(g);}}
 }
 public void message(String text)throws Exception{
  text=text.trim();if(text.isEmpty()||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16000)throw new IOException("MESSAGE_TOO_LARGE");
  String id=UUID.randomUUID().toString();int g,version;
  JSONObject row=new JSONObject().put("id",id).put("text",text).put("direction","out").put("status","sending").put("time",System.currentTimeMillis());
  synchronized(this){if(!authenticated||!started)throw new IOException("NO_ACTIVE_TRANSFER_SESSION");g=epoch.get();version=connectionVersion.get();if(messages.size()>=500)messages.remove(0);messages.add(row);}changed();
  try{sendOn(new JSONObject().put("type","message").put("id",id).put("text",text),g,version);synchronized(this){if(row.optString("status").equals("sending"))row.put("status","sent");}}
  catch(Exception e){synchronized(this){row.put("status","failed");}throw e;}finally{changed();}
 }
 private void send(JSONObject json)throws Exception{sendOn(json,epoch.get(),connectionVersion.get());}
 private void sendOn(JSONObject json,int g,int version)throws Exception{
  DataOutputStream out=output;
  synchronized(writeLock){if(epoch.get()!=g||connectionVersion.get()!=version||out==null||out!=output||!authenticated)throw new IOException("NOT_CONNECTED");writeDeadline=android.os.SystemClock.elapsedRealtime()+30000;
   try{LocalProtocol.writeControl(out,json.toString());}finally{writeDeadline=0;}
  }
 }
 private void sendChunk(String id,long offset,byte[]data,int n,int g,int version)throws Exception{
  DataOutputStream out=output;
  synchronized(writeLock){if(epoch.get()!=g||connectionVersion.get()!=version||out==null||out!=output||!authenticated)throw new IOException("NOT_CONNECTED");writeDeadline=android.os.SystemClock.elapsedRealtime()+30000;
   try{LocalProtocol.writeControl(out,new JSONObject().put("type","chunk").put("id",id).put("offset",offset).put("length",n).toString());out.write(data,0,n);out.flush();}finally{writeDeadline=0;}
  }
 }
 private synchronized void failSession(int g,String reason){if(epoch.get()==g)fail(reason);}
 private synchronized void connectionError(int g,String reason){if(epoch.get()!=g)return;closeSocket();phase="paused";error=reason;changed();}
 private synchronized void finishPump(int g,int version){if(epoch.get()==g&&connectionVersion.get()==version&&authenticated&&!paused&&!peerPaused)state(started?"complete":"paired");}
 private synchronized void failPump(Exception e,int g,int version){if(epoch.get()==g&&connectionVersion.get()==version){error=code(e);phase="paused";changed();}}
 private synchronized void lost(int g){if(epoch.get()!=g)return;closeSocket();phase="paused";error="CONNECTION_LOST";changed();}
 private void closeSocket(){connectionVersion.incrementAndGet();authenticated=false;SSLSocket old=socket;socket=null;output=null;if(old!=null)try{old.close();}catch(Exception ignored){}}
 private void closeTransport(){closeSocket();for(Socket pending:pendingConnections.values())try{pending.close();}catch(Exception ignored){}pendingConnections.clear();SSLServerSocket old=server;server=null;if(old!=null)try{old.close();}catch(Exception ignored){}wifi.close();LocalIdentity id=identity;identity=null;if(id!=null)id.close();}
 public synchronized void reset(){recovered=false;epoch.incrementAndGet();files.cancelFileWork();closeTransport();pairing=null;route=null;ticket="";receiverTicket="";receiverPeer="";pendingTicket="";pendingPeer="";started=false;paused=false;outgoingRequested=false;peerPaused=false;retries=0;role="";peer="";method="";sent.clear();responses.clear();incoming.clear();finalizing.clear();synchronized(this){transfers.clear();messages.clear();bytes=0;}state("idle");}
 public synchronized void disconnect(){reset();state("closed");}
 public synchronized void shutdown(){disconnect();clock.shutdownNow();io.shutdownNow();if(recovery!=null)recovery.close();}
 @Override public void close(){disconnect();}
 private static String[]protocols(String[]supported){List<String>a=new ArrayList<>();for(String p:supported)if(p.equals("TLSv1.2")||p.equals("TLSv1.3"))a.add(p);return a.toArray(new String[0]);}
 private static String code(Exception e){if(e instanceof SecurityException)return "FILE_ACCESS_REQUIRED";String s=e.getMessage();return s!=null&&s.matches("[A-Z0-9_]{3,80}")?s:e instanceof javax.net.ssl.SSLException?"TLS_VERIFICATION_FAILED":e instanceof java.net.SocketTimeoutException?"NETWORK_TIMEOUT":"LOCAL_TRANSFER_FAILED";}
}
