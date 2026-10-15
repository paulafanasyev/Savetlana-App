/**
 * Явная просьба создать карточку важнее остальных правил встроенной Светланы.
 *
 * «Создай карточку: термокружка, доставка по России, отличный подарок, 990 ₽»
 * раньше уходила в правило про доставку или подарки, потому что они
 * проверяются первыми, и черновик не создавался. Теперь сообщение, которое
 * начинается с просьбы создать карточку, сразу идёт в создание черновика.
 * Просьба должна стоять в начале: «как добавить товар?» и «сделай товар
 * дешевле» сюда не попадают.
 */
import type { AiCompleteRequest, AiCompleteResponse, AiProvider } from "../types";
import { draftArgs } from "./mock";

const DRAFT_COMMAND =
  /^(?:светлана[\s,!.:]*)?(?:пожалуйста[\s,]*)?(?:(?:созда(?:й|йте)|оформ(?:и|ите)|вылож(?:и|ите)|состав(?:ь|ьте))\s+(?:мне\s+|пожалуйста\s+)?(?:нов(?:ую|ый|ое)\s+)?(?:карточк|товар|объявлени)|сдела(?:й|йте)\s+(?:мне\s+|пожалуйста\s+)?(?:нов(?:ую|ое)\s+)?(?:карточк|объявлени))/i;

export function isDraftCommand(text: string): boolean {
  const t = text.trim();
  return DRAFT_COMMAND.test(t) && !/в корзин|в избранн/i.test(t);
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
      if (request.jsonMode || last?.role !== "user" || !isDraftCommand(last.content)) return inner.complete(request);
      const args = draftArgs(last.content);
      if (!args.title) return respond(ASK_DETAILS);
      return respond(`Готовлю черновик карточки «${args.title}». Публикация останется за вами.`, [
        { id: `call_draft_first_${Date.now()}`, name: "create_product_draft", arguments: args },
      ]);
    },
  };
}
