(() => {
  const languageLabels = { ru: 'Русский', hy: 'Հայերեն', en: 'English' };
  const kindLabels = { service: 'Услуга', lesson_type: 'Тип занятия', mode: 'Способ участия' };
  const list = document.querySelector('#service-list');
  const pageMessage = document.querySelector('#page-message');

  function showPageError(message) {
    pageMessage.textContent = message;
    list.setAttribute('aria-busy', 'false');
  }

  function translationField(language, field, value, serviceKey) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = `${languageLabels[language]} — ${field === 'name' ? 'название' : 'описание'}`;
    const input = field === 'name' ? document.createElement('input') : document.createElement('textarea');
    input.name = `${language}.${field}`;
    input.value = value || '';
    input.maxLength = field === 'name' ? 120 : 1000;
    input.required = field === 'name';
    input.dataset.language = language;
    input.dataset.field = field;
    input.setAttribute('aria-label', `${title.textContent}: ${serviceKey}`);
    label.append(title, input);
    return label;
  }

  function renderService(service) {
    const form = document.createElement('form');
    form.className = 'service-editor';
    form.dataset.key = service.key;

    const heading = document.createElement('h2');
    heading.textContent = `${kindLabels[service.kind] || service.kind}: ${service.key}`;
    const fields = document.createElement('div');
    fields.className = 'translations';
    for (const language of ['ru', 'hy', 'en']) {
      const group = document.createElement('div');
      const translation = service.translations[language] || {};
      group.append(
        translationField(language, 'name', translation.name, service.key),
        translationField(language, 'description', translation.description, service.key),
      );
      fields.append(group);
    }

    const actions = document.createElement('div');
    actions.className = 'service-actions';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Сохранить';
    const message = document.createElement('p');
    message.className = 'service-message';
    message.setAttribute('role', 'status');
    actions.append(submit, message);
    form.append(heading, fields, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      message.textContent = 'Сохраняем…';
      const translations = {};
      for (const language of ['ru', 'hy', 'en']) {
        translations[language] = {
          name: form.querySelector(`[data-language="${language}"][data-field="name"]`).value,
          description: form.querySelector(`[data-language="${language}"][data-field="description"]`).value,
        };
      }
      try {
        const response = await fetch('/api/admin/services', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ key: service.key, translations }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.code || 'save_failed');
        message.textContent = 'Сохранено.';
      } catch (error) {
        message.textContent = `Не удалось сохранить (${error.message}).`;
      } finally {
        submit.disabled = false;
      }
    });
    return form;
  }

  fetch('/api/admin/services', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (response.status === 401) {
        window.location.assign('/admin/login.html');
        return null;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.code || 'load_failed');
      return result.services;
    })
    .then((services) => {
      if (!services) return;
      list.replaceChildren(...services.map(renderService));
      list.setAttribute('aria-busy', 'false');
    })
    .catch((error) => showPageError(`Не удалось загрузить услуги (${error.message}).`));
})();
