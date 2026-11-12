package com.msayed.qrferry.local;

import android.content.Context;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.*;
import java.nio.charset.StandardCharsets;

/**
 * Endpoint discovery and handshake on top of Nearby Connections. This class only
 * moves names, codes and short text payloads; file bytes never travel here. The
 * transfer itself stays on the TLS session the QR path already uses, so a radar
 * pairing and a scanned pairing end in exactly the same state.
 */
public final class NearbyRadar implements ConnectionLifecycleCallback {
 public interface Events {
  void radarStatus(String state,String code);
  void radarPeer(String endpointId,String payload,boolean lost);
  void radarRequest(String endpointId,String payload,String digits);
  void radarConnecting(String endpointId,String digits);
  void radarConnected(String endpointId,String payload);
  void radarMessage(String endpointId,String message);
  void radarClosed(String endpointId,String code);
 }

 private static final Strategy STRATEGY=Strategy.P2P_POINT_TO_POINT;
 private final Context context;private final ConnectionsClient client;
 private Events events;private String serviceId;private boolean advertising;private boolean discovering;

 NearbyRadar(Context context){
  this.context=context.getApplicationContext();
  this.client=Nearby.getConnectionsClient(this.context);
 }
 static boolean available(Context context){
  return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)==ConnectionResult.SUCCESS;
 }

 public void attach(Events listener){events=listener;}

 public void advertise(String endpointName,String serviceId){
  this.serviceId=serviceId;stopEverything();advertising=true;
  client.startAdvertising(endpointName,serviceId,this,new AdvertisingOptions.Builder().setStrategy(STRATEGY).build())
   .addOnSuccessListener(unused->status("advertising",""))
   .addOnFailureListener(error->{advertising=false;status("error",code(error));});
 }

 public void discover(String serviceId){
  this.serviceId=serviceId;stopEverything();discovering=true;
  client.startDiscovery(serviceId,new EndpointDiscoveryCallback(){
   public void onEndpointFound(String endpointId,DiscoveredEndpointInfo info){peer(endpointId,info.getEndpointName(),false);}
   public void onEndpointLost(String endpointId){peer(endpointId,"",true);}
  },new DiscoveryOptions.Builder().setStrategy(STRATEGY).build())
   .addOnSuccessListener(unused->status("discovering",""))
   .addOnFailureListener(error->{discovering=false;status("error",code(error));});
 }

 /** Sender side: ask the discovered endpoint for a confirmed connection. */
 public void request(String endpointId,String endpointName){
  client.requestConnection(endpointName,endpointId,this)
   .addOnFailureListener(error->closed(endpointId,code(error)));
 }

 public void accept(String endpointId){
  client.acceptConnection(endpointId,new PayloadCallback(){
   public void onPayloadReceived(String id,Payload payload){message(id,payload);}
   public void onPayloadTransferUpdate(String id,PayloadTransferUpdate update){/* short payloads only */}
  });
 }

 public void reject(String endpointId){client.rejectConnection(endpointId);}

 public void send(String endpointId,String text){
  ByteArrayHolder holder=new ByteArrayHolder(text.getBytes(StandardCharsets.UTF_8));
  client.sendPayload(endpointId,Payload.fromBytes(holder.bytes))
   .addOnFailureListener(error->closed(endpointId,code(error)));
 }

 public void disconnect(String endpointId){client.disconnectFromEndpoint(endpointId);}

 public void stop(){
  advertising=false;discovering=false;
  client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();
  status("idle","");
 }

 private void stopEverything(){client.stopAdvertising();client.stopDiscovery();}

 // ---- ConnectionLifecycleListener ----

 public void onConnectionInitiated(String endpointId,ConnectionInfo info){
  String digits=info.getAuthenticationDigits();
  if(info.isIncomingConnection()){if(events!=null)events.radarRequest(endpointId,info.getEndpointName(),digits);}
  else if(events!=null)events.radarConnecting(endpointId,digits);
 }

 public void onConnectionResult(String endpointId,ConnectionResolution resolution){
  if(resolution.getStatus().isSuccess()){
   advertising=false;
   if(events!=null)events.radarConnected(endpointId,"");
   // Both ends accept so payloads can flow in both directions.
   accept(endpointId);
  }else closed(endpointId,"CONNECTION_REJECTED");
 }

 public void onDisconnected(String endpointId){closed(endpointId,"PEER_DISCONNECTED");}

 // ---- plumbing ----

 private void peer(String endpointId,String payload,boolean lost){if(events!=null)events.radarPeer(endpointId,payload,lost);}

 private void status(String state,String code){if(events!=null)events.radarStatus(state,code);}

 private void closed(String endpointId,String code){if(events!=null)events.radarClosed(endpointId,code);}

 private void message(String endpointId,Payload payload){
  if(payload.getType()!=Payload.Type.BYTES||events==null)return;
  byte[] bytes=payload.asBytes();
  events.radarMessage(endpointId,new String(bytes,StandardCharsets.UTF_8));
 }

 /** Maps a Play services task failure to one of the codes the UI knows. */
 private String code(Exception error){
  String text=error==null?"":String.valueOf(error.getMessage());
  if(text.contains("8034")||text.toLowerCase(java.util.Locale.US).contains("permission"))return "MISSING_PERMISSION";
  if(text.toLowerCase(java.util.Locale.US).contains("bluetooth"))return "BLUETOOTH_OFF";
  if(text.toLowerCase(java.util.Locale.US).contains("wifi"))return "WIFI_OFF";
  return "RADAR_UNAVAILABLE";
 }

 /** Keeps the bytes reachable for the asynchronous send call. */
 private static final class ByteArrayHolder{final byte[] bytes;ByteArrayHolder(byte[] value){bytes=value;}}
}
