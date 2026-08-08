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
  'catalog.matchedSynonym': 'Совпало по синониму {name}',
  'catalog.matchedCultivar': 'Совпало по культивару {name}',
  'catalog.backToCatalog': 'Назад в каталог',
  'catalog.profileTitle': 'Что известно об этом растении',
  'catalog.profileDescription':
    'Факты из указанных источников и сведения, проверенные садоводом; доказательство показано рядом с каждым значением.',
  'catalog.profileLoading': 'Загружается то, что известно об этом растении.',
  'catalog.profileMissing':
    'Об этом растении пока ничего не собрано. Это отсутствие данных, а не ошибка.',
  'catalog.profileNoFactsTitle': 'Подключённые источники не вернули садоводческих сведений',
  'catalog.profileNoFacts':
    'Ботаническая идентификация и эталонные фотографии доступны, но подключённые источники не сообщили дополнительных сведений об этом таксоне.',
  'catalog.profileAssembled': 'Собрано {date}',
  'catalog.profilePartialTitle': 'Неполный профиль',
  'catalog.profilePartial':
    'Профиль неполон: хотя бы одно свойство, которое описывают источники, не удалось подтвердить проверенным утверждением.',
  'catalog.factProvider': 'Источник: {provider}',
  'catalog.sourcesTitle': 'Источники',
  'catalog.factSourceBacked': 'Подтверждено источником · не проверено садоводом',
  'catalog.factReviewed': 'Проверено садоводом',
  'catalog.factScope': 'Относится к: {scope}',
  'catalog.imageAlt': 'Эталонная фотография этого растения',
  'catalog.imageAltOrgan': 'Эталонная фотография этого растения: {organ}',
  'catalog.imageCredit': 'Фотография: {holder}',
  'catalog.imageOpenFullscreen': 'Открыть эталонное фото {number} на весь экран',
  'catalog.imageCloseFullscreen': 'Закрыть полноэкранную фотографию',
  'catalog.imagePrevious': 'Предыдущее фото',
  'catalog.imageNext': 'Следующее фото',
  'catalog.taxonomyLabel': 'Ботаническая идентификация',
  'catalog.familyLabel': 'Семейство',
  'catalog.genusLabel': 'Род',
  'catalog.varietyLabel': 'Разновидность',
  'catalog.taxonomySourceLabel': 'Источник каталога',
  'catalog.factHardinessMinimum': 'Минимальная зона морозостойкости',
  'catalog.factHardinessMaximum': 'Максимальная зона морозостойкости',
  'catalog.factSunExposure': 'Освещение',
  'catalog.factWaterNeeds': 'Потребность в воде',
  'catalog.factSoilType': 'Предпочтительная почва',
  'catalog.factSoilPhMinimum': 'Минимальный pH почвы',
  'catalog.factSoilPhMaximum': 'Максимальный pH почвы',
  'catalog.factDrainage': 'Дренаж',
  'catalog.factMatureHeight': 'Высота взрослого растения',
  'catalog.factMatureSpread': 'Ширина взрослого растения',
  'catalog.factGrowthHabit': 'Форма роста',
  'catalog.factLifeCycle': 'Жизненный цикл',
  'catalog.factBloomTime': 'Период цветения',
  'catalog.factHarvestTime': 'Период сбора урожая',
  'catalog.factPruning': 'Обрезка',
  'catalog.factPropagation': 'Размножение',
  'catalog.factWildlifeValue': 'Ценность для живой природы',
  'catalog.factToxicity': 'Токсичность',
  'catalog.factEdibility': 'Съедобность',
  'catalog.factInterestingFact': 'Интересный факт',
};
