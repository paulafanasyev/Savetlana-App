/**
 * «Первые шаги» на главной кабинета продавца: что осталось до первой продажи.
 * Чистый модуль: из фактов делает шаги со ссылками. Блок пропадает, когда обязательные
 * шаги сделаны (магазин одобрен и есть опубликованный товар).
 */

export interface FirstStepsFacts {
  /** Статус заявки: NOT_SUBMITTED | PENDING | REJECTED | APPROVED. */
  verification: string;
  activeProducts: number;
  draftProducts: number;
  shipCity: string | null;
  telegramLinked: boolean;
  /** Telegram-бот настроен на площадке: иначе шаг не показываем. */
  telegramConfigured: boolean;
}

export interface FirstStep {
  key: "apply" | "product" | "city" | "telegram";
  title: string;
  hint: string;
  href: string;
  done: boolean;
}

export function firstSteps(f: FirstStepsFacts): FirstStep[] | null {
  const approved = f.verification === "APPROVED";
  if (approved && f.activeProducts > 0) return null;
  const steps: FirstStep[] = [
    {
      key: "apply",
      title: "Заявка продавца",
      hint: approved
        ? "Магазин одобрен."
        : f.verification === "PENDING"
          ? "Заявка на проверке, о решении придёт уведомление. Товары можно готовить уже сейчас."
          : f.verification === "REJECTED"
            ? "Заявка отклонена: исправьте данные и отправьте снова."
            : "Тип, название магазина и ИНН. Самозанятых одобряем сразу по данным ФНС.",
      href: "/seller/onboarding",
      done: approved,
    },
    {
      key: "product",
      title: "Первый товар",
      hint:
        f.activeProducts > 0
          ? "Товар опубликован."
          : f.draftProducts > 0
            ? approved
              ? "Черновики готовы: добавьте цену, фото и остаток и опубликуйте."
              : "Черновики готовы, опубликовать их можно будет после одобрения магазина."
            : "Название, цена, фото и остаток. Светлана поможет с описанием, а каталог с Ozon, WB или 1С можно перенести файлом.",
      href: "/seller/products",
      done: f.activeProducts > 0,
    },
    {
      key: "city",
      title: "Город отгрузки",
      hint: f.shipCity ? `Сейчас: ${f.shipCity}.` : "Покупатели из вашего города найдут вас фильтром «Из моего города». Поле ниже на этой странице.",
      href: "/seller#ship-city",
      done: Boolean(f.shipCity),
    },
  ];
  if (f.telegramConfigured || f.telegramLinked) {
    steps.push({
      key: "telegram",
      title: "Заказы в Telegram",
      hint: f.telegramLinked ? "Подключён." : "Чтобы не пропустить первый заказ. Кнопка ниже на этой странице.",
      href: "/seller#telegram",
      done: f.telegramLinked,
    });
  }
  return steps;
}
