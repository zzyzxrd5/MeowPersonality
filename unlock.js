const storageKey = 'meow-static-unlock';
const form = document.querySelector('#access-form');
const input = document.querySelector('#access-code');
const button = document.querySelector('#enter-button');
const error = document.querySelector('#access-error');
let encrypted;
let busy = false;
const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value)));

document.querySelector('#learn-more').addEventListener('click', () => {
  document.querySelector('#visitor-intro').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
});
document.querySelector('#show-code').addEventListener('change', event => { input.type = event.target.checked ? 'text' : 'password'; });
input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });

async function getPayload() {
  if (encrypted) return encrypted;
  const response = await fetch(new URL('./content.encrypted.json', document.baseURI), { cache: 'no-store' });
  if (!response.ok) throw new Error('network');
  const data = await response.json();
  if (data.version !== 1 || data.iterations !== 210000 || !/^[a-f0-9]{64}$/.test(data.id)) throw new Error('network');
  encrypted = data;
  return data;
}

async function passwordKey(code, payload) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toUpperCase()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: decode(payload.salt), iterations: payload.iterations }, material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function unlock(key, payload) {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(payload.iv) }, key, decode(payload.ciphertext));
  const app = JSON.parse(new TextDecoder().decode(bytes));
  const urls = {};
  for (const name of ['extra-cats.js', 'data.js', 'share-card.js', 'app.js']) {
    let source = app.modules[name];
    if (typeof source !== 'string') throw new Error('payload');
    for (const [dependency, url] of Object.entries(urls)) source = source.replaceAll(`'./${dependency}'`, JSON.stringify(url));
    urls[name] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  }
  const parsed = new DOMParser().parseFromString(app.html, 'text/html');
  parsed.querySelectorAll('script').forEach(script => script.remove());
  document.body.className = parsed.body.className;
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
  await import(urls['app.js']);
  try { sessionStorage.setItem(storageKey, JSON.stringify({ id: payload.id, key: encode(await crypto.subtle.exportKey('raw', key)) })); }
  catch { /* Unlock still works when session storage is unavailable. */ }
  // Keep URLs alive through back/forward cache restores; the browser frees them with the document.
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  if (!window.isSecureContext || !crypto.subtle) { error.textContent = '请使用 HTTPS 地址在新版浏览器中打开。'; return; }
  busy = true; button.disabled = true; button.textContent = '正在核对口令…'; error.textContent = '';
  try {
    const payload = await getPayload();
    await unlock(await passwordKey(input.value, payload), payload);
  } catch (reason) {
    if (!form.isConnected) {
      document.body.replaceChildren(Object.assign(document.createElement('p'), { textContent: '页面暂时未能载入，请刷新后重新输入口令。' }));
    } else {
      error.textContent = reason?.name === 'OperationError' ? '口令不正确，请粘贴收到的完整口令。' : '内容暂时未能载入，请检查网络后重试。';
      input.setAttribute('aria-invalid', 'true'); input.focus();
    }
  } finally { busy = false; button.disabled = false; button.innerHTML = '进入我的猫猫世界 <span aria-hidden="true">→</span>'; }
});

async function restore() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { return; }
  if (!saved || !crypto.subtle) return;
  busy = true; button.disabled = true;
  try {
    const payload = await getPayload();
    if (saved.id !== payload.id) throw new Error('changed');
    const key = await crypto.subtle.importKey('raw', decode(saved.key), 'AES-GCM', true, ['decrypt']);
    await unlock(key, payload);
  } catch {
    try { sessionStorage.removeItem(storageKey); } catch {}
    if (!form.isConnected) location.reload();
  } finally { busy = false; button.disabled = false; }
}
restore();
