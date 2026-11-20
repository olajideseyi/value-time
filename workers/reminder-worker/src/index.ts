export interface Env { SUPABASE_URL:string; SUPABASE_SERVICE_ROLE_KEY:string; TELEGRAM_BOT_TOKEN?:string; RESEND_API_KEY?:string; EMAIL_FROM?:string; VAPID_PUBLIC_KEY?:string; VAPID_PRIVATE_JWK?:string; VAPID_SUBJECT?:string; }
interface WorkerScheduledController { cron:string; scheduledTime:number; }
interface WorkerExecutionContext { waitUntil(promise:Promise<unknown>):void; passThroughOnException():void; }
type DueReminder={id:string;user_id:string;title:string;message:string|null;attempts:number;channel:"telegram"|"email"|"push"|"in_app"};
type TelegramConnection={telegram_chat_id:string|null;notifications_enabled:boolean};
async function sendEmail(env:Env,to:string,subject:string,html:string){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw new Error("Email delivery is not configured. Add RESEND_API_KEY and EMAIL_FROM to the reminder Worker secrets.");
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
 const data=await r.json() as {id?:string;message?:string};if(!r.ok)throw new Error(data.message||"Resend email failed with HTTP "+r.status);return data.id||null;
}

type PushSubscriptionRow={id:string;endpoint:string;p256dh:string;auth_secret:string};
const utf8=(value:string)=>new TextEncoder().encode(value);
function bytesToBase64Url(bytes:Uint8Array){
 let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function base64UrlToBytes(value:string){
 const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);
 const binary=atob(padded);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function concatBytes(...parts:Uint8Array[]){
 const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;
 for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
async function hkdf(input:Uint8Array,salt:Uint8Array,info:Uint8Array,length:number){
 const inputBuffer=input.slice().buffer as ArrayBuffer;
 const saltBuffer=salt.slice().buffer as ArrayBuffer;
 const infoBuffer=info.slice().buffer as ArrayBuffer;
 const key=await crypto.subtle.importKey("raw",inputBuffer,"HKDF",false,["deriveBits"]);
 return new Uint8Array(await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt:saltBuffer,info:infoBuffer},key,length*8));
}
async function vapidToken(endpoint:string,env:Env){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_JWK||!env.VAPID_SUBJECT)throw new Error("Web Push is not configured. Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK, and VAPID_SUBJECT to the reminder Worker.");
 const audience=new URL(endpoint).origin;
 const header=bytesToBase64Url(utf8(JSON.stringify({typ:"JWT",alg:"ES256"})));
 const claims=bytesToBase64Url(utf8(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+12*60*60,sub:env.VAPID_SUBJECT})));
 const unsigned=header+"."+claims;
 const privateKey=await crypto.subtle.importKey("jwk",JSON.parse(env.VAPID_PRIVATE_JWK),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,utf8(unsigned)));
 return unsigned+"."+bytesToBase64Url(signature);
}
async function encryptPushPayload(subscription:PushSubscriptionRow,payload:string){
 const clientPublic=base64UrlToBytes(subscription.p256dh),authSecret=base64UrlToBytes(subscription.auth_secret);
 if(clientPublic.length!==65||authSecret.length!==16)throw new Error("Stored push subscription keys are invalid.");
 const pair=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]) as CryptoKeyPair;
 const serverPublic=new Uint8Array(await crypto.subtle.exportKey("raw",pair.publicKey));
 const peer=await crypto.subtle.importKey("raw",clientPublic,{name:"ECDH",namedCurve:"P-256"},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:peer},pair.privateKey,256));
 const ikm=await hkdf(shared,authSecret,concatBytes(utf8("WebPush: info\0"),clientPublic,serverPublic),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,utf8("Content-Encoding: aes128gcm\0"),16);
 const nonce=await hkdf(ikm,salt,utf8("Content-Encoding: nonce\0"),12);
 const key=await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["encrypt"]);
 const plain=concatBytes(utf8(payload),new Uint8Array([2]));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,tagLength:128},key,plain));
 const recordSize=new Uint8Array([0,0,16,0]);
 const keyLength=new Uint8Array([serverPublic.length]);
 return concatBytes(salt,recordSize,keyLength,serverPublic,encrypted);
}
async function sendWebPush(env:Env,subscription:PushSubscriptionRow,payload:{title:string;body:string;url?:string;tag?:string}){
 const token=await vapidToken(subscription.endpoint,env);
 const body=await encryptPushPayload(subscription,JSON.stringify(payload));
 const response=await fetch(subscription.endpoint,{method:"POST",headers:{
  "Authorization":"vapid t="+token+", k="+env.VAPID_PUBLIC_KEY,
  "Content-Type":"application/octet-stream","Content-Encoding":"aes128gcm","TTL":"300","Urgency":"high"
 },body});
 if(response.status===404||response.status===410)return {expired:true,status:response.status};
 if(!response.ok)throw new Error("Push service returned HTTP "+response.status+": "+(await response.text()).slice(0,300));
 return {expired:false,status:response.status};
}
async function deliverPush(env:Env,base:string,headers:Record<string,string>,userId:string,reminder:DueReminder){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_JWK||!env.VAPID_SUBJECT)throw new Error("Web Push is not configured on the reminder Worker.");
 const url=new URL(base+"/rest/v1/push_subscriptions");url.searchParams.set("select","id,endpoint,p256dh,auth_secret");url.searchParams.set("user_id","eq."+userId);
 const response=await fetch(url,{headers});if(!response.ok)throw new Error("Could not load push subscriptions: HTTP "+response.status);
 const subscriptions=await response.json() as PushSubscriptionRow[];if(!subscriptions.length)throw new Error("No registered browser or device push subscription was found.");
 let delivered=0;const failures:string[]=[];
 for(const subscription of subscriptions){
  try{
   const result=await sendWebPush(env,subscription,{title:reminder.title,body:reminder.message||"Your scheduled reminder is due.",url:"/reminders",tag:reminder.id});
   if(result.expired){await fetch(base+"/rest/v1/push_subscriptions?id=eq."+subscription.id,{method:"DELETE",headers});continue;}
   delivered++;await fetch(base+"/rest/v1/push_subscriptions?id=eq."+subscription.id,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({last_success_at:new Date().toISOString()})});
  }catch(error){failures.push(error instanceof Error?error.message:"Push delivery failed.");}
 }
 if(!delivered)throw new Error(failures[0]||"All push subscriptions have expired.");
 return "push:"+delivered;
}

