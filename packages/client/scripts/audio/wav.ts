/**
 * Minimalis WAV-beolvasas es -iras.
 *
 * SZANDEKOSAN nincs hozza csomag: egyetlen, jol korulhatarolt formatumot
 * kell kezelni (PCM WAV), es a hangelokeszites egy ritkan futo,
 * fejlesztoi lepes -- egy fuggoseg tobbe kerulne, mint amennyit er.
 */
import { readFileSync, writeFileSync } from "node:fs";

export interface Hang {
  /** Csatornank egy-egy -1..1 kozotti mintasor. */
  csatornak: Float32Array[];
  mintavetel: number;
}

export function beolvas(utvonal: string): Hang {
  const b = readFileSync(utvonal);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`nem WAV fajl: ${utvonal}`);
  }

  let p = 12;
  let kod = 0;
  let csatDb = 0;
  let mintavetel = 0;
  let bit = 0;
  let adat: Buffer | null = null;

  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const meret = b.readUInt32LE(p + 4);
    if (id === "fmt ") {
      kod = b.readUInt16LE(p + 8);
      csatDb = b.readUInt16LE(p + 10);
      mintavetel = b.readUInt32LE(p + 12);
      bit = b.readUInt16LE(p + 22);
    } else if (id === "data") {
      adat = b.subarray(p + 8, p + 8 + meret);
    }
    // A darabok paros hosszra vannak igazitva -- a paratlant egy
    // kitolto bajt koveti, amit at kell lepni.
    p += 8 + meret + (meret % 2);
  }
  if (!adat) throw new Error(`nincs adat-darab: ${utvonal}`);

  const bajt = bit / 8;
  const hossz = adat.length / (bajt * csatDb);
  const csatornak = Array.from(
    { length: csatDb },
    () => new Float32Array(hossz),
  );

  for (let i = 0; i < hossz; i++) {
    for (let c = 0; c < csatDb; c++) {
      const o = (i * csatDb + c) * bajt;
      let v: number;
      if (bit === 16) v = adat.readInt16LE(o) / 32768;
      else if (bit === 24) {
        // 24 bites elojeles ertek harom bajtbol, elojel-kiterjesztessel.
        const nyers = adat[o] | (adat[o + 1] << 8) | (adat[o + 2] << 16);
        v = ((nyers << 8) >> 8) / 8388608;
      } else if (bit === 32 && kod === 3) v = adat.readFloatLE(o);
      else if (bit === 32) v = adat.readInt32LE(o) / 2147483648;
      else throw new Error(`nem tamogatott mintameret: ${bit} bit`);
      csatornak[c][i] = v;
    }
  }
  return { csatornak, mintavetel };
}

/** Mono, 16 bites PCM WAV kiiras -- ezt tolti be a bongeszo. */
export function kiir(utvonal: string, minta: Float32Array, mintavetel: number): void {
  const adatMeret = minta.length * 2;
  const b = Buffer.alloc(44 + adatMeret);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + adatMeret, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(mintavetel, 24);
  b.writeUInt32LE(mintavetel * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(adatMeret, 40);
  for (let i = 0; i < minta.length; i++) {
    const v = Math.max(-1, Math.min(1, minta[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(utvonal, b);
}
