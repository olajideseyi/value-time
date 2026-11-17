export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
}
type DueReminder = {
  id:string; user_id:string; title:string; message:string|null;
  telegram_connections:{telegram_chat_id:string;notifications_enabled:boolean}[];
};
async function processReminders(env:Env) {
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const query=new URL(base+"/rest/v1/reminders");
  query.searchParams.set("select","id,user_id,title,message,telegram_connections!inner(telegram_chat_id,notifications_enabled)");
  query.searchParams.set("status","eq.pending");
  query.searchParams.set("channel","eq.telegram");
  query.searchParams.set("due_at","lte."+new Date().toISOString());
  query.searchParams.set("limit","50");
  const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"};
  const response=await fetch(query,{headers});
  if(!response.ok) throw new Error("Supabase reminder query failed: "+response.status+" "+await response.text());
  const reminders=await response.json() as DueReminder[];
  for(const reminder of reminders) {
    const claimUrl=new URL(base+"/rest/v1/reminders");
    claimUrl.searchParams.set("id","eq."+reminder.id);
    claimUrl.searchParams.set("status","eq.pending");
    const claim=await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=representation"},body:JSON.stringify({status:"processing",attempts:1})});
    if(!claim.ok) continue;
    const claimed=await claim.json() as unknown[];
    if(claimed.length===0) continue;
    const connection=reminder.telegram_connections?.[0];
    let status:"sent"|"failed"="failed";
    let providerId:string|null=null;
    let errorMessage:string|null=null;
    if(connection?.telegram_chat_id && connection.notifications_enabled) {
      const telegram=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({chat_id:connection.telegram_chat_id,text:"🔔 "+reminder.title+"\n\n"+(reminder.message||"Your scheduled reminder is due."),disable_web_page_preview:true})
      });
      const result=await telegram.json() as {ok?:boolean;description?:string;result?:{message_id?:number}};
      if(telegram.ok && result.ok) {status="sent";providerId=String(result.result?.message_id??"");}
      else errorMessage=result.description||"Telegram returned HTTP "+telegram.status;
    } else errorMessage="No connected Telegram chat or notifications disabled.";
    await fetch(claimUrl,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({status:status,sent_at:status==="sent"?new Date().toISOString():null,last_error:errorMessage})});
    await fetch(base+"/rest/v1/notification_logs",{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({user_id:reminder.user_id,reminder_id:reminder.id,channel:"telegram",status:status,provider_message_id:providerId,error_message:errorMessage})});
  }
}
export default {
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) {ctx.waitUntil(processReminders(env));},
  async fetch() {return new Response("Value Time reminder worker is running.",{headers:{"Content-Type":"text/plain"}});}
};
