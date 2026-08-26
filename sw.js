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

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const appUrl=new URL("./",self.registration.scope).href;
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
