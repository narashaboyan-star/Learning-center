const form = document.querySelector('#login-form');
const message = document.querySelector('#login-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (response.ok) window.location.assign('/admin/');
  else message.textContent = 'Не удалось войти. Проверьте email и пароль.';
});
