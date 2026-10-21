const texts = {
  ru: {
    eyebrow: 'Личный кабинет', title: 'Мои заявки', intro: 'Вход необязателен для записи. Кабинет помогает сохранить контакт и видеть заявки, отправленные после входа.',
    loginTitle: 'Войти через Telegram', loginText: 'После входа новые заявки будут доступны только вам. Телефон вводится отдельно.', loginButton: 'Войти через Telegram', mockButton: 'Тестовый вход через Telegram', mockNote: 'Локальный тест: Telegram имитируется, внешняя авторизация не выполняется.',
    profileEyebrow: 'Контакт', profileTitle: 'Профиль родителя', profileHelp: 'Имя и телефон подставляются в форму записи. Данные ребёнка вводятся отдельно для каждой заявки.', parentName: 'Имя родителя *', phone: 'Телефон *', save: 'Сохранить', logout: 'Выйти',
    historyEyebrow: 'История', historyTitle: 'Мои заявки', historyHelp: 'Здесь видны только заявки, отправленные после входа.', empty: 'После входа вы ещё не отправляли заявок.', lessonLink: 'Пробное занятие',
    new: 'Новая', in_progress: 'В работе', completed: 'Завершена', cancelled: 'Отменена', child: 'Ребёнок', grade: 'Класс', date: 'Дата', price: 'Стоимость', help: 'Комментарий', composition: 'Выбранный формат', groupPrice: '15 000 AMD в месяц', consultationPrice: 'После консультации',
    saved: 'Профиль сохранён.', loadError: 'Не удалось загрузить кабинет. Попробуйте ещё раз.', saveError: 'Проверьте имя и армянский номер телефона.', expired: 'Сессия завершена. Войдите снова.', cancelledLogin: 'Вход отменён. Можно попробовать ещё раз.', failedLogin: 'Telegram-вход временно недоступен.', disabled: 'Telegram-вход пока не настроен для этого предпросмотра.'
  },
  hy: {
    eyebrow: 'Անձնական էջ', title: 'Իմ հայտերը', intro: 'Մուտքը պարտադիր չէ գրանցման համար։ Անձնական էջը պահպանում է կոնտակտը և ցույց տալիս մուտքից հետո ուղարկված հայտերը։',
    loginTitle: 'Մուտք Telegram-ով', loginText: 'Մուտքից հետո նոր հայտերը հասանելի կլինեն միայն ձեզ։ Հեռախոսահամարը լրացվում է առանձին։', loginButton: 'Մուտք Telegram-ով', mockButton: 'Telegram-ի փորձնական մուտք', mockNote: 'Տեղային փորձարկում․ Telegram-ը նմանակվում է, արտաքին մուտք չի կատարվում։',
    profileEyebrow: 'Կոնտակտ', profileTitle: 'Ծնողի պրոֆիլ', profileHelp: 'Անունն ու հեռախոսը լրացվում են գրանցման ձևում։ Երեխայի տվյալները լրացվում են յուրաքանչյուր հայտի համար։', parentName: 'Ծնողի անուն *', phone: 'Հեռախոս *', save: 'Պահպանել', logout: 'Դուրս գալ',
    historyEyebrow: 'Պատմություն', historyTitle: 'Իմ հայտերը', historyHelp: 'Այստեղ երևում են միայն մուտքից հետո ուղարկված հայտերը։', empty: 'Մուտքից հետո դեռ հայտ չեք ուղարկել։', lessonLink: 'Փորձնական դաս',
    new: 'Նոր', in_progress: 'Ընթացքում', completed: 'Ավարտված', cancelled: 'Չեղարկված', child: 'Երեխա', grade: 'Դասարան', date: 'Ամսաթիվ', price: 'Արժեք', help: 'Մեկնաբանություն', composition: 'Ընտրված ձևաչափ', groupPrice: 'Ամսական 15 000 AMD', consultationPrice: 'Խորհրդատվությունից հետո',
    saved: 'Պրոֆիլը պահպանված է։', loadError: 'Չհաջողվեց բեռնել անձնական էջը։ Փորձեք կրկին։', saveError: 'Ստուգեք անունը և հայկական հեռախոսահամարը։', expired: 'Նիստն ավարտվել է։ Մուտք գործեք կրկին։', cancelledLogin: 'Մուտքը չեղարկվել է։ Կարող եք կրկին փորձել։', failedLogin: 'Telegram-ի մուտքը ժամանակավորապես անհասանելի է։', disabled: 'Telegram-ի մուտքը դեռ կարգավորված չէ այս տարբերակի համար։'
  },
  en: {
    eyebrow: 'Parent account', title: 'My applications', intro: 'Signing in is optional for booking. The account saves your contact and shows applications sent after sign-in.',
    loginTitle: 'Sign in with Telegram', loginText: 'After sign-in, new applications will be visible only to you. Your phone number is entered separately.', loginButton: 'Sign in with Telegram', mockButton: 'Test Telegram sign-in', mockNote: 'Local test: Telegram is simulated and no external authentication takes place.',
    profileEyebrow: 'Contact', profileTitle: 'Parent profile', profileHelp: 'Your name and phone are prefilled in the booking form. Child details are entered for each application.', parentName: 'Parent name *', phone: 'Phone *', save: 'Save', logout: 'Sign out',
    historyEyebrow: 'History', historyTitle: 'My applications', historyHelp: 'Only applications sent after sign-in appear here.', empty: 'You have not sent any applications after sign-in yet.', lessonLink: 'Trial lesson',
    new: 'New', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', child: 'Child', grade: 'Grade', date: 'Date', price: 'Price', help: 'Comment', composition: 'Selected format', groupPrice: 'AMD 15,000 per month', consultationPrice: 'After consultation',
    saved: 'Profile saved.', loadError: 'The account could not be loaded. Please try again.', saveError: 'Check the name and Armenian phone number.', expired: 'Your session has ended. Please sign in again.', cancelledLogin: 'Sign-in was cancelled. You can try again.', failedLogin: 'Telegram sign-in is temporarily unavailable.', disabled: 'Telegram sign-in is not configured for this preview yet.'
  },
};

