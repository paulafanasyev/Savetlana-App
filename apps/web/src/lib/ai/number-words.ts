/**
 * Числа словами в запросах: «до пяти тысяч», «за триста рублей», «полторы
 * тысячи». Светлана и поиск понимают цифры, поэтому перед разбором меняем
 * числительные на цифры. Одиночные маленькие числа («один из них», «два
 * чайника») не трогаем: там это обычно не цена.
 */
const UNITS: Record<string, number> = {
  ноль: 0, нуля: 0,
  один: 1, одна: 1, одно: 1, одного: 1, одной: 1, одну: 1,
  два: 2, две: 2, двух: 2,
  три: 3, трех: 3,
  четыре: 4, четырех: 4,
  пять: 5, пяти: 5,
  шесть: 6, шести: 6,
  семь: 7, семи: 7,
  восемь: 8, восьми: 8,
  девять: 9, девяти: 9,
  десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11,
  двенадцать: 12, двенадцати: 12,
  тринадцать: 13, тринадцати: 13,
  четырнадцать: 14, четырнадцати: 14,
  пятнадцать: 15, пятнадцати: 15,
  шестнадцать: 16, шестнадцати: 16,
  семнадцать: 17, семнадцати: 17,
  восемнадцать: 18, восемнадцати: 18,
  девятнадцать: 19, девятнадцати: 19,
  двадцать: 20, двадцати: 20,
  тридцать: 30, тридцати: 30,
  сорок: 40, сорока: 40,
  пятьдесят: 50, пятидесяти: 50,
  шестьдесят: 60, шестидесяти: 60,
  семьдесят: 70, семидесяти: 70,
  восемьдесят: 80, восьмидесяти: 80,
  девяносто: 90, девяноста: 90,
  сто: 100, ста: 100,
  двести: 200, двухсот: 200,
  триста: 300, трехсот: 300,
  четыреста: 400, четырехсот: 400,
  пятьсот: 500, пятисот: 500,
  шестьсот: 600, шестисот: 600,
  семьсот: 700, семисот: 700,
  восемьсот: 800, восьмисот: 800,
  девятьсот: 900, девятисот: 900,
};

const MULTIPLIERS: Record<string, number> = {
  тысяча: 1_000, тысячи: 1_000, тысяч: 1_000, тысячу: 1_000, тыс: 1_000,
  миллион: 1_000_000, миллиона: 1_000_000, миллионов: 1_000_000, млн: 1_000_000,
};

const HALF: Record<string, number> = {
  полторы: 1.5, полтора: 1.5,
  полтысячи: 500, полмиллиона: 500_000,
};

interface Token { word: string; start: number; end: number }

function norm(word: string): string {
  return word.toLowerCase().replace(/ё/g, "е");
}

function isNumberWord(w: string): boolean {
  return w in UNITS || w in MULTIPLIERS || w in HALF || /^\d+$/.test(w);
}

/** Значение последовательности числительных или null, если это не число. */
function valueOf(words: string[]): { value: number; hasMultiplier: boolean } | null {
  let total = 0;
  let current = 0;
  let hasMultiplier = false;
  let any = false;
  for (const w of words) {
    if (w in HALF) {
      if (HALF[w] >= 500) { total += HALF[w]; hasMultiplier = true; any = true; continue; }
      current += HALF[w];
      any = true;
      continue;
    }
    if (/^\d+$/.test(w)) { current += Number(w); any = true; continue; }
    if (w in UNITS) { current += UNITS[w]; any = true; continue; }
    if (w in MULTIPLIERS) {
      total += (any && current > 0 ? current : 1) * MULTIPLIERS[w];
      current = 0;
      hasMultiplier = true;
      any = true;
      continue;
    }
    return null;
  }
  return any ? { value: Math.round(total + current), hasMultiplier } : null;
}

const ORDINAL_NEXT = /^(перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят)/;

/** «двух с половиной тысяч» → «2500». */
function withHalf(text: string): string {
  return text.replace(/([а-яёА-ЯЁ]+|\d+)\s+с\s+половиной\s+(тысяч[а-яё]*|миллион[а-яё]*)/gi, (all, head: string, mult: string) => {
    const h = norm(head);
    const base = /^\d+$/.test(h) ? Number(h) : UNITS[h];
    const k = MULTIPLIERS[norm(mult)] ?? (norm(mult).startsWith("тысяч") ? 1_000 : 1_000_000);
    return typeof base === "number" ? String(Math.round((base + 0.5) * k)) : all;
  });
}

export function numberWordsToDigits(input: string): string {
  const text = withHalf(input);
  const tokens: Token[] = [];
  const re = /[а-яёА-ЯЁ]+|\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });

  let out = "";
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumberWord(norm(tokens[i].word))) continue;
    // Набираем подряд идущие числительные, разделённые только пробелами.
    let j = i;
    while (
      j + 1 < tokens.length &&
      isNumberWord(norm(tokens[j + 1].word)) &&
      /^\s+$/.test(text.slice(tokens[j].end, tokens[j + 1].start))
    ) j++;
    const run = tokens.slice(i, j + 1);
    const words = run.map((t) => norm(t.word));
    const parsed = valueOf(words);
    const onlyDigits = words.every((w) => /^\d+$/.test(w));
    const next = tokens[j + 1] ? norm(tokens[j + 1].word) : "";
    const money = /^(руб|р$|₽)/.test(next);
    // «сорок второго размера»: это порядковое число, не цена.
    const ordinal = ORDINAL_NEXT.test(next) && !isNumberWord(next);
    if (!ordinal && parsed && !onlyDigits && (parsed.hasMultiplier || parsed.value >= 10 || money)) {
      out += text.slice(cursor, run[0].start) + String(parsed.value);
      cursor = run[run.length - 1].end;
    }
    i = j;
  }
  return out + text.slice(cursor);
}
