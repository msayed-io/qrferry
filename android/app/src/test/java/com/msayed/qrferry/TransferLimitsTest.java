package com.msayed.qrferry;
import static org.junit.Assert.*;
import org.junit.Test;
public class TransferLimitsTest {
    @Test public void permitsBoundedSequentialChunksAndEndOfFileProbe(){
        assertTrue(TransferLimits.validRead(0,196608));
        assertTrue(TransferLimits.validRead(TransferLimits.MAX_BYTES,1));
        assertEquals(536870912L,TransferLimits.MAX_BYTES);
        assertEquals(3,TransferLimits.MAX_FILES);
    }
    @Test public void rejectsNegativeOffsetsAndOversizedIpcRequests(){
        assertFalse(TransferLimits.validRead(-1,1));
        assertFalse(TransferLimits.validRead(TransferLimits.MAX_BYTES+1,1));
        assertFalse(TransferLimits.validRead(0,0));
        assertFalse(TransferLimits.validRead(0,TransferLimits.MAX_CHUNK+1));
    }
}