const elements = {
  message: document.querySelector('#account-message'), loginPanel: document.querySelector('#login-panel'), loginButton: document.querySelector('#login-button'), mockNote: document.querySelector('#mock-note'),
  content: document.querySelector('#account-content'), profileForm: document.querySelector('#profile-form'), logout: document.querySelector('#logout-button'), list: document.querySelector('#customer-applications'), details: document.querySelector('#customer-application-details'), home: document.querySelector('#home-link'), lesson: document.querySelector('#lesson-link'),
};
let language = ['ru', 'hy', 'en'].includes(new URLSearchParams(location.search).get('lang')) ? new URLSearchParams(location.search).get('lang') : 'ru';
let authMode = 'disabled';
let isAuthenticated = false;
let currentMessageKey = '';
let currentMessageSuccess = false;
const authResult = new URLSearchParams(location.search).get('auth');
const pendingAuthMessage = authResult === 'cancelled' ? 'cancelledLogin' : authResult === 'failed' ? 'failedLogin' : '';

function t(key) { return texts[language][key] || key; }
function setMessage(key, success = false) {
  currentMessageKey = key;
  currentMessageSuccess = success;
  elements.message.textContent = key ? t(key) : '';
  elements.message.classList.toggle('is-success', success);
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-text]').forEach((element) => { element.textContent = t(element.dataset.text); });
  document.querySelectorAll('.lang-button').forEach((button) => button.classList.toggle('is-active', button.dataset.lang === language));
  const homePath = language === 'en' ? '/en/index.html' : language === 'ru' ? '/ru/index.html' : '/index.html?lang=hy';
  elements.home.href = homePath; elements.lesson.href = `${homePath.split('?')[0]}${language === 'hy' ? '?lang=hy' : ''}#trial`;
  document.title = `${t('title')} — Kostanyan Learning Center`;
  if (authMode === 'mock') elements.loginButton.textContent = t('mockButton');
  if (currentMessageKey) setMessage(currentMessageKey, currentMessageSuccess);
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString(language === 'hy' ? 'hy-AM' : language === 'en' ? 'en-GB' : 'ru-RU');
}
function priceText(price) { return price?.period === 'month' && price.amount === 15000 ? t('groupPrice') : t('consultationPrice'); }
function appendDefinition(list, term, value) { const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value || '—'; list.append(dt, dd); }

