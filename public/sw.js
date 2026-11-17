const CACHE="value-time-shell-v1";
self.addEventListener("install",event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
self.addEventListener("push",event=>{let data={title:"Value Time",body:"You have an upcoming activity.",url:"/"};try{data={...data,...event.data.json()};}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:"/icon.svg",badge:"/icon.svg",data:{url:data.url||"/"},tag:data.tag||"value-time"}));});
self.addEventListener("notificationclick",event=>{event.notification.close();const target=event.notification.data?.url||"/";event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{for(const client of list){if("focus"in client){client.navigate(target);return client.focus();}}return self.clients.openWindow(target);}));});
