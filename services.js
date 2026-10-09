(() => {
  const titleKeys = {
    individual: 'formatIndividual',
    group: 'formatGroup',
    online: 'formatOnline',
    offline: 'formatOffline',
  };
  let services = null;

  function currentLanguage() {
    const language = document.documentElement.lang;
    return ['ru', 'hy', 'en'].includes(language) ? language : 'ru';
  }

  function serviceByKey(key) {
    return services?.find((service) => service.key === key);
  }

  function applyServiceText() {
    if (!services) return;
    const language = currentLanguage();

    for (const [key, translationKey] of Object.entries(titleKeys)) {
      const translation = serviceByKey(key)?.translations?.[language];
      if (!translation?.name) continue;
      document.querySelectorAll(`[data-i18n="${translationKey}"]`).forEach((element) => {
        element.textContent = translation.name;
      });
    }

    const selected = document.querySelector('.format-chip.is-selected');
    const selectedTranslation = selected && serviceByKey(selected.dataset.format)?.translations?.[language];
    const detailTitle = document.querySelector('#format-detail-title');
    const detailText = document.querySelector('#format-detail-text');
    if (selectedTranslation?.name && detailTitle) detailTitle.textContent = selectedTranslation.name;
    if (selectedTranslation?.description && detailText) detailText.textContent = selectedTranslation.description;
  }

  document.querySelectorAll('.lang-button, .format-chip').forEach((button) => {
    button.addEventListener('click', () => queueMicrotask(applyServiceText));
  });

  fetch('/api/services', { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('services_unavailable')))
    .then((result) => {
      if (!result?.ok || !Array.isArray(result.services)) throw new Error('invalid_services_response');
      services = result.services;
      applyServiceText();
    })
    .catch(() => {
      // The checked-in static text remains visible when the local API is unavailable.
    });
})();
