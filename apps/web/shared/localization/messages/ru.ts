import type { MessageCatalogue } from '../catalogue';

/** Russian message catalogue. Typed against the English catalogue, so it cannot be incomplete. */
export const russianMessages: MessageCatalogue = {
  'app.name': 'Verdery',
  'app.tagline': 'Живая карта настоящего сада.',
  'app.skipToContent': 'Перейти к содержимому',

  'home.title': 'Веб-приложение Verdery',
  'home.description':
    'Это каркас приложения. Работа с картой сада и уходом появится на следующих этапах.',
  'home.openStatus': 'Открыть состояние сервиса',

  'status.title': 'Состояние сервиса',
  'status.description': 'Текущие результаты проверок работоспособности API Verdery.',
  'status.refresh': 'Проверить снова',
  'status.checking': 'Идёт проверка API.',
  'status.liveness': 'Живость',
  'status.readiness': 'Готовность',
  'status.version': 'Версия {version}',
  'status.stateAlive': 'Процесс работает',
  'status.stateReady': 'Готов обслуживать запросы',
  'status.stateNotReady': 'Не готов обслуживать запросы',
  'status.dependencies': 'Зависимости',
  'status.dependencyAvailable': 'Доступна',
  'status.dependencyUnavailable': 'Недоступна',
  'status.dependenciesEmpty': 'Сервис не сообщил ни одной зависимости.',
  'status.announcementLoading': 'Идёт проверка состояния сервиса.',
  'status.announcementLoaded': 'Состояние сервиса обновлено.',

  'notFound.title': 'Страница не найдена',
  'notFound.description': 'Открытый адрес не соответствует ни одной странице этого приложения.',
  'notFound.backHome': 'Вернуться на начальную страницу',

  'errorBoundary.title': 'Что-то пошло не так',
  'errorBoundary.description':
    'Эту часть приложения не удалось отобразить. Можно повторить попытку, не теряя остальную сессию.',
  'errorBoundary.retry': 'Повторить',
  'errorBoundary.reference': 'Код для поддержки: {reference}',

  'error.title': 'Запрос не выполнен',
  'error.correlation': 'Код для поддержки: {correlationId}',
  'error.requestInvalid': 'Запрос отклонён, потому что не соответствует контракту API.',
  'error.requestTooLarge': 'Запрос превысил допустимый для API размер.',
  'error.idempotencyKeyReused': 'Этот запрос уже использовался для другой команды.',
  'error.unauthenticated': 'Вы не вошли в систему или сессия истекла.',
  'error.forbidden': 'У этой учётной записи нет прав на это действие.',
  'error.staleRevision': 'Запись изменилась до того, как правка была сохранена.',
  'error.rateLimited': 'Отправлено слишком много запросов. Подождите и попробуйте снова.',
  'error.internal': 'Сервис завершился с непредвиденной ошибкой.',
  'error.dependencyUnavailable': 'Сервис, от которого зависит API, временно недоступен.',
  'error.transportFailure': 'Из этого браузера не удалось связаться с API.',
  'error.malformedResponse': 'API вернул ответ, который приложение не может интерпретировать.',
  'error.unknown': 'Запрос не выполнен по нераспознанной причине.',
};
