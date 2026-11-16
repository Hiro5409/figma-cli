import { args, combinator, required, string } from "gunshi/combinators";
import * as v from "valibot";

import { parseCliInput } from "../../cli-input.ts";

// Figma names reactions by shortcode, optionally with a skin tone: ":+1::skin-tone-2:".
const EmojiSchema = v.pipe(
  v.string(),
  v.regex(/^(?::[\w+-]+:){1,2}$/, 'Expected an emoji shortcode such as ":heart:".'),
);

export const reactionArgs = args({
  "comment-id": required(string({ description: "Comment ID" })),
  emoji: required(
    combinator({
      description: 'Emoji shortcode, such as ":heart:" or ":+1:"',
      parse: (value) => parseCliInput(EmojiSchema, value, { label: "--emoji" }),
    }),
  ),
});
