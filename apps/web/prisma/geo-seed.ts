/**
 * Geography seed — Russian federal districts → regions → cities (+ Moscow / SPb
 * metro trees). Every classified must carry a real, filterable location, so the
 * geo tree must exist before any ad can be posted.
 *
 * Idempotent: upserts on the natural keys (names are @unique per parent).
 */
import { prisma } from "../src/lib/prisma";

interface CitySeed {
  name: string;
  population?: number;
  hasMetro?: boolean;
  metro?: Record<string, string[]>; // line name -> stations
}

interface RegionSeed {
  name: string;
  type: string;
  cities: CitySeed[];
}

interface DistrictSeed {
  name: string;
  regions: RegionSeed[];
}

const MOSCOW_METRO: Record<string, string[]> = {
  "Сокольническая линия": [
    "Бульвар Рокоссовского", "Черкизовская", "Преображенская площадь",
    "Сокольники", "Красносельская", "Комсомольская", "Красносельская",
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

const DISTRICTS: DistrictSeed[] = [
  {
    name: "Центральный федеральный округ",
    regions: [
      {
        name: "Москва", type: "город федерального значения",
        cities: [{ name: "Москва", population: 13_195_000, hasMetro: true, metro: MOSCOW_METRO }],
      },
      {
        name: "Московская область", type: "область",
        cities: [
          { name: "Подольск", population: 309_000 },
          { name: "Химки", population: 259_000 },
          { name: "Королёв", population: 224_000 },
          { name: "Мытищи", population: 220_000 },
          { name: "Люберцы", population: 205_000 },
          { name: "Красногорск", population: 187_000 },
          { name: "Электросталь", population: 156_000 },
          { name: "Коломна", population: 140_000 },
          { name: "Одинцово", population: 180_000 },
          { name: "Серпухов", population: 124_000 },
        ],
      },
      {
        name: "Санкт-Петербург", type: "город федерального значения",
        cities: [{ name: "Санкт-Петербург", population: 5_384_000, hasMetro: true, metro: SPB_METRO }],
      },
      {
        name: "Ленинградская область", type: "область",
        cities: [
          { name: "Гатчина", population: 95_000 },
          { name: "Выборг", population: 72_000 },
          { name: "Сосновый Бор", population: 67_000 },
          { name: "Волхов", population: 42_000 },
        ],
      },
      {
        name: "Воронежская область", type: "область",
        cities: [
          { name: "Воронеж", population: 1_057_000 },
          { name: "Борисоглебск", population: 61_000 },
          { name: "Россошь", population: 62_000 },
        ],
      },
      {
        name: "Ярославская область", type: "область",
        cities: [{ name: "Ярославль", population: 577_000 }, { name: "Рыбинск", population: 168_000 }],
      },
      {
        name: "Тверская область", type: "область",
        cities: [{ name: "Тверь", population: 424_000 }],
      },
      {
        name: "Смоленская область", type: "область",
        cities: [{ name: "Смоленск", population: 316_000 }],
      },
      {
        name: "Тульская область", type: "область",
        cities: [{ name: "Тула", population: 473_000 }, { name: "Новомосковск", population: 122_000 }],
      },
      {
        name: "Калужская область", type: "область",
        cities: [{ name: "Калуга", population: 332_000 }, { name: "Обнинск", population: 117_000 }],
      },
    ],
  },
  {
    name: "Северо-Западный федеральный округ",
    regions: [
      {
        name: "Республика Карелия", type: "республика",
        cities: [{ name: "Петрозаводск", population: 280_000 }],
      },
      {
        name: "Республика Коми", type: "республика",
        cities: [{ name: "Сыктывкар", population: 220_000 }, { name: "Ухта", population: 97_000 }],
      },
      {
        name: "Архангельская область", type: "область",
        cities: [{ name: "Архангельск", population: 301_000 }, { name: "Северодвинск", population: 180_000 }],
      },
      {
        name: "Мурманская область", type: "область",
        cities: [{ name: "Мурманск", population: 270_000 }, { name: "Апатиты", population: 55_000 }],
      },
      {
        name: "Вологодская область", type: "область",
        cities: [{ name: "Вологда", population: 313_000 }, { name: "Череповец", population: 315_000 }],
      },
      {
        name: "Калининградская область", type: "область",
        cities: [{ name: "Калининград", population: 490_000 }],
      },
      {
        name: "Ненецкий автономный округ", type: "АО",
        cities: [{ name: "Нарьян-Мар", population: 26_000 }],
      },
    ],
  },
  {
    name: "Южный федеральный округ",
    regions: [
      {
        name: "Ростовская область", type: "область",
        cities: [
          { name: "Ростов-на-Дону", population: 1_142_000 },
          { name: "Таганрог", population: 245_000 },
          { name: "Шахты", population: 226_000 },
          { name: "Волгодонск", population: 167_000 },
          { name: "Новочеркасск", population: 166_000 },
        ],
      },
      {
        name: "Краснодарский край", type: "край",
        cities: [
          { name: "Краснодар", population: 1_099_000 },
          { name: "Сочи", population: 443_000 },
          { name: "Новороссийск", population: 275_000 },
          { name: "Армавир", population: 189_000 },
          { name: "Анапа", population: 93_000 },
          { name: "Геленджик", population: 78_000 },
        ],
      },
      {
        name: "Волгоградская область", type: "область",
        cities: [
          { name: "Волгоград", population: 1_005_000 },
          { name: "Волжский", population: 320_000 },
          { name: "Камышин", population: 111_000 },
        ],
      },
      {
        name: "Астраханская область", type: "область",
        cities: [{ name: "Астрахань", population: 475_000 }],
      },
      {
        name: "Республика Дагестан", type: "республика",
        cities: [{ name: "Махачкала", population: 623_000 }, { name: "Дербент", population: 126_000 }],
      },
      {
        name: "Республика Адыгея", type: "республика",
        cities: [{ name: "Майкоп", population: 144_000 }],
      },
      {
        name: "Республика Крым", type: "республика",
        cities: [
          { name: "Севастополь", population: 547_000 },
          { name: "Симферополь", population: 332_000 },
          { name: "Керчь", population: 155_000 },
          { name: "Евпатория", population: 105_000 },
          { name: "Феодосия", population: 68_000 },
          { name: "Ялта", population: 78_000 },
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
          { name: "Ставрополь", population: 547_000 },
          { name: "Пятигорск", population: 146_000 },
          { name: "Невинномысск", population: 116_000 },
          { name: "Кисловодск", population: 127_000 },
        ],
      },
      {
        name: "Чеченская Республика", type: "республика",
        cities: [{ name: "Грозный", population: 328_000 }],
      },
      {
        name: "Республика Ингушетия", type: "республика",
        cities: [{ name: "Магас", population: 13_000 }, { name: "Назрань", population: 122_000 }],
      },
      {
        name: "Республика Северная Осетия — Алания", type: "республика",
        cities: [{ name: "Владикавказ", population: 295_000 }],
      },
      {
        name: "Кабардино-Балкарская Республика", type: "республика",
        cities: [{ name: "Нальчик", population: 240_000 }],
      },
    ],
  },
  {
    name: "Приволжский федеральный округ",
    regions: [
      {
        name: "Республика Татарстан", type: "республика",
        cities: [
          { name: "Казань", population: 1_314_000 },
          { name: "Набережные Челны", population: 548_000 },
          { name: "Нижнекамск", population: 243_000 },
          { name: "Альметьевск", population: 157_000 },
        ],
      },
      {
        name: "Республика Башкортостан", type: "республика",
        cities: [
          { name: "Уфа", population: 1_144_000 },
          { name: "Стерлитамак", population: 272_000 },
          { name: "Салават", population: 148_000 },
          { name: "Нефтекамск", population: 148_000 },
        ],
      },
      {
        name: "Нижегородская область", type: "область",
        cities: [
          { name: "Нижний Новгород", population: 1_222_000 },
          { name: "Дзержинск", population: 230_000 },
          { name: "Арзамас", population: 103_000 },
        ],
      },
      {
        name: "Самарская область", type: "область",
        cities: [
          { name: "Самара", population: 1_144_000 },
          { name: "Тольятти", population: 684_000 },
          { name: "Сызрань", population: 160_000 },
          { name: "Новокуйбышевск", population: 100_000 },
        ],
      },
      {
        name: "Пермский край", type: "край",
        cities: [
          { name: "Пермь", population: 1_034_000 },
          { name: "Березники", population: 145_000 },
          { name: "Соликамск", population: 91_000 },
        ],
      },
      {
        name: "Удмуртская Республика", type: "республика",
        cities: [{ name: "Ижевск", population: 631_000 }],
      },
      {
        name: "Чувашская Республика", type: "республика",
        cities: [{ name: "Чебоксары", population: 496_000 }],
      },
      {
        name: "Республика Мордовия", type: "республика",
        cities: [{ name: "Саранск", population: 314_000 }],
      },
      {
        name: "Кировская область", type: "область",
        cities: [{ name: "Киров", population: 468_000 }],
      },
      {
        name: "Оренбургская область", type: "область",
        cities: [{ name: "Оренбург", population: 543_000 }, { name: "Орск", population: 220_000 }],
      },
      {
        name: "Пензенская область", type: "область",
        cities: [{ name: "Пенза", population: 501_000 }],
      },
      {
        name: "Саратовская область", type: "область",
        cities: [{ name: "Саратов", population: 902_000 }, { name: "Энгельс", population: 225_000 }],
      },
      {
        name: "Ульяновская область", type: "область",
        cities: [{ name: "Ульяновск", population: 617_000 }],
      },
    ],
  },
  {
    name: "Уральский федеральный округ",
    regions: [
      {
        name: "Свердловская область", type: "область",
        cities: [
          { name: "Екатеринбург", population: 1_493_000 },
          { name: "Нижний Тагил", population: 335_000 },
          { name: "Каменск-Уральский", population: 163_000 },
        ],
      },
      {
        name: "Челябинская область", type: "область",
        cities: [
          { name: "Челябинск", population: 1_186_000 },
          { name: "Магнитогорск", population: 416_000 },
          { name: "Златоуст", population: 161_000 },
          { name: "Миасс", population: 148_000 },
        ],
      },
      {
        name: "Тюменская область", type: "область",
        cities: [
          { name: "Тюмень", population: 847_000 },
          { name: "Ишим", population: 65_000 },
        ],
      },
      {
        name: "Ханты-Мансийский автономный округ — Югра", type: "АО",
        cities: [
          { name: "Сургут", population: 396_000 },
          { name: "Нижневартовск", population: 282_000 },
          { name: "Нефтеюганск", population: 126_000 },
        ],
      },
      {
        name: "Ямало-Ненецкий автономный округ", type: "АО",
        cities: [{ name: "Новый Уренгой", population: 118_000 }, { name: "Ноябрьск", population: 110_000 }],
      },
      {
        name: "Курганская область", type: "область",
        cities: [{ name: "Курган", population: 310_000 }],
      },
    ],
  },
  {
    name: "Сибирский федеральный округ",
    regions: [
      {
        name: "Новосибирская область", type: "область",
        cities: [{ name: "Новосибирск", population: 1_634_000 }, { name: "Бердск", population: 103_000 }],
      },
      {
        name: "Красноярский край", type: "край",
        cities: [{ name: "Красноярск", population: 1_095_000 }, { name: "Железногорск", population: 82_000 }],
      },
      {
        name: "Иркутская область", type: "область",
        cities: [{ name: "Иркутск", population: 617_000 }, { name: "Ангарск", population: 226_000 }],
      },
      {
        name: "Кемеровская область — Кузбасс", type: "область",
        cities: [
          { name: "Кемерово", population: 557_000 },
          { name: "Новокузнецк", population: 537_000 },
          { name: "Прокопьевск", population: 177_000 },
        ],
      },
      {
        name: "Омская область", type: "область",
        cities: [{ name: "Омск", population: 1_125_000 }],
      },
      {
        name: "Томская область", type: "область",
        cities: [{ name: "Томск", population: 570_000 }],
      },
      {
        name: "Алтайский край", type: "край",
        cities: [{ name: "Барнаул", population: 631_000 }, { name: "Бийск", population: 183_000 }],
      },
      {
        name: "Республика Хакасия", type: "республика",
        cities: [{ name: "Абакан", population: 187_000 }],
      },
      {
        name: "Республика Тыва", type: "республика",
        cities: [{ name: "Кызыл", population: 120_000 }],
      },
      {
        name: "Республика Бурятия", type: "республика",
        cities: [{ name: "Улан-Удэ", population: 437_000 }],
      },
      {
        name: "Забайкальский край", type: "край",
        cities: [{ name: "Чита", population: 335_000 }],
      },
    ],
  },
  {
    name: "Дальневосточный федеральный округ",
    regions: [
      {
        name: "Приморский край", type: "край",
        cities: [{ name: "Владивосток", population: 597_000 }, { name: "Уссурийск", population: 173_000 }],
      },
      {
        name: "Хабаровский край", type: "край",
        cities: [{ name: "Хабаровск", population: 613_000 }, { name: "Комсомольск-на-Амуре", population: 243_000 }],
      },
      {
        name: "Амурская область", type: "область",
        cities: [{ name: "Благовещенск", population: 241_000 }],
      },
      {
        name: "Республика Саха (Якутия)", type: "республика",
        cities: [{ name: "Якутск", population: 355_000 }],
      },
      {
        name: "Камчатский край", type: "край",
        cities: [{ name: "Петропавловск-Камчатский", population: 180_000 }],
      },
      {
        name: "Магаданская область", type: "область",
        cities: [{ name: "Магадан", population: 92_000 }],
      },
      {
        name: "Сахалинская область", type: "область",
        cities: [{ name: "Южно-Сахалинск", population: 200_000 }],
      },
      {
        name: "Чукотский автономный округ", type: "АО",
        cities: [{ name: "Анадырь", population: 15_000 }],
      },
    ],
  },
];

export async function seedGeo(): Promise<{
  districts: number;
  regions: number;
  cities: number;
  metroLines: number;
  metroStations: number;
}> {
  let districts = 0;
  let regions = 0;
  let cities = 0;
  let metroLines = 0;
  let metroStations = 0;

  for (const d of DISTRICTS) {
    const district = await prisma.federalDistrict.upsert({
      where: { name: d.name },
      update: {},
      create: { name: d.name },
    });
    districts++;

    for (const r of d.regions) {
      const region = await prisma.region.upsert({
        where: { name: r.name },
        update: {},
        create: { name: r.name, type: r.type, districtId: district.id },
      });
      regions++;

      for (const c of r.cities) {
        const city = await prisma.city.upsert({
          where: { name_regionId: { name: c.name, regionId: region.id } },
          update: { population: c.population ?? null, hasMetro: c.hasMetro ?? false },
          create: {
            name: c.name,
            regionId: region.id,
            population: c.population ?? null,
            hasMetro: c.hasMetro ?? false,
          },
        });
        cities++;

        if (c.hasMetro && c.metro) {
          for (const [lineName, stations] of Object.entries(c.metro)) {
            const line = await prisma.metroLine.upsert({
              where: { name_cityId: { name: lineName, cityId: city.id } },
              update: {},
              create: { name: lineName, cityId: city.id },
            });
            metroLines++;
            for (const st of stations) {
              await prisma.metroStation.upsert({
                where: { name_lineId: { name: st, lineId: line.id } },
                update: {},
                create: { name: st, lineId: line.id },
              });
              metroStations++;
            }
          }
        }
      }
    }
  }

  return { districts, regions, cities, metroLines, metroStations };
}

async function main() {
  const stats = await seedGeo();
  console.log("geo seed:", JSON.stringify(stats));
}

// Only run as a script, not when imported (e.g. by the test setup, which calls
// seedGeo() directly). Otherwise an import would exit the importing process.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
