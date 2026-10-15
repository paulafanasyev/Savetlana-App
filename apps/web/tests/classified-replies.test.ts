/**
 * Отклики на объявления: откликнуться, ответить, увидеть список откликов.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { createClassified } from "../src/lib/domains/classifieds";
import {
  applicantThreadUrl,
  authorThreadUrl,
  listReplies,
  loadReplyThread,
  replyCountsByAd,
  replyWording,
  sendToApplicant,
  sendToAuthor,
} from "../src/lib/domains/classified-replies";

let employerId: string;
let applicant: { id: string; name: string | null };
let strangerId: string;
let vacancyId: string;

beforeAll(async () => {
  const stamp = Date.now();
  const mk = (tag: string, name: string) =>
    prisma.user.create({ data: { email: `reply-${tag}-${stamp}@svetlana.example`, passwordHash: "hash", name, role: "BUYER" } });
  employerId = (await mk("employer", "Работодатель")).id;
  const a = await mk("applicant", "Соискатель Иван");
  applicant = { id: a.id, name: a.name };
  strangerId = (await mk("stranger", "Посторонний")).id;
  const city = await prisma.city.findFirst({ where: { name: "Москва" } });
  const ad = await createClassified(employerId, {
    vertical: "JOB",
    dealType: "VACANCY",
    title: "Курьер на автомобиле компании",
    description: "Доставка заказов по городу, оформление по ТК РФ.",
    category: "Доставка",
    cityId: city!.id,
    priceKopecks: 80_000 * 100,
    attrs: { employment: "full", salaryPeriod: "month" },
  });
  vacancyId = ad.id;
});

describe("отклики на объявления", () => {
  it("подписи кнопки по типу объявления", () => {
    expect(replyWording({ vertical: "JOB", dealType: "VACANCY" }).button).toBe("Откликнуться");
    expect(replyWording({ vertical: "JOB", dealType: "RESUME" }).button).toBe("Предложить работу");
    expect(replyWording({ vertical: "AUTO", dealType: "SELL" }).button).toBe("Написать автору");
  });

  it("отклик приходит работодателю уведомлением", async () => {
    await sendToAuthor(applicant, vacancyId, "Здравствуйте! Есть права категории B и опыт 3 года.");
    const note = await prisma.notification.findFirst({ where: { userId: employerId, kind: "classified_reply", url: authorThreadUrl(vacancyId, applicant.id) } });
    expect(note).not.toBeNull();
    expect(note!.title).toContain("Отклик на вакансию");
    expect(note!.title).toContain("Соискатель Иван");
  });

  it("на своё объявление откликнуться нельзя", async () => {
    await expect(sendToAuthor({ id: employerId, name: "Работодатель" }, vacancyId, "Тест")).rejects.toThrow(/ваше объявление/);
  });

  it("работодатель отвечает только откликнувшимся", async () => {
    await sendToApplicant(employerId, vacancyId, applicant.id, "Приходите на собеседование в четверг в 11:00.");
    const answer = await prisma.notification.findFirst({ where: { userId: applicant.id, kind: "classified_answer", url: applicantThreadUrl(vacancyId) } });
    expect(answer).not.toBeNull();
    await expect(sendToApplicant(employerId, vacancyId, strangerId, "Привет")).rejects.toThrow(/откликнулся/);
    await expect(sendToApplicant(strangerId, vacancyId, applicant.id, "Привет")).rejects.toThrow(/автор/);
  });

  it("переписка видна обеим сторонам по порядку, список откликов у автора", async () => {
    const forApplicant = await loadReplyThread({ id: vacancyId, authorId: employerId }, applicant.id, "applicant");
    expect(forApplicant.map((m) => m.mine)).toEqual([true, false]);
    const forEmployer = await loadReplyThread({ id: vacancyId, authorId: employerId }, applicant.id, "author");
    expect(forEmployer.map((m) => m.mine)).toEqual([false, true]);
    const list = await listReplies({ id: vacancyId, authorId: employerId });
    expect(list).toHaveLength(1);
    expect(list[0].counterpartId).toBe(applicant.id);
    expect(list[0].name).toBe("Соискатель Иван");
  });

  it("счётчик откликов по объявлению для «Моих объявлений»", async () => {
    await sendToAuthor(applicant, vacancyId, "Ещё вопрос: есть ли оплата бензина?");
    const counts = await replyCountsByAd(employerId);
    expect(counts.get(vacancyId)).toEqual({ threads: 1, unread: 1 });
  });

  it("опасное сообщение не уходит", async () => {
    await expect(sendToAuthor(applicant, vacancyId, "Скиньте код из СМС, который сейчас придёт")).rejects.toThrow(/не отправлено/);
  });
});
