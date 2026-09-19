"use client";
import { useEffect, useState } from "react";
import { Moon, Sun, MonitorCog } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme="light"|"dark"|"system";
const STORAGE_KEY="sanad-theme";

function apply(theme:Theme){
  const root=document.documentElement;
  if(theme==="system")root.removeAttribute("data-theme");
  else root.setAttribute("data-theme",theme);
}

/** Cycles system → light → dark. The choice is per-device, so it lives in
    localStorage; app/layout.tsx replays it before first paint. */
export default function ThemeToggle({className}:{className?:string}){
  const [theme,setTheme]=useState<Theme>("system");
  const [ready,setReady]=useState(false);

  useEffect(()=>{
    let saved:Theme="system";
    try{
      const stored=localStorage.getItem(STORAGE_KEY);
      if(stored==="dark"||stored==="light")saved=stored;
    }catch{/* private mode: fall back to the system setting */}
    setTheme(saved);
    setReady(true);
  },[]);

  function next(){
    const order:Theme[]=["system","light","dark"];
    const value=order[(order.indexOf(theme)+1)%order.length];
    setTheme(value);
    apply(value);
    try{
      if(value==="system")localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY,value);
    }catch{/* nothing to persist to; the attribute still applies for this visit */}
  }

  const label=theme==="dark"?"المظهر: داكن":theme==="light"?"المظهر: فاتح":"المظهر: حسب النظام";
  const Icon=theme==="dark"?Moon:theme==="light"?Sun:MonitorCog;

  return <Button type="button" variant="ghost" size="icon" onClick={next}
    className={className} aria-label={label} title={label}>
    {ready?<Icon size={18}/>:<MonitorCog size={18}/>}
  </Button>;
}
