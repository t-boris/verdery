import type { englishAerialTraceMessages } from './en-aerial-trace';

export const russianAerialTraceMessages: Record<keyof typeof englishAerialTraceMessages, string> = {
  'map.aerialTrace.title': 'Трассировать этот аэроснимок',
  'map.aerialTrace.description':
    'Ограничивает снимок вокруг сохранённого адреса, выделяет участок с этой точкой и предлагает видимые объекты для проверки.',
  'map.aerialTrace.legalWarning':
    'Трассировка по аэроснимку приблизительна и не устанавливает юридическую границу участка.',
  'map.aerialTrace.action': 'Трассировать аэроснимок',
  'map.aerialTrace.running': 'Ищем этот участок…',
  'map.aerialTrace.needsLocation': 'Перед трассировкой сохраните точный адрес.',
  'map.aerialTrace.disabled': 'Трассировка по аэроснимку не настроена в этом окружении.',
  'map.aerialTrace.outsideCoverage': 'Для этого места нет поддерживаемой аэрофотосъёмки.',
  'map.aerialTrace.unusableImagery':
    'Точности снимка или привязки недостаточно для безопасной трассировки.',
  'map.aerialTrace.quotaExceeded': 'Лимит трассировки исчерпан. Повторите позже.',
  'map.aerialTrace.timedOut': 'Сервис снимков или распознавания не ответил вовремя.',
  'map.aerialTrace.providerFailure': 'Сервис снимков или распознавания не завершил трассировку.',
  'map.aerialTrace.noVisibleGeometry':
    'Целевой участок не удалось отделить от соседних либо объекты видны недостаточно хорошо.',
  'map.aerialTrace.dateUnknown': 'дата снимка не указана',
  'map.aerialTrace.editHint':
    'Выберите предложение: его можно двигать и менять вершины на снимке. Категории остаются совместимыми с геометрией.',
  'map.aerialTrace.label': 'Название',
  'map.aerialTrace.category': 'Категория',
  'map.aerialTrace.reject': 'Отклонить предложение',
  'map.aerialTrace.reviewOnly':
    'Это временные предложения. Каноническое принятие появится после включения хранилища предложений с сохранением происхождения.',
};
