// Comment text for Jira servers whose database cannot store characters above
// U+FFFF: the write-side encoding a profile opts into, and the decoded view
// that comment and worklog reads add next to the stored text.

/**
 * Profile setting `supplementaryCharacters`. "unicode" (the default) sends text
 * as written; "entities" sends characters above U+FFFF as numeric entities.
 */
export const SUPPLEMENTARY_CHARACTER_MODES = Object.freeze(["unicode", "entities"]);

// Characters outside the Basic Multilingual Plane (U+10000 and above) take
// four bytes in UTF-8: most emoji, including the agent marker U+1F916.
const SUPPLEMENTARY_CHARACTER = /[\u{10000}-\u{10FFFF}]/gu;

/**
 * Replace each character above U+FFFF with a decimal HTML numeric entity
 * (U+1F916 becomes "&#129302;"). Every other character is left unchanged.
 *
 * Workaround: a Jira Server database that stores only 3-byte UTF-8 (MySQL
 * "utf8" rather than "utf8mb4") answers HTTP 500 to a comment containing a
 * 4-byte character and stores nothing. The wiki renderer passes numeric
 * entities through to HTML, so the page still shows the emoji. Inside {code}
 * and {noformat} blocks the renderer escapes the entity, so a real emoji
 * written there shows as entity text. Turn the profile setting off once the
 * server's database stores utf8mb4.
 *
 * @param {string | null | undefined} text
 * @returns {string | null | undefined} the encoded text; null and undefined pass through
 */
export function encodeSupplementaryCharacters(text) {
  if (typeof text !== "string") return text;
  return text.replace(SUPPLEMENTARY_CHARACTER, (character) => `&#${character.codePointAt(0)};`);
}

const sendUnchanged = (text) => text;

/**
 * The encoder for comment text sent with this profile: entity encoding when the
 * profile sets `supplementaryCharacters: "entities"`, otherwise the identity.
 *
 * @param {{ supplementaryCharacters?: string } | undefined} profile
 * @returns {(text: string | null | undefined) => string | null | undefined}
 */
export function commentTextEncoder(profile) {
  return profile?.supplementaryCharacters === "entities" ? encodeSupplementaryCharacters : sendUnchanged;
}

/**
 * Encode the body of every operation in an edit or transition `update.comment`
 * list, such as `[{ add: { body } }, { edit: { id, body } }]`. Other update
 * keys and operations without a string body pass through unchanged.
 *
 * @param {object | undefined} update a Jira `update` object
 * @param {(text: string) => string} encode
 * @returns {object | undefined} a copy with encoded comment bodies, or the input when it has no comment list
 */
export function encodeCommentOperations(update, encode) {
  if (!Array.isArray(update?.comment)) return update;
  const comment = update.comment.map((operation) => {
    if (!operation || typeof operation !== "object") return operation;
    return Object.fromEntries(Object.entries(operation).map(([verb, value]) => [
      verb,
      typeof value?.body === "string" ? { ...value, body: encode(value.body) } : value,
    ]));
  });
  return { ...update, comment };
}

// Decimal or hex entities that name a code point above U+FFFF.
const SUPPLEMENTARY_ENTITY = /&#(?:[xX]([0-9a-fA-F]{5,6})|(\d{5,7}));/g;

// A {code} or {noformat} block, with optional parameters, up to its closing tag.
// An unclosed block runs to the end of the text, as the renderer treats it.
const LITERAL_BLOCK = /\{(code|noformat)(?::[^}]*)?\}[\s\S]*?(?:\{\1\}|$)/gi;

function decodeEntities(text) {
  return text.replace(SUPPLEMENTARY_ENTITY, (entity, hex, decimal) => {
    const codePoint = hex ? Number.parseInt(hex, 16) : Number(decimal);
    return codePoint >= 0x10000 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}

/**
 * Show stored comment text as the Jira page does: entities above U+FFFF become
 * their characters, except inside {code} and {noformat} blocks, which the page
 * shows literally. Entities below U+10000 (such as &amp; or &#233;) stay.
 *
 * @param {string | null | undefined} text
 * @returns {string | null | undefined}
 */
export function decodeSupplementaryEntities(text) {
  if (typeof text !== "string") return text;
  let decoded = "";
  let index = 0;
  for (const block of text.matchAll(LITERAL_BLOCK)) {
    decoded += decodeEntities(text.slice(index, block.index)) + block[0];
    index = block.index + block[0].length;
  }
  return decoded + decodeEntities(text.slice(index));
}

/**
 * The decoded view of a stored text field, keyed by `name`, for spreading into
 * a read result next to the stored text. Empty when decoding changes nothing,
 * so most results carry only the stored text.
 *
 * @param {string} name the result key, such as "decodedBody"
 * @param {unknown} text the stored text
 * @returns {Record<string, string>}
 */
export function decodedView(name, text) {
  if (typeof text !== "string") return {};
  const decoded = decodeSupplementaryEntities(text);
  return decoded === text ? {} : { [name]: decoded };
}
