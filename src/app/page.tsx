"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlarmClock, ArrowRight, Bell, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown,
  CircleHelp, ClipboardList, Clock3, Command, LayoutDashboard, LogOut, Menu,
  Plus, Send, Settings2, Sparkles, Target, TrendingUp, X
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type Task = { id: string; title: string; status: string; priority: string; due_at: string | null };
type Schedule = { id: string; title: string; starts_at: string; ends_at: string; location: string | null; activity_type: string; recurrence_type?: string; recurrence_days?: number[]; recurrence_until?: string | null; lecturer_name?: string | null };
type Exam = { id: string; title: string; starts_at: string; ends_at: string | null; exam_type: string; location: string | null; status: string };
type Assignment = { id: string; title: string; due_at: string | null; status: string; priority: string };

const dateLabel = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" });
const timeLabel = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" });

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [displayName, setDisplayName] = useState("there");

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); if (event === "PASSWORD_RECOVERY") setRecoveryMode(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    let active = true;
    async function load() {
      const today = new Date();
      const start = new Date(today); start.setHours(0,0,0,0);
      const end = new Date(today); end.setHours(23,59,59,999);
      const examWindowEnd = new Date(end); examWindowEnd.setDate(examWindowEnd.getDate()+30);
      const [profile, taskRows, scheduleRows, assignmentRows, examRows] = await Promise.all([
        supabase!.from("profiles").select("display_name").eq("id", session!.user.id).maybeSingle(),
        supabase!.from("tasks").select("id,title,status,priority,due_at").neq("status","completed").order("due_at",{ascending:true}).limit(6),
        supabase!.from("schedule_entries").select("id,title,starts_at,ends_at,location,activity_type,recurrence_type,recurrence_days,recurrence_until,lecturer_name").eq("is_active",true).order("starts_at").limit(100),
        supabase!.from("assignments").select("id,title,due_at,status,priority").neq("status","completed").order("due_at",{ascending:true}).limit(5),
        supabase!.from("examinations").select("id,title,starts_at,ends_at,exam_type,location,status").eq("status","scheduled").gte("starts_at",start.toISOString()).lte("starts_at",examWindowEnd.toISOString()).order("starts_at").limit(5)
      ]);
      if (!active) return;
      setDisplayName(profile.data?.display_name?.split(" ")[0] || session!.user.email?.split("@")[0] || "there");
      setTasks(taskRows.data || []); const todaySchedule=(scheduleRows.data||[]).filter(item=>item.recurrence_type==="weekly"?(item.recurrence_days?.length?item.recurrence_days:[new Date(item.starts_at).getDay()]).includes(today.getDay())&&(!item.recurrence_until||item.recurrence_until>=today.toISOString().slice(0,10)):new Date(item.starts_at).toDateString()===today.toDateString()).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()).slice(0,6); setSchedule(todaySchedule); setAssignments(assignmentRows.data || []); setExams(examRows.data || []);
    }
    load();
    return () => { active = false; };
  }, [session]);

  const todayText = useMemo(() => dateLabel.format(new Date()), []);
  

  async function authenticate(e: FormEvent) {
    e.preventDefault(); setAuthError(""); setBusy(true);
    if (!supabase) { setAuthError("Account access is being prepared. Please try again shortly."); setBusy(false); return; }
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setAuthError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setNotice("Account created. Check your email to confirm your address, then sign in.");
    setBusy(false);
  }

  async function signOut() { await supabase?.auth.signOut(); setTasks([]); setSchedule([]); setAssignments([]); }
  async function addTask(e: FormEvent) {
    e.preventDefault(); if (!supabase || !session || !taskTitle.trim()) return;
    setAddingTask(true);
    const { data, error } = await supabase.from("tasks").insert({ user_id: session.user.id, title: taskTitle.trim(), status: "pending", priority: "medium" }).select("id,title,status,priority,due_at").single();
    if (error) setNotice(error.message); else { setTasks(current => [data, ...current]); setTaskTitle(""); setNotice("Task added to your list."); }
    setAddingTask(false);
  }
  async function completeTask(task: Task) {
    if (!supabase) return;
    const { error } = await supabase.from("tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id",task.id);
    if (!error) setTasks(current => current.filter(t => t.id !== task.id));
  }

  if (authLoading) return <main className="loading-screen"><div className="loader-mark"><Clock3 size={25}/></div><span>Preparing your workspace…</span></main>;

  if (session && recoveryMode) return <main className="auth-page"><section className="auth-panel"><div className="auth-form-wrap"><span className="eyebrow muted">SECURE YOUR ACCOUNT</span><h2>Choose a new password.</h2><p className="auth-subtitle">Use a password you have not used before.</p><form className="auth-form" onSubmit={async(e)=>{e.preventDefault();if(!supabase)return;setBusy(true);const {error}=await supabase.auth.updateUser({password});setAuthError(error?.message||"Your password has been updated. You can continue to your workspace.");if(!error)setRecoveryMode(false);setBusy(false);}}><label>New password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required placeholder="At least 8 characters"/></label>{authError&&<p className="form-error">{authError}</p>}<button className="primary-button full-button" disabled={busy}>{busy?"Updating…":"Update password"}<ArrowRight size={17}/></button></form></div></section></main>;

  if (!session) return <main className="auth-page">
    <section className="auth-visual">
      <div className="brand"><div className="brand-icon"><Clock3 size={21}/></div><span>value<span className="brand-light">time</span></span></div>
      <div className="auth-message">
        <span className="eyebrow"><Sparkles size={14}/> YOUR TIME, IN GOOD HANDS</span>
        <h1>Make room for<br/><em>what matters.</em></h1>
        <p>Your timetable, assignments, reminders and everyday plans — brought together in one calm, focused workspace.</p>
        <div className="visual-checks"><span><CheckCircle2 size={16}/> Stay ahead of deadlines</span><span><CheckCircle2 size={16}/> Build better routines</span><span><CheckCircle2 size={16}/> Never miss the important things</span></div>
      </div>
      <div className="visual-bottom"><span>PLAN WITH PURPOSE.</span><span>© 2026 VALUE TIME</span></div>
    </section>
    <section className="auth-panel">
      <div className="auth-form-wrap">
        <div className="mobile-brand brand"><div className="brand-icon"><Clock3 size={20}/></div><span>value<span className="brand-light">time</span></span></div>
        <span className="eyebrow muted">WELCOME TO VALUE TIME</span>
        <h2>{authMode === "signin" ? "Good to have you back." : "Create your workspace."}</h2>
        <p className="auth-subtitle">{authMode === "signin" ? "Sign in to pick up where you left off." : "A little more organised starts right here."}</p>
        {!isSupabaseConfigured && <div className="config-note"><CircleHelp size={17}/> <span><strong>Account access is temporarily unavailable.</strong><br/>Please try again shortly. Your information has not been lost.</span></div>}
        <form onSubmit={authenticate} className="auth-form">
          {authMode === "signup" && <label>Full name<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your name" required/></label>}
          <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required/></label>
          <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} autoComplete={authMode==="signin"?"current-password":"new-password"} required/></label>
          {authMode === "signin" && <button type="button" className="forgot-password" onClick={async()=>{if(!supabase||!email){setAuthError("Enter your email address first.");return;}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});setAuthError(error?.message||"If an account exists for this email, a password reset link has been sent.");}}>Forgot password?</button>}{authError && <p className="form-error">{authError}</p>}{notice && <p className="form-success">{notice}</p>}
          <button className="primary-button full-button" disabled={busy || !isSupabaseConfigured}>{!isSupabaseConfigured ? "Temporarily unavailable" : busy ? "Please wait…" : authMode==="signin" ? "Sign in" : "Create account"}<ArrowRight size={17}/></button>
        </form>
        <p className="auth-switch">{authMode==="signin" ? "New to Value Time?" : "Already have an account?"} <button onClick={()=>{setAuthMode(authMode==="signin"?"signup":"signin");setAuthError("");setNotice("");}}>{authMode==="signin"?"Create an account":"Sign in"}</button></p>
        <p className="privacy-note">Your workspace is private. Your activities and personal information are visible only to you.</p>
      </div>
    </section>
  </main>;

  return <main className="app-shell">
    <aside className={mobileNav?"sidebar open":"sidebar"}>
      <div className="brand sidebar-brand"><div className="brand-icon"><Clock3 size={21}/></div><span>value<span className="brand-light">time</span></span><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">
        <a className="nav-link active" href="#"><LayoutDashboard size={18}/> Overview</a>
        <a className="nav-link" href="/timetable"><CalendarDays size={18}/> Timetable</a>
        <a className="nav-link" href="/courses"><BookOpen size={18}/> Courses</a>
        <a className="nav-link" href="/exams"><CalendarDays size={18}/> Exams & assessments</a>
        <a className="nav-link" href="/assignments"><ClipboardList size={18}/> Assignments</a>
        <a className="nav-link" href="/tasks"><CheckCircle2 size={18}/> My tasks</a>
        <a className="nav-link" href="/reminders"><AlarmClock size={18}/> Alarms & reminders</a>
      </nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-tip"><div className="tip-icon"><Target size={18}/></div><strong>Make today count.</strong><p>Small steps, done consistently, make a remarkable difference.</p></div>
      <a className="nav-link settings-link" href="/settings"><Settings2 size={18}/> Settings</a>
      <div className="sidebar-user"><div className="avatar">{displayName.slice(0,1).toUpperCase()}</div><div className="user-meta"><strong>{displayName}</strong><span>Personal workspace</span></div><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={17}/></button></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <section className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><div className="topbar-actions"><span className="today-chip"><CalendarDays size={15}/>{todayText}</span><button className="notification-button" aria-label="Notifications"><Bell size={18}/><i/></button><div className="top-avatar">{displayName.slice(0,1).toUpperCase()}</div></div></header>
      <div className="content-wrap">
        <div className="welcome-row"><div><span className="eyebrow muted">YOUR PERSONAL OVERVIEW</span><h1>Good day, {displayName}<span className="wave">✳</span></h1><p>Here's what's happening with your time today.</p></div><div className="date-block"><span>{new Intl.DateTimeFormat("en-NG",{month:"short"}).format(new Date()).toUpperCase()}</span><strong>{new Date().getDate()}</strong><small>{new Intl.DateTimeFormat("en-NG",{weekday:"long"}).format(new Date())}</small></div></div>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-icon blue"><CalendarDays size={19}/></div><span>Today's activities</span><strong>{schedule.length.toString().padStart(2,"0")}</strong><small>On your timetable</small></div>
          <div className="stat-card"><div className="stat-icon violet"><ClipboardList size={19}/></div><span>Open assignments</span><strong>{assignments.length.toString().padStart(2,"0")}</strong><small>Need your attention</small></div>
          <div className="stat-card"><div className="stat-icon amber"><CheckCircle2 size={19}/></div><span>Active tasks</span><strong>{tasks.length.toString().padStart(2,"0")}</strong><small>Ready for your focus</small></div>
          <div className="stat-card"><div className="stat-icon green"><TrendingUp size={19}/></div><span>Upcoming exams</span><strong>{exams.length.toString().padStart(2,"0")}</strong><small>Assessments in the next 30 days</small></div>
        </div>
        {notice && <div className="inline-notice">{notice}<button onClick={()=>setNotice("")}><X size={15}/></button></div>}
        <div className="dashboard-grid">
          <section className="panel schedule-panel" id="timetable"><div className="panel-heading"><div><span className="eyebrow muted">YOUR DAY AT A GLANCE</span><h2>Today's timetable</h2></div><a href="/timetable">View timetable <ArrowRight size={14}/></a></div>
            {schedule.length ? <div className="timeline">{schedule.map(item=><div className="timeline-item" key={item.id}><div className="timeline-time">{timeLabel.format(new Date(item.starts_at))}</div><div className="timeline-track"><i/></div><div className="timeline-detail"><strong>{item.title}</strong><span>{item.location || item.activity_type.replace("_"," ")}{item.lecturer_name?" · "+item.lecturer_name:""}</span></div><span className="duration">{Math.max(1,Math.round((new Date(item.ends_at).getTime()-new Date(item.starts_at).getTime())/60000))} min</span></div>)}</div> : <div className="empty-state"><div className="empty-icon"><CalendarDays size={22}/></div><strong>Your day is still open.</strong><span>Add a class or activity to your timetable.</span></div>}
          </section>
          <section className="panel tasks-panel" id="tasks"><div className="panel-heading"><div><span className="eyebrow muted">KEEP THE MOMENTUM</span><h2>My tasks</h2></div><span className="count-pill">{tasks.length} active</span></div>
            <form className="quick-add" onSubmit={addTask}><input value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} placeholder="Add a task to your list…" aria-label="New task"/><button disabled={addingTask || !taskTitle.trim()} aria-label="Add task"><Plus size={19}/></button></form>
            <div className="task-list">{tasks.length ? tasks.map(task=><div className="task-row" key={task.id}><button className="task-check" onClick={()=>completeTask(task)} aria-label="Complete task"><Check size={14}/></button><div className="task-copy"><strong>{task.title}</strong><span>{task.due_at ? "Due "+new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(task.due_at)) : "No deadline"}</span></div><span className={"priority "+task.priority}>{task.priority}</span></div>) : <div className="mini-empty">No tasks yet. Add your first task above.</div>}</div>
          </section>
          <section className="panel assignments-panel" id="assignments"><div className="panel-heading"><div><span className="eyebrow muted">DEADLINES TO WATCH</span><h2>Assignments</h2></div><a href="#assignments">View all <ArrowRight size={14}/></a></div>
            {assignments.length ? <div className="assignment-list">{assignments.map(a=><div className="assignment-row" key={a.id}><div className="assignment-mark"><ClipboardList size={17}/></div><div className="assignment-copy"><strong>{a.title}</strong><span>{a.due_at ? "Due "+new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(a.due_at)) : "Deadline not set"}</span></div><span className={"priority "+a.priority}>{a.priority}</span></div>)}</div> : <div className="empty-state compact"><div className="empty-icon"><ClipboardList size={20}/></div><strong>No assignments added</strong><span>Your upcoming deadlines will appear here.</span></div>}
          </section>
          <section className="panel exams-panel" id="exams"><div className="panel-heading"><div><span className="eyebrow muted">PLAN AHEAD</span><h2>Examinations & assessments</h2></div><a href="/exams">View all <ArrowRight size={14}/></a></div>
            {exams.length ? <div className="assignment-list">{exams.map(exam=><div className="assignment-row" key={exam.id}><div className="assignment-mark"><CalendarDays size={17}/></div><div className="assignment-copy"><strong>{exam.title}</strong><span>{exam.exam_type.replace("_"," ")} · {new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(exam.starts_at))}{exam.location?" · "+exam.location:""}</span></div><span className="item-tag">Scheduled</span></div>)}</div> : <div className="empty-state compact"><div className="empty-icon"><CalendarDays size={20}/></div><strong>No upcoming assessments</strong><span>Your scheduled exams will appear here.</span></div>}
          </section>
          <section className="focus-card" id="reminders"><div className="focus-decoration"><Clock3 size={88}/></div><span className="eyebrow">STAY A STEP AHEAD</span><h2>Make time for<br/>what matters.</h2><p>Review your alarms, notification preferences and daily briefing settings.</p><a href="/reminders">Manage reminders <ArrowRight size={15}/></a></section>
        </div>
        <footer className="app-footer"><span>VALUE TIME <b>·</b> MAKE EVERY MOMENT COUNT</span><span>Built for a more intentional day.</span></footer>
      </div>
    </section>
  </main>;
}
