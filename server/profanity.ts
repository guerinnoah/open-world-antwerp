import { RegExpMatcher, TextCensor, asteriskCensorStrategy, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { cleanChat, cleanName } from '../src/net/protocol.ts';

const english = englishDataset.build();
const profanity = new RegExpMatcher({
  ...english, ...englishRecommendedTransformers, whitelistedTerms: [...(english.whitelistedTerms ?? []), 'cockpit'],
});
const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

/** '' for an offensive name, so the caller falls back to a generated one. */
export function safeName(raw: unknown): string {
  const name = cleanName(raw);
  return profanity.hasMatch(name) ? '' : name;
}

export function safeChat(raw: unknown): string {
  const text = cleanChat(raw);
  return censor.applyTo(text, profanity.getAllMatches(text));
}
