export class TitleScreen {
  started: boolean;
  private root = document.querySelector<HTMLDivElement>('#title')!;

  constructor(private skip: boolean) {
    this.started = skip;
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
