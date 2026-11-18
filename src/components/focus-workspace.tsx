"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, CheckCircle2, Clock3, Flame, Leaf, Pause, Play,
  Plus, RotateCcw, Target, Trash2, TrendingUp, Trophy, Volume2
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Habit = { id: string; title: string; description: string | null; frequency: "daily" | "weekly"; target_days: number[]; is_active: boolean };
type HabitEntry = { id: string; habit_id: string; entry_date: string; completed: boolean };
type FocusSession = { id: string; title: string; planned_minutes: number; duration_seconds: number; started_at: string; completed: boolean };
type Course = { id: string; name: string; code: string | null };

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const localDateKey = (d: Date) => [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
const formatMinutes = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? minutes + " min" : Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
};

export default function FocusWorkspace() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<{status:string;completed_at:string|null;created_at:string}[]>([]);
  const [attendance, setAttendance] = useState<{status:string}[]>([]);
  const [habitTitle, setHabitTitle] = useState("");
  const [habitFrequency, setHabitFrequency] = useState<"daily"|"weekly">("daily");
  const [habitDays, setHabitDays] = useState<number[]>([1,2,3,4,5,6,0]);
  const [focusTitle, setFocusTitle] = useState("Focused study");
  const [courseId, setCourseId] = useState("");
  const [mode, setMode] = useState<"focus"|"short"|"long">("focus");
  const [duration, setDuration] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25*60);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<string|null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  const today = localDateKey(new Date());

  const load = useCallback(async (userId: string) => {
    if (!supabase) return;
    const since = new Date(); since.setDate(since.getDate()-30); since.setHours(0,0,0,0);
    const week = new Date(); week.setDate(week.getDate()-6); week.setHours(0,0,0,0);
    const [h,e,s,c,t,a] = await Promise.all([
      supabase.from("habits").select("id,title,description,frequency,target_days,is_active").eq("user_id",userId).eq("is_active",true).order("created_at",{ascending:true}),
      supabase.from("habit_entries").select("id,habit_id,entry_date,completed").eq("user_id",userId).gte("entry_date",localDateKey(since)).lte("entry_date",today),
      supabase.from("focus_sessions").select("id,title,planned_minutes,duration_seconds,started_at,completed").eq("user_id",userId).gte("started_at",week.toISOString()).order("started_at",{ascending:false}).limit(100),
      supabase.from("courses").select("id,name,code").eq("user_id",userId).order("name"),
      supabase.from("tasks").select("status,completed_at,created_at").eq("user_id",userId).gte("created_at",since.toISOString()).limit(500),
      supabase.from("attendance").select("status").eq("user_id",userId).gte("marked_at",since.toISOString()).limit(500)
    ]);
    if (h.error || e.error || s.error || c.error || t.error || a.error) setError([h.error,e.error,s.error,c.error,t.error,a.error].find(Boolean)?.message || "Some productivity data could not be loaded.");
    setHabits(h.data||[]); setEntries(e.data||[]); setSessions(s.data||[]); setCourses(c.data||[]); setTasks(t.data||[]); setAttendance(a.data||[]);
  }, [today]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setError("Your workspace is unavailable. Please try again."); setLoading(false); return; }
      const {data:{session}} = await supabase.auth.getSession();
      if (!active) return;
      if (!session) { router.replace("/"); return; }
      setUid(session.user.id);
      await load(session.user.id);
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [load, router]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSecondsLeft(value => Math.max(0,value-1)),1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const saveFocus = useCallback(async (completed: boolean) => {
    if (!supabase || !uid || !startedAt || saving.current || mode !== "focus") return;
    saving.current = true;
    const elapsed = Math.max(0,duration*60-secondsLeft);
    if (elapsed < 30) { saving.current = false; return; }
    const {error:saveError} = await supabase.from("focus_sessions").insert({
      user_id:uid, course_id:courseId || null, title:focusTitle.trim() || "Focused study",
      planned_minutes:duration, duration_seconds:elapsed, started_at:startedAt,
      ended_at:new Date().toISOString(), completed
    });
    if (saveError) setError("Your focus session could not be saved: "+saveError.message);
    else { setNotice(completed ? "Focus session completed and saved." : "Focus time saved to your history."); await load(uid); }
    saving.current = false;
  },[uid,startedAt,mode,duration,secondsLeft,courseId,focusTitle,load]);

  useEffect(() => {
    if (secondsLeft !== 0 || !running) return;
    setRunning(false);
    if (mode === "focus") void saveFocus(true);
    setNotice(mode === "focus" ? "Well done. Your focus session is complete." : "Break finished. Ready for another round?");
  },[secondsLeft,running,mode,saveFocus]);

  const switchMode = (next:"focus"|"short"|"long") => {
    setRunning(false); setMode(next);
    const mins = next === "focus" ? duration : next === "short" ? 5 : 15;
    setSecondsLeft(mins*60); setStartedAt(null); saving.current = false;
  };
  const startTimer = () => {
    if (secondsLeft <= 0) return;
    if (mode === "focus" && !startedAt) setStartedAt(new Date().toISOString());
    setRunning(true);
  };
  const resetTimer = () => { setRunning(false); setSecondsLeft((mode==="focus"?duration:mode==="short"?5:15)*60); setStartedAt(null); saving.current=false; };
  const finishEarly = async () => { setRunning(false); await saveFocus(false); resetTimer(); };

  async function addHabit(e:FormEvent) {
    e.preventDefault(); if (!supabase || !uid || !habitTitle.trim()) return;
    setError(""); const {data,error:addError} = await supabase.from("habits").insert({
      user_id:uid,title:habitTitle.trim(),frequency:habitFrequency,target_days:habitFrequency==="daily"?[0,1,2,3,4,5,6]:habitDays
    }).select("id,title,description,frequency,target_days,is_active").single();
    if (addError) setError(addError.message);
    else { setHabits(current=>[...current,data]); setHabitTitle(""); setNotice("Habit added to your routine."); }
  }

  async function toggleHabit(habit:Habit) {
    if (!supabase) return;
    const existing = entries.find(x=>x.habit_id===habit.id&&x.entry_date===today);
    const next = !existing?.completed;
    const result = existing
      ? await supabase.from("habit_entries").update({completed:next}).eq("id",existing.id).select("id,habit_id,entry_date,completed").single()
      : await supabase.from("habit_entries").insert({user_id:uid,habit_id:habit.id,entry_date:today,completed:next}).select("id,habit_id,entry_date,completed").single();
    if (result.error) setError(result.error.message);
    else setEntries(current=>[...current.filter(x=>!(x.habit_id===habit.id&&x.entry_date===today)),result.data]);
  }

  async function deleteHabit(id:string) {
    if (!supabase || !window.confirm("Remove this habit and its history?")) return;
    const {error:deleteError} = await supabase.from("habits").delete().eq("id",id);
    if (deleteError) setError(deleteError.message);
    else { setHabits(current=>current.filter(x=>x.id!==id)); setEntries(current=>current.filter(x=>x.habit_id!==id)); }
  }

  const weekBars = useMemo(() => Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i)); const key=localDateKey(d);
    const seconds=sessions.filter(s=>localDateKey(new Date(s.started_at))===key).reduce((sum,s)=>sum+s.duration_seconds,0);
    return {label:dayNames[d.getDay()],minutes:Math.round(seconds/60)};
  }),[sessions]);
  const totalFocus = sessions.reduce((sum,s)=>sum+s.duration_seconds,0);
  const completedTasks = tasks.filter(t=>t.status==="completed").length;
  const attendanceCount = attendance.filter(a=>a.status==="joined"||a.status==="missed");
  const attendanceRate = attendanceCount.length ? Math.round(attendanceCount.filter(a=>a.status==="joined").length/attendanceCount.length*100) : 0;
  const maxBar = Math.max(60,...weekBars.map(x=>x.minutes));
  const progress = mode==="focus" ? 1-secondsLeft/(duration*60) : 1-secondsLeft/((mode==="short"?5:15)*60);
  const clock = String(Math.floor(secondsLeft/60)).padStart(2,"0")+":"+String(secondsLeft%60).padStart(2,"0");

  if (loading) return <main className="focus-page"><div className="focus-loading">Preparing your productivity workspace…</div></main>;

  return <main className="focus-page">
    <header className="focus-topbar"><Link href="/" className="focus-back"><ArrowLeft size={17}/> Back to overview</Link><span>VALUE TIME <i>·</i> FOCUS & INSIGHTS</span></header>
    <div className="focus-container">
      <div className="focus-heading"><div><span className="focus-kicker">PRODUCTIVITY WORKSPACE</span><h1>Make progress, <em>one session at a time.</em></h1><p>Protect your attention, build consistent habits and understand how you use your time.</p></div><div className="focus-date"><span>TODAY</span><strong>{new Intl.DateTimeFormat("en-NG",{day:"2-digit"}).format(new Date())}</strong><small>{new Intl.DateTimeFormat("en-NG",{month:"long",weekday:"long"}).format(new Date())}</small></div></div>
      {notice && <div className="focus-notice"><CheckCircle2 size={16}/>{notice}<button onClick={()=>setNotice("")}>Dismiss</button></div>}
      {error && <div className="focus-error">{error}</div>}
      <div className="focus-layout">
        <section className="focus-timer-card">
          <div className="focus-card-top"><div><span className="focus-kicker">FOCUS TIMER</span><h2>Give one thing your full attention.</h2></div><span className="focus-live"><i/> {running?"SESSION LIVE":"READY WHEN YOU ARE"}</span></div>
          <div className="timer-mode"><button className={mode==="focus"?"selected":""} onClick={()=>switchMode("focus")}>Focus</button><button className={mode==="short"?"selected":""} onClick={()=>switchMode("short")}>Short break</button><button className={mode==="long"?"selected":""} onClick={()=>switchMode("long")}>Long break</button></div>
          <div className="timer-face">
            <svg viewBox="0 0 260 260" role="img" aria-label={"Timer "+clock}>
              <circle cx="130" cy="130" r="112" className="timer-track"/>
              <circle cx="130" cy="130" r="112" className="timer-progress" strokeDasharray="703.7" strokeDashoffset={703.7*(1-progress)}/>
            </svg>
            <div className="timer-readout"><strong>{clock}</strong><span>{mode==="focus"?"STAY WITH IT":mode==="short"?"RESET YOUR MIND":"TAKE A REAL BREAK"}</span></div>
          </div>
          {mode==="focus" && <div className="timer-controls"><label>Session length<select disabled={running} value={duration} onChange={e=>{const n=Number(e.target.value);setDuration(n);setSecondsLeft(n*60);setStartedAt(null);}}><option value={15}>15 minutes</option><option value={25}>25 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={50}>50 minutes</option></select></label><label>Working on<input value={focusTitle} onChange={e=>setFocusTitle(e.target.value)} disabled={running}/></label><label>Course<select value={courseId} onChange={e=>setCourseId(e.target.value)} disabled={running}><option value="">Personal study</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code?c.code+" · ":""}{c.name}</option>)}</select></label></div>}
          <div className="timer-actions"><button className="timer-primary" onClick={running?()=>setRunning(false):startTimer}>{running?<Pause size={17}/>:<Play size={17}/>} {running?"Pause":secondsLeft===0?"Finished":"Start session"}</button><button className="timer-reset" onClick={resetTimer}><RotateCcw size={16}/> Reset</button>{mode==="focus"&&startedAt&&!running&&secondsLeft<(duration*60)&&<button className="timer-reset" onClick={()=>void finishEarly()}>Save & finish</button>}</div>
          <p className="timer-footnote"><Volume2 size={14}/> Keep this tab open while you focus. Your completed sessions are saved to your private workspace.</p>
        </section>
        <aside className="focus-side">
          <section className="insight-card"><div className="insight-heading"><div className="insight-icon"><Clock3 size={17}/></div><span>LAST 7 DAYS</span></div><strong>{formatMinutes(totalFocus)}</strong><p>Focused time recorded</p><div className="week-bars">{weekBars.map((b,i)=><div className="week-bar" key={i}><div className="week-bar-track"><i style={{height:Math.max(3,b.minutes/maxBar*100)+"%"}}/></div><span>{b.label}</span><small>{b.minutes?b.minutes+"m":"—"}</small></div>)}</div></section>
          <section className="insight-mini-grid"><div><span><CheckCircle2 size={15}/> TASKS DONE</span><strong>{completedTasks}</strong><small>In the last 30 days</small></div><div><span><TrendingUp size={15}/> ATTENDANCE</span><strong>{attendanceRate}%</strong><small>In the last 30 days</small></div></section>
          <section className="insight-card"><div className="insight-heading"><div className="insight-icon warm"><Flame size={17}/></div><span>ROUTINE CHECK-IN</span></div><strong>{habits.filter(h=>entries.some(e=>e.habit_id===h.id&&e.entry_date===today&&e.completed)).length}/{habits.length}</strong><p>Habits completed today</p><div className="habit-progress"><i style={{width:(habits.length?habits.filter(h=>entries.some(e=>e.habit_id===h.id&&e.entry_date===today&&e.completed)).length/habits.length*100:0)+"%"}}/></div></section>
        </aside>
      </div>
      <section className="habits-section">
        <div className="section-title-row"><div><span className="focus-kicker">SMALL ACTIONS, BIG MOMENTUM</span><h2>Your habits & routines</h2><p>Check off the routines you complete today.</p></div><span className="habit-count"><Leaf size={15}/>{habits.length} active habits</span></div>
        <form className="habit-create" onSubmit={addHabit}><input value={habitTitle} onChange={e=>setHabitTitle(e.target.value)} placeholder="Add a habit — e.g. Read for 20 minutes" maxLength={100} required/><select value={habitFrequency} onChange={e=>setHabitFrequency(e.target.value as "daily"|"weekly")}><option value="daily">Every day</option><option value="weekly">Selected days</option></select>{habitFrequency==="weekly"&&<div className="habit-day-picker">{dayNames.map((d,i)=><label key={d} className={habitDays.includes(i)?"active":""}><input type="checkbox" checked={habitDays.includes(i)} onChange={e=>setHabitDays(current=>e.target.checked?[...current,i]:current.filter(x=>x!==i))}/>{d}</label>)}</div>}<button className="habit-add" disabled={!habitTitle.trim()||habitFrequency==="weekly"&&!habitDays.length}><Plus size={16}/> Add habit</button></form>
        {habits.length ? <div className="habit-grid">{habits.map(h=>{const done=entries.some(e=>e.habit_id===h.id&&e.entry_date===today&&e.completed);const scheduled=h.frequency==="daily"||h.target_days.includes(new Date().getDay());return <article className={done?"habit-card is-done":"habit-card"} key={h.id}><div className="habit-card-mark"><Leaf size={18}/></div><div className="habit-card-copy"><strong>{h.title}</strong><span>{h.frequency==="daily"?"Daily routine":"Every "+h.target_days.map(d=>dayNames[d]).join(", ")}</span></div><button className="habit-check" disabled={!scheduled} onClick={()=>void toggleHabit(h)} aria-label={done?"Mark habit incomplete":"Mark habit complete"}>{done?<Check size={17}/>:<span/>}</button><button className="habit-delete" onClick={()=>void deleteHabit(h.id)} aria-label="Delete habit"><Trash2 size={15}/></button></article>;})}</div> : <div className="habits-empty"><Trophy size={23}/><strong>Build a routine that works for you.</strong><span>Add your first habit above and track your consistency here.</span></div>}
      </section>
      <section className="focus-history"><div className="section-title-row"><div><span className="focus-kicker">RECENT ACTIVITY</span><h2>Focus history</h2><p>Your recorded sessions from the past seven days.</p></div></div>{sessions.length?<div className="focus-history-list">{sessions.slice(0,8).map(s=><div className="focus-history-row" key={s.id}><div className="history-icon"><Clock3 size={16}/></div><div><strong>{s.title}</strong><span>{new Intl.DateTimeFormat("en-NG",{weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(s.started_at))}</span></div><b>{formatMinutes(s.duration_seconds)}</b></div>)}</div>:<div className="history-empty">Your completed focus sessions will appear here.</div>}</section>
      <footer className="focus-footer">VALUE TIME <i>·</i> BUILD A BETTER RELATIONSHIP WITH YOUR TIME</footer>
    </div>
  </main>;
}
