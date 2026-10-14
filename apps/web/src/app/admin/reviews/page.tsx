import { requireAdminServer } from "@/lib/auth";
import { listReviewModerationQueue } from "@/lib/domains/review-screening";
import { REVIEW_FINDING_LABEL } from "@/lib/domains/review-guard";

export const dynamic = "force-dynamic";

/** Отзывы, которые антифрод отправил на проверку. */
export default async function AdminReviewsModerationPage() {
  await requireAdminServer();
  const queue = await listReviewModerationQueue();

  return (
    <section className="space-y-4">
      <div className="card space-y-1 p-4">
        <h2 className="text-base font-bold text-ink">Отзывы на проверке</h2>
        <p className="text-sm text-ink-soft">
          Здесь отзывы с признаками накрутки: волна оценок от новых аккаунтов, отзыв за кешбэк, повтор текста, крайняя
          оценка без покупок. Пока вы не решите, отзыв скрыт и не влияет на рейтинг. Отзывы на свой товар, с фишинговыми
          ссылками и номерами карт не принимаются сразу.
        </p>
        <p className="text-sm text-ink">
          Ждут решения: <b>{queue.length}</b>
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">Очередь пуста</div>
      ) : (
        queue.map((r) => (
          <div key={r.id} className="card space-y-3 p-4">
            <div>
              <div className="font-medium text-ink">
                {"★".repeat(r.rating)}
                {"☆".repeat(5 - r.rating)} · {r.productTitle}
              </div>
              <div className="text-xs text-ink-faint">
                {r.authorName ?? "без имени"} ({r.authorEmail}) · {r.verifiedPurchase ? "покупка подтверждена" : "без покупки"} ·{" "}
                {new Date(r.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.codes.map((c) => (
                <span key={c} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {REVIEW_FINDING_LABEL[c] ?? c}
                </span>
              ))}
            </div>
            <p className="whitespace-pre-wrap text-sm text-ink">{r.body}</p>
            <form action={`/api/admin/reviews/${r.id}`} method="POST" className="flex flex-wrap items-center gap-2">
              <input name="note" maxLength={200} placeholder="Заметка (необязательно)" className="input min-w-[16rem] flex-1 text-sm" />
              <button name="decision" value="approve" className="btn btn-primary text-sm">
                Опубликовать
              </button>
              <button name="decision" value="reject" className="btn btn-ghost text-sm text-bad">
                Не публиковать
              </button>
            </form>
          </div>
        ))
      )}
    </section>
  );
}