function localParts(date:Date,tz:string){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 return {year:Number(parts.find(x=>x.type==="year")!.value),month:Number(parts.find(x=>x.type==="month")!.value),day:Number(parts.find(x=>x.type==="day")!.value)};
}
function localTimeParts(date:Date,tz:string){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
 return {hour:Number(parts.find(x=>x.type==="hour")!.value),minute:Number(parts.find(x=>x.type==="minute")!.value)};
}
function localDateTimeToUtc(date:string,hour:number,minute:number,tz:string){
 const [year,month,day]=date.split("-").map(Number);
 const desired=Date.UTC(year,month-1,day,hour,minute);
 let guess=new Date(desired);
 for(let i=0;i<3;i++){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(guess);
  const actual=Date.UTC(Number(parts.find(x=>x.type==="year")!.value),Number(parts.find(x=>x.type==="month")!.value)-1,Number(parts.find(x=>x.type==="day")!.value),Number(parts.find(x=>x.type==="hour")!.value),Number(parts.find(x=>x.type==="minute")!.value));
  guess=new Date(guess.getTime()+desired-actual);
 }
 return guess;
}
async function processRecurringScheduleReminders(env:Env){
 const base=env.SUPABASE_URL.replace(/\/$/,"");
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const scheduleUrl=new URL(base+"/rest/v1/schedule_entries");
 scheduleUrl.searchParams.set("select","id,user_id,title,starts_at,timezone,location,lecturer_name,recurrence_days,recurrence_until,reminder_minutes");
 scheduleUrl.searchParams.set("is_active","eq.true");scheduleUrl.searchParams.set("recurrence_type","eq.weekly");scheduleUrl.searchParams.set("limit","500");
 const response=await fetch(scheduleUrl,{headers});if(!response.ok)throw new Error("Recurring timetable query failed: HTTP "+response.status+" "+(await response.text()).slice(0,500));
 const schedules=await response.json() as any[];if(!schedules.length)return;
 const now=new Date(),horizon=new Date(now.getTime()+14*86400000);
 const pushSubscriptionsUrl=new URL(base+"/rest/v1/push_subscriptions");pushSubscriptionsUrl.searchParams.set("select","user_id");pushSubscriptionsUrl.searchParams.set("user_id","in.("+[...new Set(schedules.map(x=>x.user_id))].join(",")+")");const pushSubscriptionsResponse=await fetch(pushSubscriptionsUrl,{headers});if(!pushSubscriptionsResponse.ok)throw new Error("Push subscription lookup failed: HTTP "+pushSubscriptionsResponse.status+" "+(await pushSubscriptionsResponse.text()).slice(0,250));const pushReady=new Set((await pushSubscriptionsResponse.json() as {user_id:string}[]).map(x=>x.user_id));
 const preferenceUrl=new URL(base+"/rest/v1/user_preferences");preferenceUrl.searchParams.set("select","user_id,email_notifications_enabled,push_enabled");preferenceUrl.searchParams.set("user_id","in.("+[...new Set(schedules.map(x=>x.user_id))].join(",")+")");const preferenceResponse=await fetch(preferenceUrl,{headers});const preferenceRows=preferenceResponse.ok?await preferenceResponse.json() as any[]:[];const emailEnabled=new Map(preferenceRows.map(x=>[x.user_id,x.email_notifications_enabled!==false]));const pushEnabled=new Map(preferenceRows.map(x=>[x.user_id,x.push_enabled!==false]));
 const existingUrl=new URL(base+"/rest/v1/reminders");
 existingUrl.searchParams.set("select","target_id,occurrence_starts_at,reminder_offset_minutes,channel");existingUrl.searchParams.set("target_type","eq.schedule");
 existingUrl.searchParams.set("due_at","gte."+new Date(now.getTime()-86400000).toISOString());
 existingUrl.searchParams.append("and","(due_at.lte."+horizon.toISOString()+")");existingUrl.searchParams.set("limit","10000");
 const existingResponse=await fetch(existingUrl,{headers});if(!existingResponse.ok)throw new Error("Existing schedule reminder lookup failed: "+existingResponse.status);
 const existing=await existingResponse.json() as any[];
 const keys=new Set(existing.filter(x=>x.occurrence_starts_at&&x.reminder_offset_minutes!==null).map(x=>x.target_id+"|"+new Date(x.occurrence_starts_at).toISOString()+"|"+x.reminder_offset_minutes+"|"+x.channel));
 const inserts:any[]=[];
 for(const entry of schedules){
  const tz=entry.timezone||"Africa/Lagos";const start=new Date(entry.starts_at);const time=localTimeParts(start,tz);
  const weekdays=Array.isArray(entry.recurrence_days)&&entry.recurrence_days.length?entry.recurrence_days:[new Date(new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(start)+"T00:00:00Z").getUTCDay()];
  const reminderMinutes=Array.isArray(entry.reminder_minutes)&&entry.reminder_minutes.length?entry.reminder_minutes:[30,10];
  const today=localParts(now,tz);
  for(let offset=0;offset<=14;offset++){
   const dateObj=new Date(Date.UTC(today.year,today.month-1,today.day+offset));
   const date=dateObj.toISOString().slice(0,10);const weekday=dateObj.getUTCDay();
   if(!weekdays.includes(weekday)||entry.recurrence_until&&date>entry.recurrence_until)continue;
   const occurrence=localDateTimeToUtc(date,time.hour,time.minute,tz);
   for(const mins of reminderMinutes){
    const dueAt=new Date(occurrence.getTime()-Number(mins)*60000);
    if(dueAt<=now||dueAt>horizon)continue;
    const message=(entry.lecturer_name?"Lecturer: "+entry.lecturer_name+". ":"")+(entry.location||"Your scheduled activity is coming up.");
    for(const channel of (["in_app",...(emailEnabled.get(entry.user_id)===false?[]:["email"]),...(pushEnabled.get(entry.user_id)===false||!pushReady.has(entry.user_id)?[]:["push"])] as const)){
     const key=entry.id+"|"+occurrence.toISOString()+"|"+mins+"|"+channel;if(keys.has(key))continue;
     keys.add(key);inserts.push({user_id:entry.user_id,target_type:"schedule",target_id:entry.id,occurrence_starts_at:occurrence.toISOString(),reminder_offset_minutes:Number(mins),title:entry.title+" starts soon",message,channel,due_at:dueAt.toISOString(),status:"pending"});
    }
   }
  }
 }
 for(let i=0;i<inserts.length;i+=500){
  const batch=inserts.slice(i,i+500);const insertUrl=new URL(base+"/rest/v1/reminders");insertUrl.searchParams.set("on_conflict","user_id,target_id,occurrence_starts_at,reminder_offset_minutes,channel");const saved=await fetch(insertUrl,{method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(batch)});
  if(!saved.ok)throw new Error("Could not create recurring schedule reminders: "+saved.status+" "+await saved.text());
 }
}
async function processRecurringTasks(env:Env){
 const base=env.SUPABASE_URL.replace(/\/$/,"");
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const q=new URL(base+"/rest/v1/tasks");
 q.searchParams.set("select","id,user_id,title,description,priority,due_at,recurrence_rule,recurrence_parent_id,recurrence_generated_at,completed_at,estimated_minutes");
 q.searchParams.set("is_recurring","eq.true");q.searchParams.set("status","eq.completed");q.searchParams.set("recurrence_rule","not.is.null");q.searchParams.set("limit","200");
 const response=await fetch(q,{headers});if(!response.ok)throw new Error("Recurring task query failed: "+response.status+" "+(await response.text()).slice(0,300));
 const tasks=await response.json() as any[];if(!tasks.length)return;
 const ids=[...new Set(tasks.map(t=>t.user_id))];const prefUrl=new URL(base+"/rest/v1/user_preferences");prefUrl.searchParams.set("select","user_id,timezone");prefUrl.searchParams.set("user_id","in.("+ids.join(",")+")");
 const prefResponse=await fetch(prefUrl,{headers});const prefRows=prefResponse.ok?await prefResponse.json() as {user_id:string;timezone:string|null}[]:[];
 const timezones=new Map(prefRows.map(p=>[p.user_id,p.timezone||"Africa/Lagos"]));
 for(const task of tasks){
  if(task.completed_at&&task.recurrence_generated_at&&new Date(task.recurrence_generated_at)>=new Date(task.completed_at))continue;
  const rule=String(task.recurrence_rule).toLowerCase();if(!["daily","weekly","monthly"].includes(rule))continue;
  const completedAt=task.completed_at?new Date(task.completed_at):new Date();
  const dueAt=task.due_at?new Date(task.due_at):completedAt;
  const baseDate=new Date(Math.max(completedAt.getTime(),dueAt.getTime()));
  const tz=timezones.get(task.user_id)||"Africa/Lagos";
  const parts=localParts(baseDate,tz),clock=localTimeParts(baseDate,tz);
  let date: string;
  if(rule==="monthly"){
   const nextMonth=new Date(Date.UTC(parts.year,parts.month,1));
   const lastDay=new Date(Date.UTC(nextMonth.getUTCFullYear(),nextMonth.getUTCMonth()+1,0)).getUTCDate();
   date=[nextMonth.getUTCFullYear(),String(nextMonth.getUTCMonth()+1).padStart(2,"0"),String(Math.min(parts.day,lastDay)).padStart(2,"0")].join("-");
  }else{
   const next=new Date(Date.UTC(parts.year,parts.month-1,parts.day+(rule==="weekly"?7:1)));
   date=next.toISOString().slice(0,10);
  }
  const nextDue=localDateTimeToUtc(date,clock.hour,clock.minute,tz);
  const rootId=task.recurrence_parent_id||task.id;
  const insertUrl=new URL(base+"/rest/v1/tasks");insertUrl.searchParams.set("on_conflict","recurrence_parent_id,due_at");
  const body={user_id:task.user_id,title:task.title,description:task.description,priority:task.priority,status:"pending",due_at:nextDue.toISOString(),is_recurring:true,recurrence_rule:rule,recurrence_parent_id:rootId,estimated_minutes:task.estimated_minutes||45};
  const inserted=await fetch(insertUrl,{method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(body)});
  if(!inserted.ok)throw new Error("Could not generate next recurring task: "+inserted.status+" "+(await inserted.text()).slice(0,300));
  const markUrl=new URL(base+"/rest/v1/tasks");markUrl.searchParams.set("id","eq."+task.id);
  const marked=await fetch(markUrl,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({recurrence_generated_at:new Date().toISOString()})});
  if(!marked.ok)throw new Error("Could not mark recurring task occurrence: "+marked.status);
 }
}


