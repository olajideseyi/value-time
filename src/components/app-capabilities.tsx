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
 const audio=useRef<AudioContext|null>(null);const customAudio=useRef<HTMLAudioElement|null>(null);const fired=useRef<Map<string,string>>(new Map());
 useEffect(()=>{
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
  const unlock=async()=>{try{const C=window.AudioContext||(window as any).webkitAudioContext;if(!C)return;if(!audio.current)audio.current=new C();if(audio.current.state==="suspended")await audio.current.resume();}catch{}};
  window.addEventListener("pointerdown",unlock,{passive:true});window.addEventListener("keydown",unlock);
  let timers:ReturnType<typeof setTimeout>[]=[];let live=true;
  async function schedule(){
   if(!supabase)return;
   const {data:{session}}=await supabase.auth.getSession();if(!session||!live)return;
   const [reminders,prefs]=await Promise.all([
    supabase.from("reminders").select("id,title,message,due_at,channel").eq("user_id",session.user.id).eq("status","pending").eq("channel","in_app").order("due_at",{ascending:true}).order("due_at").limit(100),
    supabase.from("user_preferences").select("sound_enabled,push_enabled,alarm_sound,alarm_volume,alarm_repeat,custom_alarm_path").eq("user_id",session.user.id).maybeSingle()
   ]);
   if(!live||reminders.error)return;
   const settings:any=prefs.data||{};
   if(settings.custom_alarm_path&&settings.alarm_sound==="custom"){const signed=await supabase.storage.from("alarm-audio").createSignedUrl(settings.custom_alarm_path,3600);if(signed.data?.signedUrl){customAudio.current?.pause();customAudio.current=new Audio(signed.data.signedUrl);customAudio.current.volume=Math.max(0,Math.min(1,Number(settings.alarm_volume??.75)));}}
   for(const reminder of reminders.data||[]){
    if(fired.current.get(reminder.id)===reminder.due_at)continue;
    const delay=Math.max(0,new Date(reminder.due_at).getTime()-Date.now());if(delay>2147480000)continue;
    timers.push(setTimeout(async()=>{
     if(!live||fired.current.get(reminder.id)===reminder.due_at)return;fired.current.set(reminder.id,reminder.due_at);
     const body=reminder.message||"Your scheduled reminder is due.";
     if(settings.push_enabled&&"Notification"in window&&Notification.permission==="granted"){
      try{if("serviceWorker"in navigator){const reg=await navigator.serviceWorker.ready;await reg.showNotification(reminder.title,{body,tag:reminder.id,icon:"/icon.svg",badge:"/icon.svg"});}else new Notification(reminder.title,{body});}catch{}
     }
     if(settings.sound_enabled&&audio.current?.state==="running"){
      const ctx=audio.current,vol=Math.max(0,Math.min(1,Number(settings.alarm_volume??.75)));
      if(settings.alarm_sound==="custom"&&customAudio.current){try{customAudio.current.currentTime=0;customAudio.current.volume=vol;void customAudio.current.play().catch(()=>{});}catch{}}else{const patterns:Record<string,number[]>={classic:[880,988,1174],chime:[660,880,1046,1320],pulse:[880,440,880],digital:[1046,784,1046,1568],bell:[523,784,1046],soft:[523,659,784],urgent:[988,784,988,784,1174]};const tones=patterns[settings.alarm_sound]||patterns.classic;
      const rounds=settings.alarm_repeat===false?1:3;
      for(let n=0;n<rounds;n++)tones.forEach((hz,i)=>{const t=ctx.currentTime+n*.85+i*.17;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=hz;gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(vol*.2,t+.025);gain.gain.exponentialRampToValueAtTime(.001,t+.15);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.16);});}
     }
     if(supabase)await supabase.from("reminders").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",reminder.id).eq("status","pending");window.dispatchEvent(new Event("valuetime:reminders-changed"));
    },delay));
   }
  }
  schedule();const refreshTimers=()=>{timers.forEach(clearTimeout);timers=[];schedule();};const refresh=window.setInterval(refreshTimers,60000);window.addEventListener("valuetime:reminders-changed",refreshTimers);
  const auth=supabase?.auth.onAuthStateChange(()=>{timers.forEach(clearTimeout);timers=[];fired.current.clear();schedule();});
  return()=>{live=false;window.clearInterval(refresh);window.removeEventListener("valuetime:reminders-changed",refreshTimers);timers.forEach(clearTimeout);auth?.data.subscription.unsubscribe();window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
 },[]);
 return null;
}
