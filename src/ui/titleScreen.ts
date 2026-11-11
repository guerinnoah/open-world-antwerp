import { keyLabel, type Action } from '../core/keys';
import { onSettings } from '../core/settings';

export class TitleScreen {
  started: boolean;
  readonly begun: Promise<void>;
  private root = document.querySelector<HTMLDivElement>('#title')!;
  private bar = this.root.querySelector<HTMLDivElement>('#loading .bar');
  private fill = this.bar?.querySelector('div');
  private nameField = this.root.querySelector<HTMLInputElement>('.name input');
  private filled = 0;
  private begin?: () => void;
  private opened!: () => void;

  constructor(private skip: boolean) {
    this.started = skip;
    this.begun = new Promise((resolve) => (this.opened = resolve));
    if (skip) this.opened();
    onSettings(() => {
      for (const kbd of this.root.querySelectorAll<HTMLElement>('kbd[data-key]')) kbd.textContent = keyLabel(kbd.dataset.key as Action);
    });
  }

  askName({ value, placeholder }: { value: string; placeholder: string }) {
    const field = this.nameField;
    if (this.skip || !field) return;
    field.value = value;
    field.placeholder = placeholder;
    field.parentElement!.hidden = false;
    field.addEventListener('keydown', (e) => {
      e.stopPropagation(); // otherwise typing mutes, opens the map or starts the game
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) this.begin?.(); // 229: Safari's Enter that confirms an IME word
    });
  }

  get typedName(): string | undefined {
    const field = this.nameField;
    return field && !field.parentElement!.hidden ? field.value.trim() || field.placeholder : undefined;
  }

  /** Never moves back: more downloads join the count late. */
  progress(fraction: number) {
    this.filled = Math.max(this.filled, Math.min(1, fraction));
    this.fill?.style.setProperty('transform', `scaleX(${this.filled})`);
    this.bar?.setAttribute('aria-valuenow', String(Math.round(this.filled * 100)));
  }

  /** Inside the loading line, so a load that recovers anyway removes it with that line. */
  fail(message: string, retry = true) {
    const loading = this.root.querySelector<HTMLDivElement>('#loading');
    if (!loading || loading.classList.contains('failed')) return;
    loading.classList.add('failed');
    loading.querySelector('span')!.textContent = message;
    if (!retry) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retry';
    button.textContent = 'Retry';
    button.addEventListener('click', () => location.reload());
    loading.append(button);
  }

  ready() {
    if (this.skip) {
      this.hide(false);
      return;
    }
    const play = this.root.querySelector<HTMLButtonElement>('.play')!;
    play.hidden = false;
    const start = () => {
      if (this.started) return;
      this.started = true;
      removeEventListener('keydown', onKey);
      this.nameField?.blur();
      this.hide(true);
      this.opened();
    };
    this.begin = start;
    // a focused button or field handles its own Enter and Space
    const onKey = (e: KeyboardEvent) => (e.code === 'Enter' || e.code === 'Space') && !(e.target as Element).closest?.('button, input, select') && start();
    play.addEventListener('click', start);
    addEventListener('keydown', onKey);
  }

  private hide(fade: boolean) {
    document.body.classList.remove('on-title');
    if (!fade) {
      this.root.remove();
      return;
    }
    this.root.classList.add('gone');
    setTimeout(() => this.root.remove(), 600);
  }
}
