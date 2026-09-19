"use client";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Layout primitives for سَنَد.
   Eleven views were each repeating their own header, panel, stat tile and empty
   state markup. These are those patterns, once, so a screen describes what it
   shows instead of how it is built. Styling comes from app/ui-primitives.css. */

export type Tone="neutral"|"brand"|"good"|"warn"|"danger"|"info";

/** Page-level heading: eyebrow, title, one line of context, optional actions. */
export function PageHeader({eyebrow,title,description,actions,className}:{
  eyebrow?:ReactNode;title:ReactNode;description?:ReactNode;actions?:ReactNode;className?:string;
}){
  return <header className={cn("page-header",className)}>
    <div className="page-header-copy">
      {eyebrow?<span className="page-eyebrow">{eyebrow}</span>:null}
      <h1 className="page-title">{title}</h1>
      {description?<p className="page-description">{description}</p>:null}
    </div>
    {actions?<div className="page-header-actions">{actions}</div>:null}
  </header>;
}

/** A titled region inside a view. */
export function Section({title,description,actions,children,className,contentClassName}:{
  title?:ReactNode;description?:ReactNode;actions?:ReactNode;children:ReactNode;className?:string;contentClassName?:string;
}){
  return <section className={cn("section",className)}>
    {(title||actions)?<div className="section-head">
      <div className="section-head-copy">
        {title?<h2 className="section-title">{title}</h2>:null}
        {description?<p className="section-description">{description}</p>:null}
      </div>
      {actions?<div className="section-actions">{actions}</div>:null}
    </div>:null}
    <div className={cn("section-body",contentClassName)}>{children}</div>
  </section>;
}

/** Card surface. `interactive` adds hover lift and press feedback. */
export function Panel({children,className,interactive=false,tone="neutral",...rest}:{
  children:ReactNode;className?:string;interactive?:boolean;tone?:Tone;
}&React.HTMLAttributes<HTMLDivElement>){
  return <div className={cn("panel",interactive&&"lift press",className)} data-tone={tone} {...rest}>{children}</div>;
}

/** Figure tile: label, value, optional delta and icon. */
export function StatCard({label,value,hint,icon:Icon,tone="neutral",onClick,className}:{
  label:ReactNode;value:ReactNode;hint?:ReactNode;icon?:ComponentType<{size?:number}>;tone?:Tone;onClick?:()=>void;className?:string;
}){
  const Tag=onClick?"button":"div";
  return <Tag type={onClick?"button":undefined} onClick={onClick}
    className={cn("stat-tile",onClick&&"lift press",className)} data-tone={tone}>
    <span className="stat-tile-head">
      {Icon?<span className="stat-tile-icon"><Icon size={18}/></span>:null}
      <span className="stat-tile-label">{label}</span>
    </span>
    <span className="stat-tile-value" data-numeric>{value}</span>
    {hint?<span className="stat-tile-hint">{hint}</span>:null}
  </Tag>;
}

/** Status chip. Semantic colour is separate from the brand accent. */
export function Pill({children,tone="neutral",className}:{children:ReactNode;tone?:Tone;className?:string}){
  return <span className={cn("pill",className)} data-tone={tone}>{children}</span>;
}

/** Shown when a list has nothing in it — always says what to do next. */
export function EmptyState({icon:Icon,title,description,action,className}:{
  icon?:ComponentType<{size?:number}>;title:ReactNode;description?:ReactNode;action?:ReactNode;className?:string;
}){
  return <div className={cn("empty-state",className)}>
    {Icon?<span className="empty-state-icon"><Icon size={26}/></span>:null}
    <p className="empty-state-title">{title}</p>
    {description?<p className="empty-state-description">{description}</p>:null}
    {action?<div className="empty-state-action">{action}</div>:null}
  </div>;
}

/** Horizontal control strip that wraps instead of overflowing on a phone. */
export function Toolbar({children,className,align="start"}:{children:ReactNode;className?:string;align?:"start"|"between"|"end"}){
  return <div className={cn("toolbar",className)} data-align={align}>{children}</div>;
}

/** Wide tables stay readable: they scroll in their own box, never the page. */
export function TableScroll({children,label,className}:{children:ReactNode;label?:string;className?:string}){
  return <div className={cn("table-scroll",className)} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

/** Key/value line used across case details and review packets. */
export function Field({label,children,dir}:{label:ReactNode;children:ReactNode;dir?:"rtl"|"ltr"}){
  return <div className="kv">
    <span className="kv-label">{label}</span>
    <span className="kv-value" dir={dir}>{children}</span>
  </div>;
}
