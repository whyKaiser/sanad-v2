"use client";
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Motion primitives for سَنَد.
   The CSS lives in app/motion.css; these components only decide *when* a class
   is applied, so a screen never hand-writes an animation again. */

function usePrefersReducedMotion(){
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{
    const query=window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync=()=>setReduced(query.matches);
    sync();
    query.addEventListener("change",sync);
    return ()=>query.removeEventListener("change",sync);
  },[]);
  return reduced;
}

type RevealProps={
  children:ReactNode;
  /** ms to wait after the element enters the viewport */
  delay?:number;
  /** how much of the element must be visible before it plays */
  amount?:number;
  /** render as something other than a div */
  as?:ElementType;
  className?:string;
  /** play immediately instead of waiting for the viewport (above-the-fold content) */
  immediate?:boolean;
};

/** Fades and lifts its children the first time they reach the viewport. */
export function Reveal({children,delay=0,amount=0.15,as:Tag="div",className,immediate=false}:RevealProps){
  const ref=useRef<HTMLElement|null>(null);
  const [shown,setShown]=useState(immediate);
  const reduced=usePrefersReducedMotion();

  useEffect(()=>{
    if(shown||reduced)return;
    const node=ref.current;
    if(!node)return;
    if(typeof IntersectionObserver==="undefined"){setShown(true);return;}
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.isIntersecting){setShown(true);observer.disconnect();break;}
      }
    },{threshold:amount,rootMargin:"0px 0px -8% 0px"});
    observer.observe(node);
    return ()=>observer.disconnect();
  },[shown,amount,reduced]);

  return <Tag
    ref={ref as never}
    className={cn("reveal",className)}
    data-shown={shown||reduced?"true":"false"}
    style={delay?{["--motion-delay" as string]:`${delay}ms`}:undefined}
  >{children}</Tag>;
}

type StaggerProps={
  children:ReactNode;
  /** ms before the first child starts */
  delay?:number;
  /** ms between children; falls back to the --stagger token */
  step?:number;
  as?:ElementType;
  className?:string;
};

/** Plays its direct children in sequence. Use for card grids, lists, toolbars. */
export function Stagger({children,delay=0,step,as:Tag="div",className}:StaggerProps){
  const style:Record<string,string>={};
  if(delay)style["--motion-delay"]=`${delay}ms`;
  if(step)style["--stagger"]=`${step}ms`;
  return <Tag className={cn("motion-stagger",className)} style={Object.keys(style).length?style:undefined}>{children}</Tag>;
}

/** Re-plays an entrance whenever `viewKey` changes — used when the workspace
    switches between views, so the new panel reads as arriving, not swapping. */
export function ViewTransition({viewKey,children,className,inline=false}:{viewKey:string;children:ReactNode;className?:string;inline?:boolean}){
  return <div key={viewKey} className={cn(inline?"view-enter-inline":"view-enter",className)}>{children}</div>;
}

/** Counts up to a number when it first appears. Respects reduced motion and
    keeps the final value in the DOM for copy/paste and screen readers. */
export function CountUp({value,duration=900,decimals=0,className}:{value:number;duration?:number;decimals?:number;className?:string}){
  const [shown,setShown]=useState(0);
  const ref=useRef<HTMLSpanElement|null>(null);
  const reduced=usePrefersReducedMotion();

  useEffect(()=>{
    if(reduced){setShown(value);return;}
    const node=ref.current;
    if(!node)return;
    let raf=0;let start=0;
    const run=()=>{
      const tick=(now:number)=>{
        if(!start)start=now;
        const progress=Math.min(1,(now-start)/duration);
        const eased=1-Math.pow(1-progress,3);
        setShown(value*eased);
        if(progress<1)raf=requestAnimationFrame(tick);
      };
      raf=requestAnimationFrame(tick);
    };
    if(typeof IntersectionObserver==="undefined"){run();return ()=>cancelAnimationFrame(raf);}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){run();observer.disconnect();}
    },{threshold:0.4});
    observer.observe(node);
    return ()=>{observer.disconnect();cancelAnimationFrame(raf);};
  },[value,duration,reduced]);

  return <span ref={ref} className={className} data-numeric dir="ltr">
    {shown.toLocaleString("en-US",{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}
  </span>;
}

/** Placeholder that matches the shape of what is loading. */
export function Skeleton({lines=3,className}:{lines?:number;className?:string}){
  return <div className={cn("skeleton-group",className)} aria-hidden="true">
    {Array.from({length:lines},(_,index)=>
      <div key={index} className={cn("skeleton skeleton-line",index===lines-1?"short":index%2?"medium":undefined)}>&nbsp;</div>
    )}
  </div>;
}
