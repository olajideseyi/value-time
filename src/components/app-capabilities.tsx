"use client";
import {useEffect,useRef,useState} from "react";
import {supabase} from "@/lib/supabase";
import {Download,Check} from "lucide-react";

declare global { interface Window { deferredInstallPrompt?: any } }
export function InstallAppButton(){
 const [prompt,setPrompt]=useState<any>(null);const [installed,setInstalled]=useState(false);
 useEffect(()=>{const before=(e:Event)=>{e.preventDefault();setPrompt(e);};const done=()=>{setInstalled(true);setPrompt(null);};window.addEventListener("beforeinstallprompt",before);window.addEventListener("appinstalled",done);if(window.matchMedia("(display-mode: standalone)").matches)setInstalled(true);return()=>{window.removeEventListener("beforeinstallprompt",before);window.removeEventListener("appinstalled",done);};},[]);
 if(installed)return <span className="pwa-installed"><Check size={14}/> App installed</span>;
 return <button className="pwa-install" onClick={async()=>{if(!prompt){const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);alert(ios?"To add Value Time to your Home Screen, open this page in Safari, tap Share, then choose Add to Home Screen.":"Open your browser menu and choose Install app or Add to Home screen. If that option is unavailable, check that you are using the latest browser over HTTPS.");return;}await prompt.prompt();const result=await prompt.userChoice;if(result?.outcome==="accepted")setInstalled(true);setPrompt(null);}}><Download size={15}/> Install app</button>;
}
export function ReminderEngine(){
 const audio=useRef<AudioContext|null>(null);const fired=useRef<Set<string>>(new Set());
 useEffect(()=>{
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
  const unlock=async()=>{try{const C=window.AudioContext||(window as any).webkitAudioContext;if(!C)return;if(!audio.current)audio.current=new C();if(audio.current.state==="suspended")await audio.current.resume();}catch{}};
  window.addEventListener("pointerdown",unlock,{passive:true});window.addEventListener("keydown",unlock);
  let timers:ReturnType<typeof setTimeout>[]=[];let live=true;
  async function schedule(){
   if(!supabase)return;
   const {data:{session}}=await supabase.auth.getSession();if(!session||!live)return;
   const [reminders,prefs]=await Promise.all([
    supabase.from("reminders").select("id,title,message,due_at,channel").eq("user_id",session.user.id).eq("status","pending").in("channel",["in_app","push"]).order("due_at",{ascending:true}).order("due_at").limit(100),
    supabase.from("user_preferences").select("sound_enabled,push_enabled,alarm_sound,alarm_volume,alarm_repeat").eq("user_id",session.user.id).maybeSingle()
   ]);
   if(!live||reminders.error)return;
   const settings:any=prefs.data||{};
   for(const reminder of reminders.data||[]){
    if(fired.current.has(reminder.id))continue;
    const delay=Math.max(0,new Date(reminder.due_at).getTime()-Date.now());if(delay>2147480000)continue;
    timers.push(setTimeout(async()=>{
     if(!live||fired.current.has(reminder.id))return;fired.current.add(reminder.id);
     const body=reminder.message||"Your scheduled reminder is due.";
     if(settings.push_enabled&&"Notification"in window&&Notification.permission==="granted"){
      try{if("serviceWorker"in navigator){const reg=await navigator.serviceWorker.ready;await reg.showNotification(reminder.title,{body,tag:reminder.id,icon:"/icon.svg",badge:"/icon.svg"});}else new Notification(reminder.title,{body});}catch{}
     }
     if(settings.sound_enabled&&audio.current?.state==="running"){
      const ctx=audio.current,vol=Math.max(0,Math.min(1,Number(settings.alarm_volume??.75)));
      const tones=settings.alarm_sound==="chime"?[660,880,1046]:settings.alarm_sound==="pulse"?[880,440,880]:[880,988,1174];
      const rounds=settings.alarm_repeat===false?1:3;
      for(let n=0;n<rounds;n++)tones.forEach((hz,i)=>{const t=ctx.currentTime+n*.85+i*.17;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=hz;gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(vol*.2,t+.025);gain.gain.exponentialRampToValueAtTime(.001,t+.15);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.16);});
     }
     if(supabase)await supabase.from("reminders").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",reminder.id).eq("status","pending");
    },delay));
   }
  }
  schedule();const refresh=window.setInterval(()=>{timers.forEach(clearTimeout);timers=[];schedule();},60000);
  const auth=supabase?.auth.onAuthStateChange(()=>{timers.forEach(clearTimeout);timers=[];fired.current.clear();schedule();});
  return()=>{live=false;window.clearInterval(refresh);timers.forEach(clearTimeout);auth?.data.subscription.unsubscribe();window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
 },[]);
 return null;
}
