const LANGUAGES = Object.freeze(['ru', 'hy', 'en']);
const SERVICE_KEYS = Object.freeze({
  service: ['trial-lesson'],
  lesson_type: ['individual', 'group'],
  mode: ['online', 'offline'],
});

function clean(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeApplication(input) {
  const application = {
    parentName: clean(input.parentName, 120),
    phone: clean(input.phone, 80),
    childName: clean(input.childName, 120),
    grade: clean(input.grade, 20),
    lessonType: clean(input.lessonType, 30),
    mode: clean(input.mode, 30),
    helpNeeded: clean(input.helpNeeded),
    language: clean(input.language, 10) || 'ru',
    submissionKey: clean(input.submissionKey, 80),
  };
  const required = ['parentName', 'phone', 'childName', 'grade', 'lessonType', 'mode'];
  if (required.some((field) => !application[field])) throw new Error('required_fields_missing');
  if (!/^0\d{8}$/.test(application.phone)) throw new Error('invalid_phone');
  if (!LANGUAGES.includes(application.language)) throw new Error('invalid_language');
  if (!SERVICE_KEYS.lesson_type.includes(application.lessonType)) throw new Error('invalid_lesson_type');
  if (!SERVICE_KEYS.mode.includes(application.mode)) throw new Error('invalid_mode');
  if (application.submissionKey && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(application.submissionKey)) {
    throw new Error('invalid_submission_key');
  }
  return application;
}

module.exports = { LANGUAGES, SERVICE_KEYS, clean, normalizeApplication };
