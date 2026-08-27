/**
 * Hangmuveletek a letoltott felvetelekhez.
 *
 * MIND a felvetelen vegzett igazitas -- vagas, szint, mono, loop --,
 * nem hangszintezis: a forras vegig a valodi felvetel marad.
 */

/**
 * Monova keveres.
 *
 * A jatekban a hangok TERBEN szolalnak meg (a jatekos autojahoz kepest
 * balra/jobbra), tehat a felvetel sajat sztereo kepe ugysem latszana --
 * a bongeszo a monobol keveri ki a panoramat. Sztereo forrassal ez
 * ossze is akadna: a mar kevert kep es a szamolt panorama.
 */
export function monova(csatornak: Float32Array[]): Float32Array {
  if (csatornak.length === 1) return csatornak[0];
  const ki = new Float32Array(csatornak[0].length);
  for (let i = 0; i < ki.length; i++) {
    let osszeg = 0;
    for (const c of csatornak) osszeg += c[i];
    ki[i] = osszeg / csatornak.length;
  }
  return ki;
}

/**
 * Egyenaramu eltolas (DC) eltavolitasa.
 *
 * A nullatol eltolt hullamforma a hang INDULASAKOR es VEGEN is
 * kattanast ad (a hangszoro ugrik a nullarol az eltolt szintre), es
 * feleslegesen elveszi a fejteret. A gepfegyver-mintan 0.24 volt.
 */
export function dcTelenit(minta: Float32Array): Float32Array {
  let osszeg = 0;
  for (const v of minta) osszeg += v;
  const atlag = osszeg / minta.length;
  const ki = new Float32Array(minta.length);
  for (let i = 0; i < minta.length; i++) ki[i] = minta[i] - atlag;
  return ki;
}

/**
 * A csend levagasa a ket vegerol.
 *
 * Az ELEJEN azert, mert a jatek egy esemenyre inditja a hangot: 12 ms
 * csend mar erezheto kesest ad a ravasz es a durranas kozott. A VEGEN
 * azert, mert puszta helypazarlas -- az agyu-mintanak a fele volt csend.
 */
export function csendetVag(
  minta: Float32Array,
  kuszob = 0.002,
): Float32Array {
  let elso = 0;
  while (elso < minta.length && Math.abs(minta[elso]) < kuszob) elso++;
  let utolso = minta.length - 1;
  while (utolso > elso && Math.abs(minta[utolso]) < kuszob) utolso--;
  return minta.slice(elso, utolso + 1);
}

/**
 * Ujramintavetelezes.
 *
 * ELOSZOR aluláteresztő szuro, CSAK UTANA ritkitas: e nelkul a 96 kHz-es
 * felvetel 22 kHz feletti tartalma a hallhato savba tukrozodne vissza
 * (alias), es fémes csengest adna a robbanasnak.
 */
export function ujramintavetel(
  minta: Float32Array,
  bemenetiRata: number,
  kimenetiRata: number,
): Float32Array {
  if (bemenetiRata === kimenetiRata) return minta;

  const szurt =
    kimenetiRata < bemenetiRata
      ? alulatereszto(minta, (kimenetiRata * 0.45) / bemenetiRata)
      : minta;

  const arany = bemenetiRata / kimenetiRata;
  const hossz = Math.floor(minta.length / arany);
  const ki = new Float32Array(hossz);
  for (let i = 0; i < hossz; i++) {
    const p = i * arany;
    const j = Math.floor(p);
    const t = p - j;
    const a = szurt[j] ?? 0;
    const b = szurt[j + 1] ?? a;
    ki[i] = a + (b - a) * t;
  }
  return ki;
}

/** Ablakozott sinc alulateresztő. A vagasi frekvencia 0..0.5 (a mintaveteli rata tortje). */
function alulatereszto(minta: Float32Array, vagas: number): Float32Array {
  const N = 63;
  const fel = (N - 1) / 2;
  const mag = new Float32Array(N);
  let osszeg = 0;
  for (let i = 0; i < N; i++) {
    const x = i - fel;
    const sinc =
      x === 0 ? 2 * vagas : Math.sin(2 * Math.PI * vagas * x) / (Math.PI * x);
    // Hamming-ablak: e nelkul a levagott sinc hullamzast vinne a savba.
    const ablak = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
    mag[i] = sinc * ablak;
    osszeg += mag[i];
  }
  for (let i = 0; i < N; i++) mag[i] /= osszeg;

  const ki = new Float32Array(minta.length);
  for (let i = 0; i < minta.length; i++) {
    let e = 0;
    for (let k = 0; k < N; k++) {
      const j = i + k - fel;
      if (j >= 0 && j < minta.length) e += minta[j] * mag[k];
    }
    ki[i] = e;
  }
  return ki;
}

/** Rovid be- es kiuszatas, hogy a minta ne kattanjon. */
export function uszat(
  minta: Float32Array,
  mintavetel: number,
  beMs: number,
  kiMs: number,
): Float32Array {
  const ki = Float32Array.from(minta);
  const be = Math.round((mintavetel * beMs) / 1000);
  const veg = Math.round((mintavetel * kiMs) / 1000);
  for (let i = 0; i < be && i < ki.length; i++) ki[i] *= i / be;
  for (let i = 0; i < veg && i < ki.length; i++) {
    ki[ki.length - 1 - i] *= i / veg;
  }
  return ki;
}

/**
 * Varratmentes loop: a minta VEGET beleusztatjuk az ELEJEBE.
 *
 * A motor-felvetel vege es eleje kozott kis ugras van (merve: 0.039).
 * Ez onmagaban halk, de MASODPERCENKENT ISMETLODNE -- egy allando,
 * ritmusos kattogas lenne belole, ami hangosabban hallatszik, mint
 * amilyen nagy. Az atuszatas ezt tunteti el: a hurok utolso szakasza
 * mar az elejevel keveredik, tehat a varrat helyen nincs ugras.
 */
export function loopVarrat(
  minta: Float32Array,
  mintavetel: number,
  uszatasMs = 50,
): Float32Array {
  const n = Math.min(
    Math.round((mintavetel * uszatasMs) / 1000),
    Math.floor(minta.length / 4),
  );
  const ki = minta.slice(0, minta.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    ki[i] = minta[i] * t + minta[minta.length - n + i] * (1 - t);
  }
  return ki;
}

/** Csucs-normalizalas a megadott szintre (0..1). */
export function normalizal(minta: Float32Array, cel = 0.89): Float32Array {
  let csucs = 0;
  for (const v of minta) csucs = Math.max(csucs, Math.abs(v));
  if (csucs === 0) return minta;
  const szorzo = cel / csucs;
  const ki = new Float32Array(minta.length);
  for (let i = 0; i < minta.length; i++) ki[i] = minta[i] * szorzo;
  return ki;
}
