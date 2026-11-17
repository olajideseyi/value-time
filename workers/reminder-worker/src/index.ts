export interface Env { SUPABASE_URL:string; SUPABASE_SERVICE_ROLE_KEY:string; TELEGRAM_BOT_TOKEN?:string; RESEND_API_KEY?:string; EMAIL_FROM?:string; }
interface WorkerScheduledController { cron:string; scheduledTime:number; }
interface WorkerExecutionContext { waitUntil(promise:Promise<unknown>):void; passThroughOnException():void; }
type DueReminder={id:string;user_id:string;title:string;message:string|null;attempts:number;channel:"telegram"|"email"};
type TelegramConnection={telegram_chat_id:string|null;notifications_enabled:boolean};
async function sendEmail(env:Env,to:string,subject:string,html:string){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw new Error("Email delivery is not configured. Add RESEND_API_KEY and EMAIL_FROM to the reminder Worker secrets.");
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
 const data=await r.json() as {id?:string;message?:string};if(!r.ok)throw new Error(data.message||"Resend email failed with HTTP "+r.status);return data.id||null;
}
async function processReminders(env:Env){
 const base=env.SUPABASE_URL.replace(/\/$/,"");const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
 const q=new URL(base+"/rest/v1/reminders");q.searchParams.set("select","id,user_id,title,message,attempts,channel");q.searchParams.set("status","eq.pending");q.searchParams.set("channel","in.(telegram,email)");q.searchParams.set("due_at","lte."+new Date().toISOString());q.searchParams.set("limit","50");
 const response=await fetch(q,{headers});if(!response.ok)throw new Error("Supabase reminder query failed: "+response.status+" "+await response.text());const reminders=await response.json() as DueReminder[];
 for(const reminder of reminders){
  const claimUrl=new URL(base+"/rest/v1/reminders");claimUrl.searchParams.set("id","eq."+reminder.id);claimUrl.searchParams.set("status","eq.pending");
  const claim=await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=representation"},body:JSON.stringify({status:"processing",attempts:reminder.attempts+1})});if(!claim.ok)continue;const claimed=await claim.json() as unknown[];if(!claimed.length)continue;
  let status:"sent"|"failed"="failed";let providerId:string|null=null;let errorMessage:string|null=null;
  try{
   if(reminder.channel==="email"){
    const prefUrl=new URL(base+"/rest/v1/user_preferences");prefUrl.searchParams.set("select","email_notifications_enabled");prefUrl.searchParams.set("user_id","eq."+reminder.user_id);const prefResponse=await fetch(prefUrl,{headers});const prefRows=await prefResponse.json() as {email_notifications_enabled:boolean}[];if(prefRows[0]?.email_notifications_enabled===false)throw new Error("Email reminders are disabled in account preferences.");const ur=await fetch(base+"/auth/v1/admin/users/"+reminder.user_id,{headers});if(!ur.ok)throw new Error("Could not retrieve account email.");const user=await ur.json() as {email?:string};if(!user.email)throw new Error("No email address is registered for this account.");
    const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
    const body=esc(reminder.message||"Your scheduled reminder is due.").replace(/\n/g,"<br/>");
    const html="<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#17243a\"><p style=\"color:#3567d6;font-weight:bold;letter-spacing:2px\">VALUE TIME</p><h1>"+esc(reminder.title)+"</h1><p style=\"line-height:1.7;color:#52627a\">"+body+"</p><p style=\"margin-top:32px;color:#8793a5;font-size:12px\">A reminder from your Value Time workspace.</p></div>";
    providerId=await sendEmail(env,user.email,"Value Time reminder: "+reminder.title,html);
   }else{
    if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram delivery is not configured.");const cq=new URL(base+"/rest/v1/telegram_connections");cq.searchParams.set("select","telegram_chat_id,notifications_enabled");cq.searchParams.set("user_id","eq."+reminder.user_id);const cr=await fetch(cq,{headers});if(!cr.ok)throw new Error("Telegram connection lookup failed.");const conns=await cr.json() as TelegramConnection[];const c=conns[0];if(!c?.telegram_chat_id||!c.notifications_enabled)throw new Error("No connected Telegram chat or notifications disabled.");
    const tr=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c.telegram_chat_id,text:"🔔 "+reminder.title+"\n\n"+(reminder.message||"Your scheduled reminder is due."),disable_web_page_preview:true})});const td=await tr.json() as {ok?:boolean;description?:string;result?:{message_id?:number}};if(!tr.ok||!td.ok)throw new Error(td.description||"Telegram returned HTTP "+tr.status);providerId=String(td.result?.message_id??"");
   }status="sent";
  }catch(e){errorMessage=e instanceof Error?e.message:"Notification delivery failed.";}
  await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({status,sent_at:status==="sent"?new Date().toISOString():null,last_error:errorMessage})});
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
export default {async scheduled(_event:WorkerScheduledController,env:Env,ctx:WorkerExecutionContext){ctx.waitUntil(Promise.all([processReminders(env),processDailySummaries(env)]));},async fetch(){return new Response("Value Time reminder worker is running.",{headers:{"Content-Type":"text/plain"}});}};