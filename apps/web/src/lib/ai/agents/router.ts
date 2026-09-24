/**
 * Agent Router (spec §4, §52, §144).
 *
 * Routes a user intent to the specialized subagent that owns the tools for
 * it. The router is a deterministic mapping (not an LLM call) so routing is
 * explainable, testable and free of hallucinated delegation. New agents are
 * added here without touching the Master Agent (spec §4).
 */
export type AgentKey =
  | "buyer"
  | "seller"
  | "search"
  | "vision"
  | "recommendation"
  | "gift"
  | "relationship"
  | "order"
  | "delivery"
  | "payment"
  | "risk"
  | "trust"
  | "review"
  | "competitor"
  | "pricing"
  | "analytics"
  | "product"
  | "compliance"
  | "document"
  | "memory"
  | "notification"
  | "support";

interface RouteRule {
  agent: AgentKey;
  pattern: RegExp;
  /** Buyer-side or seller-side conversational context. */
  side: "buyer" | "seller";
}

const RULES: RouteRule[] = [
  // Seller-side business questions
  // Global competitor sweep must win over the generic competitor rule so the
  // seller's explicit «глобально / по всему интернету / озон / вб» request
  // reaches the multi-tier external scan (spec §13, §26).
  {
    side: "seller",
    agent: "competitor",
    pattern: /глобальн|по всему интернет|международн|ozon|озон|wildberries|вб |aliexpress|taobao|amazon|китайск/i,
  },
  { side: "seller", agent: "delivery", pattern: /доставк[а|у].*(уровен|тариф|цен|стоим)|сколько стоит доставка|условия доставки|перевозчик|ПВЗ|международная доставка/i },
  { side: "seller", agent: "analytics", pattern: /почему.*(упали|плохо прода|снизил).*продаж|продажи упали|как увеличить продажи|что с продажами/i },
  { side: "seller", agent: "pricing", pattern: /какую цену|цена.*(конкурент|адекват)|стоит ли (снижать|поднимать)|переоцен/i },
  { side: "seller", agent: "competitor", pattern: /конкурент|сопостав|кто мои конкуренты|сравни с конкурентами/i },
  { side: "seller", agent: "document", pattern: /документ|сертификат|деклараци|какие документы нужны/i },
  { side: "seller", agent: "order", pattern: /заказы|где заказы покупателей|что заказали/i },
  { side: "seller", agent: "memory", pattern: /запомни .* (под заказ|обычно|всегда)|бизнес-память/i },
  { side: "seller", agent: "review", pattern: /отзывы покупателей|что говорят покупатели|ответить на отзыв/i },
  { side: "seller", agent: "seller", pattern: /карточк[а|у] товар|создай товар|оформи|выложи|ассортимент|что добавить/i },
  { side: "seller", agent: "product", pattern: /создай товар|карточк[а|у] товар|оформи товар|выложи товар|сгенерируй.*описани|ai.*карточк/i },
  { side: "seller", agent: "compliance", pattern: /соответстви|regulatory|разрешени|сертификат соответствия|маркировк|честный знак|обязательн.*требован/i },
  { side: "seller", agent: "notification", pattern: /напомни|правил[о|а] автоматиза|если .* сообщи/i },

  // Buyer-side intents
  { side: "buyer", agent: "gift", pattern: /подар(ок|ок|ить)|что подарить|день рождения|групповой подарок/i },
  { side: "buyer", agent: "relationship", pattern: /друг|родственник|мама|папа|сестра|брат|коллега|семья|мои связи/i },
  { side: "buyer", agent: "order", pattern: /где мой заказ|статус заказа|мои заказы|отмени заказ|доставк[а|у] заказа/i },
  { side: "buyer", agent: "delivery", pattern: /когда доставят|где посылка|отслед|перевозчик|ПВЗ/i },
  { side: "buyer", agent: "payment", pattern: /оплат|возврат денег|чек|комисси|выплат[а|ы]/i },
  { side: "buyer", agent: "recommendation", pattern: /посоветуй|что мне (купить|подойдёт)|рекомендаци|персональн/i },
  { side: "buyer", agent: "memory", pattern: /запомни мои (предпочтени|размер|бюджет)|что ты обо мне знаешь/i },
  { side: "buyer", agent: "review", pattern: /отзывы|что говорят|стоит ли брать|какие плюсы|какие минусы|недостатки/i },
  { side: "buyer", agent: "vision", pattern: /по фот|фотографи|сделал фото|распознай товар/i },
  { side: "buyer", agent: "search", pattern: /найд[и|ите]|ищу|хочу купить|подбери|выбери|сравни|дешевле|аналог/i },
];

export interface RouteResult {
  agent: AgentKey;
  side: "buyer" | "seller";
  /** The rule that matched, for explainability. */
  matchedBy: string;
}

/**
 * @param text user message
 * @param side the conversational surface: seller cabinet vs. buyer storefront
 */
export function routeAgent(text: string, side: "buyer" | "seller"): RouteResult {
  const sideRules = RULES.filter((r) => r.side === side);
  for (const rule of sideRules) {
    if (rule.pattern.test(text)) {
      return { agent: rule.agent, side, matchedBy: rule.pattern.source };
    }
  }
  // Cross-side fallback: buyer questions asked anywhere route buyer-side.
  if (side === "seller") {
    for (const rule of RULES.filter((r) => r.side === "buyer")) {
      if (rule.pattern.test(text)) return { agent: rule.agent, side: "buyer", matchedBy: rule.pattern.source };
    }
  }
  return { agent: side === "seller" ? "seller" : "buyer", side, matchedBy: "default" };
}

/**
 * Tools each agent is allowed to request. The Master Agent still enforces
 * role-level permissions via the registry; this just shapes the prompt.
 */
export const AGENT_TOOLS: Record<AgentKey, string[]> = {
  buyer: ["search_products", "compare_products", "get_product", "search_sellers", "get_reviews", "check_inventory", "cart_add", "create_order", "get_order", "cancel_order", "get_tracking", "get_payment_status", "request_return", "create_dispute", "wishlist_add", "recall_memory", "remember_preference"],
  seller: ["analyze_seller_sales", "product_health", "advise_price", "change_price", "confirm_inventory", "extend_listing", "create_product_draft", "publish_product", "find_competitors", "scan_global_competitors", "delivery_quotes", "document_requirements", "create_workflow_rule"],
  search: ["search_products", "search_cheaper", "compare_products", "get_product", "search_sellers", "global_search"],
  vision: ["vision_search", "search_products", "search_cheaper", "compare_products"],
  recommendation: ["search_products", "recall_memory"],
  gift: ["plan_gift", "upcoming_events", "gift_context"],
  relationship: ["declare_relationship", "verified_circle"],
  order: ["get_order", "cancel_order", "cart_add"],
  delivery: ["get_tracking", "get_order", "delivery_quotes"],
  payment: ["get_payment_status", "get_order"],
  risk: ["assess_order_risk"],
  trust: ["document_requirements", "assess_order_risk"],
  review: ["get_reviews", "get_product"],
  competitor: ["find_competitors", "scan_global_competitors", "global_search", "advise_price"],
  pricing: ["advise_price", "change_price", "price_history"],
  analytics: ["analyze_seller_sales", "product_health"],
  product: ["create_product_draft", "publish_product", "product_health", "check_inventory"],
  compliance: ["document_requirements"],
  document: ["document_requirements"],
  memory: ["remember_preference", "recall_memory"],
  notification: ["create_workflow_rule"],
  support: ["get_order", "get_product", "get_tracking", "get_payment_status", "request_return", "create_dispute"],
};
