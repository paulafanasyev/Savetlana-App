/**
 * External marketplace adapter contract (spec §13, §26, §149).
 *
 * Svetlana must be able to search for products and analyse competitors GLOBALLY,
 * not only inside this platform. Ozon and Wildberries are first-class external
 * sources. The contract is identical for every marketplace so new ones plug in
 * without touching the agent layer (spec §104 adapter philosophy).
 *
 * HONESTY RULES (spec §49, §58):
 *  - An adapter is `available` only when the network endpoint is actually
 *    reachable AND the request returned a parseable payload.
 *  - Prices are normalised to KOPECKS internally. Because external feeds vary
 *    in units, every parsed batch runs through a plausibility check; a batch
 *    whose prices are implausible is returned as `NOT_PROVEN` with the reason
 *    recorded — never as silently wrong numbers.
 *  - Only public catalog data is read. There is no access to other sellers'
 *    private cabinets and no copying of protected content (spec §13).
 */

export interface ExternalSearchQuery {
  text: string;
  limit?: number;
  minPriceKopecks?: number;
  maxPriceKopecks?: number;
}

/**
 * A single offer found on an external marketplace, already normalised.
 */
export interface ExternalOffer {
  marketplace: string;
  externalId: string;
  title: string;
  url: string;
  priceKopecks: number;
  oldPriceKopecks?: number;
  currency: string;
  rating?: number;
  reviewsCount?: number;
  sellerName?: string;
  brand?: string;
  inStock?: boolean;
  deliveryText?: string;
  imageUrl?: string;
}

export type OfferConfidence = "VERIFIED" | "NOT_PROVEN";

export interface ExternalSearchResult {
  marketplace: string;
  offers: ExternalOffer[];
  /** Real HTTP status or an explicit failure category. */
  status: "OK" | "UNREACHABLE" | "BLOCKED" | "PARSE_FAILED" | "EMPTY" | "MISCONFIGURED";
  confidence: OfferConfidence;
  /** Present whenever confidence is NOT_PROVEN — the human-readable reason. */
  warning?: string;
  latencyMs: number;
}

/**
 * Regional tier (spec §104 — country adapters, expandable platform).
 *
 * TIER 1 — Russia. Always scanned. This is the seller's home market: Ozon and
 * Wildberries plus the platform itself.
 *
 * TIER 2 — Global. Scanned ONLY when the seller explicitly asks for a global
 * sweep (AliExpress, Taobao, Amazon). Cross-border offers carry longer
 * delivery, customs and currency considerations, so they are never mixed into
 * the default Russia-level verdict silently.
 */
export type MarketplaceRegion = "RU" | "GLOBAL";

export interface MarketplaceAdapter {
  readonly key: string;
  readonly label: string;
  /** Regional tier this marketplace belongs to. */
  readonly region: MarketplaceRegion;
  /** True only for a fixture-based adapter used in tests. */
  readonly sandbox: boolean;
  /** Currency the marketplace quotes in (offers are converted to RUB via CBR). */
  readonly currency: string;
  /**
   * Live reachability + shape check. Performs one real request and validates
   * that the response parses. Used to decide `available`.
   */
  probe(): Promise<boolean>;
  search(query: ExternalSearchQuery): Promise<ExternalSearchResult>;
}
