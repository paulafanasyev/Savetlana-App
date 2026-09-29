/**
 * VIN check domain — a fact about a vehicle, not an opinion.
 *
 * Adapter architecture: official/aggregator sources (GIBDD public check,
 * Avtoteka, Autocode) plug in behind one interface. Until real credentials
 * exist, results are labelled NOT_PROVEN and the platform never fabricates a
 * "clean" report (spec §49). A VIN check is also *stale* data: reports carry an
 * expiry and the buyer sees when it was actually produced (spec §122).
 */
import { prisma } from "../prisma";
import { readArray, writeJson } from "../db/json";
import { isValidEnum } from "../db/enums";
import { audit } from "./audit";
import { hashVin, isValidVin, maskVin } from "./classifieds";

export interface VinFinding {
  type: string; // accident | mileage_record | ownership | restriction | taxi | lease | wanted | pledge
  date?: string;
  description: string;
  source?: string;
}

export interface VinReport {
  status: "CLEAN" | "WARNINGS" | "PROBLEMS" | "UNAVAILABLE";
  source: string;
  make?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  ownersCount?: number;
  isWanted: boolean;
  hasRestrictions: boolean;
  findings: VinFinding[];
  restrictions: string[];
  verification: "VERIFIED" | "NOT_PROVEN";
  checkedAt: Date;
  expiresAt: Date;
}

/**
 * A VIN source adapter. `probe()` reports whether real credentials exist;
 * `check()` performs the actual lookup. Both are honest: a sandbox adapter
 * returns NOT_PROVEN, never a fabricated clean report.
 */
export interface VinSourceAdapter {
  key: string;
  label: string;
  available: boolean;
  probe(): Promise<boolean>;
  check(vin: string): Promise<VinReport | null>;
}

// ---------------------------------------------------------------------------
// Sandbox adapter — development/testing only, explicitly labelled
// ---------------------------------------------------------------------------

class SandboxVinAdapter implements VinSourceAdapter {
  key = "GIBDD";
  label = "ГИБДД (песочница)";
  available = true;

  async probe(): Promise<boolean> {
    // In sandbox mode the endpoint is reachable but carries no authority.
    return true;
  }

  async check(vin: string): Promise<VinReport | null> {
    if (!isValidVin(vin)) return null;
    const now = new Date();
    return {
      status: "WARNINGS",
      source: this.key,
      isWanted: false,
      hasRestrictions: false,
      findings: [
        {
          type: "sandbox_notice",
          description:
            "Проверка выполнена в режиме песочницы. Реальный отчёт ГИБДД будет получен после настройки официального доступа.",
        },
      ],
      restrictions: [],
      verification: "NOT_PROVEN",
      checkedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 86400_000),
    };
  }
}

// ---------------------------------------------------------------------------
// Real GIBDD public adapter (PENDING_EXTERNAL_ACCESS)
// ---------------------------------------------------------------------------

class GibddVinAdapter implements VinSourceAdapter {
  key = "GIBDD";
  label = "ГИБДД (официальный)";
  available = false;

  private get endpoint(): string | undefined {
    return process.env.GIBDD_CHECK_URL;
  }

