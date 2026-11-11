package com.msayed.qrferry.local;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** Native scan overlay drawn above the camera preview: a single soft dim around
 * the scan square (the square itself stays clear) plus four rim brackets. */
final class LocalScanFrame extends View {
 private static final int DIM=0x99000000,TINT=0xFFE792B9;
 private final Paint dim=new Paint(Paint.ANTI_ALIAS_FLAG),bracket=new Paint(Paint.ANTI_ALIAS_FLAG);
 private final Path outside=new Path();
 LocalScanFrame(Context context){super(context);dim.setColor(DIM);bracket.setColor(TINT);bracket.setStyle(Paint.Style.STROKE);bracket.setStrokeCap(Paint.Cap.round);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
 @Override protected void onDraw(Canvas canvas){
  float w=getWidth(),h=getHeight(),side=Math.min(w,h)*.62f,left=(w-side)/2f,top=(h-side)/2f,radius=28*getResources().getDisplayMetrics().density;
  RectF square=new RectF(left,top,left+side,top+side);
  outside.reset();outside.setFillType(Path.FillType.EVEN_ODD);
  outside.addRect(0,0,w,h,Path.Direction.CW);
  outside.addRoundRect(square,radius,radius,Path.Direction.CW);
  canvas.drawPath(outside,dim);
  float length=side*.18f,width=3.4f*getResources().getDisplayMetrics().density;bracket.setStrokeWidth(width);
  float[] corners={left,top,1,1,left+side,top,-1,1,left,top+side,1,-1,left+side,top+side,-1,-1};
  for(int i=0;i<corners.length;i+=4){
   float x=corners[i],y=corners[i+1],sx=corners[i+2],sy=corners[i+3];
   canvas.drawLine(x,y,x+sx*length,y,bracket);
   canvas.drawLine(x,y,x,y+sy*length,bracket);
  }
 }
}
