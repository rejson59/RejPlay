/**
 * Hak resolucji dla `node --test` + natywnego strip-types w Node 22.
 *
 * Kod produkcyjny używa importów bez rozszerzenia (`./hand-pose`), co Vite
 * rozwiązuje, a goły ESM w Node już nie. Dokładamy `.ts` bez zmiany źródeł —
 * dzięki temu testy działają na tym samym kodzie, który trafia do produkcji.
 */
export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Spróbuj kolejnego wariantu, a na końcu oddaj oryginalny błąd.
      }
    }
  }
  return nextResolve(specifier, context);
}
