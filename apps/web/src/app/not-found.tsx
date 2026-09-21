import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-4 text-2xl font-bold text-ink">Страница не найдена</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Возможно, ссылка устарела. Светлана поможет найти то, что вы искали.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          На главную
        </Link>
        <Link href="/svetlana" className="btn btn-ghost">
          К Светлане
        </Link>
      </div>
    </div>
  );
}
