/** Rejestruje hak resolucji we wszystkich procesach potomnych node:test. */
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
