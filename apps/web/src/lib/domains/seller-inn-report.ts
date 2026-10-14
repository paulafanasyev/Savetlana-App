/**
 * Отчёт для администратора: у каких продавцов ИНН не годится для чека 54-ФЗ.
 *
 * ИНН берётся так же, как в чеке и в проверке допуска к торговле: сначала
 * юрлица продавца, потом профиля. Пока агентский чек (RECEIPT_AGENT_TYPE)
 * выключен, отчёт просто показывает, кто перестанет торговать после включения.
 */
import { prisma } from "../prisma";
import { isValidInn, receiptSettings } from "./receipt";

export type InnStatus = "OK" | "MISSING" | "INVALID";

export const INN_STATUS_LABEL: Record<InnStatus, string> = {
  OK: "в порядке",
  MISSING: "не указан",
  INVALID: "ошибка в цифрах",
};

/** ИНН для чека и его состояние. */
export function sellerInnStatus(seller: { inn: string | null; companyInn?: string | null }): { inn: string | null; source: "company" | "profile" | null; status: InnStatus } {
  const company = seller.companyInn?.trim() || null;
  const profile = seller.inn?.trim() || null;
  const inn = company ?? profile;
  const source = company ? "company" : profile ? "profile" : null;
  if (!inn) return { inn: null, source, status: "MISSING" };
  return { inn, source, status: isValidInn(inn) ? "OK" : "INVALID" };
}

export interface SellerInnRow {
  id: string;
  displayName: string;
  email: string;
  sellerType: string;
  isActivated: boolean;
  activeProducts: number;
  inn: string | null;
  source: "company" | "profile" | null;
  status: InnStatus;
}

export async function sellerInnReport(limit = 500): Promise<{ agentReceipts: boolean; rows: SellerInnRow[]; problems: number; tradingProblems: number }> {
  const sellers = await prisma.sellerProfile.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      displayName: true,
      sellerType: true,
      isActivated: true,
      inn: true,
      user: { select: { email: true } },
      companies: { select: { inn: true }, orderBy: { createdAt: "asc" }, take: 1 },
      _count: { select: { products: { where: { status: "ACTIVE" } } } },
    },
  });
  const rows: SellerInnRow[] = sellers
    .map((s) => ({
      id: s.id,
      displayName: s.displayName,
      email: s.user?.email ?? "",
      sellerType: s.sellerType,
      isActivated: s.isActivated,
      activeProducts: s._count.products,
      ...sellerInnStatus({ inn: s.inn, companyInn: s.companies[0]?.inn }),
    }))
    // Сначала проблемные и те, кто уже торгует.
    .sort((a, b) => Number(a.status === "OK") - Number(b.status === "OK") || b.activeProducts - a.activeProducts);
  const bad = rows.filter((r) => r.status !== "OK");
  return {
    agentReceipts: Boolean(receiptSettings().agentType),
    rows,
    problems: bad.length,
    tradingProblems: bad.filter((r) => r.isActivated && r.activeProducts > 0).length,
  };
}