async function processUpcomingItemReminders(env:Env){
 const base=env.SUPABASE_URL.replace(/\\/$/,"");
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const now=new Date(),horizon=new Date(now.getTime()+14*86400000),nowIso=now.toISOString(),horizonIso=horizon.toISOString();
 const getRows=async(table:string,params:Record<string,string>)=>{
  const url=new URL(base+"/rest/v1/"+table);url.searchParams.set("select","*");url.searchParams.set("limit","1000");
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{headers});if(!response.ok)throw new Error("Upcoming "+table+" lookup failed: HTTP "+response.status+" "+(await response.text()).slice(0,300));
  return await response.json() as any[];
 };
 const [schedules,tasks,assignments,exams]=await Promise.all([
  getRows("schedule_entries",{is_active:"eq.true",starts_at:"gte."+nowIso,"and":"(starts_at.lte."+horizonIso+")"}).then(rows=>rows.filter(x=>x.recurrence_type!=="weekly")),
  getRows("tasks",{due_at:"gte."+nowIso,"and":"(due_at.lte."+horizonIso+")",status:"not.in.(completed,cancelled)"}),
  getRows("assignments",{due_at:"gte."+nowIso,"and":"(due_at.lte."+horizonIso+")",status:"not.in.(submitted,completed)"}),
  getRows("examinations",{starts_at:"gte."+nowIso,"and":"(starts_at.lte."+horizonIso+")",status:"eq.scheduled"})
 ]);
 const events:any[]=[
  ...schedules.map(x=>({row:x,type:"schedule",time:x.starts_at,offsets:Array.isArray(x.reminder_minutes)&&x.reminder_minutes.length?x.reminder_minutes:[30,10],titleSuffix:" starts soon",message:(x.lecturer_name?"Lecturer: "+x.lecturer_name+". ":"")+(x.location||"Your scheduled activity is coming up.")})),
  ...tasks.map(x=>({row:x,type:"task",time:x.due_at,offsets:[1440,60],titleSuffix:" deadline approaching",message:x.description||"Your task deadline is approaching."})),
  ...assignments.map(x=>({row:x,type:"assignment",time:x.due_at,offsets:[1440,60],titleSuffix:" due soon",message:x.description||"Your assignment deadline is approaching."})),
  ...exams.map(x=>({row:x,type:"exam",time:x.starts_at,offsets:[1440,60,15],titleSuffix:" is coming up",message:x.location?"Venue: "+x.location:"Your examination or assessment is approaching."}))
 ];
 if(!events.length)return;
 const userIds=[...new Set(events.map(x=>x.row.user_id).filter(Boolean))];
 const [preferences,subscriptions]=await Promise.all([
  getRows("user_preferences",{user_id:"in.("+userIds.join(",")+")"}),
  getRows("push_subscriptions",{user_id:"in.("+userIds.join(",")+")"})
 ]);
 const prefByUser=new Map(preferences.map(x=>[x.user_id,x]));
 const pushUsers=new Set(subscriptions.map(x=>x.user_id));
 const inserts:any[]=[];
 for(const event of events){
  const row=event.row,pref=prefByUser.get(row.user_id)||{};
  if(!row.user_id||!row.id||!event.time)continue;
  const occurrence=new Date(event.time);if(!Number.isFinite(occurrence.getTime()))continue;
  for(const rawOffset of event.offsets){
   const mins=Math.max(0,Number(rawOffset));if(!Number.isFinite(mins))continue;
   const dueAt=new Date(occurrence.getTime()-mins*60000);if(dueAt<=now||dueAt>horizon)continue;
   const channels=["in_app",...(pref.email_notifications_enabled===false?[]:["email"]),...(pref.push_enabled===false||!pushUsers.has(row.user_id)?[]:["push"])] as const;
   for(const channel of channels){
    inserts.push({user_id:row.user_id,target_type:event.type,target_id:row.id,occurrence_starts_at:occurrence.toISOString(),reminder_offset_minutes:mins,title:String(row.title||"Upcoming activity")+event.titleSuffix,message:event.message,channel,due_at:dueAt.toISOString(),status:"pending"});
   }
  }
 }
 for(let i=0;i<inserts.length;i+=500){
  const url=new URL(base+"/rest/v1/reminders");url.searchParams.set("on_conflict","user_id,target_id,occurrence_starts_at,reminder_offset_minutes,channel");
  const response=await fetch(url,{method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(inserts.slice(i,i+500))});
  if(!response.ok)throw new Error("Could not queue upcoming activity reminders: HTTP "+response.status+" "+(await response.text()).slice(0,400));
 }
}

