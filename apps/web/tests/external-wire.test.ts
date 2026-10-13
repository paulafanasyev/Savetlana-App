import { describe, it, expect } from "vitest";
import { toWireMessages } from "../src/lib/ai/providers/external";

// Внешние OpenAI-совместимые модели отклоняют результат инструмента без
// предшествующего хода ассистента с tool_calls.
describe("external wire format", () => {
  it("сериализует tool_calls ассистента перед результатом инструмента", () => {
    const wire = toWireMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "найди чайник" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "search_products", arguments: { query: "чайник" } }] },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "c1" },
    ]);
    expect(wire[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: "{\"query\":\"чайник\"}" } }],
    });
    expect(wire[3]).toEqual({ role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" });
    expect(wire[1]).toEqual({ role: "user", content: "найди чайник" });
  });
});
