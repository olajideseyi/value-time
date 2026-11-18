"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ArrowLeft,CalendarClock,CheckCircle2,RefreshCw,Sparkles,AlertTriangle} from "lucide-react";
import {supabase} from "@/lib/supabase";

type Task={id:string;title:string;status:string;priority:string;due_at:string|null;planned_for:string|null;estimated_minutes:number};
type EventRow={id:string;title:string;starts_at:string;ends_at:string;recurrence_type:string;recurrence_days:number[];recurrence_until:string|null;is_active:boolean};
type Slot={task:Task;start:Date|null;end:Date|null;atRisk:boolean};
const key=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const rank=(p:string)=>({urgent:0,high:1,medium:2,low:3} as Record<string,number>)[p]??2;
const time=(d:Date)=>new Intl.DateTimeFormat("en-NG",{hour:"numeric",minute:"2-digit"}).format(d);

function makePlan(tasks:Task[],events:EventRow[],now:Date):Slot[]{
 const day=key(now),start=new Date(now);start.setHours(8,0,0,0);const finish=new Date(now);finish.setHours(22,0,0,0);
 let cursor=new Date(Math.max(start.getTime(),now.getTime()));cursor.setMinutes(Math.ceil(cursor.getMinutes()/15)*15,0,0);
 const blocks=events.filter(e=>e.is_active).flatMap(e=>{
  const original=new Date(e.starts_at),originalEnd=new Date(e.ends_at);
  if(e.recurrence_type==="weekly"){
   if(!(e.recurrence_days?.length?e.recurrence_days:[original.getDay()]).includes(now.getDay())||(e.recurrence_until&&e.recurrence_until<day))return [];
   const a=new Date(now);a.setHours(original.getHours(),original.getMinutes(),0,0);const b=new Date(now);b.setHours(originalEnd.getHours(),originalEnd.getMinutes(),0,0);return [{start:a,end:b}];
  }
  return key(original)===day?[{start:original,end:originalEnd}]:[];
 }).filter(e=>e.end>cursor).sort((a,b)=>a.start.getTime()-b.start.getTime());
 const gaps:{start:Date;end:Date}[]=[];
 for(const block of blocks){if(block.end<=cursor)continue;if(block.start>cursor)gaps.push({start:new Date(cursor),end:new Date(Math.min(block.start.getTime(),finish.getTime()))});cursor=new Date(Math.max(cursor.getTime(),block.end.getTime()));if(cursor>=finish)break;}
 if(cursor<finish)gaps.push({start:cursor,end:finish});
 const ordered=[...tasks].sort((a,b)=>rank(a.priority)-rank(b.priority)||((a.due_at?new Date(a.due_at).getTime():Infinity)-(b.due_at?new Date(b.due_at).getTime():Infinity)));
 const result:Slot[]=[];let gi=0;
 for(const task of ordered){const mins=Math.max(5,Math.min(480,Number(task.estimated_minutes)||45));let placed=false;while(gi<gaps.length){const gap=gaps[gi],a=new Date(gap.start),b=new Date(a.getTime()+mins*60000);if(b<=gap.end){result.push({task,start:a,end:b,atRisk:!!task.due_at&&new Date(task.due_at)<b});gap.start=new Date(b.getTime()+15*60000);if(gap.end.getTime()-gap.start.getTime()<5*60000)gi++;placed=true;break;}gi++;}if(!placed)result.push({task,start:null,end:null,atRisk:true});}
 return result;
}

