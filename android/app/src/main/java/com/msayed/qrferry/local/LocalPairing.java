package com.msayed.qrferry.local;

import org.json.JSONObject;
import java.net.InetAddress;
import java.security.SecureRandom;
import android.util.Base64;

/** Only private/link-local numeric addresses; QR input cannot turn this into a public-network client. */
public final class LocalPairing {
 public final String session,host,pin,secret,ssid,password,method;public final int port;public final long expires;
 /** Wi-Fi security of the offered hotspot: "wpa2" (default) or "sae". */
 public String security="wpa2";
 /** Receiver model, shown to the sender before it connects. */
 public String device="";
 public LocalPairing(String session,String host,int port,String pin,String secret,String ssid,String password,String method,long expires){this.session=session;this.host=host;this.port=port;this.pin=pin;this.secret=secret;this.ssid=ssid;this.password=password;this.method=method;this.expires=expires;}
 public static String token(){byte[]v=new byte[32];new SecureRandom().nextBytes(v);return Base64.encodeToString(v,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
 public static boolean localAddress(String s){try{if(s==null||!s.matches("[0-9.]{7,15}"))return false;InetAddress a=InetAddress.getByName(s);return a.isSiteLocalAddress()&&!a.isLoopbackAddress()&&!a.isAnyLocalAddress();}catch(Exception e){return false;}}
 public String encode()throws Exception{return "QFL1:"+new JSONObject().put("v",1).put("session",session).put("host",host).put("port",port).put("pin",pin).put("secret",secret).put("ssid",ssid).put("password",password).put("method",method).put("expires",expires).put("sec",security).put("dev",device).toString();}
 public static LocalPairing decode(String raw)throws Exception{
  if(raw==null||raw.length()>4096||!raw.startsWith("QFL1:"))throw new IllegalArgumentException("INVALID_QR");JSONObject o=new JSONObject(raw.substring(5));
  String session=o.getString("session"),host=o.getString("host"),pin=o.getString("pin"),secret=o.getString("secret"),ssid=o.optString("ssid"),password=o.optString("password"),method=o.getString("method");int port=o.getInt("port");long expires=o.getLong("expires"),now=System.currentTimeMillis();
  if(o.getInt("v")!=1||!session.matches("[a-f0-9-]{36}")||!localAddress(host)||port<1024||port>65535||!LocalProtocol.hash(pin)||!secret.matches("[A-Za-z0-9_-]{43}")||expires<now||expires>now+10*60*1000L||ssid.length()>32||password.length()>63||!java.util.Arrays.asList("direct","hotspot","lan").contains(method))throw new IllegalArgumentException("INVALID_OR_EXPIRED_QR");
  if(!method.equals("lan")&&(ssid.isEmpty()||password.length()<8))throw new IllegalArgumentException("INVALID_NETWORK");
  String security="sae".equals(o.optString("sec","wpa2"))?"sae":"wpa2";
  LocalPairing pairing=new LocalPairing(session,host,port,pin,secret,ssid,password,method,expires);pairing.security=security;pairing.device=o.optString("dev","");return pairing;
 }
}
