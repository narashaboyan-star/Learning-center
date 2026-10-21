const SERVICES = [
  { key: 'trial-lesson', kind: 'service', order: 10, names: { ru: 'Пробное занятие', hy: 'Փորձնական դաս', en: 'Trial lesson' } },
  { key: 'individual', kind: 'lesson_type', order: 20, names: { ru: 'Индивидуальное', hy: 'Անհատական', en: 'Individual' } },
  { key: 'group', kind: 'lesson_type', order: 30, names: { ru: 'Групповое', hy: 'Խմբային', en: 'Group' } },
  { key: 'online', kind: 'mode', order: 40, names: { ru: 'Онлайн', hy: 'Առցանց', en: 'Online' } },
  { key: 'offline', kind: 'mode', order: 50, names: { ru: 'Офлайн', hy: 'Առկա', en: 'In person' } },
];

function seedServices(database) {
  const insertService = database.prepare(`
    INSERT INTO services (service_key, kind, sort_order) VALUES (?, ?, ?)
    ON CONFLICT(service_key) DO NOTHING
  `);
  const insertTranslation = database.prepare(`
    INSERT INTO service_translations (service_id, language, name, description) VALUES (?, ?, ?, '')
    ON CONFLICT(service_id, language) DO NOTHING
  `);
  for (const service of SERVICES) {
    insertService.run(service.key, service.kind, service.order);
    const row = database.prepare('SELECT id FROM services WHERE service_key = ?').get(service.key);
    for (const [language, name] of Object.entries(service.names)) insertTranslation.run(row.id, language, name);
  }
}

module.exports = { SERVICES, seedServices };