export default function PlannerWorkspace(){
 const router=useRouter();const [uid,setUid]=useState("");const [loading,setLoading]=useState(true);const [tasks,setTasks]=useState<Task[]>([]);const [events,setEvents]=useState<EventRow[]>([]);const [slots,setSlots]=useState<Slot[]>([]);const [saving,setSaving]=useState(false);const [notice,setNotice]=useState("");const [error,setError]=useState("");const [today,setToday]=useState(new Date());
 const load=useCallback(async(id:string)=>{if(!supabase)return;const [t,e]=await Promise.all([supabase.from("tasks").select("id,title,status,priority,due_at,planned_for,estimated_minutes").eq("user_id",id).not("status","in","(completed,cancelled)").limit(200),supabase.from("schedule_entries").select("id,title,starts_at,ends_at,recurrence_type,recurrence_days,recurrence_until,is_active").eq("user_id",id).eq("is_active",true).limit(200)]);if(t.error||e.error)setError(t.error?.message||e.error?.message||"Could not load your plan.");const next=t.data||[],calendar=e.data||[];setTasks(next);setEvents(calendar);setSlots(makePlan(next,calendar,new Date()));},[]);
 useEffect(()=>{let live=true;(async()=>{if(!supabase){setError("Workspace unavailable.");setLoading(false);return;}const {data:{session}}=await supabase.auth.getSession();if(!live)return;if(!session){router.replace("/");return;}setUid(session.user.id);await load(session.user.id);if(live)setLoading(false);})();return()=>{live=false};},[load,router]);
 function recalculate(){const n=new Date();setToday(n);setSlots(makePlan(tasks,events,n));setNotice("Plan recalculated around your timetable, task priorities and remaining time.");}
 async function apply(){if(!supabase||!uid)return;const ready=slots.filter(s=>s.start);if(!ready.length){setNotice("No tasks fit into today's remaining free time.");return;}setSaving(true);setError("");const results=await Promise.all(ready.map(s=>supabase!.from("tasks").update({planned_for:s.start!.toISOString()}).eq("id",s.task.id).eq("user_id",uid)));const failure=results.find(x=>x.error);if(failure?.error)setError(failure.error.message);else{setNotice(ready.length+" task(s) scheduled. Deadlines were not changed.");await load(uid);}setSaving(false);}
 const fitted=slots.filter(s=>s.start).length,overflow=slots.length-fitted,already=tasks.filter(t=>t.planned_for&&key(new Date(t.planned_for))===key(today)).length;
 if(loading)return <main className="planner-page"><div className="planner-loading">Preparing your daily plan…</div></main>;
 return <main className="planner-page"><header className="planner-topbar"><Link href="/" className="planner-back"><ArrowLeft size={17}/> Overview</Link><span>VALUE TIME <i>·</i> DAILY PLANNER</span></header><div className="planner-container">
 <div className="planner-heading"><div><span className="planner-kicker">INTELLIGENT DAILY PLANNING</span><h1>A clearer plan for <em>today.</em></h1><p>Arrange unfinished work around your timetable, urgency and available time.</p><div className="planner-date"><CalendarClock size={15}/>{new Intl.DateTimeFormat("en-NG",{weekday:"long",day:"numeric",month:"long"}).format(today)}</div></div><button className="planner-refresh" onClick={recalculate}><RefreshCw size={15}/> Recalculate</button></div>
 {notice&&<div className="planner-notice"><CheckCircle2 size={16}/>{notice}<button onClick={()=>setNotice("")}>Dismiss</button></div>}{error&&<div className="planner-error">{error}</div>}
 <div className="planner-stats"><div><span>OPEN TASKS</span><strong>{tasks.length}</strong><small>Still to complete</small></div><div><span>PLANNED TODAY</span><strong>{already}</strong><small>Already assigned a time</small></div><div><span>FITS TODAY</span><strong>{fitted}</strong><small>Suggested time blocks</small></div><div><span>NEEDS ATTENTION</span><strong>{overflow}</strong><small>Cannot fit in free time</small></div></div>
 {overflow>0&&<div className="planner-warning"><AlertTriangle size={17}/><div><strong>Your day is getting full.</strong><span>{overflow} task(s) do not fit into today's remaining free time. Move lower-priority work to another day or adjust estimates.</span></div></div>}
 <section className="planner-panel"><div className="planner-panel-heading"><div><span className="planner-kicker">SUGGESTED SCHEDULE</span><h2>Make the next block count.</h2><p>Scheduled classes are protected and a 15-minute buffer is left between work blocks.</p></div><button className="planner-apply" disabled={!fitted||saving} onClick={()=>void apply()}>{saving?"Saving…":"Apply suggested plan"}</button></div>
 {slots.length?<div className="planner-timeline">{slots.map(s=><article className={s.start?"planner-slot":"planner-slot unscheduled"} key={s.task.id}><div className="planner-slot-time">{s.start?<><strong>{time(s.start)}</strong><span>{time(s.end!)}</span></>:"MOVE TO ANOTHER DAY"}</div><div className="planner-slot-line"><i/></div><div className="planner-slot-copy"><div><strong>{s.task.title}</strong><span className={"planner-priority "+s.task.priority}>{s.task.priority}</span>{s.atRisk&&<span className="planner-risk">Deadline risk</span>}</div><p>{s.task.estimated_minutes||45} min estimated{s.task.due_at?" · Due "+new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(s.task.due_at)):" · No deadline"}</p>{s.task.planned_for&&<small>Previously planned: {new Intl.DateTimeFormat("en-NG",{hour:"numeric",minute:"2-digit",day:"numeric",month:"short"}).format(new Date(s.task.planned_for))}</small>}</div><div className="planner-slot-icon">{s.start?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}</div></article>)}</div>:<div className="planner-empty"><Sparkles size={25}/><strong>Your task list is clear.</strong><span>Add tasks and estimated durations to build your daily plan.</span><Link href="/tasks">Open my tasks</Link></div>}</section>
 <section className="planner-guide"><Sparkles size={19}/><div><strong>How recommendations work</strong><p>Urgent and high-priority tasks are considered first, followed by the nearest deadlines. The planner uses estimated task durations, avoids your timetable and adds a 15-minute buffer. Applying the plan updates planned time only — actual deadlines remain unchanged.</p></div></section>
 <footer className="planner-footer">VALUE TIME <i>·</i> PLAN WITH PURPOSE. MAKE EVERY MOMENT COUNT.</footer></div></main>;
}
