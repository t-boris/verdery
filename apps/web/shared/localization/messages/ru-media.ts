import type { englishMediaMessages } from './en-media';

/**
 * Russian messages for media upload, preview, and the garden property plan
 * upload flow.
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary (`ru-collaboration.ts`
 * follows the identical pattern).
 */
export const russianMediaMessages: Readonly<Record<keyof typeof englishMediaMessages, string>> = {
  'media.selectFile': 'Выбрать фотографию',
  'media.chooseAction': 'Выбрать…',
  'media.noFileChosen': 'Файл не выбран',
  'media.tooLarge': 'Этот файл больше ограничения в {max}. Выберите файл меньшего размера.',
  'media.progressLabel': 'Загрузка {filename}: {uploaded} из {total}',
  'media.pause': 'Пауза',
  'media.resume': 'Возобновить загрузку',
  'media.retry': 'Повторить',
  'media.cancel': 'Отменить загрузку',
  'media.recoverableDescription':
    'Обнаружена прерванная загрузка: {filename}, уже отправлено {percent}%. Возобновите её или начните заново.',
  'media.resumeRecovered': 'Возобновить прерванную загрузку',
  'media.discardRecovered': 'Отклонить',
  'media.previewLoading': 'Загрузка предпросмотра.',
  'media.previewAlt': 'Загруженная фотография: {filename}',
  'media.previewOpenFullscreen': 'Открыть фотографию на весь экран',
  'media.previewCloseFullscreen': 'Закрыть полноэкранную фотографию',
  'media.previewPrevious': 'Предыдущая фотография',
  'media.previewNext': 'Следующая фотография',
  'media.rejectedDescription':
    'Этот файл не удалось подтвердить — то, что фактически было получено, не совпало с заявленным при начале загрузки. Выберите файл заново и повторите попытку.',
  'media.processingFailedDescription':
    'Файл был загружен и подтверждён, но не удалось его обработать. Попробуйте загрузить его снова.',

  'media.plan.title': 'План участка',
  'media.plan.description':
    'Загрузите план участка — скан, фотографию или PDF — чтобы использовать его как приватную подложку карты. До 50 МиБ.',
  'media.plan.selectFile': 'Выбрать документ плана',
  'media.plan.unsupportedType':
    'Этот тип файла не поддерживается. Выберите изображение JPEG, PNG, WebP, HEIC/HEIF или PDF.',
  'media.plan.previewUnavailable': 'Предпросмотр этого плана пока недоступен.',
  'media.plan.previewAlt': 'Предпросмотр плана: {filename}',
  'media.plan.readyForMap':
    'План загружен и проверен. Добавьте его на карту через панель «Подложки плана» в редакторе карты.',

  'media.phase.idle': '',
  'media.phase.recoverable': 'Обнаружена прерванная загрузка.',
  'media.phase.registering': 'Подготовка загрузки.',
  'media.phase.uploading': 'Идёт загрузка.',
  'media.phase.paused': 'Загрузка приостановлена.',
  'media.phase.completing': 'Завершение загрузки.',
  'media.phase.processing': 'Проверка и обработка загрузки. Это может занять некоторое время.',
  'media.phase.processed': 'Готово.',
  'media.phase.rejected': 'Этот файл был отклонён.',
  'media.phase.processingFailed': 'Обработка этого файла не удалась.',
  'media.phase.sessionExpired':
    'Сессия загрузки истекла до завершения. Повторите, чтобы начать заново.',
  'media.phase.uploadFailed': 'Загрузка не завершилась.',
  'media.phase.apiFailed': 'Запрос не выполнен.',

  'media.failureReason.networkError':
    'Загрузка была прервана из-за проблемы с сетью. Её можно повторить с того места, где она остановилась.',
  'media.failureReason.unexpectedStatus':
    'Облачное хранилище отклонило загрузку неожиданным ответом. Повтор начнёт новую сессию загрузки.',
};
