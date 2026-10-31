export const MAX_STARS = 5;
const ESCALATE_GAP = 4; // s: a rampage through a crowd is one star, not one per person
const SEARCH = 15; // s
const SEARCH_PER_STAR = 5; // s
const BLINK_AFTER = 1.5; // s
const RESPONSE = 35; // s for the police to arrive before the search clock starts
const BUST_TIME = 1.8; // s
const UNITS = [0, 1, 2, 3, 4, 6]; // by stars
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
    if (this.level >= MAX_STARS || this.gap > 0) return false;
    this.level++;
    this.gap = ESCALATE_GAP;
    return true;
  }

  update(dt: number, seen: boolean, cornered: boolean): 'lost' | 'busted' | null {
    this.gap -= dt;
    if (!this.level) return null;
    this.cornered = cornered ? this.cornered + dt : 0;
    if (this.cornered >= BUST_TIME) {
      this.clear();
      return 'busted';
    }
    if (seen) this.responding = 0;
    if (seen || (this.responding -= dt) > 0) this.unseen = 0;
    else this.unseen += dt;
    if (this.unseen < SEARCH + (this.level - 1) * SEARCH_PER_STAR) return null;
    this.clear();
    return 'lost';
  }

  set(level: number) {
    this.clear();
    this.level = Math.min(MAX_STARS, level);
    this.responding = RESPONSE;
  }

  clear() {
    this.level = this.unseen = this.cornered = this.responding = this.gap = 0;
  }

  get searching(): boolean {
    return this.level > 0 && this.unseen > BLINK_AFTER;
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
