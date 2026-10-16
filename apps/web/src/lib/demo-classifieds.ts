/**
 * Примеры объявлений для пустой витрины. Каждое честно помечено «Пример:»
 * в заголовке и в описании, чтобы никто не принял его за настоящее.
 * Как только настоящих объявлений станет достаточно, примеры удаляются сами.
 */

export const DEMO_AUTHOR_EMAIL = "demo@aiko.invalid";
export const DEMO_TITLE_PREFIX = "Пример: ";
/** Сколько настоящих опубликованных объявлений нужно, чтобы убрать примеры. */
export const DEMO_REMOVE_AFTER_REAL = 20;
export const DEMO_NOTE =
  "Это пример объявления, чтобы показать, как работает АИКО. Связаться с автором нельзя. Разместите своё объявление бесплатно.";

export interface DemoAd {
  city: string;
  vertical: "REAL_ESTATE" | "AUTO" | "SERVICE";
  dealType: "SELL" | "LONG_RENT" | "DAILY_RENT" | "SERVICE_OFFER" | "SERVICE_REQUEST";
  category: string;
  title: string;
  text: string;
  rub: number;
  attrs: Record<string, unknown>;
}

export const DEMO_ADS: DemoAd[] = [
  { city: "Москва", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "2-комнатная квартира, 54 м², 7/12 эт.", text: "Светлая квартира рядом с парком, ремонт 2022 года.", rub: 16_500_000, attrs: { rooms: 2, areaTotal: 54, floor: 7, floorsTotal: 12 } },
  { city: "Москва", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Kia Rio, 2020, 1.6 AT, 58 000 км", text: "Один владелец, сервисная книжка.", rub: 1_390_000, attrs: { brand: "Kia", model: "Rio", year: 2020, mileage: 58000, transmission: "AT", engineVolume: 1.6 } },
  { city: "Москва", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Ремонт техники", title: "Ремонт холодильников на дому", text: "Выезд в день обращения, гарантия на работу 6 месяцев.", rub: 1_500, attrs: { serviceType: "Ремонт техники", atHome: true, warrantyMonths: 6 } },
  { city: "Химки", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "1-комнатная квартира на длительный срок, 38 м²", text: "Мебель и техника есть, 10 минут до станции.", rub: 42_000, attrs: { rooms: 1, areaTotal: 38, floor: 5, floorsTotal: 17 } },
  { city: "Химки", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Lada Granta, 2022, 1.6 MT, 21 000 км", text: "Гаражное хранение, зимняя резина в подарок.", rub: 780_000, attrs: { brand: "Lada", model: "Granta", year: 2022, mileage: 21000, transmission: "MT", engineVolume: 1.6 } },
  { city: "Санкт-Петербург", vertical: "REAL_ESTATE", dealType: "DAILY_RENT", category: "Квартиры", title: "Студия посуточно в центре, 26 м²", text: "Рядом Невский проспект, бесконтактное заселение.", rub: 3_200, attrs: { rooms: 1, areaTotal: 26, floor: 3, floorsTotal: 6, daily: true } },
  { city: "Санкт-Петербург", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "IT и разработка", title: "Сайт-визитка за 5 дней", text: "Дизайн, адаптивная вёрстка, подключение формы заявок.", rub: 25_000, attrs: { serviceType: "IT и разработка", contractAvailable: true } },
  { city: "Казань", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "3-комнатная квартира, 78 м², 4/9 эт.", text: "Кирпичный дом, школа и садик во дворе.", rub: 11_200_000, attrs: { rooms: 3, areaTotal: 78, floor: 4, floorsTotal: 9 } },
  { city: "Казань", vertical: "SERVICE", dealType: "SERVICE_REQUEST", category: "Ремонт", title: "Нужен мастер по укладке плитки в ванной", text: "Площадь около 6 м², материалы куплены.", rub: 18_000, attrs: { serviceType: "Ремонт", areaTotal: 6 } },
  { city: "Набережные Челны", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Hyundai Solaris, 2019, 1.6 AT, 74 000 км", text: "Не битый, не крашеный, два комплекта ключей.", rub: 1_150_000, attrs: { brand: "Hyundai", model: "Solaris", year: 2019, mileage: 74000, transmission: "AT", engineVolume: 1.6 } },
  { city: "Набережные Челны", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "2-комнатная квартира на длительный срок", text: "Свежий ремонт, без животных.", rub: 22_000, attrs: { rooms: 2, areaTotal: 48, floor: 2, floorsTotal: 9 } },
  { city: "Екатеринбург", vertical: "REAL_ESTATE", dealType: "SELL", category: "Дома и коттеджи", title: "Дом 120 м² с участком 6 соток", text: "Газ, вода, баня. 20 минут до центра.", rub: 9_800_000, attrs: { areaTotal: 120, landArea: 6, gas: true } },
  { city: "Екатеринбург", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Перевозки", title: "Грузоперевозки по городу, Газель", text: "Грузчики по запросу, работаем без выходных.", rub: 900, attrs: { serviceType: "Перевозки" } },
  { city: "Челябинск", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Volkswagen Polo, 2018, 1.6 MT, 96 000 км", text: "Обслуживание вовремя, все чеки на руках.", rub: 990_000, attrs: { brand: "Volkswagen", model: "Polo", year: 2018, mileage: 96000, transmission: "MT", engineVolume: 1.6 } },
  { city: "Новосибирск", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "Студия 28 м² у метро на длительный срок", text: "Новый дом, вся техника есть.", rub: 27_000, attrs: { rooms: 1, areaTotal: 28, floor: 11, floorsTotal: 25 } },
  { city: "Новосибирск", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Обучение", title: "Репетитор по математике, ЕГЭ и ОГЭ", text: "Опыт 8 лет, занятия онлайн и очно.", rub: 1_200, attrs: { serviceType: "Обучение", online: true } },
  { city: "Краснодар", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "1-комнатная квартира в новостройке, 41 м²", text: "Сдан в 2024 году, предчистовая отделка.", rub: 5_400_000, attrs: { rooms: 1, areaTotal: 41, floor: 14, floorsTotal: 20 } },
  { city: "Ростов-на-Дону", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Toyota Corolla, 2017, 1.6 CVT, 110 000 км", text: "Надёжный автомобиль, без вложений.", rub: 1_450_000, attrs: { brand: "Toyota", model: "Corolla", year: 2017, mileage: 110000, transmission: "CVT", engineVolume: 1.6 } },
  { city: "Нижний Новгород", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Красота", title: "Маникюр с покрытием, выезд на дом", text: "Стерильные инструменты, материалы в цене.", rub: 1_300, attrs: { serviceType: "Красота", atHome: true } },
  { city: "Самара", vertical: "REAL_ESTATE", dealType: "DAILY_RENT", category: "Квартиры", title: "Квартира посуточно у набережной", text: "Две кровати, рядом пляж и кафе.", rub: 2_800, attrs: { rooms: 2, areaTotal: 46, floor: 6, floorsTotal: 10, daily: true } },
];

/** Пора ли убрать примеры: настоящих объявлений уже достаточно. */
export function shouldRemoveDemo(realPublished: number): boolean {
  return realPublished >= DEMO_REMOVE_AFTER_REAL;
}
