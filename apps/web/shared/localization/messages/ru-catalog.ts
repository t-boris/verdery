/**
 * Russian messages for the plant-catalog feature — mirrors `en-catalog.ts`.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const russianCatalogMessages = {
  'catalog.pageTitle': 'Каталог растений',
  'catalog.pageDescription':
    'Общие справочные знания о растениях, с указанием источника для каждого факта.',
  'catalog.searchLabel': 'Поиск по названию',
  'catalog.searchPlaceholder': 'Научное или обиходное название',
  'catalog.searchEmpty': 'Ни один таксон не подходит под это название.',
  'catalog.searchBounded':
    'Показаны первые {limit} совпадений. Уточните название, чтобы увидеть другие, — следующих страниц у этого поиска нет.',
  'catalog.backToCatalog': 'Назад в каталог',
  'catalog.profileTitle': 'Что известно об этом растении',
  'catalog.profileDescription':
    'Факты, собранные из проверенных внешних источников; у каждого указано происхождение.',
  'catalog.profileLoading': 'Загружается то, что известно об этом растении.',
  'catalog.profileMissing':
    'Об этом растении пока ничего не собрано. Это отсутствие данных, а не ошибка.',
  'catalog.profileNoFacts': 'В этом профиле нет ни одного проверенного факта.',
  'catalog.profileAssembled': 'Собрано {date}',
  'catalog.profilePartialTitle': 'Неполный профиль',
  'catalog.profilePartial':
    'Профиль неполон: хотя бы одно свойство, которое описывают источники, не удалось подтвердить проверенным утверждением.',
  'catalog.factProvider': 'Источник: {provider}',
  'catalog.factScope': 'Относится к: {scope}',
};
