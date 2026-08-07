import type { englishWeatherMessages } from './en-weather';

/**
 * Russian messages for the garden weather panel.
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianWeatherMessages: Readonly<Record<keyof typeof englishWeatherMessages, string>> =
  {
    'weather.title': 'Условия',
    'weather.loading': 'Загрузка погоды.',
    'weather.retry': 'Повторить',

    'weather.observationLabel': 'Сейчас',
    'weather.forecastLabel': 'Прогноз',
    'weather.forecastFor': 'На {time}',
    'weather.measuredAt': 'Измерено {time}',

    'weather.temperature': 'Температура',
    'weather.precipitation': 'Осадки',
    'weather.wind': 'Ветер',
    'weather.humidity': 'Влажность',
    'weather.temperatureValue': '{value} °C',
    'weather.precipitationValue': '{value} мм',
    'weather.windValue': '{value} м/с',
    'weather.humidityValue': '{value}%',
    'weather.measurementMissing': 'Нет данных',

    'weather.stale': 'Устарело',
    'weather.staleExplanation':
      'Это самое свежее измерение для этого сада, но оно старше окна обновления. Рекомендации по погоде используют его с пониженной уверенностью, а предупреждения о заморозках не выдаются вовсе.',

    'weather.unavailableTitle': 'Для этого сада ещё нет погоды',
    'weather.reasonNoProvider':
      'В этой среде не включён поставщик погоды, поэтому данные не приходят ни в один сад. От вас ничего не требуется.',
    'weather.reasonNotGeoreferenced':
      'У сада ещё нет местоположения, а запрос погоды состоит именно из координат. Укажите местоположение в настройках сада — данные появятся при следующем обновлении.',
    'weather.reasonNotYetFetched':
      'Плановое обновление ещё не дошло до этого сада. Данные появятся сами в ближайшее время.',
    'weather.setLocation': 'Указать местоположение',

    'weather.ruleImpactTitle': 'На что это влияет',
    'weather.ruleImpactWithWeather':
      'Из этих измерений формируются проверки полива и предупреждения о заморозках.',
    'weather.ruleImpactWithoutWeather':
      'Без измерений проверки полива и предупреждения о заморозках не формируются. На остальные рекомендации это не влияет.',
  };
