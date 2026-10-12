(() => {
  const form = document.querySelector('#trial-form');
  if (!form) return;
  const parentName = form.elements.namedItem('parentName');
  const phone = form.elements.namedItem('phone');
  const lessonTypes = form.querySelectorAll('input[name="lessonType"]');
  const submissionKey = document.createElement('input');
  submissionKey.type = 'hidden';
  submissionKey.name = 'submissionKey';
  submissionKey.value = crypto.randomUUID();
  form.append(submissionKey);

  const priceHint = document.createElement('p');
  priceHint.className = 'field-help application-price-hint';
  priceHint.setAttribute('role', 'status');
  const lessonFieldset = form.querySelector('input[name="lessonType"]')?.closest('fieldset');
  lessonFieldset?.append(priceHint);

  const priceTexts = {
    ru: { group: 'Групповые занятия — 15 000 AMD в месяц.', individual: 'Стоимость индивидуальных занятий определяется после консультации.' },
    hy: { group: 'Խմբային դասերը՝ ամսական 15 000 AMD։', individual: 'Անհատական դասերի արժեքը որոշվում է խորհրդատվությունից հետո։' },
    en: { group: 'Group lessons — AMD 15,000 per month.', individual: 'Individual lesson pricing is agreed after the consultation.' },
  };

  function updatePriceHint() {
    const language = ['ru', 'hy', 'en'].includes(document.documentElement.lang) ? document.documentElement.lang : 'ru';
    const selected = form.querySelector('input[name="lessonType"]:checked')?.value;
    priceHint.textContent = selected ? priceTexts[language][selected] : '';
  }

  lessonTypes.forEach((input) => input.addEventListener('change', updatePriceHint));
  document.querySelectorAll('.lang-button').forEach((button) => {
    button.addEventListener('click', () => queueMicrotask(updatePriceHint));
  });

  form.addEventListener('reset', () => {
    queueMicrotask(() => {
      submissionKey.value = crypto.randomUUID();
      updatePriceHint();
    });
  });

  fetch('/api/customer/session', { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((result) => {
      const profile = result?.authenticated ? result.customer?.profile : null;
      if (!profile) return;
      if (profile.parentName && !parentName.value) parentName.value = profile.parentName;
      if (profile.phone && !phone.value) phone.value = profile.phone;
    })
    .catch(() => {});

  window.KostanyanApplications = Object.freeze({ formSubmissionOwner: 'script.js' });
})();
