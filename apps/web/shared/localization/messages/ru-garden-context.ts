import type { englishGardenContextMessages } from './en-garden-context';

/**
 * Russian messages for the Context quality section (P9D-UX-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `ru-today.ts` gives itself.
 */
export const russianGardenContextMessages: Readonly<
  Record<keyof typeof englishGardenContextMessages, string>
> = {
  'contextQuality.title': 'Качество данных о среде',
  'contextQuality.description':
    'Заявленные факты об условиях выращивания в этом саду и насколько каждому из них можно доверять.',
  'contextQuality.loading': 'Загрузка данных о среде сада.',
  'contextQuality.retry': 'Повторить',

  'contextQuality.notDeclared': 'Пока не заявлено',
  'contextQuality.recordedByDisplay': 'Заявлено пользователем {profileId}',
  'contextQuality.reviewedByDisplay': 'Проверено: {reviewedBy}, {reviewedOn}',

  'contextQuality.edit': 'Изменить',
  'contextQuality.declare': 'Заявить',
  'contextQuality.cancelEdit': 'Отмена',
  'contextQuality.save': 'Сохранить',
  'contextQuality.valueLabel': 'Значение',
  'contextQuality.valueRequired': 'Введите значение.',

  'contextQuality.kind.sunExposure': 'Освещённость',
  'contextQuality.kind.soilType': 'Тип почвы',
  'contextQuality.kind.drainage': 'Дренаж',
  'contextQuality.kind.irrigationMethod': 'Способ полива',
  'contextQuality.kind.growingContext': 'Условия выращивания',
  'contextQuality.kind.microclimate': 'Микроклимат',

  'contextQuality.source.userDeclared': 'Заявлено участником',
  'contextQuality.source.horticulturallyReviewedDefault':
    'Проверенное агрономом значение по умолчанию',
  'contextQuality.source.imported': 'Импортировано',

  'contextQuality.enum.sunExposure.fullSun': 'Полное солнце',
  'contextQuality.enum.sunExposure.partialSun': 'Переменное солнце',
  'contextQuality.enum.sunExposure.partialShade': 'Полутень',
  'contextQuality.enum.sunExposure.fullShade': 'Полная тень',

  'contextQuality.enum.drainage.wellDrained': 'Хороший дренаж',
  'contextQuality.enum.drainage.poorDrainage': 'Плохой дренаж',
  'contextQuality.enum.drainage.waterlogged': 'Застой воды',

  'contextQuality.enum.irrigationMethod.manual': 'Ручной полив',
  'contextQuality.enum.irrigationMethod.drip': 'Капельный полив',
  'contextQuality.enum.irrigationMethod.sprinkler': 'Дождевание',
  'contextQuality.enum.irrigationMethod.none': 'Нет полива',

  'contextQuality.enum.growingContext.openGround': 'Открытый грунт',
  'contextQuality.enum.growingContext.container': 'Контейнер',
  'contextQuality.enum.growingContext.greenhouse': 'Теплица',
};
