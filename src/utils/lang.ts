/**
 * Natural language detection for the /Lang entry (PDF/UA 7.2).
 *
 * PDF/UA requires a declared default language, and a *wrong* declaration is
 * worse than a clumsy one: screen readers will pronounce the text with the
 * wrong phonetics. So inference is deliberately conservative, and the caller
 * always reports what was inferred so the user can override it.
 */

/** ひらがな・カタカナ（かながあれば日本語と断定できる） */
const KANA_RE = /[぀-ヿ]/;
/** ハングル */
const HANGUL_RE = /[가-힯ᄀ-ᇿ]/;
/** 漢字（日中いずれもありうる） */
const HAN_RE = /[一-鿿㐀-䶿]/;

export interface InferredLang {
  lang: string;
  /** 断定できたか（false のとき呼び出し側は警告を出す） */
  confident: boolean;
}

/**
 * 本文から BCP 47 の言語タグを推定する。
 * かなが無い漢字のみの文書は中国語の可能性があるため confident=false を返す。
 */
export function inferLang(text: string): InferredLang {
  if (KANA_RE.test(text)) return { lang: 'ja', confident: true };
  if (HANGUL_RE.test(text)) return { lang: 'ko', confident: true };
  if (HAN_RE.test(text)) {
    // 漢字のみ: 日本語とも中国語とも取れる。本サーバの主用途に寄せて ja とするが断定しない
    return { lang: 'ja', confident: false };
  }
  return { lang: 'en', confident: true };
}
