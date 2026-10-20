import { describe, expect, it } from "vitest";
import { actorTypeLabel, identityStatusLabel, riskActionLabel, riskLevelLabel, roleLabel } from "../src/lib/admin-labels";

describe("подписи админки", () => {
  it("переводит известные коды", () => {
    expect(roleLabel("SELLER")).toBe("продавец");
    expect(identityStatusLabel("VERIFIED")).toBe("проверен");
    expect(riskLevelLabel("BLOCKED")).toBe("заблокировано");
    expect(riskLevelLabel("high")).toBe("высокий");
    expect(actorTypeLabel("ORDER")).toBe("заказ");
    expect(riskActionLabel("reviewed_by_admin")).toBe("рассмотрено администратором");
  });

  it("незнакомое показывает как есть, пустое прочерком", () => {
    expect(roleLabel("ROBOT")).toBe("ROBOT");
    expect(riskActionLabel("custom_step")).toBe("custom_step");
    expect(identityStatusLabel(null)).toBe("—");
  });
});
