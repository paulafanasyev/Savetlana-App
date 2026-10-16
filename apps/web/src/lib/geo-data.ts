/**
 * Справочник географии: федеральные округа → регионы → города (+ метро Москвы и
 * Петербурга). Координаты центров городов приблизительные (до сотых градуса):
 * их хватает для точки на карте и прогноза погоды.
 *
 * Чистые данные без базы: отсюда берут и сид (prisma/geo-seed.ts), и
 * автозаполнение справочника на сайте, и карта выбора города.
 */

export interface CitySeed {
  name: string;
  population?: number;
  hasMetro?: boolean;
  metro?: Record<string, string[]>;
  lat: number;
  lon: number;
}

export interface RegionSeed {
  name: string;
  type: string;
  cities: CitySeed[];
}

export interface DistrictSeed {
  name: string;
  regions: RegionSeed[];
}

const MOSCOW_METRO: Record<string, string[]> = {
  "Сокольническая линия": [
    "Бульвар Рокоссовского", "Черкизовская", "Преображенская площадь",
    "Сокольники", "Красносельская", "Комсомольская",
    "Чистые пруды", "Лубянка", "Охотный ряд", "Парк культуры",
  ],
  "Кольцевая линия": [
    "Парк культуры", "Октябрьская", "Добрынинская", "Павелецкая",
    "Таганская", "Курская", "Комсомольская", "Проспект Мира",
    "Новослободская", "Белорусская", "Краснопресненская", "Киевская",
  ],
  "Замоскворецкая линия": [
    "Ховрино", "Речной вокзал", "Водный стадион", "Войковская",
    "Сокол", "Аэропорт", "Динамо", "Белорусская", "Маяковская",
    "Тверская", "Театральная", "Новокузнецкая", "Павелецкая",
    "Автозаводская", "Технопарк", "Коломенская", "Каширская",
  ],
  "Арбатско-Покровская линия": [
    "Пятницкое шоссе", "Митино", "Волоколамская", "Мякинино",
    "Строгино", "Крылатское", "Молодёжная", "Кунцевская",
    "Славянский бульвар", "Парк Победы", "Киевская", "Смоленская",
    "Арбатская", "Площадь Революции", "Курская", "Бауманская",
    "Электрозаводская", "Семёновская", "Партизанская", "Измайловская",
  ],
};

const SPB_METRO: Record<string, string[]> = {
  "Кировско-Выборгская линия": [
    "Девяткино", "Гражданский проспект", "Академическая", "Политехническая",
    "Площадь Мужества", "Лесная", "Выборгская", "Площадь Ленина",
    "Чернышевская", "Площадь Восстания", "Владимирская", "Пушкинская",
    "Технологический институт", "Балтийская", "Нарвская", "Кировский завод",
    "Автово", "Ленинский проспект", "Проспект Ветеранов",
  ],
  "Московско-Петроградская линия": [
    "Парнас", "Проспект Просвещения", "Озерки", "Удельная", "Пионерская",
    "Чёрная речка", "Петроградская", "Горьковская", "Невский проспект",
    "Сенная площадь", "Технологический институт", "Фрунзенская",
    "Московские ворота", "Электросила", "Парк Победы", "Московская",
    "Звёздная", "Купчино",
  ],
};

