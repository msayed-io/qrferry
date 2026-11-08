package com.msayed.qrferry;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Small local platform adapter. No remote server, broad storage permission,
 * persisted URI grants, file paths from JS, or cleartext network exception. */
@CapacitorPlugin(name="QRFerryDevice", permissions={@Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})})
public class QRFerryDevicePlugin extends Plugin {
    private static final long MAX_BYTES=TransferLimits.MAX_BYTES;
    private final Map<String,Uri> shared=new LinkedHashMap<>();
    private final Map<String,InputStream> inputs=new HashMap<>();
    private final Map<String,Long> positions=new HashMap<>();
    private boolean savePending=false;
    private final Map<String,OutputStream> outputs=new HashMap<>();
    private final Map<String,Uri> outputUris=new HashMap<>();
    private final Map<String,Long> outputSizes=new HashMap<>();
    private boolean awake=false;

    private JSObject preferences(){
        Configuration config=getContext().getResources().getConfiguration();
        JSObject result=new JSObject();
        result.put("dark",(config.uiMode & Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);
        JSArray languages=new JSArray();
        for(int i=0;i<config.getLocales().size();i++)languages.put(config.getLocales().get(i).toLanguageTag());
        result.put("languages",languages);return result;
    }
    @PluginMethod public void getPreferences(PluginCall call){call.resolve(preferences());}
    @Override protected void handleOnConfigurationChanged(Configuration config){notifyListeners("preferencesChanged",preferences());}
    @Override protected void handleOnResume(){notifyListeners("preferencesChanged",preferences());applyAwake(awake);}
    @Override protected void handleOnPause(){applyAwake(false);}
    @Override public void load(){
        Intent initial=getActivity().getIntent();
        getBridge().execute(()->captureShare(initial));
    }
    @Override protected void handleOnNewIntent(Intent intent){getBridge().execute(()->captureShare(intent));}
    private void captureShare(Intent intent){
        if(intent==null)return;
        String action=intent.getAction();
        if(!Intent.ACTION_SEND.equals(action)&&!Intent.ACTION_SEND_MULTIPLE.equals(action))return;
        ArrayList<Uri> uris=new ArrayList<>();
        if(Intent.ACTION_SEND.equals(action)){
            Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(uri!=null)uris.add(uri);
        }else{ArrayList<Uri> list=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(list!=null)uris.addAll(list);}
        if(uris.isEmpty()&&intent.getClipData()!=null)for(int i=0;i<intent.getClipData().getItemCount();i++){
            Uri uri=intent.getClipData().getItemAt(i).getUri();if(uri!=null)uris.add(uri);
        }
        closeInputs();shared.clear();
        // Excess files are retained as descriptors so JS can show a real validation error.
        for(Uri uri:uris){if(shared.size()>TransferLimits.MAX_FILES)break;if("content".equals(uri.getScheme()))shared.put(UUID.randomUUID().toString(),uri);}
        notifyListeners("sharedFiles",new JSObject(),true);
    }
    @PluginMethod public void getSharedFiles(PluginCall call){
        JSArray files=new JSArray();
        try{for(Map.Entry<String,Uri> entry:shared.entrySet()){
            JSObject file=new JSObject();file.put("id",entry.getKey());
            String mime=getContext().getContentResolver().getType(entry.getValue());
            file.put("mime",mime==null?"application/octet-stream":mime);
            file.put("name","shared-file");file.put("size",-1);
            try(Cursor cursor=getContext().getContentResolver().query(entry.getValue(),new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){
                if(cursor!=null&&cursor.moveToFirst()){
                    String name=cursor.getString(0);if(name!=null&&!name.trim().isEmpty())file.put("name",name);
                    if(!cursor.isNull(1))file.put("size",cursor.getLong(1));
                }
            }files.put(file);
        }JSObject result=new JSObject();result.put("files",files);call.resolve(result);
        }catch(Exception error){call.reject("Cannot read the shared file metadata.",error);}
    }
    @PluginMethod public void readSharedChunk(PluginCall call){
        Uri uri=shared.get(call.getString("id",""));
        // JSON offsets below 512 MiB are Integers; Capacitor getLong does not coerce them.
        long offset=call.getInt("offset",-1);int length=call.getInt("length",196608);
        if(uri==null||!TransferLimits.validRead(offset,length)){call.reject("Invalid shared-file request.");return;}
        try {
            InputStream input=inputs.get(call.getString("id",""));
            String id=call.getString("id","");
            if(input==null||positions.getOrDefault(id,-1L)!=offset){
                if(input!=null)input.close();
                input=getContext().getContentResolver().openInputStream(uri);
                if(input==null)throw new IllegalStateException("File provider did not open the file.");
                long remaining=offset;
                while(remaining>0){long skipped=input.skip(remaining);if(skipped==0){if(input.read()==-1)throw new IllegalStateException("Unexpected end of file.");skipped=1;}remaining-=skipped;}
                inputs.put(id,input);
            }
            byte[] bytes=new byte[length];int count=0;
            while(count<length){int read=input.read(bytes,count,length-count);if(read<0)break;count+=read;}
            positions.put(id,offset+count);
            JSObject result=new JSObject();result.put("data",Base64.encodeToString(bytes,0,count,Base64.NO_WRAP));call.resolve(result);
        }catch(Exception error){call.reject("Cannot read the shared file.",error);}
    }
    private void closeInputs(){
        for(InputStream input:inputs.values())try{input.close();}catch(Exception ignored){}
        inputs.clear();positions.clear();
    }
    @PluginMethod public void clearSharedFiles(PluginCall call){
        JSArray ids=call.getArray("ids",new JSArray());
        for(int i=0;i<ids.length();i++){
            String id=ids.optString(i);shared.remove(id);positions.remove(id);InputStream input=inputs.remove(id);
            if(input!=null)try{input.close();}catch(Exception ignored){}
        }
        if(shared.isEmpty()){
            Intent current=getActivity().getIntent();
            if(current!=null&&(Intent.ACTION_SEND.equals(current.getAction())||Intent.ACTION_SEND_MULTIPLE.equals(current.getAction()))){
                // Consume only share data; retain component and launch/lifecycle metadata.
                Intent consumed=new Intent(current);
                consumed.setAction(Intent.ACTION_MAIN);
                consumed.removeExtra(Intent.EXTRA_STREAM);
                consumed.removeExtra(Intent.EXTRA_TEXT);
                consumed.removeExtra(Intent.EXTRA_HTML_TEXT);
                consumed.setClipData(null);consumed.setDataAndType(null,null);
                getActivity().setIntent(consumed);
            }
        }
        call.resolve();
    }
    @PluginMethod public void beginSave(PluginCall call){
        if(savePending||!outputs.isEmpty()){call.reject("Another save is in progress.");return;}
        savePending=true;
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime","application/octet-stream"));
        String name=call.getString("name","QRFerry-file").replaceAll("[\\\\/\\r\\n]","_");
        intent.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(call,intent,"saveChosen");
    }
    @ActivityCallback private void saveChosen(PluginCall call,ActivityResult result){
        savePending=false;
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){JSObject data=new JSObject();data.put("cancelled",true);call.resolve(data);return;}
        Uri uri=result.getData().getData();
        try{OutputStream output=getContext().getContentResolver().openOutputStream(uri,"w");if(output==null)throw new IllegalStateException("No output stream.");
            String id=UUID.randomUUID().toString();outputs.put(id,output);outputUris.put(id,uri);outputSizes.put(id,0L);
            JSObject data=new JSObject();data.put("id",id);call.resolve(data);
        }catch(Exception error){call.reject("Cannot save this file.",error);}
    }
    @PluginMethod public void writeSaveChunk(PluginCall call){
        String id=call.getString("id","");OutputStream output=outputs.get(id);String encoded=call.getString("data","");
        if(output==null||encoded.length()>350000){call.reject("Invalid save stream.");return;}
        try{byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);long total=outputSizes.get(id)+bytes.length;
            if(total>MAX_BYTES)throw new IllegalArgumentException("File exceeds the size limit.");
            output.write(bytes);outputSizes.put(id,total);call.resolve();
        }catch(Exception error){call.reject("Cannot write the file.",error);}
    }
    @PluginMethod public void finishSave(PluginCall call){
        String id=call.getString("id","");OutputStream output=outputs.remove(id);Uri uri=outputUris.remove(id);outputSizes.remove(id);
        try{if(output!=null)output.close();if(call.getBoolean("abort",false)&&uri!=null)getContext().getContentResolver().delete(uri,null,null);call.resolve();}
        catch(Exception error){call.reject("Cannot finish saving the file.",error);}
    }
    private void applyAwake(boolean value){getActivity().runOnUiThread(()->{
        if(value)getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    });}
    @PluginMethod public void setAwake(PluginCall call){awake=call.getBoolean("awake",false);applyAwake(awake);call.resolve();}
    @PluginMethod public void requestNotifications(PluginCall call){
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationPermission");return;}
        notificationPermission(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call){
        JSObject result=new JSObject();result.put("granted",Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED);call.resolve(result);
    }
    @PluginMethod public void notify(PluginCall call){
        NotificationManager manager=(NotificationManager)getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){call.resolve();return;}
        String channel="qrferry-transfers";
        if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(channel,"QRFerry transfers",NotificationManager.IMPORTANCE_DEFAULT));
        manager.notify(1,new NotificationCompat.Builder(getContext(),channel).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(call.getString("title","QRFerry")).setContentText(call.getString("body","")).setAutoCancel(true).build());call.resolve();
    }
    @Override protected void handleOnDestroy(){
        awake=false;applyAwake(false);closeInputs();shared.clear();savePending=false;
        for(OutputStream output:outputs.values())try{output.close();}catch(Exception ignored){}
        outputs.clear();outputUris.clear();outputSizes.clear();
    }
}
