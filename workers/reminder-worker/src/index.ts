export interface Env { SUPABASE_URL:string; SUPABASE_SERVICE_ROLE_KEY:string; TELEGRAM_BOT_TOKEN?:string; RESEND_API_KEY?:string; EMAIL_FROM?:string; }
type DueReminder={id:string;user_id:string;title:string;message:string|null;attempts:number;channel:"telegram"|"email"};
type TelegramConnection={telegram_chat_id:string|null;notifications_enabled:boolean};
async function sendEmail(env:Env,to:string,subject:string,html:string){
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw new Error("Email delivery is not configured. Add RESEND_API_KEY and EMAIL_FROM to the reminder Worker secrets.");
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
 const data=await r.json() as {id?:string;message?:string};if(!r.ok)throw new Error(data.message||"Resend email failed with HTTP "+r.status);return data.id||null;
}
async function processReminders(env:Env){
 const base=env.SUPABASE_URL.replace(/\\/$/,"");const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
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
    const body=esc(reminder.message||"Your scheduled reminder is due.").replace(/\\n/g,"<br/>");
    const html="<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#17243a\"><p style=\"color:#3567d6;font-weight:bold;letter-spacing:2px\">VALUE TIME</p><h1>"+esc(reminder.title)+"</h1><p style=\"line-height:1.7;color:#52627a\">"+body+"</p><p style=\"margin-top:32px;color:#8793a5;font-size:12px\">A reminder from your Value Time workspace.</p></div>";
    providerId=await sendEmail(env,user.email,"Value Time reminder: "+reminder.title,html);
   }else{
    if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram delivery is not configured.");const cq=new URL(base+"/rest/v1/telegram_connections");cq.searchParams.set("select","telegram_chat_id,notifications_enabled");cq.searchParams.set("user_id","eq."+reminder.user_id);const cr=await fetch(cq,{headers});if(!cr.ok)throw new Error("Telegram connection lookup failed.");const conns=await cr.json() as TelegramConnection[];const c=conns[0];if(!c?.telegram_chat_id||!c.notifications_enabled)throw new Error("No connected Telegram chat or notifications disabled.");
    const tr=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c.telegram_chat_id,text:"🔔 "+reminder.title+"\\n\\n"+(reminder.message||"Your scheduled reminder is due."),disable_web_page_preview:true})});const td=await tr.json() as {ok?:boolean;description?:string;result?:{message_id?:number}};if(!tr.ok||!td.ok)throw new Error(td.description||"Telegram returned HTTP "+tr.status);providerId=String(td.result?.message_id??"");
   }status="sent";
  }catch(e){errorMessage=e instanceof Error?e.message:"Notification delivery failed.";}
  await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({status,sent_at:status==="sent"?new Date().toISOString():null,last_error:errorMessage})});
  await fetch(base+"/rest/v1/notification_logs",{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({user_id:reminder.user_id,reminder_id:reminder.id,channel:reminder.channel,status,provider_message_id:providerId,error_message:errorMessage})});
 }
}
export default {async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(processReminders(env));},async fetch(){return new Response("Value Time reminder worker is running.",{headers:{"Content-Type":"text/plain"}});}};