  async probe(): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const res = await fetch(this.endpoint, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok || res.status === 405 || res.status === 404; // endpoint exists
    } catch {
      return false;
    }
  }

  async check(vin: string): Promise<VinReport | null> {
    if (!this.endpoint) return null;
    if (!isValidVin(vin)) return null;

    const res = await fetch(`${this.endpoint}?vin=${encodeURIComponent(vin)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      make?: string; model?: string; year?: number; mileageKm?: number;
      ownersCount?: number; isWanted?: boolean; hasRestrictions?: boolean;
      findings?: VinFinding[]; restrictions?: string[];
    };

    const findings = body.findings ?? [];
    const now = new Date();
    return {
      status: body.isWanted || body.hasRestrictions ? "PROBLEMS" : findings.length ? "WARNINGS" : "CLEAN",
      source: this.key,
      make: body.make,
      model: body.model,
      year: body.year,
      mileageKm: body.mileageKm,
      ownersCount: body.ownersCount,
      isWanted: body.isWanted ?? false,
      hasRestrictions: body.hasRestrictions ?? false,
      findings,
      restrictions: body.restrictions ?? [],
      verification: "VERIFIED",
      checkedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 86400_000),
    };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ADAPTERS: VinSourceAdapter[] = [
  // Real official source takes priority when configured; sandbox is the
  // explicit fallback so the pipeline is always exercisable in development.
  new GibddVinAdapter(),
  new SandboxVinAdapter(),
];

let resolvedAdapter: VinSourceAdapter | null = null;

async function resolveVinAdapter(): Promise<VinSourceAdapter> {
  if (resolvedAdapter && resolvedAdapter.available) return resolvedAdapter;
  for (const a of ADAPTERS) {
    if (await a.probe()) {
      resolvedAdapter = a;
      return a;
    }
  }
  resolvedAdapter = ADAPTERS[ADAPTERS.length - 1];
  return resolvedAdapter;
}

export async function getVinSourceStatus(): Promise<{
  source: string;
  available: boolean;
  verification: "VERIFIED" | "NOT_PROVEN";
  pendingExternalAccess: string[];
}> {
  const adapter = await resolveVinAdapter();
  const isReal = adapter instanceof GibddVinAdapter && !!(await adapter.probe());
  return {
    source: adapter.label,
    available: adapter.available,
    verification: isReal ? "VERIFIED" : "NOT_PROVEN",
    pendingExternalAccess: isReal
      ? []
      : ["GIBDD_CHECK_URL — официальный URL проверки VIN через ГИБДД/агрегатор"],
  };
}

// ---------------------------------------------------------------------------
// Check + persist
// ---------------------------------------------------------------------------

export async function runVinCheck(
  classifiedId: string,
  vin: string,
  actorId: string,
  opts: { actorRole?: string; force?: boolean } = {}
): Promise<VinReport> {
  const v = vin.trim().toUpperCase();
  if (!isValidVin(v)) {
    throw new Error("invalid_vin_format");
  }

  const classified = await prisma.classified.findUnique({
    where: { id: classifiedId },
    select: { id: true, authorId: true, vertical: true },
  });
  if (!classified) throw new Error("classified_not_found");
  if (classified.vertical !== "AUTO") throw new Error("vin_check_auto_only");

  // Idempotent: a fresh report within its validity window is reused.
  const existing = await prisma.vinCheck.findFirst({
    where: { vin: v, expiresAt: { gt: new Date() } },
  });
  if (existing && existing.checkedAt && !opts.force) {
    return rowToReport(existing);
  }

  const adapter = await resolveVinAdapter();
  const report = await adapter.check(v);
  if (!report) {
    // Honest failure: record the attempt, surface UNAVAILABLE, never fake.
    const now = new Date();
    const row = await prisma.vinCheck.create({
      data: {
        classifiedId,
        vin: v,
        vinHash: await hashVin(v),
        status: "UNAVAILABLE",
        source: adapter.key,
        findings: writeJson([
          { type: "lookup_failed", description: "Источник проверки не ответил. Попробуйте позже." },
        ]),
        restrictions: "[]",
        checkedAt: now,
        expiresAt: new Date(now.getTime() + 3600_000),
        verification: "NOT_PROVEN",
      },
    });
    await audit({
      actorId,
      actorRole: opts.actorRole ?? "BUYER",
      action: "vin.check_failed",
      targetType: "VinCheck",
      targetId: row.id,
      before: null,
      after: { vin: maskVin(v), source: adapter.key },
    });
    return rowToReport(row);
  }

  const created = await prisma.vinCheck.create({
    data: {
      classifiedId,
      vin: v,
      vinHash: await hashVin(v),
      make: report.make,
      model: report.model,
      year: report.year,
      status: isValidEnum("VinCheckStatus", report.status) ? report.status : "UNAVAILABLE",
      source: report.source,
      findings: writeJson(report.findings),
      restrictions: writeJson(report.restrictions),
      mileageKm: report.mileageKm,
      ownersCount: report.ownersCount,
      isWanted: report.isWanted,
      hasRestrictions: report.hasRestrictions,
      checkedAt: report.checkedAt,
      expiresAt: report.expiresAt,
      verification: report.verification,
    },
  });

  await audit({
    actorId,
    actorRole: opts.actorRole ?? "BUYER",
    action: "vin.checked",
    targetType: "VinCheck",
    targetId: created.id,
    before: null,
    after: { vin: maskVin(v), status: created.status, source: created.source },
  });

  return rowToReport(created);
}

function rowToReport(row: {
  status: string; source: string; make: string | null; model: string | null;
  year: number | null; mileageKm: number | null; ownersCount: number | null;
  isWanted: boolean; hasRestrictions: boolean; findings: string;
  restrictions: string; checkedAt: Date | null; expiresAt: Date | null;
  verification: string | null;
}): VinReport {
  // verification is persisted at check time. It is never re-derived here: a
  // sandbox report stays NOT_PROVEN even though a source answered, so the
  // buyer is never shown a fabricated "clean" history (spec §49).
  const verification: VinReport["verification"] =
    row.verification === "VERIFIED" ? "VERIFIED" : "NOT_PROVEN";
  return {
    status: (["CLEAN", "WARNINGS", "PROBLEMS", "UNAVAILABLE"].includes(row.status)
      ? row.status
      : "UNAVAILABLE") as VinReport["status"],
    source: row.source,
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    year: row.year ?? undefined,
    mileageKm: row.mileageKm ?? undefined,
    ownersCount: row.ownersCount ?? undefined,
    isWanted: row.isWanted,
    hasRestrictions: row.hasRestrictions,
    findings: readArray<VinFinding>(row.findings),
    restrictions: readArray<string>(row.restrictions),
    verification,
    checkedAt: row.checkedAt ?? new Date(0),
    expiresAt: row.expiresAt ?? new Date(0),
  };
}

export async function getLatestVinCheck(classifiedId: string) {
  const row = await prisma.vinCheck.findFirst({
    where: { classifiedId },
    orderBy: { createdAt: "desc" },
  });
  return row ? rowToReport(row) : null;
}
