// On-device model probe (Chrome Prompt API / LanguageModel).
//
// SDK-free: only touches `window.LanguageModel`, so it can be imported by
// the initial bundle without pulling in Firebase AI Logic.

import type { NanoAvailability } from './types';

/** On-device (Gemini Nano) is only used for short notes; longer ones go to cloud. */
export const ON_DEVICE_CHAR_LIMIT = 6000;

interface LanguageModelGlobal {
  availability: () => Promise<string>;
}

function getLanguageModel(): LanguageModelGlobal | null {
  const lm = (window as unknown as Record<string, unknown>).LanguageModel;
  if (!lm || typeof (lm as LanguageModelGlobal).availability !== 'function') return null;
  return lm as LanguageModelGlobal;
}

/** Probe Chrome's on-device model. Never throws — returns 'unsupported' instead. */
export async function checkNanoAvailability(): Promise<NanoAvailability> {
  const lm = getLanguageModel();
  if (!lm) return 'unsupported';
  try {
    const status = await lm.availability();
    if (
      status === 'available' ||
      status === 'downloadable' ||
      status === 'downloading' ||
      status === 'unavailable'
    ) {
      return status;
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
