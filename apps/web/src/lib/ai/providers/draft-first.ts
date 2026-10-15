/**
 * Явная просьба создать карточку важнее остальных правил встроенной Светланы.
 *
 * «Создай карточку: термокружка, доставка по России, отличный подарок, 990 ₽»
 * раньше уходила в правило про доставку или подарки, потому что они
 * проверяются первыми, и черновик не создавался. Теперь сообщение, которое
 * начинается с просьбы создать карточку, сразу идёт в создание черновика.
 * Просьбу понимаем и в конце сообщения («Вот кроссовки…, оформи карточку»),
 * а «как добавить товар?» и «сделай товар дешевле» сюда не попадают
 * (lib/ai/draft-command.ts). Так же сразу разбирается «Составь резюме: …»
 * (lib/ai/resume-command.ts) и «Продли скидку на 7 дней» (lib/ai/promo-extend-command.ts).
 */
import type { AiCompleteRequest, AiCompleteResponse, AiProvider } from "../types";
import { draftArgs } from "./mock";
import { parseDraftCommand } from "../draft-command";
import { parseResumeCommand, RESUME_ASK, resumeChatReply } from "../resume-command";
import { scrubContacts } from "../../domains/contact-scrub";
import { parsePromoExtendCommand, PROMO_EXTEND_ASK, promoExtendReply } from "../promo-extend-command";

export function isDraftCommand(text: string): boolean {
  return parseDraftCommand(text) !== null;
}

const ASK_DETAILS =
  "Напишите, что за товар, и я составлю карточку. Например: «Создай карточку: кроссовки Nike Air Max 90, белые, 42 размер, новые, 7990 ₽». Цену, размер, цвет и остальное возьму из ваших слов.";

export function draftCommandFirst(inner: AiProvider): AiProvider {
  const respond = (content: string, toolCalls?: AiCompleteResponse["toolCalls"]): AiCompleteResponse => ({
    content,
    toolCalls,
    provider: inner.key,
    model: "sandbox-rule-engine",
    latencyMs: 1,
    sandbox: true,
    finishReason: "stop",
  });
  return {
    key: inner.key,
    displayName: inner.displayName,
    available: inner.available,
    sandbox: inner.sandbox,
    embed: inner.embed?.bind(inner),
    async complete(request: AiCompleteRequest): Promise<AiCompleteResponse> {
      const last = request.messages[request.messages.length - 1];
      const userText = request.jsonMode || last?.role !== "user" ? null : last.content;
      // «Составь резюме: …»: разбираем тем же составителем, что и в форме объявления.
      const resume = userText === null ? null : parseResumeCommand(userText);
      if (resume !== null) {
        if (resume.length < 15) return respond(RESUME_ASK);
        // Динамический импорт: составитель резюме сам обращается к шлюзу, статический импорт замкнул бы круг.
        const { parseResumeText } = await import("../../domains/resume-draft");
        // Телефон и почту убираем и из ответа, и из ссылки на форму.
        const clean = scrubContacts(resume);
        return respond(resumeChatReply(parseResumeText(clean.text), clean.text, clean.removed));
      }
      // «Продли скидку на кроссовки на 7 дней»: без срока сначала спрашиваем, на сколько.
      const extend = userText === null ? null : parsePromoExtendCommand(userText);
      if (extend !== null) {
        if (!extend.days) return respond(PROMO_EXTEND_ASK);
        return respond(promoExtendReply(extend), [
          { id: `call_promo_extend_${Date.now()}`, name: "extend_promotion", arguments: { query: extend.query, days: extend.days } },
        ]);
      }
      const command = userText === null ? null : parseDraftCommand(userText);
      if (!command) return inner.complete(request);
      // Просьба может стоять в конце: разбираем только текст о товаре.
      const args = draftArgs(command.product ? `карточка ${command.product}` : "");
      if (!args.title) return respond(ASK_DETAILS);
      return respond(`Готовлю черновик карточки «${args.title}». Публикация останется за вами.`, [
        { id: `call_draft_first_${Date.now()}`, name: "create_product_draft", arguments: args },
      ]);
    },
  };
}
