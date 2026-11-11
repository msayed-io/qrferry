package com.msayed.qrferry.local;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.math.BigInteger;
import java.net.Socket;
import java.security.*;
import java.security.cert.*;
import java.util.Date;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;

/** Platform TLS; a per-session Keystore key, QR-pinned certificate, no trust-all manager. */
public final class LocalIdentity implements AutoCloseable {
 private final String alias;private final KeyStore store;public final String fingerprint;public final SSLContext server;
 public LocalIdentity(String session)throws Exception{
  alias="qrferry-local-"+session;store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");
  generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
   .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA512)
   .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,KeyProperties.SIGNATURE_PADDING_RSA_PSS)
   .setCertificateSubject(new X500Principal("CN=QRFerry local session"))
   .setCertificateSerialNumber(new BigInteger(120,new SecureRandom()))
   .setCertificateNotBefore(new Date(System.currentTimeMillis()-60000))
   .setCertificateNotAfter(new Date(System.currentTimeMillis()+86400000)).build());generator.generateKeyPair();
  X509Certificate cert=(X509Certificate)store.getCertificate(alias);fingerprint=LocalProtocol.hex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
  final PrivateKey key=(PrivateKey)store.getKey(alias,null);
  X509ExtendedKeyManager km=new X509ExtendedKeyManager(){
   public String[] getClientAliases(String t,java.security.Principal[]i){return null;}public String chooseClientAlias(String[]t,java.security.Principal[]i,Socket s){return null;}
   public String[] getServerAliases(String t,java.security.Principal[]i){return "RSA".equals(t)?new String[]{alias}:null;}
   public String chooseServerAlias(String t,java.security.Principal[]i,Socket s){return "RSA".equals(t)?alias:null;}
   public String chooseEngineServerAlias(String t,java.security.Principal[]i,SSLEngine e){return "RSA".equals(t)?alias:null;}
   public X509Certificate[]getCertificateChain(String a){return alias.equals(a)?new X509Certificate[]{cert}:null;}
   public PrivateKey getPrivateKey(String a){return alias.equals(a)?key:null;}
  };
  server=SSLContext.getInstance("TLS");server.init(new KeyManager[]{km},null,new SecureRandom());
 }
 public static SSLContext client(String pin)throws Exception{
  if(!LocalProtocol.hash(pin))throw new GeneralSecurityException("INVALID_CERTIFICATE_PIN");
  X509TrustManager tm=new X509TrustManager(){
   public X509Certificate[]getAcceptedIssuers(){return new X509Certificate[0];}
   public void checkClientTrusted(X509Certificate[]c,String a)throws CertificateException{throw new CertificateException("CLIENT_AUTH_NOT_USED");}
   public void checkServerTrusted(X509Certificate[]c,String a)throws CertificateException{
    try{if(c==null||c.length==0)throw new CertificateException("MISSING_CERTIFICATE");c[0].checkValidity();String actual=LocalProtocol.hex(MessageDigest.getInstance("SHA-256").digest(c[0].getEncoded()));if(!LocalProtocol.secret(actual,pin))throw new CertificateException("CERTIFICATE_PIN_MISMATCH");}
    catch(GeneralSecurityException e){throw new CertificateException(e);}
   }
  };SSLContext c=SSLContext.getInstance("TLS");c.init(null,new TrustManager[]{tm},new SecureRandom());return c;
 }
 @Override public void close(){try{store.deleteEntry(alias);}catch(Exception ignored){}}
}
