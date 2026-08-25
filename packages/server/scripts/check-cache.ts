/**
 * Gyorsitotar-fejlecek: mit tarolhat el a bongeszo, es mit nem.
 *
 * KET, ELLENTETES hibat ved:
 *
 *  1. Ha az index.html eltarolhato, egy deploy utan a visszatero
 *     jatekos a REGI oldalt kapja, ami a REGI csomagra mutat -- es
 *     protokoll-eltereskent talalkozik vele. Ez MINDEN visszateroet
 *     erint, tehat pont a kozos jatek elejen.
 *  2. Ha a hasitott nevu csomag NEM tarolhato el, a 3.4 MB minden
 *     betolteskor ujra letoltodik. A nevben tartalom-hash van, tehat
 *     ez tiszta veszteseg.
 *
 * A szervernek futnia kell (npm run dev:server vagy start).
 *
 * Futtatas: npm run check:cache
 */
const URL = process.env.SERVER_URL ?? "http://localhost:8080";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function headerOf(path: string, name: string): Promise<string | null> {
  const res = await fetch(`${URL}${path}`);
  if (!res.ok) return null;
  // A torzset elolvassuk, kulonben a kapcsolat nyitva maradhat.
  await res.arrayBuffer();
  return res.headers.get(name);
}

async function main(): Promise<void> {
  console.log("=== Gyorsitotar-fejlecek ===\n");

  // --- Az oldal MINDIG ellenorzodjon ---
  const html = await headerOf("/", "cache-control");
  check(
    "az index.html nem tarolhato el ellenorzes nelkul",
    html !== null && /no-cache|no-store|max-age=0/.test(html),
    `cache-control: ${html ?? "nincs"}`,
  );

  // --- A hasitott nevu csomag viszont ORÖKRE eltarolhato ---
  //
  // A nevet az index.html-bol olvassuk ki, nem beegetve: minden build
  // mas hasitast ad.
  const page = await (await fetch(`${URL}/`)).text();
  const asset = page.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0] ?? null;
  check(
    "az oldal hasitott nevu csomagra hivatkozik",
    asset !== null,
    asset ?? "nem talalhato /assets/... hivatkozas",
  );

  if (asset) {
    const js = await headerOf(asset, "cache-control");
    check(
      "a hasitott nevu csomag hosszan eltarolhato",
      js !== null && /immutable/.test(js) && /max-age=\d{6,}/.test(js),
      `cache-control: ${js ?? "nincs"}`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
