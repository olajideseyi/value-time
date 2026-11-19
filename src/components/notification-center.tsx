"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Bell, CheckCheck, Clock3, RotateCcw, X, AlertCircle } from "lucide-react";

type Notice = { id: string; title: string; message: string | null; due_at: string; sent_at: string | null; status: string; read_at: string | null };

export function NotificationCenter() {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setItems([]); setLoading(false); return; }
    const { data, error: queryError } = await supabase.from("reminders")
      .select("id,title,message,due_at,sent_at,status,read_at")
      .eq("user_id", session.user.id).eq("channel", "in_app")
      .in("status", ["sent", "failed"])
      .order("sent_at", { ascending: false, nullsFirst: false }).limit(8);
    if (queryError) setError(queryError.message);
    else { setItems(data || []); setError(""); }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 45000);
    const refresh = () => { void load(); };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("valuetime:reminders-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("valuetime:reminders-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  const unread = items.filter(item => !item.read_at).length;

  async function markRead(id: string) {
    if (!supabase) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase.from("reminders").update({ read_at: readAt }).eq("id", id);
    if (error) setError(error.message);
    else setItems(current => current.map(item => item.id === id ? { ...item, read_at: readAt } : item));
  }

  async function markAllRead() {
    if (!supabase || !unread) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { error } = await supabase.from("reminders").update({ read_at: new Date().toISOString() })
      .eq("user_id", session.user.id).eq("channel", "in_app").is("read_at", null).in("status", ["sent", "failed"]);
    if (error) setError(error.message); else void load();
  }

  async function snooze(item: Notice) {
    if (!supabase) return;
    const due_at = new Date(Date.now() + 10 * 60000).toISOString();
    const { error } = await supabase.from("reminders").update({ status: "pending", due_at, sent_at: null, read_at: null, last_error: null }).eq("id", item.id);
    if (error) setError(error.message);
    else { setItems(current => current.filter(row => row.id !== item.id)); window.dispatchEvent(new Event("valuetime:reminders-changed")); }
  }

  async function dismiss(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("reminders").update({ status: "cancelled" }).eq("id", id);
    if (error) setError(error.message);
    else setItems(current => current.filter(row => row.id !== id));
  }

  return <section className="panel notification-center-panel" id="notifications">
    <div className="panel-heading">
      <div><span className="eyebrow muted">YOUR ALERTS</span><h2>Notification centre</h2><small className="notification-subtitle">Recent in-app reminders and delivery history</small></div>
      <div className="notification-heading-actions"><span className="notification-unread"><Bell size={13}/>{unread} unread</span>{unread > 0 && <button type="button" onClick={markAllRead}>Mark all read</button>}</div>
    </div>
    {error && <p className="notification-error"><AlertCircle size={14}/>{error}</p>}
    {loading ? <div className="notification-empty">Loading your notifications…</div> : items.length ? <div className="notification-list">
      {items.map(item => <article className={"notification-row" + (!item.read_at ? " unread" : "")} key={item.id}>
        <div className="notification-mark">{item.status === "failed" ? <AlertCircle size={16}/> : <Bell size={16}/>}</div>
        <div className="notification-copy"><strong>{item.title}</strong><span>{item.message || "Your scheduled reminder is due."}</span><small>{item.sent_at ? new Date(item.sent_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : new Date(item.due_at).toLocaleString("en-NG")}{item.status === "failed" ? " · Delivery failed" : " · Delivered"}</small></div>
        <div className="notification-row-actions">{!item.read_at && <button type="button" aria-label="Mark as read" title="Mark as read" onClick={() => markRead(item.id)}><CheckCheck size={15}/></button>}<button type="button" aria-label="Snooze for 10 minutes" title="Snooze 10 minutes" onClick={() => snooze(item)}><RotateCcw size={15}/></button><button type="button" aria-label="Dismiss notification" title="Dismiss" onClick={() => dismiss(item.id)}><X size={15}/></button></div>
      </article>)}
    </div> : <div className="notification-empty"><Clock3 size={21}/><strong>You're all caught up.</strong><span>New in-app reminders will appear here when they are delivered.</span></div>}
    <div className="notification-footer"><a href="/reminders">Manage alarms and reminder schedules</a></div>
  </section>;
}