function renderDetails(application) {
  elements.details.replaceChildren();
  const definitions = document.createElement('dl');
  appendDefinition(definitions, t('child'), application.childName);
  appendDefinition(definitions, t('grade'), application.grade);
  appendDefinition(definitions, t('date'), formatDate(application.createdAt));
  appendDefinition(definitions, t('price'), priceText(application.price));
  appendDefinition(definitions, t('help'), application.helpNeeded);
  const heading = document.createElement('h3'); heading.textContent = t('composition');
  const items = document.createElement('ul');
  for (const item of application.items) { const row = document.createElement('li'); row.textContent = item.name; items.append(row); }
  elements.details.append(definitions, heading, items);
}

async function loadDetails(id, button) {
  const response = await fetch(`/api/customer/applications?id=${encodeURIComponent(id)}`);
  if (response.status === 401) return showLoggedOut('expired');
  const result = await response.json();
  if (!response.ok) return setMessage('loadError');
  document.querySelectorAll('.customer-application-row').forEach((row) => row.removeAttribute('aria-current'));
  button.setAttribute('aria-current', 'true'); renderDetails(result.application);
}

async function loadApplications() {
  const response = await fetch('/api/customer/applications');
  if (response.status === 401) return showLoggedOut('expired');
  const result = await response.json();
  if (!response.ok) return setMessage('loadError');
  elements.list.replaceChildren(); elements.details.replaceChildren();
  if (!result.applications.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = t('empty'); elements.list.append(empty); return; }
  for (const application of result.applications) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'customer-application-row';
    const summary = document.createElement('span'); const title = document.createElement('strong'); title.textContent = application.childName; const note = document.createElement('small'); note.textContent = formatDate(application.createdAt); summary.append(title, note);
    const status = document.createElement('span'); status.className = 'status-pill'; status.textContent = t(application.status);
    button.append(summary, status); button.addEventListener('click', () => loadDetails(application.id, button)); elements.list.append(button);
  }
}

function showLoggedOut(messageKey = '') { elements.loginPanel.hidden = false; elements.content.hidden = true; setMessage(messageKey); }
async function showLoggedIn(profile) {
  isAuthenticated = true;
  elements.loginPanel.hidden = true; elements.content.hidden = false;
  elements.profileForm.elements.parentName.value = profile.parentName || '';
  elements.profileForm.elements.phone.value = profile.phone || '';
  await loadApplications();
}

async function loadSession() {
  try {
    const response = await fetch('/api/customer/session'); const result = await response.json();
    authMode = result.authMode; elements.mockNote.hidden = authMode !== 'mock'; elements.loginButton.disabled = authMode === 'disabled'; applyLanguage();
    if (result.authenticated) await showLoggedIn(result.customer.profile);
    else { isAuthenticated = false; showLoggedOut(pendingAuthMessage || (authMode === 'disabled' ? 'disabled' : '')); }
  } catch { showLoggedOut('loadError'); }
}

elements.loginButton.addEventListener('click', async () => {
  if (authMode === 'mock') {
    const response = await fetch('/api/customer/auth/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: 'parent-a' }) });
    if (response.ok) return loadSession();
    return setMessage('failedLogin');
  }
  if (authMode === 'telegram') {
    const returnPath = `/account.html?lang=${language}`;
    location.assign(`/api/customer/auth/telegram/start?return=${encodeURIComponent(returnPath)}`);
  }
});

elements.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!elements.profileForm.reportValidity()) return;
  const response = await fetch('/api/customer/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(elements.profileForm))) });
  if (response.status === 401) return showLoggedOut('expired');
  if (!response.ok) return setMessage('saveError');
  setMessage('saved', true);
});
elements.logout.addEventListener('click', async () => { await fetch('/api/customer/logout', { method: 'POST' }); isAuthenticated = false; showLoggedOut(); });
document.querySelectorAll('.lang-button').forEach((button) => button.addEventListener('click', () => { language = button.dataset.lang; history.replaceState(null, '', `/account.html?lang=${language}`); applyLanguage(); if (isAuthenticated) loadApplications(); }));

applyLanguage(); loadSession();
