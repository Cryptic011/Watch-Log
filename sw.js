"use strict";

/*
 * Watched Logger notification worker.
 * This worker intentionally has no fetch handler and no cache, so the Home
 * Screen app continues to load the latest GitHub Pages version.
 */
self.addEventListener("install",()=>self.skipWaiting());

self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push",event=>{
  let payload={
    title:"Watched Logger",
    body:"A Watched Logger reminder is ready.",
    tag:"watchlog-reminder",
    data:{url:"./"}
  };
  try{
    if(event.data)payload={...payload,...event.data.json()};
  }catch(_){
    if(event.data)payload.body=event.data.text()||payload.body;
  }

  // Keep episode-release alerts short and consistent on the lock screen.
  // Accept both the legacy backend wording and the current wording so an
  // already queued notification still displays the requested copy.
  const body=String(payload.body||"");
  const episodeReleased=/episode\s+\d+\s+(?:is\s+available\s+now|is\s+out\s+now)\.?/i.test(body);
  if(episodeReleased){
    payload.title="Watched log reminder";
    payload.body="Show episode is out now";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title||"Watched Logger",{
      body:payload.body||"",
      tag:payload.tag||"watchlog-reminder",
      renotify:true,
      data:payload.data||{url:"./"}
    })
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const appUrl=new URL(event.notification.data?.url||"./",self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{
      const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
      if(existing){
        if("navigate" in existing)existing.navigate(appUrl);
        return existing.focus();
      }
      return self.clients.openWindow?self.clients.openWindow(appUrl):undefined;
    })
  );
});
