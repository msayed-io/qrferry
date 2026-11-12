package com.msayed.qrferry.local;

import android.content.*;
import android.content.pm.PackageManager;
import android.net.*;
import android.net.wifi.*;
import android.net.wifi.p2p.*;
import android.os.*;
import java.net.*;
import java.util.*;

/** Owns only the group/hotspot/network request created by this session. */
public final class LocalNetwork implements AutoCloseable {
 public interface Receiver {void ready(String host,String ssid,String password,String method);void failed(String code);}
 public interface Sender {void ready(Network network);void failed(String code);}
 private final Context context;private final Handler main=new Handler(Looper.getMainLooper());
 private final WifiManager wifi;private final ConnectivityManager connectivity;private final WifiP2pManager p2p;private WifiP2pManager.Channel channel;
 private WifiManager.LocalOnlyHotspotReservation hotspot;private String security="wpa2";private ConnectivityManager.NetworkCallback callback;
 private boolean ownedGroup;private final java.util.concurrent.atomic.AtomicInteger generation=new java.util.concurrent.atomic.AtomicInteger();private int legacyId=-1;private WifiManager.WifiLock lock;
 public LocalNetwork(Context c){context=c.getApplicationContext();wifi=(WifiManager)context.getSystemService(Context.WIFI_SERVICE);connectivity=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);p2p=(WifiP2pManager)context.getSystemService(Context.WIFI_P2P_SERVICE);}
 private boolean live(int g){return generation.get()==g;}
 /** Automatic first choice per device capability, then bounded fallbacks. No
  * manual mode selection is required from the user. */
 public void receive(String method,Receiver receiver){int g=generation.incrementAndGet();main.post(()->{if(!live(g))return;releaseResources();chain(g,plan(method),0,receiver,new ArrayList<String>());});}
 private List<String> plan(String method){
  if(!"auto".equals(method))return java.util.Collections.singletonList(method);
  List<String> plan=new ArrayList<String>();
  // A Wi-Fi Direct group cannot be joined from the QR: joining needs the group
  // owner's P2P device address and WifiP2pManager.connect, while the sender only
  // has the SSID and passphrase. A local-only hotspot is joinable exactly that
  // way, so it is the automatic first choice and Wi-Fi Direct is never selected
  // automatically (the method stays available for an explicit request).
  if(Build.VERSION.SDK_INT>=26)plan.add("hotspot");
  plan.add("lan");return plan;
 }
 private void chain(int g,List<String> plan,int index,Receiver receiver,List<String> tried){
  if(!live(g))return;
  if(index>=plan.size()){receiver.failed(tried.isEmpty()?"NETWORK_UNAVAILABLE":tried.get(tried.size()-1));return;}
  Receiver step=new Receiver(){
   public void ready(String host,String ssid,String password,String chosen){if(live(g))receiver.ready(host,ssid,password,chosen);}
   public void failed(String code){
    if(!live(g))return;
    boolean terminal="WIFI_OFF".equals(code)||"NEARBY_PERMISSION_REQUIRED".equals(code);
    if(terminal||index+1>=plan.size()){receiver.failed(code);return;}
    tried.add(code);releaseResources();
    // The previous attempt must fully release its group/hotspot before the next.
    main.postDelayed(()->chain(g,plan,index+1,receiver,tried),600);
   }
  };
  attempt(g,plan.get(index),step);
 }
 private void attempt(int g,String method,Receiver receiver){
  if(!live(g))return;
  try{
   if(!wifi.isWifiEnabled()){receiver.failed("WIFI_OFF");return;}
   hold();
   if("lan".equals(method)){String ip=lanAddress();if(ip==null)receiver.failed("JOIN_WIFI_FIRST");else receiver.ready(ip,"","","lan");return;}
   if("hotspot".equals(method)){hotspot(g,receiver);return;}
   if(p2p==null||!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT)){receiver.failed("DIRECT_UNAVAILABLE");return;}
   channel=p2p.initialize(context,main.getLooper(),()->{if(live(g))receiver.failed("WIFI_CHANNEL_LOST");});
   p2p.createGroup(channel,new WifiP2pManager.ActionListener(){public void onSuccess(){if(!live(g))return;ownedGroup=true;group(g,receiver,0);}public void onFailure(int reason){if(live(g))receiver.failed("DIRECT_UNAVAILABLE");}});
  }catch(SecurityException e){receiver.failed("NEARBY_PERMISSION_REQUIRED");}catch(Exception e){receiver.failed("NETWORK_UNAVAILABLE");}
 }
 private void group(int g,Receiver receiver,int attempt){
  if(!live(g))return;if(attempt>=40){if(ownedGroup&&channel!=null)p2p.removeGroup(channel,null);ownedGroup=false;hotspot(g,receiver);return;}
  p2p.requestGroupInfo(channel,group->{if(!live(g))return;if(group==null||group.getPassphrase()==null){main.postDelayed(()->group(g,receiver,attempt+1),250);return;}
   p2p.requestConnectionInfo(channel,info->{if(!live(g))return;if(info.groupOwnerAddress==null){main.postDelayed(()->group(g,receiver,attempt+1),250);return;}receiver.ready(info.groupOwnerAddress.getHostAddress(),group.getNetworkName(),group.getPassphrase(),"direct");});
  });
 }
 public String security(){return security;}
 private void hotspot(int g,Receiver receiver){
  if(!live(g))return;if(Build.VERSION.SDK_INT<26){receiver.failed("DIRECT_UNAVAILABLE_USE_EXISTING_WIFI");return;}
  try{wifi.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback(){
   @Override public void onStarted(WifiManager.LocalOnlyHotspotReservation r){if(!live(g)){r.close();return;}hotspot=r;String ssid,password;security="wpa2";
    if(Build.VERSION.SDK_INT>=30){ssid=r.getSoftApConfiguration().getSsid();password=r.getSoftApConfiguration().getPassphrase();
     // The hotspot decides its own security; the sender has to know it to join.
     if(r.getSoftApConfiguration().getSecurityType()==SoftApConfiguration.SECURITY_TYPE_WPA3_SAE)security="sae";}else{WifiConfiguration config=r.getWifiConfiguration();ssid=config.SSID;password=config.preSharedKey;}
    String host=hotspotAddress();if(host==null||password==null){r.close();hotspot=null;receiver.failed("HOTSPOT_ADDRESS_UNAVAILABLE");return;}receiver.ready(host,unquote(ssid),unquote(password),"hotspot");
   }
   @Override public void onStopped(){if(live(g))receiver.failed("HOTSPOT_STOPPED");}
   @Override public void onFailed(int reason){if(live(g))receiver.failed("HOTSPOT_UNAVAILABLE_USE_EXISTING_WIFI");}
  },main);}catch(SecurityException e){receiver.failed("NEARBY_PERMISSION_REQUIRED");}catch(Exception e){receiver.failed("HOTSPOT_UNAVAILABLE_USE_EXISTING_WIFI");}
 }
 public void connect(LocalPairing offer,Sender sender){int g=generation.incrementAndGet();main.post(()->{if(!live(g))return;releaseResources();try{
  if(!wifi.isWifiEnabled()){sender.failed("WIFI_OFF");return;}hold();
  if(offer.method.equals("lan")){for(Network n:connectivity.getAllNetworks()){NetworkCapabilities caps=connectivity.getNetworkCapabilities(n);if(caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)){sender.ready(n);return;}}sender.failed("JOIN_WIFI_FIRST");return;}
  if(Build.VERSION.SDK_INT>=29){
   WifiNetworkSpecifier.Builder builder=new WifiNetworkSpecifier.Builder().setSsid(offer.ssid);
   if("sae".equals(offer.security))builder.setWpa3Passphrase(offer.password);else builder.setWpa2Passphrase(offer.password);
   WifiNetworkSpecifier spec=builder.build();
   NetworkRequest request=new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).setNetworkSpecifier(spec).build();
   callback=new ConnectivityManager.NetworkCallback(){public void onAvailable(Network n){if(live(g))sender.ready(n);}public void onUnavailable(){if(live(g))sender.failed("NETWORK_REQUEST_DECLINED");}public void onLost(Network n){if(live(g))sender.failed("NETWORK_LOST");}};
   connectivity.requestNetwork(request,callback,main,45000);
  }else{
   WifiConfiguration config=new WifiConfiguration();config.SSID=quote(offer.ssid);config.preSharedKey=quote(offer.password);config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK);legacyId=wifi.addNetwork(config);
   if(legacyId<0||!wifi.enableNetwork(legacyId,true)){sender.failed("WIFI_JOIN_FAILED");return;}wifi.reconnect();legacyWait(g,offer,sender,0);
  }
 }catch(SecurityException e){sender.failed("NEARBY_PERMISSION_REQUIRED");}catch(Exception e){sender.failed("WIFI_JOIN_FAILED");}});}
 private void legacyWait(int g,LocalPairing p,Sender sender,int attempt){if(!live(g))return;if(attempt>80){sender.failed("WIFI_JOIN_TIMEOUT");return;}String ssid=unquote(wifi.getConnectionInfo().getSSID());if(p.ssid.equals(ssid)&&wifi.getConnectionInfo().getIpAddress()!=0){for(Network n:connectivity.getAllNetworks()){NetworkCapabilities caps=connectivity.getNetworkCapabilities(n);if(caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)){sender.ready(n);return;}}}main.postDelayed(()->legacyWait(g,p,sender,attempt+1),500);}
 private String lanAddress(){for(Network n:connectivity.getAllNetworks()){NetworkCapabilities caps=connectivity.getNetworkCapabilities(n);LinkProperties props=connectivity.getLinkProperties(n);if(caps!=null&&props!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))for(LinkAddress a:props.getLinkAddresses())if(a.getAddress() instanceof Inet4Address&&LocalPairing.localAddress(a.getAddress().getHostAddress()))return a.getAddress().getHostAddress();}return null;}
 private String hotspotAddress(){
  String best=null;int bestScore=0;
  try{for(NetworkInterface n:Collections.list(NetworkInterface.getNetworkInterfaces())){
   if(!n.isUp()||n.isLoopback())continue;int score=score(n.getName());if(score==0||score<bestScore)continue;
   for(InetAddress a:Collections.list(n.getInetAddresses()))if(a instanceof Inet4Address&&LocalPairing.localAddress(a.getHostAddress())){best=a.getHostAddress();bestScore=score;break;}
  }}catch(Exception ignored){}
  return best;
 }
 private static int score(String n){return n.startsWith("ap")?4:n.startsWith("swlan")?3:n.startsWith("wlan")?2:n.startsWith("p2p")?1:0;}
 private static String quote(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
 private static String unquote(String s){return s!=null&&s.startsWith("\"")&&s.endsWith("\"")?s.substring(1,s.length()-1):s;}
 private void hold(){if(lock!=null&&lock.isHeld())lock.release();lock=wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF,"QRFerry:local");lock.setReferenceCounted(false);lock.acquire();}
 @Override public void close(){int g=generation.incrementAndGet();Runnable cleanup=()->{if(live(g))releaseResources();};if(Looper.myLooper()==main.getLooper())cleanup.run();else main.post(cleanup);}
 // Every Android network resource is touched on the main looper. Generation is
 // invalidated at call time, so queued starts/callbacks cannot resurrect a session.
 private void releaseResources(){if(callback!=null){try{connectivity.unregisterNetworkCallback(callback);}catch(Exception ignored){}callback=null;}if(hotspot!=null){hotspot.close();hotspot=null;}if(ownedGroup&&p2p!=null&&channel!=null){try{p2p.removeGroup(channel,null);}catch(Exception ignored){}ownedGroup=false;}if(channel!=null&&Build.VERSION.SDK_INT>=27)channel.close();channel=null;if(legacyId>=0){wifi.removeNetwork(legacyId);legacyId=-1;}if(lock!=null){if(lock.isHeld())lock.release();lock=null;}}
}