export const DISTRICTS: DistrictSeed[] = [
  {
    name: "Центральный федеральный округ",
    regions: [
      { name: "Москва", type: "город федерального значения", cities: [{ name: "Москва", population: 13_195_000, hasMetro: true, metro: MOSCOW_METRO, lat: 55.76, lon: 37.62 }] },
      {
        name: "Московская область", type: "область",
        cities: [
          { name: "Подольск", population: 309_000, lat: 55.43, lon: 37.54 },
          { name: "Химки", population: 259_000, lat: 55.89, lon: 37.43 },
          { name: "Королёв", population: 224_000, lat: 55.92, lon: 37.82 },
          { name: "Мытищи", population: 220_000, lat: 55.91, lon: 37.73 },
          { name: "Люберцы", population: 205_000, lat: 55.68, lon: 37.89 },
          { name: "Красногорск", population: 187_000, lat: 55.82, lon: 37.33 },
          { name: "Электросталь", population: 156_000, lat: 55.79, lon: 38.44 },
          { name: "Коломна", population: 140_000, lat: 55.10, lon: 38.77 },
          { name: "Одинцово", population: 180_000, lat: 55.68, lon: 37.28 },
          { name: "Серпухов", population: 124_000, lat: 54.92, lon: 37.41 },
        ],
      },
      { name: "Санкт-Петербург", type: "город федерального значения", cities: [{ name: "Санкт-Петербург", population: 5_384_000, hasMetro: true, metro: SPB_METRO, lat: 59.94, lon: 30.31 }] },
      {
        name: "Ленинградская область", type: "область",
        cities: [
          { name: "Гатчина", population: 95_000, lat: 59.57, lon: 30.13 },
          { name: "Выборг", population: 72_000, lat: 60.71, lon: 28.75 },
          { name: "Сосновый Бор", population: 67_000, lat: 59.90, lon: 29.09 },
          { name: "Волхов", population: 42_000, lat: 59.92, lon: 32.34 },
        ],
      },
      {
        name: "Воронежская область", type: "область",
        cities: [
          { name: "Воронеж", population: 1_057_000, lat: 51.67, lon: 39.18 },
          { name: "Борисоглебск", population: 61_000, lat: 51.37, lon: 42.08 },
          { name: "Россошь", population: 62_000, lat: 50.20, lon: 39.57 },
        ],
      },
      { name: "Ярославская область", type: "область", cities: [{ name: "Ярославль", population: 577_000, lat: 57.63, lon: 39.87 }, { name: "Рыбинск", population: 168_000, lat: 58.05, lon: 38.83 }] },
      { name: "Тверская область", type: "область", cities: [{ name: "Тверь", population: 424_000, lat: 56.86, lon: 35.90 }] },
      { name: "Смоленская область", type: "область", cities: [{ name: "Смоленск", population: 316_000, lat: 54.78, lon: 32.05 }] },
      { name: "Тульская область", type: "область", cities: [{ name: "Тула", population: 473_000, lat: 54.19, lon: 37.62 }, { name: "Новомосковск", population: 122_000, lat: 54.01, lon: 38.29 }] },
      { name: "Калужская область", type: "область", cities: [{ name: "Калуга", population: 332_000, lat: 54.51, lon: 36.26 }, { name: "Обнинск", population: 117_000, lat: 55.10, lon: 36.61 }] },
    ],
  },
  {
    name: "Северо-Западный федеральный округ",
    regions: [
      { name: "Республика Карелия", type: "республика", cities: [{ name: "Петрозаводск", population: 280_000, lat: 61.79, lon: 34.36 }] },
      { name: "Республика Коми", type: "республика", cities: [{ name: "Сыктывкар", population: 220_000, lat: 61.67, lon: 50.84 }, { name: "Ухта", population: 97_000, lat: 63.56, lon: 53.70 }] },
      { name: "Архангельская область", type: "область", cities: [{ name: "Архангельск", population: 301_000, lat: 64.54, lon: 40.54 }, { name: "Северодвинск", population: 180_000, lat: 64.56, lon: 39.83 }] },
      { name: "Мурманская область", type: "область", cities: [{ name: "Мурманск", population: 270_000, lat: 68.97, lon: 33.07 }, { name: "Апатиты", population: 55_000, lat: 67.57, lon: 33.40 }] },
      { name: "Вологодская область", type: "область", cities: [{ name: "Вологда", population: 313_000, lat: 59.22, lon: 39.89 }, { name: "Череповец", population: 315_000, lat: 59.13, lon: 37.91 }] },
      { name: "Калининградская область", type: "область", cities: [{ name: "Калининград", population: 490_000, lat: 54.71, lon: 20.51 }] },
      { name: "Ненецкий автономный округ", type: "АО", cities: [{ name: "Нарьян-Мар", population: 26_000, lat: 67.64, lon: 53.01 }] },
    ],
  },
  {
    name: "Южный федеральный округ",
    regions: [
      {
        name: "Ростовская область", type: "область",
        cities: [
          { name: "Ростов-на-Дону", population: 1_142_000, lat: 47.23, lon: 39.72 },
          { name: "Таганрог", population: 245_000, lat: 47.21, lon: 38.94 },
          { name: "Шахты", population: 226_000, lat: 47.71, lon: 40.21 },
          { name: "Волгодонск", population: 167_000, lat: 47.51, lon: 42.15 },
          { name: "Новочеркасск", population: 166_000, lat: 47.42, lon: 40.09 },
        ],
      },
      {
        name: "Краснодарский край", type: "край",
        cities: [
          { name: "Краснодар", population: 1_099_000, lat: 45.04, lon: 38.98 },
          { name: "Сочи", population: 443_000, lat: 43.59, lon: 39.73 },
          { name: "Новороссийск", population: 275_000, lat: 44.72, lon: 37.77 },
          { name: "Армавир", population: 189_000, lat: 45.00, lon: 41.12 },
          { name: "Анапа", population: 93_000, lat: 44.89, lon: 37.32 },
          { name: "Геленджик", population: 78_000, lat: 44.56, lon: 38.08 },
        ],
      },
      {
        name: "Волгоградская область", type: "область",
        cities: [
          { name: "Волгоград", population: 1_005_000, lat: 48.71, lon: 44.51 },
          { name: "Волжский", population: 320_000, lat: 48.79, lon: 44.75 },
          { name: "Камышин", population: 111_000, lat: 50.08, lon: 45.41 },
        ],
      },
      { name: "Астраханская область", type: "область", cities: [{ name: "Астрахань", population: 475_000, lat: 46.35, lon: 48.04 }] },
      { name: "Республика Дагестан", type: "республика", cities: [{ name: "Махачкала", population: 623_000, lat: 42.98, lon: 47.50 }, { name: "Дербент", population: 126_000, lat: 42.06, lon: 48.29 }] },
      { name: "Республика Адыгея", type: "республика", cities: [{ name: "Майкоп", population: 144_000, lat: 44.61, lon: 40.10 }] },
      {
        name: "Республика Крым", type: "республика",
        cities: [
          { name: "Севастополь", population: 547_000, lat: 44.62, lon: 33.53 },
          { name: "Симферополь", population: 332_000, lat: 44.95, lon: 34.10 },
          { name: "Керчь", population: 155_000, lat: 45.36, lon: 36.47 },
          { name: "Евпатория", population: 105_000, lat: 45.19, lon: 33.37 },
          { name: "Феодосия", population: 68_000, lat: 45.03, lon: 35.38 },
          { name: "Ялта", population: 78_000, lat: 44.50, lon: 34.17 },
        ],
      },
    ],
  },
  {
    name: "Северо-Кавказский федеральный округ",
    regions: [
      {
        name: "Ставропольский край", type: "край",
        cities: [
          { name: "Ставрополь", population: 547_000, lat: 45.04, lon: 41.97 },
          { name: "Пятигорск", population: 146_000, lat: 44.05, lon: 43.06 },
          { name: "Невинномысск", population: 116_000, lat: 44.63, lon: 41.94 },
          { name: "Кисловодск", population: 127_000, lat: 43.91, lon: 42.72 },
        ],
      },
      { name: "Чеченская Республика", type: "республика", cities: [{ name: "Грозный", population: 328_000, lat: 43.32, lon: 45.69 }] },
      { name: "Республика Ингушетия", type: "республика", cities: [{ name: "Магас", population: 13_000, lat: 43.17, lon: 44.81 }, { name: "Назрань", population: 122_000, lat: 43.23, lon: 44.77 }] },
      { name: "Республика Северная Осетия — Алания", type: "республика", cities: [{ name: "Владикавказ", population: 295_000, lat: 43.02, lon: 44.68 }] },
      { name: "Кабардино-Балкарская Республика", type: "республика", cities: [{ name: "Нальчик", population: 240_000, lat: 43.49, lon: 43.62 }] },
    ],
  },
  {
    name: "Приволжский федеральный округ",
    regions: [
      {
        name: "Республика Татарстан", type: "республика",
        cities: [
          { name: "Казань", population: 1_314_000, lat: 55.79, lon: 49.12 },
          { name: "Набережные Челны", population: 548_000, lat: 55.74, lon: 52.40 },
          { name: "Нижнекамск", population: 243_000, lat: 55.64, lon: 51.82 },
          { name: "Альметьевск", population: 157_000, lat: 54.90, lon: 52.30 },
        ],
      },
      {
        name: "Республика Башкортостан", type: "республика",
        cities: [
          { name: "Уфа", population: 1_144_000, lat: 54.74, lon: 55.97 },
          { name: "Стерлитамак", population: 272_000, lat: 53.63, lon: 55.95 },
          { name: "Салават", population: 148_000, lat: 53.36, lon: 55.92 },
          { name: "Нефтекамск", population: 148_000, lat: 56.09, lon: 54.25 },
        ],
      },
      {
        name: "Нижегородская область", type: "область",
        cities: [
          { name: "Нижний Новгород", population: 1_222_000, lat: 56.33, lon: 44.00 },
          { name: "Дзержинск", population: 230_000, lat: 56.24, lon: 43.46 },
          { name: "Арзамас", population: 103_000, lat: 55.39, lon: 43.84 },
        ],
      },
      {
        name: "Самарская область", type: "область",
        cities: [
          { name: "Самара", population: 1_144_000, lat: 53.20, lon: 50.15 },
          { name: "Тольятти", population: 684_000, lat: 53.51, lon: 49.42 },
          { name: "Сызрань", population: 160_000, lat: 53.16, lon: 48.47 },
          { name: "Новокуйбышевск", population: 100_000, lat: 53.10, lon: 49.95 },
        ],
      },
      {
        name: "Пермский край", type: "край",
        cities: [
          { name: "Пермь", population: 1_034_000, lat: 58.01, lon: 56.25 },
          { name: "Березники", population: 145_000, lat: 59.41, lon: 56.82 },
          { name: "Соликамск", population: 91_000, lat: 59.65, lon: 56.78 },
        ],
      },
      { name: "Удмуртская Республика", type: "республика", cities: [{ name: "Ижевск", population: 631_000, lat: 56.85, lon: 53.20 }] },
      { name: "Чувашская Республика", type: "республика", cities: [{ name: "Чебоксары", population: 496_000, lat: 56.13, lon: 47.25 }] },
      { name: "Республика Мордовия", type: "республика", cities: [{ name: "Саранск", population: 314_000, lat: 54.19, lon: 45.18 }] },
      { name: "Кировская область", type: "область", cities: [{ name: "Киров", population: 468_000, lat: 58.60, lon: 49.66 }] },
      { name: "Оренбургская область", type: "область", cities: [{ name: "Оренбург", population: 543_000, lat: 51.77, lon: 55.10 }, { name: "Орск", population: 220_000, lat: 51.23, lon: 58.47 }] },
      { name: "Пензенская область", type: "область", cities: [{ name: "Пенза", population: 501_000, lat: 53.20, lon: 45.02 }] },
      { name: "Саратовская область", type: "область", cities: [{ name: "Саратов", population: 902_000, lat: 51.53, lon: 46.03 }, { name: "Энгельс", population: 225_000, lat: 51.50, lon: 46.12 }] },
      { name: "Ульяновская область", type: "область", cities: [{ name: "Ульяновск", population: 617_000, lat: 54.32, lon: 48.40 }] },
    ],
  },
  {
    name: "Уральский федеральный округ",
    regions: [
      {
        name: "Свердловская область", type: "область",
        cities: [
          { name: "Екатеринбург", population: 1_493_000, lat: 56.84, lon: 60.61 },
          { name: "Нижний Тагил", population: 335_000, lat: 57.91, lon: 59.97 },
          { name: "Каменск-Уральский", population: 163_000, lat: 56.41, lon: 61.92 },
        ],
      },
      {
        name: "Челябинская область", type: "область",
        cities: [
          { name: "Челябинск", population: 1_186_000, lat: 55.16, lon: 61.40 },
          { name: "Магнитогорск", population: 416_000, lat: 53.41, lon: 59.05 },
          { name: "Златоуст", population: 161_000, lat: 55.17, lon: 59.65 },
          { name: "Миасс", population: 148_000, lat: 55.05, lon: 60.11 },
        ],
      },
      { name: "Тюменская область", type: "область", cities: [{ name: "Тюмень", population: 847_000, lat: 57.15, lon: 65.53 }, { name: "Ишим", population: 65_000, lat: 56.11, lon: 69.49 }] },
      {
        name: "Ханты-Мансийский автономный округ — Югра", type: "АО",
        cities: [
          { name: "Сургут", population: 396_000, lat: 61.25, lon: 73.40 },
          { name: "Нижневартовск", population: 282_000, lat: 60.94, lon: 76.57 },
          { name: "Нефтеюганск", population: 126_000, lat: 61.10, lon: 72.60 },
        ],
      },
      { name: "Ямало-Ненецкий автономный округ", type: "АО", cities: [{ name: "Новый Уренгой", population: 118_000, lat: 66.08, lon: 76.63 }, { name: "Ноябрьск", population: 110_000, lat: 63.20, lon: 75.45 }] },
      { name: "Курганская область", type: "область", cities: [{ name: "Курган", population: 310_000, lat: 55.44, lon: 65.34 }] },
    ],
  },
  {
    name: "Сибирский федеральный округ",
    regions: [
      { name: "Новосибирская область", type: "область", cities: [{ name: "Новосибирск", population: 1_634_000, lat: 55.03, lon: 82.92 }, { name: "Бердск", population: 103_000, lat: 54.76, lon: 83.10 }] },
      { name: "Красноярский край", type: "край", cities: [{ name: "Красноярск", population: 1_095_000, lat: 56.01, lon: 92.87 }, { name: "Железногорск", population: 82_000, lat: 56.25, lon: 93.53 }] },
      { name: "Иркутская область", type: "область", cities: [{ name: "Иркутск", population: 617_000, lat: 52.29, lon: 104.28 }, { name: "Ангарск", population: 226_000, lat: 52.54, lon: 103.89 }] },
      {
        name: "Кемеровская область — Кузбасс", type: "область",
        cities: [
          { name: "Кемерово", population: 557_000, lat: 55.35, lon: 86.09 },
          { name: "Новокузнецк", population: 537_000, lat: 53.76, lon: 87.14 },
          { name: "Прокопьевск", population: 177_000, lat: 53.89, lon: 86.75 },
        ],
      },
      { name: "Омская область", type: "область", cities: [{ name: "Омск", population: 1_125_000, lat: 54.99, lon: 73.37 }] },
      { name: "Томская область", type: "область", cities: [{ name: "Томск", population: 570_000, lat: 56.48, lon: 84.95 }] },
      { name: "Алтайский край", type: "край", cities: [{ name: "Барнаул", population: 631_000, lat: 53.35, lon: 83.78 }, { name: "Бийск", population: 183_000, lat: 52.54, lon: 85.21 }] },
      { name: "Республика Хакасия", type: "республика", cities: [{ name: "Абакан", population: 187_000, lat: 53.72, lon: 91.44 }] },
      { name: "Республика Тыва", type: "республика", cities: [{ name: "Кызыл", population: 120_000, lat: 51.72, lon: 94.45 }] },
      { name: "Республика Бурятия", type: "республика", cities: [{ name: "Улан-Удэ", population: 437_000, lat: 51.83, lon: 107.58 }] },
      { name: "Забайкальский край", type: "край", cities: [{ name: "Чита", population: 335_000, lat: 52.03, lon: 113.50 }] },
    ],
  },
  {
    name: "Дальневосточный федеральный округ",
    regions: [
      { name: "Приморский край", type: "край", cities: [{ name: "Владивосток", population: 597_000, lat: 43.12, lon: 131.89 }, { name: "Уссурийск", population: 173_000, lat: 43.80, lon: 131.95 }] },
      { name: "Хабаровский край", type: "край", cities: [{ name: "Хабаровск", population: 613_000, lat: 48.48, lon: 135.08 }, { name: "Комсомольск-на-Амуре", population: 243_000, lat: 50.55, lon: 137.01 }] },
      { name: "Амурская область", type: "область", cities: [{ name: "Благовещенск", population: 241_000, lat: 50.29, lon: 127.53 }] },
      { name: "Республика Саха (Якутия)", type: "республика", cities: [{ name: "Якутск", population: 355_000, lat: 62.03, lon: 129.73 }] },
      { name: "Камчатский край", type: "край", cities: [{ name: "Петропавловск-Камчатский", population: 180_000, lat: 53.02, lon: 158.65 }] },
      { name: "Магаданская область", type: "область", cities: [{ name: "Магадан", population: 92_000, lat: 59.57, lon: 150.80 }] },
      { name: "Сахалинская область", type: "область", cities: [{ name: "Южно-Сахалинск", population: 200_000, lat: 46.96, lon: 142.73 }] },
      { name: "Чукотский автономный округ", type: "АО", cities: [{ name: "Анадырь", population: 15_000, lat: 64.73, lon: 177.51 }] },
    ],
  },
];

export interface FlatCity {
  name: string;
  regionName: string;
  population: number;
  lat: number;
  lon: number;
}

/** Все города одним списком, крупные первыми. */
export function allCities(): FlatCity[] {
  return DISTRICTS.flatMap((d) => d.regions.flatMap((r) => r.cities.map((c) => ({ name: c.name, regionName: r.name, population: c.population ?? 0, lat: c.lat, lon: c.lon }))))
    .sort((a, b) => b.population - a.population);
}

/** Координаты города по названию (без учёта регистра и «ё»). */
export function cityCoords(name: string): { lat: number; lon: number } | null {
  const key = normalizeCityName(name);
  const found = allCities().find((c) => normalizeCityName(c.name) === key);
  return found ? { lat: found.lat, lon: found.lon } : null;
}

export function normalizeCityName(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}
