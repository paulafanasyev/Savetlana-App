/**
 * Примеры объявлений для пустой витрины. Каждое честно помечено «Пример:»
 * в заголовке и в описании, чтобы никто не принял его за настоящее.
 * Как только настоящих объявлений станет достаточно, примеры удаляются сами.
 */

export const DEMO_AUTHOR_EMAIL = "demo@aiko.invalid";
export const DEMO_TITLE_PREFIX = "Пример: ";
/** Сколько настоящих опубликованных объявлений нужно, чтобы убрать примеры. */
export const DEMO_REMOVE_AFTER_REAL = 20;
/** Версия набора примеров: при смене старые примеры заменяются новыми. */
export const DEMO_VERSION = 2;
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
  attrs: Record<string, string | number>;
}

export const DEMO_ADS: DemoAd[] = [
  { city: "Москва", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "2-комнатная квартира, 54 м², 7/12 эт.", text: "Светлая квартира рядом с парком, ремонт 2022 года.", rub: 16_500_000, attrs: { propertyType: "APARTMENT", roomsTotal: 2, areaTotal: 54, floor: 7, floorsTotal: 12, renovation: "euro" } },
  { city: "Москва", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Kia Rio, 2020, 1.6 AT, 58 000 км", text: "Один владелец, сервисная книжка.", rub: 1_390_000, attrs: { brand: "Kia", model: "Rio", year: 2020, mileageKm: 58000, bodyType: "SEDAN", fuelType: "PETROL", transmission: "automatic", ownersCount: 1 } },
  { city: "Москва", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Ремонт техники", title: "Ремонт холодильников на дому", text: "Выезд в день обращения, гарантия на работу 6 месяцев.", rub: 1_500, attrs: { serviceCategory: "Ремонт техники", format: "client", warranty: "yes", experienceYears: 10 } },
  { city: "Химки", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "1-комнатная квартира на длительный срок, 38 м²", text: "Мебель и техника есть, 10 минут до станции.", rub: 42_000, attrs: { propertyType: "APARTMENT", roomsTotal: 1, areaTotal: 38, floor: 5, floorsTotal: 17, furniture: "yes" } },
  { city: "Химки", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Lada Granta, 2022, 1.6 MT, 21 000 км", text: "Гаражное хранение, зимняя резина в подарок.", rub: 780_000, attrs: { brand: "Lada", model: "Granta", year: 2022, mileageKm: 21000, bodyType: "SEDAN", fuelType: "PETROL", transmission: "manual", ownersCount: 1 } },
  { city: "Санкт-Петербург", vertical: "REAL_ESTATE", dealType: "DAILY_RENT", category: "Квартиры", title: "Студия посуточно в центре, 26 м²", text: "Рядом Невский проспект, бесконтактное заселение.", rub: 3_200, attrs: { propertyType: "STUDIO", roomsTotal: 1, areaTotal: 26, floor: 3, floorsTotal: 6, furniture: "yes" } },
  { city: "Санкт-Петербург", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "IT и разработка", title: "Сайт-визитка за 5 дней", text: "Дизайн, адаптивная вёрстка, подключение формы заявок.", rub: 25_000, attrs: { serviceCategory: "IT и разработка", format: "online", prepayment: "partial", experienceYears: 6 } },
  { city: "Казань", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "3-комнатная квартира, 78 м², 4/9 эт.", text: "Кирпичный дом, школа и садик во дворе.", rub: 11_200_000, attrs: { propertyType: "APARTMENT", roomsTotal: 3, areaTotal: 78, floor: 4, floorsTotal: 9, mortgagePossible: "yes" } },
  { city: "Казань", vertical: "SERVICE", dealType: "SERVICE_REQUEST", category: "Ремонт", title: "Нужен мастер по укладке плитки в ванной", text: "Площадь около 6 м², материалы куплены.", rub: 18_000, attrs: { serviceCategory: "Укладка плитки", format: "client" } },
  { city: "Набережные Челны", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Hyundai Solaris, 2019, 1.6 AT, 74 000 км", text: "Не битый, не крашеный, два комплекта ключей.", rub: 1_150_000, attrs: { brand: "Hyundai", model: "Solaris", year: 2019, mileageKm: 74000, bodyType: "SEDAN", fuelType: "PETROL", transmission: "automatic", accidents: "no" } },
  { city: "Набережные Челны", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "2-комнатная квартира на длительный срок", text: "Свежий ремонт, без животных.", rub: 22_000, attrs: { propertyType: "APARTMENT", roomsTotal: 2, areaTotal: 48, floor: 2, floorsTotal: 9, renovation: "cosmetic" } },
  { city: "Екатеринбург", vertical: "REAL_ESTATE", dealType: "SELL", category: "Дома и коттеджи", title: "Дом 120 м² с участком 6 соток", text: "Газ, вода, баня. 20 минут до центра.", rub: 9_800_000, attrs: { propertyType: "HOUSE", areaTotal: 120, plotArea: 6, floorsTotal: 2 } },
  { city: "Екатеринбург", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Перевозки", title: "Грузоперевозки по городу, Газель", text: "Грузчики по запросу, работаем без выходных.", rub: 900, attrs: { serviceCategory: "Грузоперевозки", format: "client", prepayment: "none" } },
  { city: "Челябинск", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Volkswagen Polo, 2018, 1.6 MT, 96 000 км", text: "Обслуживание вовремя, все чеки на руках.", rub: 990_000, attrs: { brand: "Volkswagen", model: "Polo", year: 2018, mileageKm: 96000, bodyType: "SEDAN", fuelType: "PETROL", transmission: "manual", ownersCount: 2 } },
  { city: "Новосибирск", vertical: "REAL_ESTATE", dealType: "LONG_RENT", category: "Квартиры", title: "Студия 28 м² у метро на длительный срок", text: "Новый дом, вся техника есть.", rub: 27_000, attrs: { propertyType: "STUDIO", roomsTotal: 1, areaTotal: 28, floor: 11, floorsTotal: 25, furniture: "yes" } },
  { city: "Новосибирск", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Обучение", title: "Репетитор по математике, ЕГЭ и ОГЭ", text: "Опыт 8 лет, занятия онлайн и очно.", rub: 1_200, attrs: { serviceCategory: "Репетитор по математике", format: "online", experienceYears: 8 } },
  { city: "Краснодар", vertical: "REAL_ESTATE", dealType: "SELL", category: "Квартиры", title: "1-комнатная квартира в новостройке, 41 м²", text: "Сдан в 2024 году, предчистовая отделка.", rub: 5_400_000, attrs: { propertyType: "APARTMENT", roomsTotal: 1, areaTotal: 41, floor: 14, floorsTotal: 20, buildingYear: 2024, mortgagePossible: "yes" } },
  { city: "Ростов-на-Дону", vertical: "AUTO", dealType: "SELL", category: "Автомобили", title: "Toyota Corolla, 2017, 1.6 CVT, 110 000 км", text: "Надёжный автомобиль, без вложений.", rub: 1_450_000, attrs: { brand: "Toyota", model: "Corolla", year: 2017, mileageKm: 110000, bodyType: "SEDAN", fuelType: "PETROL", transmission: "cvt", ownersCount: 2 } },
  { city: "Нижний Новгород", vertical: "SERVICE", dealType: "SERVICE_OFFER", category: "Красота", title: "Маникюр с покрытием, выезд на дом", text: "Стерильные инструменты, материалы в цене.", rub: 1_300, attrs: { serviceCategory: "Маникюр", format: "client", experienceYears: 5 } },
  { city: "Самара", vertical: "REAL_ESTATE", dealType: "DAILY_RENT", category: "Квартиры", title: "Квартира посуточно у набережной", text: "Две кровати, рядом пляж и кафе.", rub: 2_800, attrs: { propertyType: "APARTMENT", roomsTotal: 2, areaTotal: 46, floor: 6, floorsTotal: 10, furniture: "yes" } },
];

/** Пора ли убрать примеры: настоящих объявлений уже достаточно. */
export function shouldRemoveDemo(realPublished: number): boolean {
  return realPublished >= DEMO_REMOVE_AFTER_REAL;
}