async function processReminders(env:Env){
 const base=env.SUPABASE_URL.replace(/\/$/,"");const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const q=new URL(base+"/rest/v1/reminders");q.searchParams.set("select","id,user_id,title,message,attempts,channel");q.searchParams.set("status","eq.pending");q.searchParams.set("channel","in.(email,push,in_app)");q.searchParams.set("due_at","lte."+new Date().toISOString());q.searchParams.set("limit","50");
 const response=await fetch(q,{headers});if(!response.ok)throw new Error("Supabase reminder query failed: "+response.status+" "+await response.text());const reminders=await response.json() as DueReminder[];
 for(const reminder of reminders){
  const claimUrl=new URL(base+"/rest/v1/reminders");claimUrl.searchParams.set("id","eq."+reminder.id);claimUrl.searchParams.set("status","eq.pending");
  const claim=await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=representation"},body:JSON.stringify({status:"processing",attempts:reminder.attempts+1})});if(!claim.ok)continue;const claimed=await claim.json() as unknown[];if(!claimed.length)continue;
  let status:"sent"|"failed"="failed";let providerId:string|null=null;let errorMessage:string|null=null;
  try{
   if(reminder.channel==="in_app"){
    providerId="in-app:"+reminder.id;
   }else if(reminder.channel==="email"){
    const prefUrl=new URL(base+"/rest/v1/user_preferences");prefUrl.searchParams.set("select","email_notifications_enabled");prefUrl.searchParams.set("user_id","eq."+reminder.user_id);const prefResponse=await fetch(prefUrl,{headers});const prefRows=await prefResponse.json() as {email_notifications_enabled:boolean}[];if(prefRows[0]?.email_notifications_enabled===false)throw new Error("Email reminders are disabled in account preferences.");const ur=await fetch(base+"/auth/v1/admin/users/"+reminder.user_id,{headers});if(!ur.ok)throw new Error("Could not retrieve account email.");const user=await ur.json() as {email?:string};if(!user.email)throw new Error("No email address is registered for this account.");
    const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
    const body=esc(reminder.message||"Your scheduled reminder is due.").replace(/\n/g,"<br/>");
    const html="<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#17243a\"><p style=\"color:#3567d6;font-weight:bold;letter-spacing:2px\">VALUE TIME</p><h1>"+esc(reminder.title)+"</h1><p style=\"line-height:1.7;color:#52627a\">"+body+"</p><p style=\"margin-top:32px;color:#8793a5;font-size:12px\">A reminder from your Value Time workspace.</p></div>";
    providerId=await sendEmail(env,user.email,"Value Time reminder: "+reminder.title,html);
   }else if(reminder.channel==="push"){
    const prefUrl=new URL(base+"/rest/v1/user_preferences");prefUrl.searchParams.set("select","push_enabled");prefUrl.searchParams.set("user_id","eq."+reminder.user_id);const prefResponse=await fetch(prefUrl,{headers});const prefRows=await prefResponse.json() as {push_enabled:boolean}[];if(prefRows[0]?.push_enabled===false)throw new Error("Background push notifications are disabled in account preferences.");providerId=await deliverPush(env,base,headers,reminder.user_id,reminder);
   }else{
    if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram delivery is not configured.");const cq=new URL(base+"/rest/v1/telegram_connections");cq.searchParams.set("select","telegram_chat_id,notifications_enabled");cq.searchParams.set("user_id","eq."+reminder.user_id);const cr=await fetch(cq,{headers});if(!cr.ok)throw new Error("Telegram connection lookup failed.");const conns=await cr.json() as TelegramConnection[];const c=conns[0];if(!c?.telegram_chat_id||!c.notifications_enabled)throw new Error("No connected Telegram chat or notifications disabled.");
    const tr=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c.telegram_chat_id,text:"🔔 "+reminder.title+"\n\n"+(reminder.message||"Your scheduled reminder is due."),disable_web_page_preview:true})});const td=await tr.json() as {ok?:boolean;description?:string;result?:{message_id?:number}};if(!tr.ok||!td.ok)throw new Error(td.description||"Telegram returned HTTP "+tr.status);providerId=String(td.result?.message_id??"");
   }status="sent";
  }catch(e){errorMessage=e instanceof Error?e.message:"Notification delivery failed.";}
  await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({status:status==="failed"&&reminder.attempts+1<3?"pending":status,due_at:status==="failed"&&reminder.attempts+1<3?new Date(Date.now()+5*60000).toISOString():undefined,sent_at:status==="sent"?new Date().toISOString():null,last_error:errorMessage})});
  await fetch(base+"/rest/v1/notification_logs",{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({user_id:reminder.user_id,reminder_id:reminder.id,channel:reminder.channel,status,provider_message_id:providerId,error_message:errorMessage})});
 }
}

