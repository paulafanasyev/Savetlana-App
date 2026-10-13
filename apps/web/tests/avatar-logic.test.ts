import { describe, expect, it } from "vitest";
import {
  avatarReducer,
  chunkForSpeech,
  initialAvatarState,
  normalizeSpoken,
  parseAssistantEmotion,
  pickRussianVoice,
} from "../src/lib/avatar-logic";

describe("логика аватара Светланы", () => {
  it("извлекает эмоцию и убирает тег из ответа", () => {
    expect(parseAssistantEmotion("Рада помочь! [EMOTION: happy]")).toEqual({ text: "Рада помочь!", emotion: "happy" });
    expect(parseAssistantEmotion("Ого, вот это новость!")).toEqual({ text: "Ого, вот это новость!", emotion: "surprised" });
  });

  it("переключает фазы ожидания, речи и прослушивания", () => {
    let state = avatarReducer(initialAvatarState, { type: "REQUEST_START" });
    expect(state.phase).toBe("thinking");
    state = avatarReducer(state, { type: "RESPONSE", emotion: "happy" });
    expect(state).toEqual({ phase: "idle", emotion: "happy" });
    state = avatarReducer(state, { type: "SPEECH_START" });
    expect(state.phase).toBe("speaking");
    state = avatarReducer(state, { type: "SPEECH_END" });
    state = avatarReducer(state, { type: "LISTEN_START" });
    expect(state.phase).toBe("listening");
  });

  it("нормализует обращение и русские числа в голосовой команде", () => {
    expect(normalizeSpoken("Светлана, найди пять тысяч рублей")).toBe("Найди 5000");
  });

  it("делит длинный текст на произносимые фразы и выбирает русский голос", () => {
    expect(chunkForSpeech("Первое предложение. Второе предложение.", 25)).toEqual(["Первое предложение.", "Второе предложение."]);
    expect(pickRussianVoice([{ lang: "en-US", name: "English" }, { lang: "ru-RU", name: "Google Russian" }, { lang: "ru-RU", name: "Svetlana" }])?.name).toBe("Svetlana");
  });
});
