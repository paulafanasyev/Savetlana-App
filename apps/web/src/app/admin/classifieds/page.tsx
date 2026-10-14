import { requireUserServer } from "@/lib/auth";
import { listModerationQueue } from "@/lib/domains/classified-screening";
import { CLASSIFIED_FINDING_LABEL } from "@/lib/domains/classified-guard";
import { rub } from "@/lib/format";

export const dynamic = "force-dynamic";

const VERTICAL_LABEL: Record<string, string> = { REAL_ESTATE: "Недвижимость", AUTO: "Авто", SERVICE: "Услуги" };

/** Объявления, которые антифрод отправил на проверку. */
export default async function AdminClassifiedsModerationPage() {
  const { user } = await requireUserServer();
  if (user.role !== "ADMIN") return null;
  const queue = await listModerationQueue();

  return (
    <section className="space-y-4">
      <div className="card space-y-1 p-4">
        <h2 className="text-base font-bold text-ink">Объявления на проверке</h2>
        <p className="text-sm text-ink-soft">
          Антифрод нашёл в этих объявлениях признаки мошенничества. Пока вы не решите, в поиске их не видно. Явно опасные
          (фишинговые ссылки, номер карты, вербовка дропов) сюда не попадают: они отклоняются сразу.
        </p>
        <p className="text-sm text-ink">
          Ждут решения: <b>{queue.length}</b>
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">Очередь пуста</div>
      ) : (
        queue.map((ad) => (
          <div key={ad.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-ink">{ad.title}</div>
                <div className="text-xs text-ink-faint">
                  {VERTICAL_LABEL[ad.vertical] ?? ad.vertical} · {ad.cityName} · {ad.priceKopecks > 0 ? rub(ad.priceKopecks) : "без цены"} ·{" "}
                  {ad.authorName ?? "без имени"} ({ad.authorEmail}) · {new Date(ad.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ad.codes.map((c) => (
                <span key={c} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {CLASSIFIED_FINDING_LABEL[c] ?? c}
                </span>
              ))}
            </div>
            {ad.explanation && <p className="text-sm text-ink-soft">{ad.explanation}</p>}
            <form action={`/api/admin/classifieds/${ad.id}`} method="POST" className="flex flex-wrap items-center gap-2">
              <input
                name="note"
                maxLength={300}
                placeholder="Причина отказа (автор её увидит)"
                className="input min-w-[16rem] flex-1 text-sm"
              />
              <button name="decision" value="approve" className="btn btn-primary text-sm">
                Опубликовать
              </button>
              <button name="decision" value="reject" className="btn btn-ghost text-sm text-bad">
                Отклонить
              </button>
            </form>
          </div>
        ))
      )}
    </section>
  );
}
