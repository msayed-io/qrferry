package com.msayed.qrferry.local;

import android.content.Context;
import android.net.Network;
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
 private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
 private final CopyOnWriteArrayList<Listener>listeners=new CopyOnWriteArrayList<>();
 private final Map<String,JSONObject> transfers=new LinkedHashMap<>();private final List<JSONObject>messages=new ArrayList<>();
 private final ConcurrentHashMap<String,BlockingQueue<JSONObject>> responses=new ConcurrentHashMap<>();
 private final AtomicBoolean pumping=new AtomicBoolean(),clientRunning=new AtomicBoolean();private final AtomicInteger connectionVersion=new AtomicInteger();private volatile int retries;private volatile boolean peerPaused;private final Set<String> sent=ConcurrentHashMap.newKeySet();
 private final AtomicInteger epoch=new AtomicInteger();private volatile String phase="idle",error="",role="",method="",peer="",ticket="";
 private volatile boolean authenticated,started,paused;private volatile long revision,bytes,lastProgress;
 private volatile LocalPairing pairing;private volatile Network route;private volatile LocalIdentity identity;private volatile SSLServerSocket server;
 private volatile SSLSocket socket;private volatile DataOutputStream output;private volatile String receiverTicket="",receiverPeer="";
 private final String myPeer=UUID.randomUUID().toString();
 public LocalEngine(Context context){files=new LocalFiles(context);wifi=new LocalNetwork(context);clock.scheduleAtFixedRate(()->{if(authenticated)try{send(new JSONObject().put("type","ping"));}catch(Exception ignored){}else if(pairing!=null&&role.equals("receive")&&pairing.expires<System.currentTimeMillis()&&receiverTicket.isEmpty()){fail("PAIRING_EXPIRED");closeTransport();}},10,10,TimeUnit.SECONDS);}
 public void subscribe(Listener l){listeners.add(l);l.changed(snapshot());}public void unsubscribe(Listener l){listeners.remove(l);}
 public synchronized JSONObject snapshot(){try{JSONArray list=new JSONArray();for(JSONObject f:transfers.values())list.put(new JSONObject(f.toString()));JSONArray chat=new JSONArray();for(JSONObject m:messages)chat.put(new JSONObject(m.toString()));return new JSONObject().put("revision",revision).put("phase",phase).put("error",error).put("role",role).put("method",method).put("authenticated",authenticated).put("started",started).put("paused",paused||peerPaused).put("peer",peer).put("selected",files.selected()).put("files",list).put("messages",chat).put("qrReady",pairing!=null&&role.equals("receive")&&!authenticated&&receiverTicket.isEmpty()&&pairing.expires>System.currentTimeMillis()).put("expires",pairing==null?0:pairing.expires).put("bytes",bytes);}catch(Exception e){return new JSONObject();}}
 public void changed(){JSONObject s;synchronized(this){revision++;s=snapshot();}for(Listener l:listeners)l.changed(s);}
 private void state(String p){phase=p;error="";changed();}public void fail(String code){error=code;phase=started?"paused":"error";changed();}
 public boolean busy(){return !Arrays.asList("idle","error","closed").contains(phase);}
 public void receive(String requested){reset();role="receive";state("preparing");int g=epoch.get();wifi.receive(requested,new LocalNetwork.Receiver(){
  public void ready(String host,String ssid,String password,String chosen){if(epoch.get()!=g)return;io.execute(()->{try{listen(host,ssid,password,chosen,g);}catch(Exception e){if(epoch.get()==g)fail(code(e));}});}
  public void failed(String code){if(epoch.get()==g)fail(code);}
 });}
 void listen(String host,String ssid,String password,String chosen,int g)throws Exception{
  if(epoch.get()!=g)return;LocalIdentity fresh=new LocalIdentity(UUID.randomUUID().toString());if(epoch.get()!=g){fresh.close();return;}identity=fresh;server=(SSLServerSocket)identity.server.getServerSocketFactory().createServerSocket(0,4);server.setEnabledProtocols(protocols(server.getSupportedProtocols()));
  pairing=new LocalPairing(UUID.randomUUID().toString(),host,server.getLocalPort(),identity.fingerprint,LocalPairing.token(),ssid,password,chosen,System.currentTimeMillis()+5*60*1000);method=chosen;state("waiting");
  while(epoch.get()==g&&!server.isClosed()){
   SSLSocket candidate=null;try{candidate=(SSLSocket)server.accept();if(authenticated){candidate.close();continue;}candidate.setSoTimeout(15000);candidate.startHandshake();DataInputStream in=new DataInputStream(candidate.getInputStream());DataOutputStream out=new DataOutputStream(candidate.getOutputStream());JSONObject hello=new JSONObject(LocalProtocol.readControl(in));
    String supplied=hello.optString("credential"),id=hello.optString("peer");boolean first=receiverTicket.isEmpty();
    if(!hello.optString("type").equals("hello")||hello.optInt("v")!=1||!hello.optString("session").equals(pairing.session)||!id.matches("[a-f0-9-]{36}")||(first?(System.currentTimeMillis()>pairing.expires||!LocalProtocol.secret(supplied,pairing.secret)):(!LocalProtocol.secret(supplied,receiverTicket)||!receiverPeer.equals(id))))throw new IOException("PAIRING_REJECTED");
    String proposed=first?LocalPairing.token():receiverTicket;
    LocalProtocol.writeControl(out,new JSONObject().put("type","welcome").put("v",1).put("ticket",proposed).put("peer",myPeer).toString());
    JSONObject confirm=new JSONObject(LocalProtocol.readControl(in));if(!confirm.optString("type").equals("confirm")||!LocalProtocol.secret(confirm.optString("ticket"),proposed))throw new IOException("PAIRING_REJECTED");
    if(first){receiverPeer=id;receiverTicket=proposed;}
    LocalProtocol.writeControl(out,new JSONObject().put("type","ready").toString());
    if(epoch.get()!=g){candidate.close();break;}activate(candidate,out,id);candidate=null;readLoop(in,g);
   }catch(Exception e){if(epoch.get()!=g)break;if(authenticated)lost(g);}
   finally{if(candidate!=null)try{candidate.close();}catch(Exception ignored){}}
  }
 }
 public String pairingCode()throws Exception{LocalPairing p=pairing;if(p==null||!role.equals("receive")||authenticated||!receiverTicket.isEmpty()||p.expires<System.currentTimeMillis())throw new IOException("QR_NOT_READY");return p.encode();}
 public void join(String raw)throws Exception{
  LocalPairing p=LocalPairing.decode(raw);if(files.sources().isEmpty())throw new IOException("SELECT_FILES_FIRST");reset();role="send";pairing=p;method=p.method;state("connecting");int g=epoch.get();
  wifi.connect(p,new LocalNetwork.Sender(){public void ready(Network n){if(epoch.get()!=g)return;route=n;connect(g);}public void failed(String code){if(epoch.get()==g){closeSocket();fail(code);}}});
 }
 private void connect(int g){if(epoch.get()!=g||!clientRunning.compareAndSet(false,true))return;io.execute(()->{try{if(epoch.get()!=g)return;
  Socket raw=new Socket();if(route!=null)route.bindSocket(raw);raw.connect(new InetSocketAddress(pairing.host,pairing.port),15000);
  SSLSocket s=(SSLSocket)LocalIdentity.client(pairing.pin).getSocketFactory().createSocket(raw,pairing.host,pairing.port,true);s.setEnabledProtocols(protocols(s.getSupportedProtocols()));s.setSoTimeout(15000);s.startHandshake();
  DataInputStream in=new DataInputStream(s.getInputStream());DataOutputStream out=new DataOutputStream(s.getOutputStream());
  LocalProtocol.writeControl(out,new JSONObject().put("type","hello").put("v",1).put("session",pairing.session).put("credential",ticket.isEmpty()?pairing.secret:ticket).put("peer",myPeer).toString());
  JSONObject welcome=new JSONObject(LocalProtocol.readControl(in));if(!welcome.optString("type").equals("welcome")||!welcome.optString("ticket").matches("[A-Za-z0-9_-]{43}"))throw new IOException("INVALID_HANDSHAKE");ticket=welcome.getString("ticket");
  LocalProtocol.writeControl(out,new JSONObject().put("type","confirm").put("ticket",ticket).toString());
  if(!new JSONObject(LocalProtocol.readControl(in)).optString("type").equals("ready"))throw new IOException("INVALID_HANDSHAKE");
  if(epoch.get()!=g){s.close();return;}activate(s,out,welcome.getString("peer"));pump();readLoop(in,g);
 }catch(Exception e){if(epoch.get()==g){lost(g);error=code(e);changed();}}finally{clientRunning.set(false);if(epoch.get()==g&&!authenticated&&!paused&&!ticket.isEmpty()&&retries++<3)clock.schedule(()->connect(g),Math.min(8,1<<retries),TimeUnit.SECONDS);}});}
 private void activate(SSLSocket s,DataOutputStream out,String id)throws Exception{closeSocket();socket=s;output=out;s.setSoTimeout(90000);authenticated=true;retries=0;peer=id;state(started?"transferring":"paired");}
 private void readLoop(DataInputStream in,int g)throws Exception{
  while(epoch.get()==g&&authenticated){JSONObject m=new JSONObject(LocalProtocol.readControl(in));String type=m.getString("type"),id=m.optString("id");
   switch(type){
    case "pause":peerPaused=m.getBoolean("value");phase=peerPaused||paused?"paused":started?"transferring":"paired";changed();if(!peerPaused&&!paused)pump();break;
    case "ping":send(new JSONObject().put("type","pong"));break;case "pong":break;
    case "offer":{
     if(!LocalProtocol.hash(id))throw new IOException("INVALID_FILE_ID");long size=m.getLong("size");String name=LocalProtocol.safeName(m.getString("name")),mime=m.optString("mime","application/octet-stream");if(mime.length()>200)throw new IOException("INVALID_MIME");
     synchronized(this){if(transfers.size()>=LocalProtocol.MAX_FILES&&!transfers.containsKey(id))throw new IOException("TOO_MANY_FILES");}
     long offset=files.prepare(id,name,mime,size);String completed=files.published(id);record(id,name,size,"in",completed==null?"receiving":"complete",completed==null?offset:size);
     send(new JSONObject().put("type",completed==null?"accept":"complete").put("id",id).put("offset",completed==null?offset:size));if(completed!=null){started=true;state("transferring");}break;
    }
    case "chunk":{
     long offset=m.getLong("offset");int count=m.getInt("length");if(!LocalProtocol.hash(id)||count<1||count>LocalProtocol.CHUNK)throw new IOException("INVALID_CHUNK");byte[]data=new byte[count];in.readFully(data);long end=files.append(id,offset,data,count);started=true;bytes+=count;progress(id,end);phase="transferring";send(new JSONObject().put("type","ack").put("id",id).put("offset",end));break;
    }
    case "finish":files.finish(id);started=true;complete(id);phase="transferring";send(new JSONObject().put("type","complete").put("id",id));changed();break;
    case "accept":case "ack":case "complete":case "reject":{BlockingQueue<JSONObject> q=responses.get(id);if(q!=null&&!q.offer(m))throw new IOException("UNEXPECTED_RESPONSE");break;}
    case "message":{String text=m.getString("text");if(!authenticated||!started||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16000||!id.matches("[a-f0-9-]{36}"))throw new IOException("INVALID_MESSAGE");synchronized(this){boolean exists=false;for(JSONObject item:messages)if(id.equals(item.optString("id")))exists=true;if(!exists){if(messages.size()>=500)messages.remove(0);messages.add(new JSONObject().put("id",id).put("text",text).put("direction","in").put("status","received").put("time",System.currentTimeMillis()));}}send(new JSONObject().put("type","messageAck").put("id",id));changed();break;}
    case "messageAck":synchronized(this){for(JSONObject item:messages)if(id.equals(item.optString("id")))item.put("status","delivered");}changed();break;
    case "close":throw new IOException("PEER_DISCONNECTED");default:throw new IOException("UNKNOWN_FRAME");
   }
  }
 }
 private synchronized void record(String id,String name,long size,String direction,String status,long offset)throws Exception{transfers.put(id,new JSONObject().put("id",id).put("name",name).put("size",size).put("direction",direction).put("status",status).put("bytes",offset));changed();}
 private synchronized void progress(String id,long offset)throws Exception{JSONObject f=transfers.get(id);if(f==null)throw new IOException("UNKNOWN_TRANSFER");f.put("bytes",offset);long now=android.os.SystemClock.elapsedRealtime();if(now-lastProgress>=100){lastProgress=now;changed();}}
 private synchronized void complete(String id)throws Exception{JSONObject f=transfers.get(id);if(f!=null)f.put("bytes",f.getLong("size")).put("status","complete");changed();}
 public void pump(){if(!authenticated||paused||peerPaused||!pumping.compareAndSet(false,true))return;int g=epoch.get(),version=connectionVersion.get();io.execute(()->{try{
  for(LocalFiles.Source source:files.sources()){
   if(!authenticated||epoch.get()!=g||paused)break;state(started?"transferring":"preparing-files");String id=hashSource(source,g);if(sent.contains(id))continue;
   BlockingQueue<JSONObject> q=new ArrayBlockingQueue<>(4);responses.put(id,q);
   try{
    record(id,source.name,source.size,"out","offering",0);send(new JSONObject().put("type","offer").put("id",id).put("name",source.name).put("mime",source.mime).put("size",source.size));JSONObject answer=await(q,g,version);
    if(answer.getString("type").equals("complete")){sent.add(id);started=true;complete(id);continue;}
    if(!answer.getString("type").equals("accept"))throw new IOException("TRANSFER_REJECTED");long offset=answer.getLong("offset");if(offset<0||offset>source.size)throw new IOException("INVALID_RESUME_OFFSET");
    try(InputStream in=files.open(source)){
     LocalProtocol.skipFully(in,offset);byte[]buffer=new byte[LocalProtocol.CHUNK];
     while(offset<source.size){if(epoch.get()!=g||!authenticated||connectionVersion.get()!=version)throw new IOException("DISCONNECTED");while((paused||peerPaused)&&epoch.get()==g&&authenticated&&connectionVersion.get()==version)Thread.sleep(100);if(epoch.get()!=g||!authenticated||connectionVersion.get()!=version)throw new IOException("DISCONNECTED");int want=(int)Math.min(buffer.length,source.size-offset),n=0;while(n<want){int read=in.read(buffer,n,want-n);if(read<0)throw new EOFException("SOURCE_CHANGED");n+=read;}
      sendChunk(id,offset,buffer,n);JSONObject ack=await(q,g,version);if(!ack.getString("type").equals("ack")||ack.getLong("offset")!=offset+n)throw new IOException("INVALID_ACK");offset+=n;bytes+=n;started=true;phase="transferring";progress(id,offset);
     }
    }
    send(new JSONObject().put("type","finish").put("id",id));JSONObject done=await(q,g,version);if(!done.getString("type").equals("complete"))throw new IOException("TRANSFER_NOT_COMMITTED");started=true;sent.add(id);complete(id);
   }finally{responses.remove(id);}
  }
  if(epoch.get()==g&&connectionVersion.get()==version&&authenticated&&!paused&&!peerPaused)state(started?"complete":"paired");
 }catch(Exception e){if(epoch.get()==g&&connectionVersion.get()==version){error=code(e);phase="paused";changed();}}finally{pumping.set(false);if(epoch.get()==g&&authenticated&&connectionVersion.get()!=version&&!paused&&!peerPaused)pump();}});}
 private String hashSource(LocalFiles.Source source,int g)throws Exception{java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");long size=0;try(InputStream in=files.open(source)){byte[]buffer=new byte[LocalProtocol.CHUNK];for(int n;(n=in.read(buffer))!=-1;){if(epoch.get()!=g)throw new IOException("CANCELLED");size+=n;digest.update(buffer,0,n);}}if(size!=source.size)throw new IOException("SOURCE_CHANGED");return source.hash=LocalProtocol.hex(digest.digest());}
 private JSONObject await(BlockingQueue<JSONObject> q,int g,int version)throws Exception{long end=System.currentTimeMillis()+300000;while(epoch.get()==g&&connectionVersion.get()==version&&authenticated&&System.currentTimeMillis()<end){JSONObject m=q.poll(1,TimeUnit.SECONDS);if(m!=null)return m;}throw new IOException("ACK_TIMEOUT_OR_DISCONNECTED");}
 public void pause(boolean value){paused=value;try{if(authenticated)send(new JSONObject().put("type","pause").put("value",value));}catch(Exception e){error="CONNECTION_LOST";}state(value?"paused":authenticated?"transferring":"connecting");if(!value){if(authenticated)pump();else if(role.equals("send")&&pairing!=null)connect(epoch.get());}}
 public void message(String text)throws Exception{if(!authenticated||!started)throw new IOException("NO_ACTIVE_TRANSFER_SESSION");text=text.trim();if(text.isEmpty()||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16000)throw new IOException("MESSAGE_TOO_LARGE");String id=UUID.randomUUID().toString();send(new JSONObject().put("type","message").put("id",id).put("text",text));synchronized(this){if(messages.size()>=500)messages.remove(0);messages.add(new JSONObject().put("id",id).put("text",text).put("direction","out").put("status","sent").put("time",System.currentTimeMillis()));}changed();}
 private synchronized void send(JSONObject json)throws Exception{DataOutputStream out=output;if(out==null||!authenticated)throw new IOException("NOT_CONNECTED");LocalProtocol.writeControl(out,json.toString());}
 private synchronized void sendChunk(String id,long offset,byte[]data,int n)throws Exception{DataOutputStream out=output;if(out==null||!authenticated)throw new IOException("NOT_CONNECTED");LocalProtocol.writeControl(out,new JSONObject().put("type","chunk").put("id",id).put("offset",offset).put("length",n).toString());out.write(data,0,n);out.flush();}
 private void lost(int g){if(epoch.get()!=g)return;closeSocket();phase="paused";error="CONNECTION_LOST";changed();}
 private void closeSocket(){connectionVersion.incrementAndGet();authenticated=false;SSLSocket old=socket;socket=null;output=null;if(old!=null)try{old.close();}catch(Exception ignored){}}
 private void closeTransport(){closeSocket();SSLServerSocket old=server;server=null;if(old!=null)try{old.close();}catch(Exception ignored){}wifi.close();LocalIdentity id=identity;identity=null;if(id!=null)id.close();}
 public void reset(){epoch.incrementAndGet();closeTransport();pairing=null;route=null;ticket="";receiverTicket="";receiverPeer="";started=false;paused=false;peerPaused=false;retries=0;role="";peer="";method="";sent.clear();responses.clear();synchronized(this){transfers.clear();messages.clear();bytes=0;}state("idle");}
 public void disconnect(){try{send(new JSONObject().put("type","close"));}catch(Exception ignored){}reset();state("closed");}
 public void shutdown(){disconnect();clock.shutdownNow();io.shutdownNow();}
 @Override public void close(){disconnect();}
 private static String[]protocols(String[]supported){List<String>a=new ArrayList<>();for(String p:supported)if(p.equals("TLSv1.2")||p.equals("TLSv1.3"))a.add(p);return a.toArray(new String[0]);}
 private static String code(Exception e){String s=e.getMessage();return s!=null&&s.matches("[A-Z0-9_]{3,80}")?s:e instanceof javax.net.ssl.SSLException?"TLS_VERIFICATION_FAILED":e instanceof java.net.SocketTimeoutException?"NETWORK_TIMEOUT":"LOCAL_TRANSFER_FAILED";}
}
