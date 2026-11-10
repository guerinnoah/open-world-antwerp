export class TitleScreen {
  started: boolean;
  private root = document.querySelector<HTMLDivElement>('#title')!;
  private bar = this.root.querySelector<HTMLDivElement>('#loading .bar div');
  private filled = 0;

  constructor(private skip: boolean) {
    this.started = skip;
  }

  /** Never moves back: more downloads join the count late. */
  progress(fraction: number) {
    this.filled = Math.max(this.filled, Math.min(1, fraction));
    this.bar?.style.setProperty('transform', `scaleX(${this.filled})`);
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
      this.hide(true);
    };
    const onKey = (e: KeyboardEvent) => (e.code === 'Enter' || e.code === 'Space') && start();
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
