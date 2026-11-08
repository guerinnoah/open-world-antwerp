export const MAX_LEVEL = 5;
const ESCALATE_GAP = 4; // s: a rampage through a crowd is one level, not one per person
const SEARCH = 15; // s
const SEARCH_PER_LEVEL = 5; // s
const SEARCHING_AFTER = 1.5; // s
const RESPONSE = 35; // s for the police to arrive before the search clock starts
const ARREST_TIME = 1.8; // s
const UNITS = [0, 1, 2, 3, 4, 6]; // by level
const SPEEDS = [0, 60, 75, 90, 105, 120].map((kmh) => kmh / 3.6);

export class Wanted {
  level = 0;
  unseen = 0; // s
  private gap = 0;
  private cornered = 0;
  private responding = 0;

  crime(witnessed: boolean): boolean {
    if (!witnessed && !this.level) return false;
    this.unseen = 0;
    this.responding = RESPONSE;
    if (this.level >= MAX_LEVEL || this.gap > 0) return false;
    this.level++;
    this.gap = ESCALATE_GAP;
    return true;
  }

  update(dt: number, seen: boolean, cornered: boolean): 'lost' | 'arrested' | null {
    this.gap -= dt;
    if (!this.level) return null;
    this.cornered = cornered ? this.cornered + dt : 0;
    if (this.cornered >= ARREST_TIME) {
      this.clear();
      return 'arrested';
    }
    if (seen) this.responding = 0;
    if (seen || (this.responding -= dt) > 0) this.unseen = 0;
    else this.unseen += dt;
    if (this.unseen < SEARCH + (this.level - 1) * SEARCH_PER_LEVEL) return null;
    this.clear();
    return 'lost';
  }

  set(level: number) {
    this.clear();
    this.level = Math.min(MAX_LEVEL, level);
    this.responding = RESPONSE;
  }

  clear() {
    this.level = this.unseen = this.cornered = this.responding = this.gap = 0;
  }

  get status(): 'on the way' | 'chasing' | 'searching' | null {
    if (!this.level) return null;
    if (this.responding > 0) return 'on the way';
    return this.unseen > SEARCHING_AFTER ? 'searching' : 'chasing';
  }

  get units(): number {
    return UNITS[this.level];
  }

  get speed(): number {
    return SPEEDS[this.level];
  }

  get ramming(): boolean {
    return this.level >= 2;
  }
}
