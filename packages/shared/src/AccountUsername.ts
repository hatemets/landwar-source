import { z } from "zod";

export const MIN_ACCOUNT_USERNAME_LENGTH = 3;
export const MAX_ACCOUNT_USERNAME_LENGTH = 20;

// Account-username rules. The client checks them for instant form feedback.
// The server checks them again, with profanity, when it saves a name. No
// dots (the dot separates base from suffix) and no unicode. Single spaces
// may separate words; edges are trimmed and consecutive spaces rejected so
// no two distinct bases render alike.
// The per-character half of the rule below. Kept beside it, and used to build
// it, so the two cannot drift: a sanitiser that seeds this form has to agree
// with the form about which characters survive, and re-typing the class in the
// sanitiser is exactly how that goes wrong.
export const ACCOUNT_NAME_CHARS = "a-zA-Z0-9_-";

export const AccountUsernameSchema = z
  .string()
  .trim()
  .min(MIN_ACCOUNT_USERNAME_LENGTH)
  .max(MAX_ACCOUNT_USERNAME_LENGTH)
  .regex(new RegExp(`^[${ACCOUNT_NAME_CHARS}]+( [${ACCOUNT_NAME_CHARS}]+)*$`));
