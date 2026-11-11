import { ACTIONS, ACTION_LIST, keyLabel, keyName, keyOf, rebind, type Action } from '../core/keys';
import { coarsePointer, detectQuality, type QualityLevel } from '../core/quality';
import { DEFAULTS, LIMITS, onSettings, saveSettings, settings, type Settings } from '../core/settings';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SLIDERS: { key: keyof typeof LIMITS; label: string; step: number; text: (v: number) => string }[] = [
  { key: 'volume', label: 'Volume', step: 0.05, text: pct },
  { key: 'radioVolume', label: 'Radio volume', step: 0.05, text: pct },
  { key: 'lookSpeed', label: 'Look speed', step: 0.1, text: (v) => `${v.toFixed(1)}×` },
  { key: 'fov', label: 'Field of view', step: 1, text: (v) => `${v}°` },
];
const QUALITY_NAMES: Record<QualityLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export class SettingsPanel {
  private dialog = document.createElement('dialog');
  private status = document.createElement('p');
  private capturing: { action: Action; button: HTMLButtonElement } | null = null;
  private refreshers: (() => void)[] = [];
  private refresh = () => this.refreshers.forEach((r) => r());

  constructor(private loadedQuality: QualityLevel) {
    const d = this.dialog;
    d.id = 'settings';
    d.setAttribute('aria-labelledby', 'settings-title');
    d.innerHTML = `
      <div class="head"><h2 id="settings-title">Settings</h2><button type="button" class="close" aria-label="Close settings">×</button></div>
      <div class="rows"></div>
      <section class="keys" aria-labelledby="keys-title">
        <h3 id="keys-title">Keys</h3>
        <p class="note">Pick an action, then press its new key. Esc cancels.</p>
        <div class="bindings"></div>
      </section>
      <div class="foot"><button type="button" class="defaults">Restore defaults</button></div>`;
    this.status.className = 'status';
    this.status.setAttribute('role', 'status');
    d.append(this.status);
    document.body.append(d);

    d.querySelector('.rows')!.append(this.qualityRow(), ...SLIDERS.map((s) => this.sliderRow(s)), this.invertRow());
    const keys = d.querySelector<HTMLElement>('.keys')!;
    if (coarsePointer()) keys.hidden = true;
    else keys.querySelector('.bindings')!.append(...ACTION_LIST.map((a) => this.bindingRow(a)));

    d.querySelector('.close')!.addEventListener('click', () => d.close());
    d.querySelector('.defaults')!.addEventListener('click', () => {
      saveSettings({ ...DEFAULTS, keys: {} });
      this.status.textContent = 'Settings restored to their defaults';
    });
    document.querySelector('#title .open-settings')?.addEventListener('click', () => this.show());
    // a click on the backdrop lands on the dialog itself
    d.addEventListener('click', (e) => e.target === d && d.close());
    d.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keys typed here don't drive or start the game
      this.onKey(e);
    });
    addEventListener('keydown', (e) => {
      // next tick: the map may claim this Esc, and its default would close the dialog again
      if (e.code === 'Escape' && !e.repeat) setTimeout(() => e.defaultPrevented || this.show());
    });
    onSettings(this.refresh);
  }

  get open() {
    return this.dialog.open;
  }

  show() {
    if (this.dialog.open) return;
    this.status.textContent = '';
    this.dialog.showModal();
  }

  private qualityRow() {
    const row = document.createElement('div');
    row.className = 'row';
    const auto = detectQuality();
    row.innerHTML = `<label for="settings-quality">Graphics</label>
      <select id="settings-quality">
        <option value="auto">Auto (${QUALITY_NAMES[auto]})</option>
        ${(['low', 'medium', 'high'] as const).map((q) => `<option value="${q}">${QUALITY_NAMES[q]}</option>`).join('')}
      </select>
      <p class="reload" hidden>Applies after a reload. <button type="button">Reload now</button></p>`;
    const select = row.querySelector('select')!;
    const reload = row.querySelector<HTMLParagraphElement>('.reload')!;
    select.addEventListener('change', () => saveSettings({ quality: select.value as Settings['quality'] }));
    reload.querySelector('button')!.addEventListener('click', () => location.reload());
    this.refreshers.push(() => {
      select.value = settings.quality;
      reload.hidden = (settings.quality === 'auto' ? auto : settings.quality) === this.loadedQuality;
    });
    return row;
  }

  private sliderRow({ key, label, step, text }: (typeof SLIDERS)[number]) {
    const row = document.createElement('div');
    row.className = 'row';
    const id = `settings-${key}`;
    const [min, max] = LIMITS[key];
    row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" /><output for="${id}"></output>`;
    const input = row.querySelector('input')!;
    const output = row.querySelector('output')!;
    input.addEventListener('input', () => saveSettings({ [key]: Number(input.value) }));
    this.refreshers.push(() => {
      input.value = String(settings[key]);
      output.textContent = text(settings[key]);
      input.setAttribute('aria-valuetext', text(settings[key]));
    });
    return row;
  }

  private invertRow() {
    const row = document.createElement('div');
    row.className = 'row check';
    row.innerHTML = '<input id="settings-invert" type="checkbox" /><label for="settings-invert">Invert looking up and down</label>';
    const box = row.querySelector('input')!;
    box.addEventListener('change', () => saveSettings({ invertLook: box.checked }));
    this.refreshers.push(() => (box.checked = settings.invertLook));
    return row;
  }

  private bindingRow(action: Action) {
    const row = document.createElement('div');
    row.className = 'binding';
    const label = document.createElement('span');
    label.textContent = ACTIONS[action].label;
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (this.capturing?.button === button) return this.stopCapture();
      this.stopCapture();
      this.capturing = { action, button };
      button.classList.add('listening');
      button.textContent = 'Press a key…';
      this.status.textContent = `Press the new key for ${ACTIONS[action].label}`;
    });
    button.addEventListener('blur', () => this.capturing?.button === button && this.stopCapture());
    row.append(label, button);
    this.refreshers.push(() => {
      if (this.capturing?.button === button) return;
      button.textContent = keyLabel(action);
      button.setAttribute('aria-label', `${ACTIONS[action].label}: ${keyLabel(action)}. Change key`);
    });
    return row;
  }

  private onKey(e: KeyboardEvent) {
    const c = this.capturing;
    if (!c) return;
    e.preventDefault(); // also keeps Esc from closing the dialog
    if (e.code === 'Escape') {
      this.stopCapture();
      this.status.textContent = 'Key unchanged';
      return;
    }
    const keys = rebind(settings.keys, c.action, e.code);
    if (!keys) {
      this.status.textContent = `${keyName(e.code)} is kept for the browser. Pick another key`;
      return;
    }
    const swapped = ACTION_LIST.find((a) => a !== c.action && keyOf(a) === e.code);
    this.stopCapture();
    saveSettings({ keys });
    this.status.textContent = `${ACTIONS[c.action].label}: ${keyLabel(c.action)}${swapped ? `. ${ACTIONS[swapped].label} moved to ${keyLabel(swapped)}` : ''}`;
  }

  private stopCapture() {
    const c = this.capturing;
    if (!c) return;
    this.capturing = null;
    c.button.classList.remove('listening');
    this.refresh();
  }
}
