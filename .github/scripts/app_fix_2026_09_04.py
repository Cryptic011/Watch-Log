from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"{label} source changed; refusing unsafe patch")
    return text.replace(old, new, 1)


index_path = Path("index.html")
text = index_path.read_text()

text = replace_once(
    text,
    '''function compareCurrentOrder(a,b,now=Date.now()){
  const au=upcomingSortInfo(a,now),bu=upcomingSortInfo(b,now);
  if(au.rank!==bu.rank)return bu.rank-au.rank;
  if(au.rank===2&&au.time!==bu.time)return au.time-bu.time;
  const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
  if(ai.current!==bi.current)return ai.current?-1:1;
  if(ai.current&&bi.current&&ai.kind!==bi.kind)return bi.kind-ai.kind;
  return compareReleaseRecency(a,b,now);
}''',
    '''function compareCurrentOrder(a,b,now=Date.now()){
  const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
  if(ai.current!==bi.current)return ai.current?-1:1;
  if(ai.current&&bi.current){
    if(ai.kind!==bi.kind)return bi.kind-ai.kind;
    if(ai.time!==bi.time)return bi.time-ai.time;
  }
  return compareReleaseRecency(a,b,now);
}
function compareRecentOrder(a,b,now=Date.now()){
  const ai=currentSortInfo(a,now),bi=currentSortInfo(b,now);
  if(ai.current!==bi.current)return ai.current?-1:1;
  if(ai.current&&bi.current){
    const added=addedSortTime(b)-addedSortTime(a);
    if(added)return added;
  }
  return compareReleaseRecency(a,b,now)||addedSortTime(b)-addedSortTime(a)||titleCollator.compare(a.title||"",b.title||"");
}''',
    "current sort",
)

text = replace_once(
    text,
    '''  function releasedEpisodeCounts(item){
    if(!isEpisodeTrackable(item))return{};
    const verified=positiveEpisodeMap(item.airedEpisodeCounts);
    if(item?.episodeScheduleVerified===true)return verified;
    if(Object.keys(verified).length)return verified;
    const counts=positiveEpisodeMap(item.episodeCounts);
    const nextSeason=Number(item.nextSeasonNum||0),current=Math.max(Number(item.curSeason||0),Number(item.airingSeason||0),Number(item.watchedSeasons||0));
    if(nextSeason>0&&nextSeason>current){
      for(const season of Object.keys(counts))if(Number(season)>=nextSeason)delete counts[season];
    }
    const activeSeason=Number(item.airingSeason||item.curSeason||0),nextEpisode=Number(item.nextEpisodeNum||0);
    if(activeSeason>0&&nextEpisode>0&&counts[activeSeason])counts[activeSeason]=Math.min(counts[activeSeason],Math.max(0,nextEpisode-1));
    const latest=Number(item.latestEpisodeNum||0);
    if(activeSeason>0&&latest>0&&counts[activeSeason])counts[activeSeason]=Math.min(counts[activeSeason],latest);
    const currentReleased=Number(item.currentSeasonEpisodeCount||0),currentSeason=Number(item.curSeason||0);
    if(currentSeason>0&&currentReleased>0&&counts[currentSeason])counts[currentSeason]=Math.min(counts[currentSeason],currentReleased);
    for(const season of Object.keys(counts))if(counts[season]<=0)delete counts[season];
    return counts;
  }''',
    '''  function releasedEpisodeCounts(item){
    if(!isEpisodeTrackable(item))return{};
    const verified=positiveEpisodeMap(item.airedEpisodeCounts);
    if(item?.episodeScheduleVerified===true)return verified;
    if(Object.keys(verified).length)return verified;

    // Never treat announced/total episode counts as released episodes. For an
    // unverified schedule, expose only seasons/episodes supported by concrete
    // release evidence already stored on the title.
    const totals=positiveEpisodeMap(item.episodeCounts),counts={};
    const completed=Math.max(0,Number(item.verifiedCompletedSeasons||0));
    for(const [seasonValue,totalValue] of Object.entries(totals)){
      const season=Number(seasonValue);
      if(season<=completed)counts[season]=Number(totalValue);
    }

    const now=Date.now(),activeSeason=Number(item.airingSeason||item.curSeason||0);
    const latest=Number(item.latestEpisodeNum||0),latestTime=toMillis(item.latestEpisodeDate);
    const nextEpisode=Number(item.nextEpisodeNum||0),nextTime=toMillis(item.nextEpisodeDate);
    let activeReleased=0;
    if(activeSeason>0&&latest>0&&latestTime>0&&latestTime<=now)activeReleased=latest;
    if(activeSeason>0&&nextEpisode>1&&nextTime>now)activeReleased=Math.max(activeReleased,nextEpisode-1);
    if(activeSeason>0&&activeReleased>0)counts[activeSeason]=totals[activeSeason]?Math.min(Number(totals[activeSeason]),activeReleased):activeReleased;

    for(const season of Object.keys(counts))if(!Number.isFinite(counts[season])||counts[season]<=0)delete counts[season];
    return counts;
  }''',
    "released episode counts",
)

text = replace_once(
    text,
    '''      const episodes=[...new Set(source.map(Number).filter(episode=>Number.isInteger(episode)&&episode>0&&(!maximum||episode<=maximum)))].sort((a,b)=>a-b);''',
    '''      const episodes=[...new Set(source.map(Number).filter(episode=>Number.isInteger(episode)&&episode>0&&maximum>0&&episode<=maximum))].sort((a,b)=>a-b);''',
    "watched episode normalization",
)

text = replace_once(
    text,
    '''    else if(activeSort==="recent")list.sort((a,b)=>addedSortTime(b)-addedSortTime(a)||titleCollator.compare(a.title||"",b.title||""));''',
    '''    else if(activeSort==="recent")list.sort((a,b)=>compareRecentOrder(a,b,now));''',
    "recent sort",
)

index_path.write_text(text)

reminder_path = Path("supabase/functions/watchlog-reminders/index.ts")
reminder = reminder_path.read_text()
reminder = replace_once(
    reminder,
    '''  const title = `Watched Logger reminder for ${name}`;
  let body = `Your Planned show is due ${timing}.`;
  if (event.kind === "episode" && event.number) {
    body = leadHours === 0
      ? `Episode ${event.number} is available now.`
      : `Episode ${event.number} airs ${timing}.`;''',
    '''  const title = "Watched log reminder";
  let body = `${name} is due ${timing}.`;
  if (event.kind === "episode" && event.number) {
    body = leadHours === 0
      ? `${name} episode ${event.number} is out now.`
      : `${name} episode ${event.number} airs ${timing}.`;''',
    "reminder copy",
)
reminder = replace_once(
    reminder,
    '''        title: `Watched Logger reminder for ${String(planned.title || "Planned title")}`,
        body:
          "Test reminder — background alerts work when Watched Logger is closed.",''',
    '''        title: "Watched log reminder",
        body: `${String(planned.title || "Planned title")} test reminder is out now.`,''',
    "private test copy",
)
reminder_path.write_text(reminder)

final = index_path.read_text()
assert "const au=upcomingSortInfo(a,now),bu=upcomingSortInfo(b,now);" not in final
assert 'else if(activeSort==="recent")list.sort((a,b)=>compareRecentOrder(a,b,now));' in final
assert "maximum>0&&episode<=maximum" in final
assert "Never treat announced/total episode counts as released episodes" in final
assert 'const title = "Watched log reminder";' in reminder_path.read_text()
print("Watched Logger guarded fixes applied successfully")