async function processDailySummaries(env:Env){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return;
 const base=env.SUPABASE_URL.replace(/\/$/,"");
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const prefUrl=new URL(base+"/rest/v1/user_preferences");
 prefUrl.searchParams.set("select","user_id,timezone,daily_summary_time,daily_summary_enabled,summary_email_enabled,email_notifications_enabled,summary_include_timetable,summary_include_tasks,summary_include_assignments,summary_include_exams");
 prefUrl.searchParams.set("daily_summary_enabled","eq.true");prefUrl.searchParams.set("summary_email_enabled","eq.true");prefUrl.searchParams.set("email_notifications_enabled","eq.true");
 const pr=await fetch(prefUrl,{headers});if(!pr.ok)throw new Error("Daily summary preferences query failed.");const prefs=await pr.json() as any[];
 const now=new Date();
 const esc=(s:string)=>s.replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]!));
 for(const p of prefs){
  const tz=p.timezone||"Africa/Lagos";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const day=parts.find(x=>x.type==="year")!.value+"-"+parts.find(x=>x.type==="month")!.value+"-"+parts.find(x=>x.type==="day")!.value;
  const hm=new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
  if(hm!==String(p.daily_summary_time).slice(0,5))continue;
  const logUrl=new URL(base+"/rest/v1/notification_logs");logUrl.searchParams.set("select","id");logUrl.searchParams.set("user_id","eq."+p.user_id);logUrl.searchParams.set("channel","eq.email_summary");logUrl.searchParams.set("status","eq.sent");logUrl.searchParams.set("provider_message_id","eq.daily-summary-"+day);logUrl.searchParams.set("limit","1");
  const lr=await fetch(logUrl,{headers});if(!lr.ok)continue;const existing=await lr.json() as unknown[];if(existing.length)continue;
  const userResponse=await fetch(base+"/auth/v1/admin/users/"+p.user_id,{headers});if(!userResponse.ok)continue;const user=await userResponse.json() as {email?:string};if(!user.email)continue;
  const profileUrl=new URL(base+"/rest/v1/profiles");profileUrl.searchParams.set("select","display_name");profileUrl.searchParams.set("id","eq."+p.user_id);const profileResponse=await fetch(profileUrl,{headers});const profileRows=profileResponse.ok?await profileResponse.json() as {display_name:string|null}[]:[];const name=profileRows[0]?.display_name||"there";
  const from=new Date(now.getTime()-12*60*60*1000).toISOString(),to=new Date(now.getTime()+36*60*60*1000).toISOString();
  const [schedule,tasks,assignments,exams]=await Promise.all([
   p.summary_include_timetable?fetchRows(base,"schedule_entries",{...headers},p.user_id,from,to):Promise.resolve([]),
   p.summary_include_tasks?fetchRows(base,"tasks",{...headers},p.user_id,from,to):Promise.resolve([]),
   p.summary_include_assignments?fetchRows(base,"assignments",{...headers},p.user_id,from,to):Promise.resolve([]),
   fetchRows(base,"examinations",{...headers},p.user_id,from,to)
  ]);
  const today=(value:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value))===day;const localWeekday=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"short"}).format(new Date(value));const weekdayNumber=(short:string)=>({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6} as Record<string,number>)[short]??-1;
  const sections:string[]=[];
  const list=(title:string,items:any[],render:(x:any)=>string)=>{const rows=items.map(render);sections.push("<h2 style='font-size:16px;margin:26px 0 10px'>"+title+"</h2>"+(rows.length?rows.join(""):"<p style='color:#8793a5'>Nothing scheduled.</p>"));};
  if(p.summary_include_timetable)list("Today's timetable",schedule.filter((x:any)=>x.is_active&&((x.recurrence_type==="weekly"&&(x.recurrence_days?.length?x.recurrence_days:[weekdayNumber(localWeekday(x.starts_at))]).includes(weekdayNumber(localWeekday(x.starts_at)))&&(!x.recurrence_until||x.recurrence_until>=day))||today(x.starts_at))),x=>"<p style='padding:10px 0;border-bottom:1px solid #edf0f4'><b>"+esc(x.title)+"</b><br><span style='color:#64748b'>"+new Intl.DateTimeFormat("en-NG",{timeZone:tz,hour:"2-digit",minute:"2-digit"}).format(new Date(x.starts_at))+" · "+esc(x.location||"Location not set")+"</span></p>");
  if(p.summary_include_tasks)list("Tasks to keep moving",tasks.filter((x:any)=>x.status!=="completed"&&(!x.due_at||today(x.due_at))),x=>"<p style='padding:8px 0;border-bottom:1px solid #edf0f4'>"+esc(x.title)+"</p>");
  if(p.summary_include_assignments)list("Assignments due",assignments.filter((x:any)=>x.status!=="completed"&&x.due_at&&today(x.due_at)),x=>"<p style='padding:8px 0;border-bottom:1px solid #edf0f4'><b>"+esc(x.title)+"</b> · "+esc(x.priority)+"</p>");
  if(p.summary_include_exams)list("Examinations & assessments",exams.filter((x:any)=>x.status==="scheduled"&&x.starts_at&&today(x.starts_at)),x=>"<p style='padding:8px 0;border-bottom:1px solid #edf0f4'><b>"+esc(x.title)+"</b> · "+new Intl.DateTimeFormat("en-NG",{timeZone:tz,hour:"2-digit",minute:"2-digit"}).format(new Date(x.starts_at))+"</p>");
  let status:"sent"|"failed"="failed",providerId:string|null=null,errorMessage:string|null=null;
  try{providerId=await sendEmail(env,user.email,"Your Value Time daily plan · "+day,"<div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:30px;color:#17243a'><p style='color:#3567d6;font-weight:bold;letter-spacing:2px'>VALUE TIME · DAILY BRIEFING</p><h1 style='font-size:25px'>Good morning, "+esc(name)+".</h1><p style='color:#64748b'>Here is your plan for "+day+".</p>"+sections.join("")+"<p style='margin-top:32px;color:#8793a5;font-size:12px'>Make every moment count.</p></div>");status="sent";}catch(e){errorMessage=e instanceof Error?e.message:"Daily summary delivery failed.";}
  await fetch(base+"/rest/v1/notification_logs",{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({user_id:p.user_id,channel:"email_summary",status,provider_message_id:status==="sent"?"daily-summary-"+day:providerId,error_message:errorMessage})});
 }
}
async function fetchRows(base:string,table:string,headers:Record<string,string>,userId:string,from:string,to:string){
 const url=new URL(base+"/rest/v1/"+table);url.searchParams.set("select","*");url.searchParams.set("user_id","eq."+userId);url.searchParams.set("limit","100");
 if(table==="schedule_entries"){url.searchParams.set("is_active","eq.true");}
 else if(table==="assignments"){url.searchParams.set("due_at","gte."+from);url.searchParams.set("and","(due_at.lte."+to+")");}else if(table==="examinations"){url.searchParams.set("starts_at","gte."+from);url.searchParams.set("and","(starts_at.lte."+to+")");}else{url.searchParams.set("status","neq.completed");}
 const r=await fetch(url,{headers});return r.ok?await r.json() as any[]:[];
}
function errorDetails(error:unknown){return {message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined};}
function checkRequiredConfig(env:Env){
 const required=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"] as const;
 const missing=required.filter(key=>!env[key]||!String(env[key]).trim());
 return {missing,optional:{RESEND_API_KEY:!!env.RESEND_API_KEY,EMAIL_FROM:!!env.EMAIL_FROM,VAPID_PUBLIC_KEY:!!env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_JWK:!!env.VAPID_PRIVATE_JWK,VAPID_SUBJECT:!!env.VAPID_SUBJECT}};
}
async function runScheduledJob(name:string,job:()=>Promise<unknown>){
 const started=Date.now();
 try{await job();console.log(JSON.stringify({event:"scheduled_job_ok",job,duration_ms:Date.now()-started}));}
 catch(error){console.error(JSON.stringify({event:"scheduled_job_failed",job,duration_ms:Date.now()-started,...errorDetails(error)}));}
}
export default {async scheduled(_event:WorkerScheduledController,env:Env,ctx:WorkerExecutionContext){
 const config=checkRequiredConfig(env);
 console.log(JSON.stringify({event:"worker_config_check",required_missing:config.missing,optional_present:config.optional}));
 if(config.missing.length){console.error("Worker configuration invalid: required settings are missing",config.missing);return;}
 ctx.waitUntil(Promise.all([
  runScheduledJob("recurring_schedule_reminders",()=>processRecurringScheduleReminders(env)),
  runScheduledJob("upcoming_item_reminders",()=>processUpcomingItemReminders(env)),
  runScheduledJob("recurring_tasks",()=>processRecurringTasks(env)),
  runScheduledJob("pending_reminders",()=>processReminders(env)),
  runScheduledJob("daily_summaries",()=>processDailySummaries(env))
 ]));
},async fetch(request:Request,env:Env){const config=checkRequiredConfig(env);return Response.json({service:"value-time-reminder-worker",status:config.missing.length?"configuration_incomplete":"running",required_missing:config.missing,optional_present:config.optional},{headers:{"Cache-Control":"no-store"}});}};