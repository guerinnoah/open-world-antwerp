# Trams and buses

## Routes

`tools/map/graph.ts` chains De Lijn's OSM route relations into runs (`trams` and `buses` in `graph.json`): a polyline,
the line's colour, its destination and the stops along it. Bus runs are offset into the right-hand lane.

## Timetable

`pnpm map:fetch-gtfs` counts De Lijn's GTFS trips per line and hour, for a weekday and a weekend day, into
`graph.schedules`. `Scheduler` in `src/actors/transit.ts` reads them for the hour the page loads (or `?time=`): only
lines with trips that hour run, and the number of vehicles is the preset's maximum scaled by how busy the hour is
compared with the busiest one. In the middle of the night none run.

Individual departures aren't followed: trams and buses appear at random points on running lines near the player.

## Driving

Trams (`src/actors/trams.ts`) and buses (`src/actors/buses.ts`) are kinematic: they are moved along their run rather
than pushed by physics. They accelerate and brake to a stop at each stop (`serveStops`), wait (`DWELL` for trams),
keep their distance from whatever is ahead, and lay over at the end of the line. You can drive a tram, which stays on
its rails, or take a bus off its route.
