package com.msayed.qrferry;
/** Limits on native IPC, independent of user-supplied metadata or JavaScript. */
final class TransferLimits {
    static final long MAX_BYTES=512L*1024*1024;
    static final int MAX_FILES=3;
    static final int MAX_CHUNK=262144;
    static boolean validRead(long offset,int length){
        return offset>=0&&offset<=MAX_BYTES&&length>0&&length<=MAX_CHUNK;
    }
    private TransferLimits(){}
}
