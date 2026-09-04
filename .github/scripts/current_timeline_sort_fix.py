from pathlib import Path

path = Path("index.html")
text = path.read_text()

old = '''  function currentSortInfo(item,now=Date.now()){
  const day=24*60*60*1000;
  if(isEpisodeTrackable(item)){
    const released=releasedEpisodeCounts(item),hasReleasedEpisodes=Object.keys(released).length>0;
    const nextEpisodeTime=toMillis(item.nextEpisodeDate),latestEpisodeTime=toMillis(item.latestEpisodeDate);
    const scheduledEpisode=hasReleasedEpisodes&&Number(item.nextEpisodeNum||0)>0&&nextEpisodeTime>now&&nextEpisodeTime<=now+90*day;
    const justAired=hasReleasedEpisodes&&latestEpisodeTime>0&&latestEpisodeTime<=now&&now-latestEpisodeTime<=14*day;
    if(scheduledEpisode||justAired)return{current:true,time:justAired?latestEpisodeTime:nextEpisodeTime,kind:2};
  }else if(item?.type==="Film"){
    const release=releaseSortInfo(item,now),releasedDays=release.bucket===2?(now-release.time)/day:Number.POSITIVE_INFINITY;
    if(releasedDays>=0&&releasedDays<=120)return{current:true,time:release.time,kind:1};
  }
  const release=releaseSortInfo(item,now);
  return{current:false,time:release.time,kind:0};
}
function compareCurrentOrder(a,b,now=Date.now()){
  const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
  if(ai.current!==bi.current)return ai.current?-1:1;
  if(ai.current&&bi.current){
    if(ai.kind!==bi.kind)return bi.kind-ai.kind;
    if(ai.time!==bi.time)return bi.time-ai.time;
  }
  return compareReleaseRecency(a,b,now);
}'''

new = '''  function currentSortInfo(item,now=Date.now()){
    const day=24*60*60*1000;
    const eventTime=value=>{
      const raw=String(value||"").trim();
      if(!raw)return 0;
      const dateOnly=/^\\d{4}-\\d{2}-\\d{2}$/.test(raw);
      const time=new Date(dateOnly?`${raw}T12:00:00`:raw).getTime();
      return Number.isFinite(time)?time:0;
    };

    if(isEpisodeTrackable(item)){
      const latestEpisodeTime=eventTime(item.latestEpisodeDate);
      const nextEpisodeTime=eventTime(item.nextEpisodeDate);
      const nextSeasonTime=eventTime(item.nextSeasonDate);

      // Current is an airing timeline, never a status/added-date sort.
      // Episodes that have just aired are first, newest release first.
      if(latestEpisodeTime>0&&latestEpisodeTime<=now&&now-latestEpisodeTime<=14*day){
        return{current:true,phase:3,time:latestEpisodeTime,kind:"aired"};
      }

      // After recent releases, show the next dated episode/season in true
      // chronological order: the soonest upcoming air time first.
      const future=[nextEpisodeTime,nextSeasonTime].filter(time=>time>now).sort((a,b)=>a-b);
      if(future.length)return{current:true,phase:2,time:future[0],kind:"upcoming"};

      // Older dated shows remain below the active airing timeline. TBA-only
      // entries have no time and therefore naturally fall to the bottom.
      if(latestEpisodeTime>0&&latestEpisodeTime<=now)return{current:false,phase:1,time:latestEpisodeTime,kind:"older"};
      return{current:false,phase:0,time:0,kind:"tba"};
    }

    if(item?.type==="Film"){
      const releaseTime=eventTime(item.filmReleaseDate);
      if(releaseTime>0&&releaseTime<=now&&now-releaseTime<=120*day)return{current:true,phase:3,time:releaseTime,kind:"aired"};
      if(releaseTime>now)return{current:true,phase:2,time:releaseTime,kind:"upcoming"};
      if(releaseTime>0)return{current:false,phase:1,time:releaseTime,kind:"older"};
    }

    return{current:false,phase:0,time:0,kind:"tba"};
  }
  function compareCurrentOrder(a,b,now=Date.now()){
    const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
    if(ai.phase!==bi.phase)return bi.phase-ai.phase;
    if(ai.phase===3&&ai.time!==bi.time)return bi.time-ai.time;
    if(ai.phase===2&&ai.time!==bi.time)return ai.time-bi.time;
    if(ai.phase===1&&ai.time!==bi.time)return bi.time-ai.time;
    return titleCollator.compare(a.title||"",b.title||"");
  }'''

if old not in text:
    raise RuntimeError("Current sort source changed; refusing unsafe patch")
text = text.replace(old, new, 1)

assert "if(ai.phase===3&&ai.time!==bi.time)return bi.time-ai.time;" in text
assert "if(ai.phase===2&&ai.time!==bi.time)return ai.time-bi.time;" in text
assert "addedSortTime" not in new
assert "status" not in new
path.write_text(text)
