# Police and health

## Wanted level

Crimes go through `Game.crime` in `src/game/game.ts`: punching someone, hitting people with a vehicle, ramming a
patrol car, and taking a bike from a cyclist, a car from its driver, a police car or a bus in service. A first crime
only counts if a police car within 60 m has a clear line of sight (`Traffic.witness`); crimes against the police count
anyway.

`Wanted` in `src/game/wanted.ts` tracks the level (1 to 5), which sets how many units come and how fast they drive.
Police get a while to arrive, then a search clock runs while you're out of sight: when it runs out, you're free.
Stand still near a stopped police car that can see you and you're arrested, then released at the Oudaan police tower.

## Pursuit

Pursuers are traffic cars with a `chase` flag in `src/actors/traffic.ts`. Units are sent from nearby patrols or spawned
out of sight near where you were last seen. A pursuer only knows where you are while it can see you; otherwise it
drives to the last place you were seen and searches around it, which is what makes hiding possible. Pursuers route
with sirens on, ignoring one-way streets, at a multiple of each street's limit (`CHASE_LIMIT`), and leave the road to
close in once they have a clear run. Stuck ones back up and swing out, and give up after a few tries.

## Health

Crash damage grows with the square of the speed lost beyond a few m/s, scaled by how exposed you are: heavier vehicles
protect you more, two-wheelers least (`crashHurt` and `exposure` in `src/actors/player.ts`). Health comes back after a
few seconds without a hit. At zero you wake up outside ZNA Sint-Elisabeth.
