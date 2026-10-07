import '../style.css';
import { ApiError, GameApi } from '../platform/api';
import { BalanceEditor, parameterError } from '../platform/balance';
import type { BalanceParameter } from '../platform/balance';
import { goldText } from '../platform/profile';

const get = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const api = new GameApi(), editor = new BalanceEditor(api);
const form = get<HTMLFormElement>('balance-form'), login = get<HTMLFormElement>('balance-login');
const fields = get('balance-fields'), save = get<HTMLButtonElement>('balance-save');
const errors = new Map<string, string>(), inputs = new Map<string, HTMLInputElement>();
let authenticated = false, message = '', uiBusy = false;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
};
function update(): void {
  const busy = uiBusy || editor.busy;
  save.disabled = busy || !editor.dirty || errors.size > 0;
  get<HTMLButtonElement>('balance-reload').disabled = busy;
  get<HTMLButtonElement>('balance-reload').textContent = editor.dirty ? 'Загрузить текущую версию и заменить черновик' : 'Загрузить текущую версию';
  get<HTMLButtonElement>('balance-logout').disabled = busy;
  for (const input of inputs.values()) input.disabled = busy;
  for (const input of login.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) input.disabled = busy;
  get('balance-draft').textContent = errors.size ? `Исправь поля: ${errors.size}. Сохранение недоступно.` : editor.dirty ? 'Есть несохранённые изменения. На сервере действует предыдущая версия.' : 'Несохранённых изменений нет.';
  const error = get('balance-error'); error.hidden = !editor.error; error.textContent = editor.error;
  get('balance-status').textContent = busy ? 'Подтверждаем действие на сервере…' : message;
}
function handle(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    authenticated = false; form.hidden = true; login.hidden = false; message = 'Войди в аккаунт с правом управления балансом.';
  } else if (error instanceof ApiError && error.status === 403) {
    form.hidden = true; login.hidden = false; message = 'У этого аккаунта нет права управления балансом. Войди в другой аккаунт или запроси право у оператора.';
  }
  if (!editor.error) editor.error = error instanceof Error ? error.message : 'Сервис недоступен. Повтори загрузку.';
  update();
}
function renderFields(): void {
  fields.replaceChildren(); errors.clear(); inputs.clear();
  const groups = new Map<string, BalanceParameter[]>();
  for (const parameter of editor.document!.parameters) { const entries = groups.get(parameter.group) ?? []; entries.push(parameter); groups.set(parameter.group, entries); }
  const ordered = [...groups].sort(([a],[b]) => a === 'Магазин' ? -1 : b === 'Магазин' ? 1 : 0);
  for (const [group, parameters] of ordered) {
    const section = make('details', undefined, 'balance-group'); section.open = group === 'Магазин' || parameters.some(p => p.key === 'forge.offlineCapSeconds');
    section.append(make('summary', `${group} · ${parameters.length}`));
    const rows = make('div', undefined, 'balance-rows');
    for (const [index, p] of parameters.entries()) {
      const row = make('div', undefined, 'balance-row'), label = make('label'), input = make('input');
      input.id = `field-${fields.childElementCount}-${index}`; input.name = p.key;
      label.htmlFor = input.id; label.append(make('span', p.label), make('small', p.key, 'balance-key'));
      const control = make('div', undefined, 'balance-control'), detail = make('small', undefined, 'balance-unit');
      const hint = make('p', undefined, 'balance-field-error'); hint.id = `${input.id}-error`; hint.hidden = true; hint.setAttribute('aria-live','polite');
      input.setAttribute('aria-describedby', `${input.id}-unit ${hint.id}`); detail.id = `${input.id}-unit`;
      if (p.type === 'boolean') { input.type = 'checkbox'; input.checked = editor.draft[p.key] as boolean; }
      else {
        input.type = p.type === 'goldMilli' ? 'text' : 'number'; input.value = String(editor.draft[p.key]); input.required = true;
        if (p.type === 'goldMilli') { input.inputMode = 'numeric'; input.pattern = '(0|[1-9][0-9]{0,18})'; }
        else { input.step = p.type === 'integer' ? '1' : 'any'; if (p.min !== undefined) input.min = String(p.min); if (p.max !== undefined) input.max = String(p.max); }
      }
      const describe = () => {
        const error = parameterError(p, editor.draft[p.key]);
        if (error) errors.set(p.key,error); else errors.delete(p.key);
        hint.textContent = error; hint.hidden = !error; input.setAttribute('aria-invalid',String(Boolean(error)));
        const bounds = p.type === 'goldMilli' ? '0…9223372036854775807' : p.type === 'number' || p.type === 'integer' ? `${p.min === undefined ? '' : `от ${p.min}`}${p.min !== undefined && p.max !== undefined ? ' ' : ''}${p.max === undefined ? '' : `до ${p.max}`}${p.type === 'integer' ? ' · целое число' : ''}` : '';
        detail.textContent = [p.unit,bounds,p.type === 'goldMilli' && !error ? `${goldText(editor.draft[p.key] as string)} золота` : ''].filter(Boolean).join(' · ');
      };
      input.addEventListener('input', () => {
        editor.draft[p.key] = p.type === 'boolean' ? input.checked : p.type === 'goldMilli' ? input.value : input.value.trim() === '' ? NaN : Number(input.value);
        describe(); message = `Редактируется версия ${editor.document!.revision}. После публикации мастерская применит настройки сразу, бой — со следующего забега. Прошедшее время производства сохраняет прежние ставки.`; update();
      });
      inputs.set(p.key,input); describe(); control.append(input,detail,hint); row.append(label,control); rows.append(row);
    }
    section.append(rows); fields.append(section);
  }
}
async function load(): Promise<void> {
  if (uiBusy || editor.busy) return;
  uiBusy = true; update();
  try {
    if (!authenticated) { await api.session(); authenticated = true; }
    await editor.load(); login.hidden = true; form.hidden = false; renderFields();
    message = `Действующая версия: ${editor.document!.revision}. Бой закреплён за начатым забегом; мастерская использует действующие настройки.`;
  } catch (error) { handle(error); }
  finally { uiBusy = false; update(); }
}
login.addEventListener('submit', event => {
  event.preventDefault(); if (uiBusy || editor.busy) return;
  const loginInput = login.elements.namedItem('login') as HTMLInputElement, password = login.elements.namedItem('password') as HTMLInputElement;
  uiBusy = true; editor.error = ''; update();
  void api.login(loginInput.value.trim(),password.value).then(() => { authenticated = true; }).catch(handle).finally(() => {
    password.value = ''; uiBusy = false; update(); if (authenticated) void load();
  });
});
form.addEventListener('submit', event => {
  event.preventDefault(); if (save.disabled) return;
  const request = editor.save(); update();
  void request.then(() => {
    renderFields(); message = `Опубликовано. Мастерская применяет версию ${editor.document!.revision} сразу; прошедшее время рассчитано по прежним ставкам. Боевые правила и эффект часов закрепляются со следующего забега.`;
  }).catch(handle).finally(update);
});
get('balance-reload').addEventListener('click', () => { void load(); });
get('balance-logout').addEventListener('click', () => {
  if (uiBusy || editor.busy) return; uiBusy = true; update();
  void api.logout().then(() => {
    authenticated = false; editor.document = null; editor.draft = {}; editor.error = ''; fields.replaceChildren(); inputs.clear(); errors.clear(); form.hidden = true; login.hidden = false; message = 'Войди в аккаунт с правом управления балансом.';
  }).catch(handle).finally(() => { uiBusy = false; update(); });
});
void load();
