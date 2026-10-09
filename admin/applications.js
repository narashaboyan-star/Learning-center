const listElement = document.querySelector('#applications-list');
const detailsElement = document.querySelector('#application-details');
const messageElement = document.querySelector('#applications-message');

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString('ru-RU');
}

function appendDefinition(list, term, value) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value || '—';
  list.append(dt, dd);
}

function renderDetails(application) {
  detailsElement.replaceChildren();
  const definitions = document.createElement('dl');
  appendDefinition(definitions, 'Родитель', application.parentName);
  appendDefinition(definitions, 'Телефон', application.phone);
  appendDefinition(definitions, 'Ребёнок', application.childName);
  appendDefinition(definitions, 'Класс', application.grade);
  appendDefinition(definitions, 'Нужна помощь', application.helpNeeded);
  appendDefinition(definitions, 'Язык сайта', application.language);
  appendDefinition(definitions, 'Получена', formatDate(application.createdAt));
  appendDefinition(
    definitions,
    'Telegram',
    application.telegram.notifiedAt
      ? `Отправлено: ${formatDate(application.telegram.notifiedAt)}`
      : `Не отправлено (${application.telegram.errorCode || 'нет кода'})`,
  );
  const heading = document.createElement('h3');
  heading.textContent = 'Состав на момент заявки';
  const items = document.createElement('ul');
  for (const item of application.items) {
    const row = document.createElement('li');
    row.textContent = item.name;
    items.append(row);
  }
  detailsElement.append(definitions, heading, items);
}

async function loadDetails(id, selectedButton) {
  messageElement.textContent = '';
  try {
    const response = await fetch(`/api/admin/applications?id=${encodeURIComponent(id)}`);
    if (response.status === 401) return window.location.assign('/admin/login.html');
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('details_failed');
    document.querySelectorAll('.application-row').forEach((button) => button.removeAttribute('aria-current'));
    selectedButton?.setAttribute('aria-current', 'true');
    renderDetails(result.application);
  } catch {
    messageElement.textContent = 'Не удалось загрузить детали заявки.';
  }
}

function renderList(applications) {
  listElement.replaceChildren();
  if (!applications.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Новых заявок пока нет.';
    listElement.append(empty);
    return;
  }
  for (const application of applications) {
    const button = document.createElement('button');
    button.className = 'application-row';
    button.type = 'button';
    const name = document.createElement('strong');
    name.textContent = application.parentName;
    const note = document.createElement('small');
    note.textContent = `${application.childName} · ${formatDate(application.createdAt)}`;
    button.append(name, note);
    button.addEventListener('click', () => loadDetails(application.id, button));
    listElement.append(button);
  }
}

async function loadApplications() {
  try {
    const response = await fetch('/api/admin/applications');
    if (response.status === 401) return window.location.assign('/admin/login.html');
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('list_failed');
    renderList(result.applications);
  } catch {
    messageElement.textContent = 'Не удалось загрузить список заявок.';
  }
}

loadApplications();
