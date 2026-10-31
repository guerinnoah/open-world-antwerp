import { CHAT_MAX, ChatLimit, cleanChat } from './protocol';

const SHOW = 12_000;
const HISTORY = 30;

export class Chat {
  onSend: (text: string) => void = () => {};
  private root = document.createElement('div');
  private button = document.createElement('button');
  private log = document.createElement('div');
  private form = document.createElement('form');
  private field = document.createElement('input');
  private limit = new ChatLimit();
  private enabled = false;

  constructor(pill: HTMLElement) {
    this.root.id = 'chat';
    this.button.type = 'button';
    this.button.className = 'chat-button';
    this.button.textContent = '💬';
    this.button.title = 'Chat (T)';
    this.button.hidden = true;
    // the press blurs the field, closing the chat before 'click'
    let openAtPress = false;
    this.button.addEventListener('pointerdown', () => (openAtPress = this.isOpen));
    this.button.addEventListener('click', (e) => ((e.detail ? openAtPress : this.isOpen) ? this.close() : this.open())); // detail 0: keyboard
    pill.after(this.button);

    this.log.className = 'log';
    this.field.type = 'text';
    this.field.maxLength = CHAT_MAX;
    this.field.placeholder = 'Say something…';
    this.field.enterKeyHint = 'send';
    this.field.autocomplete = 'off';
    this.form.hidden = true;
    this.form.append(this.field);
    this.root.append(this.log, this.form);
    pill.parentElement!.append(this.root);

    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation(); // otherwise typing drives the car
      if (e.key === 'Escape') this.close();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });
    this.field.addEventListener('blur', () => this.close());
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.isOpen) return;
      if (!this.enabled || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      this.open();
    });
  }

  get isOpen() {
    return !this.form.hidden;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.button.hidden = !enabled;
    if (!enabled) this.close();
  }

  open() {
    if (!this.enabled || !this.root.checkVisibility() || getComputedStyle(this.root).visibility === 'hidden') return;
    this.form.hidden = false;
    this.root.classList.add('open');
    this.log.scrollTop = this.log.scrollHeight;
    this.field.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.form.hidden = true;
    this.field.value = '';
    this.root.classList.remove('open');
    this.field.blur();
  }

  add(name: string, text: string, self = false) {
    const who = document.createElement('b');
    who.textContent = name;
    this.push(self ? 'line self' : 'line', who, ` ${text}`);
  }

  system(text: string) {
    this.push('line system', text);
  }

  private push(className: string, ...content: (Node | string)[]) {
    const line = document.createElement('div');
    line.className = className;
    line.append(...content);
    this.log.append(line);
    while (this.log.childElementCount > HISTORY) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('faded'), SHOW);
  }

  private send() {
    const text = cleanChat(this.field.value);
    this.close();
    if (!text) return;
    if (!this.limit.take(performance.now())) {
      this.system('Slow down a little: one message every couple of seconds.');
      return;
    }
    this.onSend(text);
  }
}
